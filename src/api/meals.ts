import type { FastifyInstance } from 'fastify'
import { logMeal, getMeals, getUserProfile } from '../db/queries.js'
import { buildProfileContext } from '../lib/nutrition.js'
import { authMiddleware } from '../middleware/auth.js'

const MAX_DAYS = 90

export async function mealsRoutes(app: FastifyInstance) {
  app.post('/meals', {
    preHandler: authMiddleware,
    schema: {
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['description', 'calories'],
        properties: {
          description: { type: 'string' },
          calories:    { type: 'integer' },
          protein_g:   { type: 'number' },
          carbs_g:     { type: 'number' },
          fat_g:       { type: 'number' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      description: string
      calories: number
      protein_g?: number
      carbs_g?: number
      fat_g?: number
    }
    const meal = await logMeal(req.userId, body)
    return reply.status(201).send(meal)
  })

  app.get('/meals', {
    preHandler: authMiddleware,
    schema: {
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string' },
          to:   { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { from, to } = req.query as { from: string; to: string }

    const fromDate = new Date(from)
    const toDate   = new Date(to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return reply.status(400).send({ error: 'Invalid date format. Use ISO 8601 UTC.' })
    }

    const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)

    if (daysDiff <= 0) {
      return reply.status(400).send({ error: '`to` must be after `from`' })
    }
    if (daysDiff > MAX_DAYS) {
      return reply.status(400).send({ error: `Date range cannot exceed ${MAX_DAYS} days` })
    }

    const [meals, profile] = await Promise.all([
      getMeals(req.userId, from, to),
      getUserProfile(req.userId),
    ])

    const days = Math.max(1, Math.ceil(daysDiff))
    const mealsList = meals as unknown as Array<{ calories: number }>
    const totalCalories = mealsList.reduce((sum, m) => sum + m.calories, 0)

    const response: Record<string, unknown> = {
      from,
      to,
      meals,
      summary: {
        total_meals:        meals.length,
        avg_daily_calories: Math.round(totalCalories / days),
      },
    }

    const profileContext = buildProfileContext(profile, mealsList, fromDate, toDate)
    if (profileContext) response.profile_context = profileContext

    return reply.send(response)
  })
}
