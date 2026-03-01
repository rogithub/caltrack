import type { FastifyInstance } from 'fastify'
import { createUser } from '../db/queries.js'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 hour' },
    },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            api_key: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { email } = req.body as { email: string }
    try {
      const user = await createUser(email)
      return reply.status(201).send({
        api_key: user.api_key,
        message: 'Guarda esta key, no se puede recuperar',
      })
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: 'Email already registered' })
      }
      throw err
    }
  })
}
