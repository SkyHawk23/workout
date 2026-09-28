// Session/set logging shared between api/sessions.js (web) and the future
// Phase 2 api/watch.js, so both write through identical, idempotent logic.
import { httpError } from "./_auth.js";
import { applyProgressionForSession } from "./_progression.js";
import { LOG_SETS_BATCH_MAX } from "./_validate.js";
import { resolveExerciseId } from "./_exercises.js";

export async function startSession(sql, userId, { client_id, planned_session_id, source = "web" }) {
  if (!client_id) throw httpError(400, "client_id is required", "validation");
  const existing = await sql`select id from session_logs where client_id = ${client_id} and user_id = ${userId}`;
  if (existing.length) return existing[0];

  if (planned_session_id) {
    const [owns] = await sql`select id from planned_sessions where id = ${planned_session_id} and user_id = ${userId}`;
    if (!owns) throw httpError(404, "Planned session not found", "not_found");
  }

  const [row] = await sql`
    insert into session_logs (client_id, user_id, planned_session_id, source, started_at)
    values (${client_id}, ${userId}, ${planned_session_id || null}, ${source}, now())
    on conflict (client_id) do update set client_id = excluded.client_id
    returning id
  `;
  return row;
}

// Resolves a logged set's exercise reference: an explicit exercise_id wins;
// otherwise falls back to the shared case-insensitive name resolver.
async function resolveSetExerciseId(sql, userId, set) {
  if (set.exercise_id) return set.exercise_id;
  if (!set.exercise_name) throw httpError(400, "Each set needs exercise_id or exercise_name", "validation");
  const exercise = await resolveExerciseId(sql, userId, set.exercise_name);
  return exercise.id;
}

export async function logSets(sql, userId, sessionLogId, sets) {
  if (!Array.isArray(sets) || !sets.length) throw httpError(400, "sets must be a non-empty array", "validation");
  if (sets.length > LOG_SETS_BATCH_MAX) throw httpError(400, `Too many sets in one batch (max ${LOG_SETS_BATCH_MAX})`, "validation");

  const [owns] = await sql`select id from session_logs where id = ${sessionLogId} and user_id = ${userId}`;
  if (!owns) throw httpError(404, "Session not found", "not_found");

  let inserted = 0;
  for (const s of sets) {
    if (!s.client_id) throw httpError(400, "Each set needs a client_id", "validation");
    const exerciseId = await resolveSetExerciseId(sql, userId, s);
    const result = await sql`
      insert into set_logs (client_id, session_log_id, exercise_id, set_index, reps, weight, rpe, completed_at)
      values (${s.client_id}, ${sessionLogId}, ${exerciseId}, ${s.set_index}, ${s.reps}, ${s.weight ?? 0}, ${s.rpe ?? null}, ${s.completed_at || new Date().toISOString()})
      on conflict (client_id) do nothing
      returning id
    `;
    if (result.length) inserted++;
  }
  return { inserted, total: sets.length };
}

export async function finishSession(sql, userId, sessionLogId, meta = {}) {
  const [session] = await sql`select * from session_logs where id = ${sessionLogId} and user_id = ${userId}`;
  if (!session) throw httpError(404, "Session not found", "not_found");

  await sql`
    update session_logs set ended_at = ${meta.ended_at || new Date().toISOString()},
      avg_hr = ${meta.avg_hr ?? null}, max_hr = ${meta.max_hr ?? null},
      calories = ${meta.calories ?? null}, notes = ${meta.notes ?? null}
    where id = ${sessionLogId} and user_id = ${userId}
  `;

  if (session.planned_session_id) {
    await sql`update planned_sessions set status = 'done', updated_at = now() where id = ${session.planned_session_id} and user_id = ${userId}`;
  }

  const { summary, sessionChanges } = await applyProgressionForSession(sessionLogId, userId, sql);
  for (const change of sessionChanges) {
    await sql`
      insert into session_changes (planned_session_id, user_id, reason, before, after)
      values (${change.planned_session_id}, ${userId}, ${change.reason}, ${JSON.stringify(change.before)}, ${JSON.stringify(change.after)})
    `;
  }

  const setCount = await sql`select count(*)::int as n from set_logs where session_log_id = ${sessionLogId}`;
  return { weight_changes: summary, sets_logged: setCount[0].n };
}
