import postgres from 'postgres'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required')
}

const sql = postgres(process.env.DATABASE_URL)

export default sql
