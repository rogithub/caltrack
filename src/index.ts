import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import rateLimit from '@fastify/rate-limit'
import staticPlugin from '@fastify/static'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { authRoutes } from './api/auth.js'
import { profileRoutes } from './api/profile.js'
import { mealsRoutes } from './api/meals.js'
import { createMcpServer } from './mcp/server.js'
import { getUserByApiKey } from './db/queries.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: true })

app.decorateRequest('userId', '')

// ── OpenAPI / Swagger ────────────────────────────────────────────────────────
await app.register(swagger, {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'CalTrack API',
      description: 'Calorie tracking API with MCP server and AI Vision support',
      version: '1.0.0',
    },
    servers: [{ url: process.env.API_BASE_URL ?? 'http://localhost:3000' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  },
})

await app.register(swaggerUi, { routePrefix: '/docs' })

// ── Rate limiting (opt-in por ruta) ─────────────────────────────────────────
await app.register(rateLimit, { global: false })

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }))

// ── API routes ────────────────────────────────────────────────────────────────
await app.register(authRoutes)
await app.register(profileRoutes)
await app.register(mealsRoutes)

// ── MCP endpoint ──────────────────────────────────────────────────────────────
app.post('/mcp', { schema: { hide: true } }, async (req, reply) => {
  reply.hijack()

  let userId: string | null = null
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const apiKey = authHeader.slice(7)
    const user = await getUserByApiKey(apiKey)
    userId = user?.id ?? null
  }

  try {
    const transport  = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const mcpServer  = createMcpServer(userId)
    await mcpServer.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  } catch (err) {
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'Content-Type': 'application/json' })
      reply.raw.end(JSON.stringify({ error: 'Internal server error' }))
    }
    app.log.error(err)
  }
})

app.get('/mcp', { schema: { hide: true } }, async (_req, reply) => {
  return reply.status(405).send({ error: 'Use POST for MCP requests' })
})

// ── Static files (index.html, llms.txt, robots.txt, sitemap.xml) ─────────────
// Registrar DESPUÉS de las rutas API para que no interfiera
await app.register(staticPlugin, {
  root:           join(__dirname, '..', 'static'),
  prefix:         '/',
  decorateReply:  false,
})

// ── Start ─────────────────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT ?? '3000')

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
