// src/index.ts
import {clerkClient, clerkMiddleware, getAuth, requireAuth} from "@clerk/express";
import {verifyWebhook} from "@clerk/express/webhooks";
import {UserService} from "./services/userService.js";
import history from "connect-history-api-fallback";
import serveStatic from "serve-static";
import compression from "compression";
import { fileURLToPath } from "url";
import express from 'express'
import morgan from "morgan";
import cors from "cors";
import path from "path";
import 'dotenv/config'

import usersRouter from "./routes/users.js";
import inspectionsRouter from "./routes/inspections.js";
import uploadsRouter from "./routes/uploads.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express()

//app.use(helmet());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use(express.json({ limit: "10mb" }));
app.use(clerkMiddleware())

// 1) CORS *first*, so it handles OPTIONS before auth middlewares
const allowedOrigins = [
    "http://localhost:5173",   // your Vite web app
    "http://localhost:8081",   // Expo web dev server
    "exp://192.168.8.5:8081",
    "https://hseappapi.vercel.app"
];

app.use(
    cors({
        origin(origin, cb) {
            if (!origin) return cb(null, true); // mobile apps / curl (no origin) → allow
            const ok =
                allowedOrigins.includes(origin) ||
                /\.vercel\.app$/.test(origin); // allow other vercel previews if you want
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

app.get('/api/superadmin-only', requireAuth(), async (req, res) => {
    const { userId } = getAuth(req)

    try {
        const user = await clerkClient.users.getUser(userId)
        const role = user?.publicMetadata?.appRole

        if (role !== "superadmin") {
            return res.status(403).json({ error: "Forbidden: superadmin access required" });
        }

        res.json({
            message: "Welcome superadmin!",
            timestamp: new Date().toISOString(),
            userId: userId
        });

    } catch (error) {
        console.error('Error fetching user:', error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/protected', requireAuth(), async (req, res) => {
    // Use `getAuth()` to get the user's `userId`
    const { userId } = getAuth(req)

    // Use Clerk's JavaScript Backend SDK to get the user's User object
    const user = await clerkClient.users.getUser(userId)

    return res.json({ user })
})

app.post('/api/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
        try {
            console.log('Webhook received, verifying...');

            // Verify the webhook
            const evt = await verifyWebhook(req);
            const { type, data } = evt;

            console.log(`Webhook verified: ID ${data.id}, Type: ${type}`);

            // Handle different event types
            switch (type) {
                case 'user.created':
                    console.log('Processing user.created event');
                    await UserService.createUser(data);
                    break;

                case 'user.updated':
                    console.log('Processing user.updated event');
                    await UserService.updateUser(data.id, data);
                    break;

                case 'user.deleted':
                    console.log('Processing user.deleted event');
                    await UserService.deleteUser(data.id);
                    break;

                default:
                    console.log(`Unhandled webhook event type: ${type}`);
            }

            return res.status(200).json({
                success: true,
                message: 'Webhook processed successfully',
                eventId: data.id,
                eventType: type
            });

        } catch (error) {
            console.error('Webhook processing error:', error);

            // Return appropriate error response
            if (error.message.includes('verification failed')) {
                return res.status(401).json({ error: 'Webhook verification failed' });
            }

            return res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    });

app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
    });
});

app.use("/api/users", usersRouter);
app.use('/api/inspections', inspectionsRouter);
app.use("/api/uploads", uploadsRouter);

// --- SPA static serving
const distDir = path.resolve(__dirname, "dist");

// 1) Let the history middleware reroute unknown non-API requests to /index.html
app.use(history({
    // only rewrite non-API calls
    rewrites: [
        { from: /^\/api\/.*$/, to: context => context.parsedUrl.path } // keep API paths intact
    ],
}));

// 2) Serve static assets with long caching
app.use(
    serveStatic(distDir, {
        index: false, // we’ll send index manually so we can set headers
        setHeaders: (res, filePath) => {
            if (/\.(?:js|css|mjs|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(filePath)) {
                // cache immutable build assets for 1 year
                res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            } else {
                // default short cache
                res.setHeader("Cache-Control", "public, max-age=3600");
            }
        },
    })
);

// 3) Catch-all to send index.html for SPA entry (no-cache to ensure fresh HTML)
app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(distDir, "index.html"));
});

export default app
