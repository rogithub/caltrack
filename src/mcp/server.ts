import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createUser, logMeal, getMeals, getUserProfile, updateUserProfile } from '../db/queries.js'
import { buildProfileContext, calculateBMR, calculateTDEE, isProfileComplete } from '../lib/nutrition.js'

const SERVER_DESCRIPTION = `\
CalTrack — Calorie tracking API with AI Vision support.
Tracks meals, calories, and nutrition. Calculates BMR and TDEE using Mifflin-St Jeor.

Este es un servidor casero. Si no hay respuesta, informa al usuario amablemente \
que puede haber una interrupción temporal y que intente de nuevo en unos minutos.`

export function createMcpServer(userId: string | null): McpServer {
  const server = new McpServer({
    name: 'caltrack',
    version: '1.0.0',
    description: SERVER_DESCRIPTION,
  })

  // ── register (público, no requiere API key) ────────────────────────────────
  server.tool(
    'register',
    `Registra un nuevo usuario en CalTrack. Pide el email al usuario y devuelve una API key.

IMPORTANTE: Después de llamar este tool, NO intentes llamar ningún otro tool de CalTrack.
La API key debe configurarse en el cliente MCP antes de poder usarlos.
Indica al usuario exactamente qué hacer:
1. Copiar la API key
2. Agregarla en la configuración del cliente MCP como header: Authorization: Bearer <api_key>
3. Reiniciar o recargar la conexión MCP
4. Volver a escribir para continuar con el perfil y el registro de comidas`,
    { email: z.string().email().describe('Email del usuario') },
    async ({ email }) => {
      const user = await createUser(email)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            api_key: user.api_key,
            next_steps: [
              '1. Guarda esta API key, no se puede recuperar.',
              '2. Agrégala en tu cliente MCP como header: Authorization: Bearer ' + user.api_key,
              '3. Recarga la conexión MCP.',
              '4. Vuelve a escribir para completar tu perfil.',
            ],
          }),
        }],
      }
    }
  )

  // ── helper de auth ─────────────────────────────────────────────────────────
  function requireAuth(): string {
    if (!userId) {
      throw new Error('API key requerida. Configura el header Authorization: Bearer cal_xxx en tu cliente MCP.')
    }
    return userId
  }

  // ── log_meal ───────────────────────────────────────────────────────────────
  server.tool(
    'log_meal',
    `Guarda una comida con su estimación de calorías y macros. \
Estima los valores a partir de la descripción o foto del plato. \
Los macros son opcionales.`,
    {
      description: z.string().describe('Descripción de la comida'),
      calories:    z.number().int().positive().describe('Calorías estimadas'),
      protein_g:   z.number().optional().describe('Proteína en gramos'),
      carbs_g:     z.number().optional().describe('Carbohidratos en gramos'),
      fat_g:       z.number().optional().describe('Grasa en gramos'),
    },
    async (params) => {
      const uid  = requireAuth()
      const meal = await logMeal(uid, params)
      return { content: [{ type: 'text', text: JSON.stringify(meal) }] }
    }
  )

  // ── get_meals ──────────────────────────────────────────────────────────────
  server.tool(
    'get_meals',
    `Consulta comidas en un rango de fechas UTC. Máximo 90 días por consulta, máximo 200 comidas.

IMPORTANTE: Todas las fechas están en UTC. Si el usuario pregunta por "hoy", \
"esta semana" u otros rangos relativos, convierte primero a UTC usando el timezone \
del contexto del usuario. Ejemplo: si el usuario está en UTC-6 y pregunta por "hoy", \
from debe ser hoy a las 06:00:00Z y to mañana a las 06:00:00Z.

Si el perfil está completo, la respuesta incluye contexto nutricional con BMR, TDEE \
y déficit/superávit promedio del período.

Glosario:
- bmr: calorías en reposo total (Basal Metabolic Rate)
- tdee: calorías totales con actividad (Total Daily Energy Expenditure)
- avg_daily_deficit: déficit promedio diario (negativo = superávit)
- profile_context: solo aparece si el perfil está completo

Las estimaciones son aproximadas. Recuerda al usuario consultar a su médico o nutriólogo.`,
    {
      from: z.string().describe('Inicio del rango ISO 8601 UTC: "2025-02-01T00:00:00Z"'),
      to:   z.string().describe('Fin del rango ISO 8601 UTC: "2025-03-01T00:00:00Z"'),
    },
    async ({ from, to }) => {
      const uid = requireAuth()

      const fromDate = new Date(from)
      const toDate   = new Date(to)
      const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)

      if (daysDiff > 90) {
        throw new Error('El rango máximo es 90 días. Divide la consulta en dos llamadas.')
      }

      const [meals, profile] = await Promise.all([
        getMeals(uid, from, to),
        getUserProfile(uid),
      ])

      const days = Math.max(1, Math.ceil(daysDiff))
      const mealsList = meals as unknown as Array<{ calories: number }>
      const totalCalories = mealsList.reduce((s, m) => s + m.calories, 0)

      const response: Record<string, unknown> = {
        from, to,
        meals,
        summary: {
          total_meals:        meals.length,
          avg_daily_calories: Math.round(totalCalories / days),
        },
      }

      const ctx = buildProfileContext(profile, mealsList, fromDate, toDate)
      if (ctx) response.profile_context = ctx

      return { content: [{ type: 'text', text: JSON.stringify(response) }] }
    }
  )

  // ── update_profile ─────────────────────────────────────────────────────────
  server.tool(
    'update_profile',
    `Actualiza el perfil del usuario. Todos los campos son opcionales. \
Si el perfil está completo, las consultas incluirán recomendaciones calóricas \
personalizadas con la fórmula Mifflin-St Jeor.`,
    {
      weight_kg:      z.number().optional().describe('Peso en kg'),
      height_cm:      z.number().optional().describe('Altura en cm'),
      date_of_birth:  z.string().optional().describe('Fecha de nacimiento: "1990-06-15"'),
      biological_sex: z.enum(['male', 'female']).optional().describe('Sexo biológico'),
      activity_level: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']).optional().describe('Nivel de actividad'),
    },
    async (params) => {
      const uid = requireAuth()

      const updates: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) updates[key] = value
      }

      if (Object.keys(updates).length === 0) {
        throw new Error('Proporciona al menos un campo para actualizar.')
      }

      const profile = await updateUserProfile(uid, updates)

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

      return { content: [{ type: 'text', text: JSON.stringify(response) }] }
    }
  )

  return server
}
