import 'dotenv/config'
import express from 'express'
import {clerkClient, clerkMiddleware, getAuth, requireAuth} from '@clerk/express'
import {verifyWebhook} from "@clerk/express/webhooks";
import {UserService} from "./services/userService.js";
import helmet from 'helmet';

const app = express()
app.use(clerkMiddleware())

// Security middleware
app.use(helmet());

// Home route - HTML
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
})

// Use requireAuth() to protect this route
// If user isn't authenticated, requireAuth() will redirect back to the homepage
app.get('/protected', requireAuth(), async (req, res) => {
    // Use `getAuth()` to get the user's `userId`
    const { userId } = getAuth(req)

    // Use Clerk's JavaScript Backend SDK to get the user's User object
    const user = await clerkClient.users.getUser(userId)

    return res.json({ user })
})

// Webhook endpoint with raw body parsing
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

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        requestId: req.id,
    });
});

// 404 handler
app.use( (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
    });
});

export default app
