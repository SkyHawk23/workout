import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  // Fails loudly at cold start rather than on the first query.
  throw new Error("DATABASE_URL is not set");
}

// Neon's HTTP driver: one query per call, no pool to manage, well suited to
// Vercel's serverless functions. `sql` is a tagged-template query function;
// use sql.query(text, params) for dynamically-built statements.
export const sql = neon(connectionString);
