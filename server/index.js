import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { ZodError } from 'zod'
import { fileURLToPath } from 'url'
import path from 'path'
import { logger } from './lib/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import authRouter from './routes/auth.js'
import setupRouter from './routes/setup.js'
import usersRouter from './routes/users.js'
import customersRouter from './routes/customers.js'
import uomRouter from './routes/uomMappings.js'
import manufacturerRouter from './routes/manufacturerMappings.js'
import productRegistryRouter from './routes/productRegistry.js'
import dashboardRouter from './routes/dashboard.js'
import convertRouter from './routes/convert.js'
import downloadRouter from './routes/download.js'
import rfqRouter from './routes/rfq.js'
import partSourcingRouter from './routes/partSourcing.js'
import { startRfqScheduler } from './services/rfqGraphSync.js'

const app = express()

const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5173'
if (allowedOrigin === '*') {
  throw new Error('CLIENT_URL must be a specific origin, not a wildcard')
}

app.use(cors({ origin: allowedOrigin, credentials: true }))
app.use(express.json())
app.use(cookieParser())

app.use('/api/setup', setupRouter)
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/customers', customersRouter)
app.use('/api/uom-mappings', uomRouter)
app.use('/api/manufacturer-mappings', manufacturerRouter)
app.use('/api/product-registry', productRegistryRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/convert', convertRouter)
app.use('/api/download', downloadRouter)
app.use('/api/rfq', rfqRouter)
app.use('/api/part-sourcing', partSourcingRouter)

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

// In production, serve the built React app for all non-API routes.
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist')
  // Content-hashed assets (index-<hash>.js/css) can be cached forever — the hash
  // changes whenever the content does.
  app.use('/assets', express.static(path.join(clientDist, 'assets'), { immutable: true, maxAge: '1y' }))
  // Everything else, incl. index.html. index.html must NOT be long-cached, or a
  // browser holding an old copy will request bundle hashes that a later deploy
  // deleted → blank screen. no-cache = always revalidate (304 when unchanged).
  app.use(express.static(clientDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
    },
  }))
  // Regex excludes /api/* so Express still returns 404 for unknown API routes
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.startsWith('Unsupported file type')) {
    return res.status(400).json({ error: err.message })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.errors })
  }
  logger.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
  startRfqScheduler()
})

export default app
