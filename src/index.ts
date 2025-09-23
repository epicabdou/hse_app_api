import 'dotenv/config'
import express from 'express'
import {clerkClient, clerkMiddleware, getAuth, requireAuth} from '@clerk/express'
import {verifyWebhook} from "@clerk/express/webhooks";
import {UserService} from "./services/userService.js";
import cors from "cors";
import {requireRole} from "./middlewares/index.js";

const app = express()

app.use(express.json({ limit: "10mb" }));
app.use(clerkMiddleware())
app.use(cors({
    origin: ["http://localhost:5173"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET","POST","OPTIONS"],
}));

app.get('/', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>HSE Analysis App - API</title>
      </head>
      <body>
        <h1>HSE Analysis App 🚀</h1>
      </body>
    </html>
  `)
});

app.get(
    "/api/superadmin-only",
    requireAuth(),
    requireRole("superadmin"),
    (req, res) => {
        res.json({
            message: "Welcome superadmin!",
            timestamp: new Date().toISOString(),
            userId: req.user.id, // available thanks to the middleware
        });
    }
);


app.get('/protected', requireAuth(), async (req, res) => {
    // Use `getAuth()` to get the user's `userId`
    const { userId } = getAuth(req)

    // Use Clerk's JavaScript Backend SDK to get the user's User object
    const user = await clerkClient.users.getUser(userId)

    return res.json({ user })
})

app.post('/api/webhooks',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
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
    }
);

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
    });
});

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        requestId: req.id,
    });
});
/**
app.use( (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
    });
});
**/
export default app
