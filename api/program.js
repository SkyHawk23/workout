import { sql } from "./_db.js";
import { withHandler } from "./_respond.js";
import { requireUser, httpError } from "./_auth.js";
import { str } from "./_validate.js";
import { localToday, startOfWeek, addDays } from "../lib/date.js";
import { moveSessionToToday } from "./_scheduling.js";

async function activeProgram(userId) {
  const [program] = await sql`
    select * from programs where user_id = ${userId} and status = 'active' order by created_at desc limit 1
  `;
  return program || null;
}

async function current(req) {
  const session = requireUser(req);
  const program = await activeProgram(session.id);
  const [{ timezone }] = await sql`select timezone from users where id = ${session.id}`;
  const start = startOfWeek(localToday(timezone));
  const end = addDays(start, 7);

  const sessions = program
    ? await sql`
        select * from planned_sessions
        where user_id = ${session.id} and (date is null or (date >= ${start} and date < ${end}))
          and (program_id = ${program.id} or kind = 'quick')
        order by date nulls last
      `
    : await sql`
        select * from planned_sessions
        where user_id = ${session.id} and (date is null or (date >= ${start} and date < ${end}))
        order by date nulls last
      `;
  return { program, sessions };
}

async function week(req, res, body) {
  const session = requireUser(req);
  const start = str(body.start, { field: "start", min: 10, max: 10 });
  const end = addDays(start, 7);
  const sessions = await sql`
    select * from planned_sessions where user_id = ${session.id} and date >= ${start} and date < ${end}
    order by date
  `;
  return { sessions };
}

async function getSession(req, res, body) {
  const session = requireUser(req);
  const id = str(body.id, { field: "id" });
  const [row] = await sql`select * from planned_sessions where id = ${id} and user_id = ${session.id}`;
  if (!row) throw httpError(404, "Session not found", "not_found");
  return { session: row };
}

async function skip(req, res, body) {
  const session = requireUser(req);
  const id = str(body.id, { field: "id" });
  const [row] = await sql`select * from planned_sessions where id = ${id} and user_id = ${session.id}`;
  if (!row) throw httpError(404, "Session not found", "not_found");
  if (row.status === "skipped") return { session: row };

  await sql`update planned_sessions set status = 'skipped', revision = revision + 1, updated_at = now() where id = ${id} and user_id = ${session.id}`;
  await sql`
    insert into session_changes (planned_session_id, user_id, reason, before, after)
    values (${id}, ${session.id}, 'skip', ${JSON.stringify({ status: row.status })}, ${JSON.stringify({ status: "skipped" })})
  `;
  const [updated] = await sql`select * from planned_sessions where id = ${id}`;
  return { session: updated };
}

async function reschedule(req, res, body) {
  const session = requireUser(req);
  const id = str(body.id, { field: "id" });
  const date = str(body.date, { field: "date", min: 10, max: 10 });
  const [row] = await sql`select * from planned_sessions where id = ${id} and user_id = ${session.id}`;
  if (!row) throw httpError(404, "Session not found", "not_found");

  await sql`update planned_sessions set date = ${date}, revision = revision + 1, updated_at = now() where id = ${id} and user_id = ${session.id}`;
  await sql`
    insert into session_changes (planned_session_id, user_id, reason, before, after)
    values (${id}, ${session.id}, 'reschedule', ${JSON.stringify({ date: row.date })}, ${JSON.stringify({ date })})
  `;
  const [updated] = await sql`select * from planned_sessions where id = ${id}`;
  return { session: updated };
}

async function startToday(req, res, body) {
  const session = requireUser(req);
  const id = str(body.id, { field: "id" });
  const [{ timezone }] = await sql`select timezone from users where id = ${session.id}`;
  const result = await moveSessionToToday(sql, session.id, id, timezone);
  if (!result) throw httpError(404, "Session not found", "not_found");
  return { session: result.session };
}

async function remove(req, res, body) {
  const session = requireUser(req);
  const id = str(body.id, { field: "id" });
  const result = await sql`delete from planned_sessions where id = ${id} and user_id = ${session.id} returning id`;
  if (!result.length) throw httpError(404, "Session not found", "not_found");
  return { ok: true };
}

// Not-yet-done quick/custom workouts (AI "Quick workout" and "Build your
// own" alike) — a member's saved library of things they haven't run yet.
async function quickList(req) {
  const session = requireUser(req);
  const sessions = await sql`
    select id, title, date, status from planned_sessions
    where user_id = ${session.id} and kind = 'quick' and status = 'planned'
    order by date desc nulls last, updated_at desc
  `;
  return { sessions };
}

// Clones a completed workout's original planned_session (title, note,
// exercises — same reps/weight, a literal repeat) into a new one dated
// today, so "run it again" reuses the exact same start/log/finish path as
// any other planned session.
async function runAgain(req, res, body) {
  const session = requireUser(req);
  const session_log_id = str(body.session_log_id, { field: "session_log_id" });
  const [log] = await sql`select planned_session_id from session_logs where id = ${session_log_id} and user_id = ${session.id}`;
  if (!log?.planned_session_id) throw httpError(400, "This workout can't be repeated", "no_template");

  const [original] = await sql`select * from planned_sessions where id = ${log.planned_session_id} and user_id = ${session.id}`;
  if (!original) throw httpError(404, "Original workout not found", "not_found");

  const [{ timezone }] = await sql`select timezone from users where id = ${session.id}`;
  const today = localToday(timezone);
  const [row] = await sql`
    insert into planned_sessions (program_id, user_id, date, title, note, exercises, status, kind)
    values (null, ${session.id}, ${today}, ${original.title}, ${original.note || ""}, ${JSON.stringify(original.exercises)}, 'planned', 'quick')
    returning *
  `;
  return { session: row };
}

async function undoChange(req, res, body) {
  const session = requireUser(req);
  const change_id = str(body.change_id, { field: "change_id" });
  const [change] = await sql`select * from session_changes where id = ${change_id} and user_id = ${session.id}`;
  if (!change) throw httpError(404, "Change not found", "not_found");
  if (change.undone) throw httpError(400, "That change was already undone", "already_undone");

  const patch = change.before || {};
  if ("status" in patch) {
    await sql`update planned_sessions set status = ${patch.status}, revision = revision + 1, updated_at = now() where id = ${change.planned_session_id} and user_id = ${session.id}`;
  }
  if ("date" in patch) {
    await sql`update planned_sessions set date = ${patch.date}, revision = revision + 1, updated_at = now() where id = ${change.planned_session_id} and user_id = ${session.id}`;
  }
  if ("exercises" in patch) {
    await sql`update planned_sessions set exercises = ${JSON.stringify(patch.exercises)}, revision = revision + 1, updated_at = now() where id = ${change.planned_session_id} and user_id = ${session.id}`;
  }
  await sql`update session_changes set undone = true where id = ${change_id} and user_id = ${session.id}`;

  const [updated] = await sql`select * from planned_sessions where id = ${change.planned_session_id}`;
  return { session: updated };
}

export default withHandler({
  current, week, session: getSession, skip, reschedule, "undo-change": undoChange,
  "start-today": startToday, remove, "quick-list": quickList, "run-again": runAgain,
});
