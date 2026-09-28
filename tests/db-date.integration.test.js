// A real integration test for the DATE type-parser fix in api/_db.js: it
// exercises the actual @neondatabase/serverless `neon()` driver end to end
// (request building, the "Neon-Raw-Text-Output"/array-mode headers, and its
// own per-field type-parser dispatch) rather than mocking any of it. Since
// that driver only speaks Neon's SQL-over-HTTP protocol and this sandbox
// can't reach neon.tech, a tiny local HTTP server stands in for Neon's
// proxy and forwards the query to a real local Postgres via `pg`, in the
// same raw-text wire shape Neon's proxy actually returns. If no local
// Postgres is reachable (e.g. a fresh checkout with no DB running), the
// suite skips itself rather than failing the rest of `npm test`.
import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { neonConfig } from "@neondatabase/serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PG_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:testpass@127.0.0.1:5432/dailylift_test";

// Probed once at collection time (top-level await), so whether the suite
// below is skipped is decided before any hooks run.
let dbAvailable = true;
{
  const probe = new pg.Client({ connectionString: PG_URL, connectionTimeoutMillis: 1500 });
  try {
    await probe.connect();
    await probe.end();
  } catch {
    dbAvailable = false;
  }
}

let proxyServer;

if (!dbAvailable) {
  describe.skip("api/_db.js DATE type parser (real driver, real Postgres)", () => {
    it("round-trips a planned_sessions.date as a plain YYYY-MM-DD string", () => {});
  });
  console.warn(`[db-date.integration.test.js] Skipped: no Postgres reachable at ${PG_URL}. Set TEST_DATABASE_URL to run it.`);
} else {
  // Fresh schema each run: the real migrations, applied via `pg` directly
  // (not through the HTTP proxy, which doesn't exist yet).
  const setupClient = new pg.Client({ connectionString: PG_URL });
  await setupClient.connect();
  for (const file of ["001_init.sql", "002_seed_exercises.sql", "003_add_timezone.sql"]) {
    const text = readFileSync(join(ROOT, "migrations", file), "utf8");
    await setupClient.query(text);
  }
  await setupClient.end();

  // A minimal stand-in for Neon's SQL-over-HTTP proxy: POST {query, params}
  // -> execute against real Postgres, respond in the same raw-text,
  // array-mode shape Neon's own proxy sends (confirmed by reading the
  // driver's request-building code — it always sends
  // "Neon-Raw-Text-Output: true" and "Neon-Array-Mode: true").
  proxyServer = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const client = new pg.Client({ connectionString: PG_URL });
        try {
          const { query, params } = JSON.parse(body);
          await client.connect();
          const result = await client.query({
            text: query, values: params, rowMode: "array",
            types: { getTypeParser: () => (val) => val }, // raw text, like Neon-Raw-Text-Output
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            command: result.command, rowCount: result.rowCount,
            fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
            rows: result.rows,
          }));
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: err.message }));
        } finally {
          await client.end().catch(() => {});
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
  neonConfig.fetchEndpoint = `http://127.0.0.1:${proxyServer.address().port}/sql`;

  // Import api/_db.js only now — it registers the DATE type parser this
  // test is meant to verify, and builds `sql` from DATABASE_URL (the dummy
  // value from vitest.config.js is fine: fetchEndpoint above overrides
  // where queries actually go, regardless of the connection string's host).
  const { sql } = await import("../api/_db.js");

  describe("api/_db.js DATE type parser (real driver, real Postgres)", () => {
    it("round-trips a planned_sessions.date as a plain YYYY-MM-DD string, not a Date/timestamp", async () => {
      // Randomized so the test is safe to re-run against a persistent local
      // DB without colliding on the unique email constraint.
      const email = `date-test-${crypto.randomUUID()}@example.com`;
      const [household] = await sql`insert into households (name) values ('Test Household') returning id`;
      const [user] = await sql`
        insert into users (household_id, role, email, password_hash, display_name, timezone)
        values (${household.id}, 'admin', ${email}, 'x', 'Date Test', 'UTC')
        returning id
      `;
      const [planned] = await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, '2026-09-28', 'Test session', '[]', 'planned', 'quick')
        returning id, date
      `;

      expect(typeof planned.date).toBe("string");
      expect(planned.date).toBe("2026-09-28");

      const [reselected] = await sql`select date from planned_sessions where id = ${planned.id}`;
      expect(typeof reselected.date).toBe("string");
      expect(reselected.date).toBe("2026-09-28");
    });
  });
}

afterAll(async () => {
  if (proxyServer) await new Promise((resolve) => proxyServer.close(resolve));
});
