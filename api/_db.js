import { neon, types } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  // Fails loudly at cold start rather than on the first query.
  throw new Error("DATABASE_URL is not set");
}

// The driver's default parser for `date` (OID 1082) treats it like a
// timestamp and returns a JS Date — which then serializes over JSON as a
// full UTC instant ("2026-09-28T00:00:00.000Z") and silently shifts a day
// in any timezone west of UTC. Every `date` column in this schema is
// stored and compared as a plain YYYY-MM-DD string (see lib/date.js), so
// keep it as the raw text the wire already sends instead of coercing it.
types.setTypeParser(types.builtins.DATE, (value) => value);

// Neon's HTTP driver: one query per call, no pool to manage, well suited to
// Vercel's serverless functions. `sql` is a tagged-template query function;
// use sql.query(text, params) for dynamically-built statements.
export const sql = neon(connectionString, { types });
