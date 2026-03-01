const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9,
}

export function calculateBMR(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: 'male' | 'female'
): number {
  const base = (10 * weightKg) + (6.25 * heightCm) - (5 * ageYears)
  return Math.round(sex === 'male' ? base + 5 : base - 161)
}

export function calculateTDEE(bmr: number, activityLevel: string): number {
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.2
  return Math.round(bmr * multiplier)
}

export function isProfileComplete(profile: Record<string, unknown>): boolean {
  return !!(
    profile.weight_kg &&
    profile.height_cm &&
    profile.date_of_birth &&
    profile.biological_sex &&
    profile.activity_level
  )
}

export function buildProfileContext(
  profile: Record<string, unknown>,
  meals: Array<{ calories: number }>,
  from: Date,
  to: Date
): Record<string, number> | undefined {
  if (!isProfileComplete(profile)) return undefined

  const bmr = calculateBMR(
    Number(profile.weight_kg),
    Number(profile.height_cm),
    Number(profile.age),
    profile.biological_sex as 'male' | 'female'
  )
  const tdee = calculateTDEE(bmr, profile.activity_level as string)

  const daysDiff = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)))
  const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0)
  const avgDailyCalories = Math.round(totalCalories / daysDiff)

  return { bmr, tdee, avg_daily_deficit: tdee - avgDailyCalories }
}
