// src/index.ts
import { clerkClient, clerkMiddleware, getAuth, requireAuth } from "@clerk/express";
import { verifyWebhook } from "@clerk/express/webhooks";
import { UserService } from "./services/userService.js";
import history from "connect-history-api-fallback";
import serveStatic from "serve-static";
import compression from "compression";
import { fileURLToPath } from "url";
import express from "express";
// import morgan from "morgan";
import cors from "cors";
import path from "path";
import "dotenv/config";

import usersRouter from "./routes/users.js";
import inspectionsRouter from "./routes/inspections.js";
import uploadsRouter from "./routes/uploads.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by"); // NEW

// Order matters:
app.use(compression());
// app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(clerkMiddleware());

// 1) CORS FIRST so preflights never hit auth
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:8081",
    "exp://192.168.8.5:8081"
];
app.use(
    cors({
        origin(origin, cb) {
            if (!origin) return cb(null, true);
            const ok = allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin);
            cb(ok ? null : new Error(`CORS blocked for origin: ${origin}`), ok);
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "Origin",
            "Accept",
            "X-Requested-With",
            "Clerk-Redirect-To",
        ],
        optionsSuccessStatus: 204,
    })
);
app.options("*", cors());

// 2) Body parsers
app.use(express.json({ limit: "10mb" }));

// ---------- API ROUTES ----------
app.get("/api/superadmin-only", requireAuth(), async (req, res) => {
    const { userId } = getAuth(req);
    try {
        const user = await clerkClient.users.getUser(userId);
        const role = user?.publicMetadata?.appRole;
        if (role !== "superadmin") {
            // NEW: explicit JSON and return (no fallthrough)
            return res.status(403).json({ error: "Forbidden: superadmin access required" });
        }
        res.json({
            message: "Welcome superadmin!",
            timestamp: new Date().toISOString(),
            userId,
        });
    } catch (error) {
        console.error("Error fetching user:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/api/protected", requireAuth(), async (req, res) => {
    const { userId } = getAuth(req);
    const user = await clerkClient.users.getUser(userId);
    return res.json({ user });
});

app.post("/api/webhooks", express.raw({ type: "application/json" }), async (req, res) => {
    try {
        const evt = await verifyWebhook(req);
        const { type, data } = evt;
        switch (type) {
            case "user.created":
                await UserService.createUser(data);
                break;
            case "user.updated":
                await UserService.updateUser(data.id, data);
                break;
            case "user.deleted":
                await UserService.deleteUser(data.id);
                break;
            default:
                console.log(`Unhandled webhook event type: ${type}`);
        }
        return res.status(200).json({
            success: true,
            message: "Webhook processed successfully",
            eventId: data.id,
            eventType: type,
        });
    } catch (error: any) {
        console.error("Webhook processing error:", error);
        if (error.message?.includes("verification failed")) {
            return res.status(401).json({ error: "Webhook verification failed" });
        }
        return res.status(500).json({ error: "Internal server error", message: error.message });
    }
});

app.get("/api/health", (_req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "1.0.0",
    });
});

app.use("/api/users", usersRouter);
app.use("/api/inspections", inspectionsRouter);
app.use("/api/uploads", uploadsRouter);

// ---------- API 404 + API ERROR HANDLERS (JSON) ----------
app.use("/api", (_req, res) => {
    // NEW: any unmatched /api/* → JSON 404 (prevents history/static fallback)
    res.status(404).json({ error: "Not found" });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    // NEW: API-scoped error serializer; do not fall through to SPA
    if (req.path.startsWith("/api/")) {
        const status = Number(err?.status || err?.statusCode || 500);
        const message = err?.message || "Internal server error";
        if (!res.headersSent) {
            return res.status(status).json({ error: message });
        }
        return; // if headers already sent, let Express end it
    }
    return next(err);
});

// ---------- SPA static serving (ONLY non-API) ----------
const distDir = path.resolve(__dirname, "dist");

app.use(
    history({
        rewrites: [
            { from: /^\/api\/.*$/, to: (ctx) => ctx.parsedUrl.path }, // keep API paths intact
        ],
    })
);

app.use(
    serveStatic(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
            if (/\.(?:js|css|mjs|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(filePath)) {
                res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            } else {
                res.setHeader("Cache-Control", "public, max-age=3600");
            }
        },
    })
);

app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(distDir, "index.html"));
});

export default app;