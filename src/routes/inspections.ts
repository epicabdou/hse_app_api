// src/routes/inspections.ts
import express from "express";
import { clerkClient, getAuth, requireAuth } from "@clerk/express";
import {OpenAI} from "openai";
import { z } from "zod";
import { db } from "../db/index.js";
import {
    users,
    inspections,
    usageLogs,
    analysisResultSchema,
    type AnalysisResult,
} from "../db/schema.js";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { HSE_ANALYSIS_PROMPT } from "../lib/prompt.js";
import { base64ToBuffer, compressToWebP } from "../lib/image.js";
import { uploadBufferToBlob } from "../lib/blob.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function ensureSuperadmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const me = await clerkClient.users.getUser(userId);
        const role = (me?.publicMetadata as any)?.appRole;
        if (role !== "superadmin")
            return res.status(403).json({ error: "Forbidden: superadmin access required" });
        next();
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Internal server error" });
    }
}

/** Helpers */
const MONTHLY_INSPECTION_LIMIT = Number(process.env.MONTHLY_INSPECTION_LIMIT ?? 100);

function sameMonth(a: Date, b: Date) {
    return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

async function getOrCreateAppUserByClerkId(clerkUserId: string) {
    const rows = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
    if (rows.length) return rows[0];

    const u = await clerkClient.users.getUser(clerkUserId);
    const email = u?.emailAddresses?.[0]?.emailAddress ?? "unknown@example.com";
    const first = u?.firstName ?? null;
    const last = u?.lastName ?? null;
    const imageUrl = u?.imageUrl ?? null;

    const inserted = await db
        .insert(users)
        .values({
            clerkUserId,
            email,
            firstName: first ?? undefined,
            lastName: last ?? undefined,
            imageUrl: imageUrl ?? undefined,
            isActive: true,
        })
        .returning();
    return inserted[0];
}

async function incrementUserInspectionCounters(userId: string) {
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return;

    const now = new Date();
    let monthly = row.monthlyInspectionCount ?? 0;
    let lastReset = row.lastResetDate ? new Date(row.lastResetDate) : now;

    if (!sameMonth(now, lastReset)) {
        monthly = 0;
        lastReset = now;
    }

    await db
        .update(users)
        .set({
            inspectionCount: (row.inspectionCount ?? 0) + 1,
            monthlyInspectionCount: monthly + 1,
            lastResetDate: lastReset,
            updatedAt: now,
        })
        .where(eq(users.id, row.id));
}

async function canRunAnotherInspection(appUserId: string) {
    const [row] = await db.select().from(users).where(eq(users.id, appUserId)).limit(1);
    if (!row) return true;
    const now = new Date();
    const monthly =
        sameMonth(now, new Date(row.lastResetDate ?? now)) ? (row.monthlyInspectionCount ?? 0) : 0;
    return monthly < MONTHLY_INSPECTION_LIMIT;
}

/** Local payload schema: allow EITHER imageUrl OR base64 imageData */
const analyzePayloadSchema = z.object({
    imageUrl: z.url().optional(),
    imageData: z.string().min(1, "imageData cannot be empty").optional(), // raw base64, no data: prefix
    imageType: z.string().optional().default("image/jpeg"),
}).refine(v => !!v.imageUrl || !!v.imageData, {
    message: "Provide imageUrl or imageData",
});

/** /api/inspections/analyze → POST
 * Body: { imageUrl } OR { imageData, imageType }
 */
router.post("/analyze", requireAuth(), async (req, res) => {
    const t0 = Date.now();
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    // Validate payload (we accept both URL and base64)
    const parsed = analyzePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const { imageUrl, imageData, imageType = "image/jpeg" } = parsed.data;

    try {
        const appUser = await getOrCreateAppUserByClerkId(clerkUserId);

        // Enforce monthly quota
        const allowed = await canRunAnotherInspection(appUser.id);
        if (!allowed) {
            return res.status(429).json({
                error: "Monthly inspection limit reached",
                limit: MONTHLY_INSPECTION_LIMIT,
            });
        }

        // If client sent base64, compress → webp and upload to Blob; otherwise use provided URL
        let finalImageUrl = imageUrl as string | undefined;

        if (!finalImageUrl && imageData) {
            // Approximate size check to avoid over-large requests if someone bypassed client compression
            const approxBytes = Math.floor(imageData.length * 0.75);
            if (approxBytes > 8_000_000) { // 8MB guardrail
                return res.status(413).json({ error: "Image too large. Please upload a smaller photo." });
            }

            const rawBuf = base64ToBuffer(imageData);
            const webp = await compressToWebP(rawBuf, { maxSide: 1600, quality: 72 });

            const key = `inspections/${appUser.id}/${Date.now()}.webp`;
            const put = await uploadBufferToBlob(key, webp.buffer, "image/webp", { access: "public" });
            finalImageUrl = put.url;
        }

        if (!finalImageUrl) {
            return res.status(400).json({ error: "No usable image provided" });
        }

        // Build strict system message
        const systemMsg =
            HSE_ANALYSIS_PROMPT +
            `
                STRICT OUTPUT RULES:
                - Return ONLY the JSON object described above.
                - Do NOT include backticks, markdown, code fences, or any commentary.
                - Ensure all enum and numeric fields meet the exact constraints.
            `;

        const startOpenAI = Date.now();

        // Vision request (Chat Completions using image URL)
        const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL ?? "gpt-4o",
            temperature: 0,
            messages: [
                { role: "system", content: systemMsg },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Analyze this workplace image." },
                        { type: "image_url", image_url: { url: finalImageUrl } },
                    ],
                },
            ],
        });

        // Extract assistant text
        const choice = completion.choices?.[0];
        const msg = choice?.message;
        let outputText = "";
        if (typeof msg?.content === "string") {
            outputText = msg.content;
        } else if ((msg as any)?.content && Array.isArray((msg as any).content)) {
            const parts = (msg as any).content as Array<{ type?: string; text?: string }>;
            outputText = parts.map(p => (p?.type === "text" ? p.text ?? "" : "")).join("").trim();
        }

        // Validate JSON with Zod
        let analysis: AnalysisResult;
        try {
            analysis = analysisResultSchema.parse(JSON.parse(outputText));
        } catch (e) {
            console.error("Zod validation failed. First 500 chars:", outputText.slice(0, 500));
            return res.status(502).json({
                error: "Model returned an unexpected format",
                details: e instanceof z.ZodError ? e.issues : String(e),
            });
        }

        // Persist inspection (store URLs, not giant data URIs)
        const now = new Date();
        const [inserted] = await db.insert(inspections).values({
            userId: appUser.id,
            imageUrl: finalImageUrl,        // public Blob URL for your UI
            originalImageUrl: finalImageUrl, // keep same for now; set to raw upload if you keep originals
            hazardCount: analysis.hazards.length,
            riskScore: analysis.overallAssessment.riskScore,
            safetyGrade: analysis.overallAssessment.safetyGrade,
            analysisResults: analysis as any,
            processingStatus: "completed",
            createdAt: now,
            updatedAt: now,
        }).returning();

        await incrementUserInspectionCounters(appUser.id);

        // tokensUsed — safe number | null
        let tokensUsed: number | null = null;
        const u = completion.usage;
        if (u) {
            tokensUsed = u.total_tokens !== undefined
                ? u.total_tokens
                : (u.completion_tokens ?? 0) + (u.prompt_tokens ?? 0);
        }

        const respMs = Date.now() - t0;
        await db.insert(usageLogs).values({
            userId: appUser.id,
            endpoint: "/api/inspections/analyze",
            tokensUsed,
            apiCost: null,
            responseTime: respMs,
            success: true,
            createdAt: new Date(),
        });

        return res.status(200).json({
            ok: true,
            inspection: inserted,
            analysis,
            usage: {
                responseMs: respMs,
                openAiLatencyMs: Date.now() - startOpenAI,
                tokensUsed,
            },
        });
    } catch (err: any) {
        console.error("Analyze error:", err);
        try {
            if (clerkUserId) {
                const appUser = await getOrCreateAppUserByClerkId(clerkUserId);
                await db.insert(usageLogs).values({
                    userId: appUser.id,
                    endpoint: "/api/inspections/analyze",
                    success: false,
                    errorType: err?.name ?? "Error",
                    responseTime: Date.now() - t0,
                    createdAt: new Date(),
                });
            }
        } catch {}

        if (err?.status === 401 || err?.status === 403) {
            return res.status(err.status).json({ error: "OpenAI authentication failed" });
        }
        return res.status(500).json({ error: "Internal server error", message: err?.message });
    }
});

/** /api/inspections/list → GET (paginated) */
router.get("/list", requireAuth(), async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const page = Math.max(1, Number(req.query.page ?? "1"));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? "20")));
    const offset = (page - 1) * pageSize;

    const appUser = await getOrCreateAppUserByClerkId(clerkUserId);
    const rows = await db
        .select()
        .from(inspections)
        .where(eq(inspections.userId, appUser.id))
        .orderBy(desc(inspections.createdAt))
        .limit(pageSize)
        .offset(offset);

    return res.status(200).json({ ok: true, inspections: rows, page, pageSize });
});

/** /api/inspections/:id → GET */
router.get("/:id", requireAuth(), async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const appUser = await getOrCreateAppUserByClerkId(clerkUserId);
    const { id } = req.params;

    const rows = await db.select().from(inspections).where(eq(inspections.id, id as any)).limit(1);
    const row = rows[0];
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    if (row.userId !== appUser.id) return res.status(403).json({ ok: false, error: "Forbidden" });

    return res.status(200).json({ ok: true, inspection: row });
});

/** /api/inspections/admin/stats → GET (superadmin only) */
router.get("/admin/stats", requireAuth(), ensureSuperadmin, async (_req, res) => {
    const total = await db.select({ count: inspections.id }).from(inspections);
    const byUser = await db.execute(sql`
    SELECT user_id AS "userId", COUNT(*)::int AS count
    FROM inspections
    GROUP BY user_id
    ORDER BY count DESC
    LIMIT 20;
  `);

    return res.status(200).json({
        ok: true,
        metrics: {
            totalInspections: (total as any)[0]?.count ?? 0,
            topUsers: byUser,
        },
    });
});

router.get("/admin/all", requireAuth(), ensureSuperadmin, async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? "20")));
    const offset = (page - 1) * pageSize;

    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const grade = typeof req.query.grade === "string" ? req.query.grade : undefined; // A|B|C|D|F
    const status = typeof req.query.status === "string" ? req.query.status : undefined; // pending|processing|completed|failed
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
    const sortByRaw =
        typeof req.query.sortBy === "string" ? req.query.sortBy : "createdAt";
    const orderRaw =
        typeof req.query.order === "string" ? req.query.order : "desc";

    // Build WHERE
    const clauses = [];
    if (userId) clauses.push(eq(inspections.userId, userId as any));
    if (grade) clauses.push(eq(inspections.safetyGrade, grade as any));
    if (status) clauses.push(eq(inspections.processingStatus, status as any));
    if (from) clauses.push(gte(inspections.createdAt, from));
    if (to) clauses.push(lte(inspections.createdAt, to));
    const where = clauses.length ? and(...clauses) : undefined;

    // Sorting
    const sortByCol =
        sortByRaw === "riskScore"
            ? inspections.riskScore
            : sortByRaw === "hazardCount"
                ? inspections.hazardCount
                : inspections.createdAt;

    const orderBy = orderRaw.toLowerCase() === "asc" ? asc(sortByCol) : desc(sortByCol);

    // Data query (join with users to include email/name)
    const rows = await db
        .select({
            id: inspections.id,
            createdAt: inspections.createdAt,
            updatedAt: inspections.updatedAt,
            userId: inspections.userId,
            imageUrl: inspections.imageUrl,
            hazardCount: inspections.hazardCount,
            riskScore: inspections.riskScore,
            safetyGrade: inspections.safetyGrade,
            processingStatus: inspections.processingStatus,
            // user info
            userEmail: users.email,
            userFirstName: users.firstName,
            userLastName: users.lastName,
        })
        .from(inspections)
        .leftJoin(users, eq(users.id, inspections.userId))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset);

    // Total count for pagination
    const totalRes = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(inspections)
        .where(where);

    const total = totalRes[0]?.count ?? 0;

    return res.status(200).json({
        ok: true,
        page,
        pageSize,
        total,
        inspections: rows,
    });
});

export default router;