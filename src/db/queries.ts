import { randomBytes } from 'crypto'
import sql from './client.js'

export function generateApiKey(): string {
  return `cal_${randomBytes(16).toString('hex')}`
}

export async function createUser(email: string) {
  const apiKey = generateApiKey()
  const rows = await sql`
    INSERT INTO users (email, api_key)
    VALUES (${email}, ${apiKey})
    RETURNING id, email, api_key
  `
  return rows[0]
}

export async function getUserByApiKey(apiKey: string) {
  const rows = await sql`
    SELECT id FROM users WHERE api_key = ${apiKey}
  `
  return rows[0] as { id: string } | undefined
}

export async function getUserProfile(userId: string) {
  const rows = await sql`
    SELECT *,
      EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age
    FROM users
    WHERE id = ${userId}
  `
  return rows[0] as Record<string, unknown>
}

export async function updateUserProfile(
  userId: string,
  updates: Record<string, unknown>
) {
  const rows = await sql`
    UPDATE users
    SET ${sql(updates)}
    WHERE id = ${userId}
    RETURNING *,
      EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age
  `
  return rows[0] as Record<string, unknown>
}

export async function logMeal(
  userId: string,
  meal: {
    description: string
    calories: number
    protein_g?: number
    carbs_g?: number
    fat_g?: number
  }
) {
  const rows = await sql`
    INSERT INTO meals (user_id, description, calories, protein_g, carbs_g, fat_g)
    VALUES (
      ${userId},
      ${meal.description},
      ${meal.calories},
      ${meal.protein_g ?? null},
      ${meal.carbs_g ?? null},
      ${meal.fat_g ?? null}
    )
    RETURNING *
  `
  return rows[0]
}

export async function getMeals(userId: string, from: string, to: string) {
  return sql`
    SELECT * FROM meals
    WHERE user_id = ${userId}
      AND eaten_at >= ${from}::timestamptz
      AND eaten_at <  ${to}::timestamptz
    ORDER BY eaten_at ASC
    LIMIT 200
  `
}
