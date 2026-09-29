// The Garmin watch API (function 7 of 12). Every response is compact JSON —
// short keys, no nulls — since the watch has very little memory. This file
// does NOT use the shared withHandler()/requireUser() cookie-auth helpers:
// pairing is unauthenticated (rate-limited by IP instead), and every other
// action authenticates via a bearer device token, never a cookie.
//
// Session/set logging goes through the exact same startSession/logSets/
// finishSession helpers api/sessions.js uses (idempotent on client_id) —
// never duplicated here.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { sql } from "./_db.js";
import { httpError } from "./_auth.js";
import { str, arr, LOG_SETS_BATCH_MAX } from "./_validate.js";
import { startSession, logSets, finishSession } from "./_sessions.js";
import { moveSessionToToday } from "./_scheduling.js";
import { localToday } from "../lib/date.js";

const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const PAIR_CODE_LEN = 6;
const PAIR_TTL_S = 600;
const PAIR_RATE_LIMIT = 10; // per IP per hour

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function clientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function generatePairCode() {
  const bytes = randomBytes(PAIR_CODE_LEN);
  let code = "";
  for (let i = 0; i < PAIR_CODE_LEN; i++) code += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
  return code;
}

// ── Pairing (unauthenticated) ────────────────────────────────────────────
async function pairStart(req) {
  const ip = clientIp(req);
  await sql`delete from pair_attempts where created_at < now() - interval '1 day'`;
  const [{ n }] = await sql`
    select count(*)::int as n from pair_attempts where ip = ${ip} and created_at > now() - interval '1 hour'
  `;
  if (n >= PAIR_RATE_LIMIT) throw httpError(429, "Too many pairing attempts. Try again in a bit.", "rate_limited");
  await sql`insert into pair_attempts (ip) values (${ip})`;

  // Opportunistic cleanup of stale unpaired rows — never touches paired devices.
  await sql`delete from devices where paired_at is null and pair_expires_at < now()`;

  const secret = randomBytes(24).toString("hex");
  const secretHash = sha256Hex(secret);

  let deviceId, code;
  for (let attempt = 0; ; attempt++) {
    code = generatePairCode();
    try {
      const [row] = await sql`
        insert into devices (name, pair_code, pair_secret_hash, pair_expires_at)
        values ('Garmin watch', ${code}, ${secretHash}, now() + interval '10 minutes')
        returning id
      `;
      deviceId = row.id;
      break;
    } catch (err) {
      if (err.code !== "23505" || attempt >= 4) throw err; // unique_violation on pair_code — vanishingly rare, retry with a new code
    }
  }

  return { c: code, p: deviceId, s: secret, e: PAIR_TTL_S };
}

// Deliberately indistinguishable between "not confirmed yet" and "wrong
// secret" — a code alone must never be enough to learn anything about the
// pairing's state, let alone get a token.
async function pairPoll(req, res, body) {
  const deviceId = str(body.p, { field: "p" });
  const secret = str(body.s, { field: "s" });

  const [row] = await sql`select * from devices where id = ${deviceId}`;
  if (!row || !row.pair_expires_at || new Date(row.pair_expires_at).getTime() < Date.now()) {
    return { st: "expired" };
  }
  if (!timingSafeEqualHex(sha256Hex(secret), row.pair_secret_hash)) {
    return { st: "wait" };
  }
  if (!row.user_id) return { st: "wait" }; // website hasn't confirmed the code yet

  // Confirmed: mint the token now, hand it back exactly once, then clear
  // every pairing field so neither a replayed poll nor a leaked code/secret
  // can ever retrieve it again.
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const [user] = await sql`select display_name from users where id = ${row.user_id}`;
  await sql`
    update devices set token_hash = ${tokenHash}, paired_at = now(),
      pair_code = null, pair_secret_hash = null, pair_expires_at = null
    where id = ${deviceId}
  `;
  return { st: "ok", t: token, n: user?.display_name || "there" };
}

// ── Device auth (bearer token) ───────────────────────────────────────────
// Writes the 401 response itself (rather than throwing) so it can use the
// compact {st:"revoked"} shape the spec calls for, distinct from the
// generic {error} shape thrown errors get.
async function requireDevice(req, res) {
  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) { res.status(401).json({ st: "revoked" }); return null; }

  const [device] = await sql`select * from devices where token_hash = ${sha256Hex(token)}`;
  if (!device || device.revoked_at) { res.status(401).json({ st: "revoked" }); return null; }

  const [user] = await sql`select id, timezone from users where id = ${device.user_id}`;
  if (!user) { res.status(401).json({ st: "revoked" }); return null; }

  // Throttled to at most once a minute so a chatty watch doesn't hammer the DB.
  if (!device.last_seen_at || Date.now() - new Date(device.last_seen_at).getTime() > 60000) {
    await sql`update devices set last_seen_at = now() where id = ${device.id}`;
  }

  return { device, user };
}

const EXERCISE_NAME_MAX = 28;

// Truncates at the last word boundary within maxLen, so a name never gets
// cut mid-word on the watch's tiny screen. Exported for tests.
export function truncateName(name, maxLen = EXERCISE_NAME_MAX) {
  const value = name || "";
  if (value.length <= maxLen) return value;
  const cut = value.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

function compactSession(row) {
  return {
    id: row.id,
    t: row.title,
    cal: !!row.is_calibration,
    x: (row.exercises || []).map((ex) => ({
      e: ex.exercise_id,
      n: truncateName(ex.name),
      r: ex.rest_s || 60,
      // A timed set (a stretch, plank, or other hold) is [0,0,0,hold_s];
      // a normal set is [reps_min,reps_max,weight_lb].
      s: (ex.sets || []).map((s) => (s.hold_s ? [0, 0, 0, s.hold_s] : [s.reps_min, s.reps_max, s.weight || 0])),
    })),
  };
}

// ── Device actions (bearer auth) ─────────────────────────────────────────
async function today({ user }) {
  const todayIso = localToday(user.timezone);
  const [row] = await sql`
    select * from planned_sessions
    where user_id = ${user.id} and status = 'planned' and date = ${todayIso} and kind in ('program', 'quick')
    order by kind
    limit 1
  `;
  if (row) return { s: compactSession(row) };

  const [next] = await sql`
    select date, title from planned_sessions
    where user_id = ${user.id} and kind = 'program' and status = 'planned' and date > ${todayIso}
    order by date limit 1
  `;
  return next ? { s: null, nx: { d: next.date, t: next.title } } : { s: null };
}

// The rest-day screen's TRAIN ANYWAY: pulls the next planned program
// session forward to today (same helper as the website's "Train now anyway"
// button, so Undo works), then answers exactly like `today`.
async function trainNow({ user }) {
  const current = await today({ user });
  if (current.s) return current;
  const [next] = await sql`
    select id from planned_sessions
    where user_id = ${user.id} and kind = 'program' and status = 'planned' and date > ${localToday(user.timezone)}
    order by date limit 1
  `;
  const moved = next && (await moveSessionToToday(sql, user.id, next.id, user.timezone));
  return { s: moved ? compactSession(moved.session) : null };
}

async function start({ user }, body) {
  const client_id = str(body.c, { field: "c" });
  const planned_session_id = body.ps ? str(body.ps, { field: "ps", required: false }) : undefined;
  const row = await startSession(sql, user.id, { client_id, planned_session_id, source: "watch" });
  return { l: row.id };
}

async function log({ user }, body) {
  const session_log_id = str(body.l, { field: "l" });
  const sets = arr(body.sets, { field: "sets", maxLen: LOG_SETS_BATCH_MAX });
  const mapped = sets.map((s) => ({
    client_id: s.c, exercise_id: s.e, set_index: s.i, reps: s.r, weight: s.w, rpe: s.p ?? null, completed_at: s.at,
  }));
  const result = await logSets(sql, user.id, session_log_id, mapped);
  return { ok: result.inserted };
}

async function finish({ user }, body) {
  const session_log_id = str(body.l, { field: "l" });
  const result = await finishSession(sql, user.id, session_log_id, {
    avg_hr: body.hr, max_hr: body.mx, calories: body.cal, ended_at: body.end,
  });
  return {
    w: result.weight_changes.map((c) => [c.exercise_name, c.before_weight, c.after_weight]),
    n: result.sets_logged,
  };
}

const PUBLIC_ACTIONS = { "pair-start": pairStart, "pair-poll": pairPoll };
const DEVICE_ACTIONS = { today, "train-now": trainNow, start, log, finish };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    const action = req.query?.action;
    const body = req.body && typeof req.body === "object" ? req.body : {};

    const publicFn = PUBLIC_ACTIONS[action];
    if (publicFn) {
      const result = await publicFn(req, res, body);
      if (res.writableEnded) return;
      res.status(200).json(result ?? {});
      return;
    }

    const deviceFn = DEVICE_ACTIONS[action];
    if (!deviceFn) { res.status(400).json({ error: `Unknown action: ${action}` }); return; }

    const auth = await requireDevice(req, res);
    if (!auth) return; // requireDevice already wrote the 401 response

    const result = await deviceFn(auth, body);
    res.status(200).json(result ?? {});
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    // Same policy as _respond.js: only a deliberately-thrown, client-facing
    // message is ever echoed back, at any status.
    res.status(status).json({ error: err.safe ? err.message : "error" });
  }
}
