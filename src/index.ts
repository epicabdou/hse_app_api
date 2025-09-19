import express from 'express';

const app = express()

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

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app
