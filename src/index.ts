import 'dotenv/config'
import express from 'express'
import {clerkClient, clerkMiddleware, getAuth, requireAuth} from '@clerk/express'

const app = express()
app.use(clerkMiddleware())

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


// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app
