// src/routes/users.ts
import express from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users as usersTable } from "../db/schema.js";
import { clerkClient, getAuth, requireAuth } from "@clerk/express";

const router = express.Router();

/** Optional: gate mutations to superadmins only */
async function ensureSuperadmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
        const { userId } = getAuth(req);
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const me = await clerkClient.users.getUser(userId);
        const role = (me?.publicMetadata as any)?.appRole;
        if (role !== "superadmin") return res.status(403).json({ error: "Forbidden: superadmin access required" });
        next();
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Internal server error" });
    }
}

const UpdateUserSchema = z.object({
    isActive: z.boolean().optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    monthlyInspectionCount: z.number().int().min(0).optional(),
    lastResetDate: z.coerce.date().optional(), // accepts ISO string
}).refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

router.get("/admin/", requireAuth(), ensureSuperadmin, async (_req, res) => {
    try {
        const rows = await db.select().from(usersTable);
        res.status(200).json(rows);
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: "Failed to load users" });
    }
});

/** PATCH /api/users/:id — partial update */
router.patch("/admin/:id", requireAuth(), ensureSuperadmin, async (req, res) => {
    const { id } = req.params;

    const parsed = UpdateUserSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const body = parsed.data;

    // Build update object only with provided fields
    const updateData: Partial<typeof usersTable.$inferInsert> = {};
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.firstName !== undefined) updateData.firstName = body.firstName || null;
    if (body.lastName !== undefined) updateData.lastName = body.lastName || null;
    if (body.monthlyInspectionCount !== undefined) updateData.monthlyInspectionCount = body.monthlyInspectionCount;
    if (body.lastResetDate !== undefined) updateData.lastResetDate = body.lastResetDate;

    try {
        const updated = await db
            .update(usersTable)
            .set({ ...updateData, updatedAt: new Date() })
            .where(eq(usersTable.id, id))
            .returning();

        if (!updated.length) return res.status(404).json({ error: "User not found" });
        res.status(200).json(updated[0]);
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: "Failed to update user" });
    }
});

export default router;
