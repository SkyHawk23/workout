import { sql } from "./_db.js";
import { withHandler } from "./_respond.js";
import { requireUser, httpError } from "./_auth.js";
import { str, int } from "./_validate.js";
import { startSession, logSets, finishSession } from "./_sessions.js";
import { localDate } from "../lib/date.js";

async function count(req) {
  const session = requireUser(req);
  const [{ n }] = await sql`select count(*)::int as n from session_logs where user_id = ${session.id} and ended_at is not null`;
  return { count: n };
}

async function start(req, res, body) {
  const session = requireUser(req);
  const row = await startSession(sql, session.id, body);
  return { session_log_id: row.id };
}

async function logSetsAction(req, res, body) {
  const session = requireUser(req);
  const session_log_id = str(body.session_log_id, { field: "session_log_id" });
  const result = await logSets(sql, session.id, session_log_id, body.sets);
  return result;
}

async function finish(req, res, body) {
  const session = requireUser(req);
  const session_log_id = str(body.session_log_id, { field: "session_log_id" });
  const result = await finishSession(sql, session.id, session_log_id, body);
  return result;
}

async function history(req, res, body) {
  const session = requireUser(req);
  const limit = int(body.limit, { field: "limit", min: 1, max: 100, required: false }) ?? 30;
  const offset = int(body.offset, { field: "offset", min: 0, required: false }) ?? 0;

  const [{ timezone }] = await sql`select timezone from users where id = ${session.id}`;
  const rows = await sql`
    select sl.id, sl.started_at, sl.ended_at, sl.source, sl.planned_session_id,
      coalesce(ps.title, 'Workout') as name,
      (select count(*)::int from set_logs where session_log_id = sl.id) as sets
    from session_logs sl
    left join planned_sessions ps on ps.id = sl.planned_session_id
    where sl.user_id = ${session.id} and sl.ended_at is not null
    order by sl.started_at desc
    limit ${limit} offset ${offset}
  `;
  return {
    sessions: rows.map((r) => ({
      id: r.id, date: localDate(r.started_at, timezone), name: r.name, sets: r.sets,
      mins: r.ended_at ? Math.max(1, Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000)) : null,
      source: r.source, has_template: r.planned_session_id !== null,
    })),
  };
}

async function historyDetail(req, res, body) {
  const session = requireUser(req);
  const session_log_id = str(body.session_log_id, { field: "session_log_id" });
  const [owns] = await sql`select id from session_logs where id = ${session_log_id} and user_id = ${session.id}`;
  if (!owns) throw httpError(404, "Session not found", "not_found");

  const rows = await sql`
    select e.name, e.is_bodyweight,
      count(*)::int as n, max(sl.weight) as top_weight, max(sl.reps) as top_reps
    from set_logs sl join exercises e on e.id = sl.exercise_id
    where sl.session_log_id = ${session_log_id}
    group by e.id, e.name, e.is_bodyweight
    order by e.name
  `;
  return {
    detail: rows.map((r) => ({
      name: r.name,
      target: `${r.n} × ${r.is_bodyweight || !r.top_weight ? r.top_reps + " reps" : r.top_weight + " lb × " + r.top_reps}`,
    })),
  };
}

async function deleteSession(req, res, body) {
  const session = requireUser(req);
  const session_log_id = str(body.session_log_id, { field: "session_log_id" });
  const result = await sql`delete from session_logs where id = ${session_log_id} and user_id = ${session.id} returning id`;
  if (!result.length) throw httpError(404, "Session not found", "not_found");
  return { ok: true };
}

async function stats(req) {
  const session = requireUser(req);

  const prs = await sql`
    select e.name, max(sl.weight) as best
    from set_logs sl
    join exercises e on e.id = sl.exercise_id
    join session_logs s on s.id = sl.session_log_id
    where s.user_id = ${session.id} and e.is_bodyweight = false
    group by e.id, e.name
    order by best desc nulls last
    limit 8
  `;

  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const end = Date.now() - i * 7 * 86400000;
    const start = end - 7 * 86400000;
    const [{ n }] = await sql`
      select count(*)::int as n from session_logs
      where user_id = ${session.id} and ended_at is not null
        and started_at > ${new Date(start).toISOString()} and started_at <= ${new Date(end).toISOString()}
    `;
    weeks.push({ label: i === 0 ? "now" : i + "w", count: n });
  }
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0 && weeks[i].count > 0; i--) streak++;

  return {
    prs: prs.map((p) => ({ name: p.name, best: p.best ? `${p.best} lb` : "bodyweight" })),
    weeks,
    streak,
  };
}

export default withHandler({
  start,
  "log-sets": logSetsAction,
  finish,
  history,
  "history-detail": historyDetail,
  delete: deleteSession,
  stats,
  count,
});
