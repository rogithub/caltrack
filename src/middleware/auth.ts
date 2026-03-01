import type { FastifyRequest, FastifyReply } from 'fastify'
import { getUserByApiKey } from '../db/queries.js'

// Augment FastifyRequest with userId
declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' })
  }
  const apiKey = authHeader.slice(7)
  const user = await getUserByApiKey(apiKey)
  if (!user) {
    return reply.status(401).send({ error: 'Invalid API key' })
  }
  req.userId = user.id
}
