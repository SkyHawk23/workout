// Integration test for api/watch.js: real local Postgres behind a local
// stand-in for Neon's SQL-over-HTTP proxy (see tests/db-date.integration
// .test.js for why — the neon() driver only speaks that protocol, and this
// sandbox can't reach neon.tech). Self-skips when no local Postgres is
// reachable. Exercises the real exported `handler(req, res)`, with small
// fake req/res objects, so this tests the actual wire shapes the watch
// will see.
import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { neonConfig } from "@neondatabase/serverless";
import { localToday } from "../lib/date.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PG_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:testpass@127.0.0.1:5432/dailylift_test";

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
  describe.skip("api/watch.js (real driver, real Postgres)", () => {
    it("pairing, device auth, today, log idempotency, finish", () => {});
  });
  console.warn(`[watch.test.js] Skipped: no Postgres reachable at ${PG_URL}. Set TEST_DATABASE_URL to run it.`);
} else {
  const setupClient = new pg.Client({ connectionString: PG_URL });
  await setupClient.connect();
  for (const file of ["001_init.sql", "002_seed_exercises.sql", "003_add_timezone.sql", "004_devices.sql"]) {
    const text = readFileSync(join(ROOT, "migrations", file), "utf8");
    await setupClient.query(text);
  }
  await setupClient.end();

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
            types: { getTypeParser: () => (val) => val },
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

  const { sql } = await import("../api/_db.js");
  const watchModule = await import("../api/watch.js");
  const watchHandler = watchModule.default;
  const { truncateName } = watchModule;

  function makeRes() {
    return {
      statusCode: 200, body: undefined, writableEnded: false,
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.body = obj; this.writableEnded = true; return this; },
    };
  }

  async function call(action, { body = {}, token, ip } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (ip) headers["x-forwarded-for"] = ip;
    const req = { method: "POST", query: { action }, body, headers, socket: {} };
    const res = makeRes();
    await watchHandler(req, res);
    return { status: res.statusCode, body: res.body };
  }

  // pair-start is IP-rate-limited (10/hour); give each pairing its own
  // fake IP so tests never interfere with each other's quota.
  function freshIp() {
    return `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  }

  // A fresh household + user for each test, so tests don't interfere.
  async function makeUser(timezone = "UTC") {
    const [household] = await sql`insert into households (name) values ('Watch Test Household') returning id`;
    const email = `watch-test-${crypto.randomUUID()}@example.com`;
    const [user] = await sql`
      insert into users (household_id, role, email, password_hash, display_name, timezone)
      values (${household.id}, 'admin', ${email}, 'x', 'Watch Tester', ${timezone})
      returning id
    `;
    await sql`insert into trainer_profiles (user_id) values (${user.id})`;
    return user;
  }

  // Simulates the website-side devices-confirm action (api/auth.js) —
  // that endpoint's own cookie auth isn't this file's concern.
  async function confirmCode(code, userId) {
    await sql`update devices set user_id = ${userId} where pair_code = ${code}`;
  }

  async function pairNewDevice(userId) {
    const started = await call("pair-start", { ip: freshIp() });
    await confirmCode(started.body.c, userId);
    const polled = await call("pair-poll", { body: { p: started.body.p, s: started.body.s } });
    return { deviceId: started.body.p, token: polled.body.t };
  }

  describe("pairing flow", () => {
    it("start -> confirm -> poll returns the token once, a second poll doesn't return it again", async () => {
      const user = await makeUser();
      const started = await call("pair-start", { ip: freshIp() });
      expect(started.status).toBe(200);
      expect(started.body.c).toHaveLength(6);
      expect(started.body.e).toBe(600);

      const beforeConfirm = await call("pair-poll", { body: { p: started.body.p, s: started.body.s } });
      expect(beforeConfirm.body).toEqual({ st: "wait" });

      await confirmCode(started.body.c, user.id);

      const afterConfirm = await call("pair-poll", { body: { p: started.body.p, s: started.body.s } });
      expect(afterConfirm.body.st).toBe("ok");
      expect(afterConfirm.body.t).toHaveLength(64); // 32 bytes, hex
      expect(afterConfirm.body.n).toBe("Watch Tester");

      const secondPoll = await call("pair-poll", { body: { p: started.body.p, s: started.body.s } });
      expect(secondPoll.body.t).toBeUndefined();
    });

    it("returns expired for an unknown or expired device id", async () => {
      const unknown = await call("pair-poll", { body: { p: crypto.randomUUID(), s: "whatever" } });
      expect(unknown.body).toEqual({ st: "expired" });

      const started = await call("pair-start", { ip: freshIp() });
      await sql`update devices set pair_expires_at = now() - interval '1 minute' where id = ${started.body.p}`;
      const expired = await call("pair-poll", { body: { p: started.body.p, s: started.body.s } });
      expect(expired.body).toEqual({ st: "expired" });
    });

    it("never returns a token for the wrong secret, even after confirmation", async () => {
      const user = await makeUser();
      const started = await call("pair-start", { ip: freshIp() });
      await confirmCode(started.body.c, user.id);
      const wrongSecret = await call("pair-poll", { body: { p: started.body.p, s: "not-the-real-secret" } });
      expect(wrongSecret.body).toEqual({ st: "wait" });
    });
  });

  describe("device auth", () => {
    it("rejects a missing or revoked token with {st:'revoked'}", async () => {
      const noToken = await call("today");
      expect(noToken.status).toBe(401);
      expect(noToken.body).toEqual({ st: "revoked" });

      const user = await makeUser();
      const { token, deviceId } = await pairNewDevice(user.id);
      await sql`update devices set revoked_at = now() where id = ${deviceId}`;

      const revoked = await call("today", { token });
      expect(revoked.status).toBe(401);
      expect(revoked.body).toEqual({ st: "revoked" });
    });
  });

  describe("today", () => {
    it("returns today's session correctly in a non-UTC timezone", async () => {
      const user = await makeUser("America/New_York");
      const { token } = await pairNewDevice(user.id);
      const todayIso = localToday("America/New_York");

      const exName = `Watch Test Row ${crypto.randomUUID()}`;
      const [exercise] = await sql`
        insert into exercises (name, category, equipment, is_bodyweight) values (${exName}, 'back', 'barbell', false) returning id
      `;
      await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${todayIso}, 'Today Session', ${JSON.stringify([
          { exercise_id: exercise.id, name: exName, rest_s: 90, sets: [{ reps_min: 8, reps_max: 10, weight: 95 }] },
        ])}, 'planned', 'quick')
      `;

      const res = await call("today", { token });
      expect(res.body.s.t).toBe("Today Session");
      expect(res.body.s.x).toEqual([{ e: exercise.id, n: truncateName(exName), r: 90, s: [[8, 10, 95]] }]);
    });

    it("truncates a long exercise name at a word boundary with an ellipsis", () => {
      const long = "Single Arm Dumbbell Romanian Deadlift Variation";
      const truncated = truncateName(long);
      expect(truncated.length).toBeLessThanOrEqual(29); // <=28 chars plus the ellipsis
      expect(truncated.endsWith("…")).toBe(true);
      expect(long.startsWith(truncated.slice(0, -1))).toBe(true); // cut lands on a real word boundary
      expect(truncateName("Push-up")).toBe("Push-up"); // short names pass through unchanged
    });

    it("emits a timed set as [0,0,0,hold_s] instead of [reps_min,reps_max,weight]", async () => {
      const user = await makeUser();
      const { token } = await pairNewDevice(user.id);
      const exName = `Watch Test Plank ${crypto.randomUUID()}`;
      const [exercise] = await sql`
        insert into exercises (name, category, equipment, is_bodyweight) values (${exName}, 'core', 'bodyweight', true) returning id
      `;
      await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${localToday("UTC")}, 'Mobility Session', ${JSON.stringify([
          { exercise_id: exercise.id, name: exName, rest_s: 30, sets: [{ reps_min: 1, reps_max: 1, weight: 0, hold_s: 30 }, { reps_min: 8, reps_max: 10, weight: 0 }] },
        ])}, 'planned', 'quick')
      `;
      const res = await call("today", { token });
      expect(res.body.s.x[0].s).toEqual([[0, 0, 0, 30], [8, 10, 0]]);
    });

    it("prefers a quick workout added today over today's program session", async () => {
      const user = await makeUser();
      const { token } = await pairNewDevice(user.id);
      const todayIso = localToday("UTC");
      await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${todayIso}, 'Day 1', '[]', 'planned', 'program')
      `;
      const [quick] = await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${todayIso}, 'Quick workout', '[]', 'planned', 'quick')
        returning id
      `;
      const res = await call("today", { token });
      expect(res.body.s.id).toBe(quick.id);
    });

    it("returns the next upcoming session on a rest day", async () => {
      const user = await makeUser();
      const { token } = await pairNewDevice(user.id);
      const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${future}, 'Future Session', '[]', 'planned', 'program')
      `;
      const res = await call("today", { token });
      expect(res.body.s).toBeNull();
      expect(res.body.nx).toEqual({ d: future, t: "Future Session" });
    });
  });

  describe("train-now", () => {
    it("moves the next program session to today and returns it in the today shape", async () => {
      const user = await makeUser("America/New_York");
      const { token } = await pairNewDevice(user.id);
      const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const [planned] = await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${future}, 'Lower A', ${JSON.stringify([
          { exercise_id: crypto.randomUUID(), name: "Back Squat", rest_s: 120, sets: [{ reps_min: 5, reps_max: 6, weight: 185 }] },
        ])}, 'planned', 'program')
        returning id
      `;

      const res = await call("train-now", { token });
      expect(res.status).toBe(200);
      expect(res.body.s.id).toBe(planned.id);
      expect(res.body.s.t).toBe("Lower A");
      expect(res.body.s.x[0].s).toEqual([[5, 6, 185]]);

      const [row] = await sql`select date from planned_sessions where id = ${planned.id}`;
      expect(row.date).toBe(localToday("America/New_York"));
      const [change] = await sql`select reason from session_changes where planned_session_id = ${planned.id}`;
      expect(change.reason).toBe("start_today");

      const today = await call("today", { token });
      expect(today.body.s.id).toBe(planned.id); // a second call sees it as today's session
    });

    it("returns {s:null} when nothing is planned, and requires a device token", async () => {
      const user = await makeUser();
      const { token } = await pairNewDevice(user.id);
      expect((await call("train-now", { token })).body).toEqual({ s: null });
      expect((await call("train-now")).status).toBe(401);
    });
  });

  describe("start / log / finish", () => {
    it("log is idempotent on client_id, and finish reports weight changes", async () => {
      const user = await makeUser();
      const { token } = await pairNewDevice(user.id);

      const exName = `Test Bench ${crypto.randomUUID()}`;
      const [exercise] = await sql`
        insert into exercises (name, category, equipment, is_bodyweight) values (${exName}, 'chest', 'barbell', false) returning id
      `;
      const [planned] = await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${localToday("UTC")}, 'Bench Session', ${JSON.stringify([
          { exercise_id: exercise.id, name: exName, rest_s: 90, sets: [{ reps_min: 5, reps_max: 5, weight: 100 }] },
        ])}, 'planned', 'quick')
        returning id
      `;

      const started = await call("start", { token, body: { c: crypto.randomUUID(), ps: planned.id } });
      expect(started.body.l).toBeTruthy();

      const setBody = { l: started.body.l, sets: [{ c: crypto.randomUUID(), e: exercise.id, i: 0, r: 5, w: 100, at: new Date().toISOString() }] };
      const firstLog = await call("log", { token, body: setBody });
      expect(firstLog.body).toEqual({ ok: 1 });

      const secondLog = await call("log", { token, body: setBody }); // identical client_id
      expect(secondLog.body).toEqual({ ok: 0 });

      const finished = await call("finish", { token, body: { l: started.body.l, hr: 130, mx: 150, cal: 220, end: new Date().toISOString() } });
      expect(finished.body.n).toBe(1);
      expect(finished.body.w).toEqual([[exName, 100, 105]]);
    });
  });

  describe("payload size", () => {
    it("keeps an 8-exercise session's today response well under 4KB", async () => {
      const user = await makeUser();
      const { token } = await pairNewDevice(user.id);

      const exercises = [];
      const suffix = crypto.randomUUID();
      for (let i = 0; i < 8; i++) {
        const name = `Exercise ${i} ${suffix}`;
        const [ex] = await sql`insert into exercises (name, category, equipment, is_bodyweight) values (${name}, 'chest', 'barbell', false) returning id`;
        exercises.push({
          exercise_id: ex.id, name, rest_s: 90,
          sets: Array.from({ length: 4 }, () => ({ reps_min: 6, reps_max: 8, weight: 135 })),
        });
      }
      await sql`
        insert into planned_sessions (program_id, user_id, date, title, exercises, status, kind)
        values (null, ${user.id}, ${localToday("UTC")}, 'Big Session', ${JSON.stringify(exercises)}, 'planned', 'quick')
      `;

      const res = await call("today", { token });
      const size = Buffer.byteLength(JSON.stringify(res.body), "utf8");
      expect(size).toBeLessThan(4096);
    });
  });
}

afterAll(async () => {
  if (proxyServer) await new Promise((resolve) => proxyServer.close(resolve));
});
