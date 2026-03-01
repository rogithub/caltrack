import type { FastifyInstance } from 'fastify'
import { updateUserProfile } from '../db/queries.js'
import { calculateBMR, calculateTDEE, isProfileComplete } from '../lib/nutrition.js'
import { authMiddleware } from '../middleware/auth.js'

const ALLOWED_FIELDS = ['weight_kg', 'height_cm', 'date_of_birth', 'biological_sex', 'activity_level']

export async function profileRoutes(app: FastifyInstance) {
  app.put('/profile', {
    preHandler: authMiddleware,
    schema: {
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          weight_kg:      { type: 'number' },
          height_cm:      { type: 'number' },
          date_of_birth:  { type: 'string', format: 'date' },
          biological_sex: { type: 'string', enum: ['male', 'female'] },
          activity_level: { type: 'string', enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as Record<string, unknown>

    const updates: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in body && body[key] !== undefined) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update' })
    }

    const profile = await updateUserProfile(req.userId, updates)

    const response: Record<string, unknown> = {
      weight_kg:      profile.weight_kg,
      height_cm:      profile.height_cm,
      date_of_birth:  profile.date_of_birth,
      biological_sex: profile.biological_sex,
      activity_level: profile.activity_level,
    }

    if (isProfileComplete(profile)) {
      const bmr = calculateBMR(
        Number(profile.weight_kg),
        Number(profile.height_cm),
        Number(profile.age),
        profile.biological_sex as 'male' | 'female'
      )
      response.bmr  = bmr
      response.tdee = calculateTDEE(bmr, profile.activity_level as string)
    }

    return reply.send(response)
  })
}
