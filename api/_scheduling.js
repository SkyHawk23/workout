// Moves a planned session to today (member timezone) and records the
// change for Undo. Shared by program.js (the Today screen's "Train now
// anyway" button) and trainer.js (the start_session_today chat tool), so
// both paths behave identically.
import { localToday } from "../lib/date.js";

// Returns null if the session doesn't exist for this user (the caller
// decides how to surface that), or {session, change} — change is null when
// the session was already dated today, since there's nothing to undo.
export async function moveSessionToToday(sql, userId, sessionId, timezone) {
  const [row] = await sql`select * from planned_sessions where id = ${sessionId} and user_id = ${userId}`;
  if (!row) return null;

  const today = localToday(timezone);
  if (row.date === today) return { session: row, change: null };

  await sql`update planned_sessions set date = ${today}, revision = revision + 1, updated_at = now() where id = ${sessionId} and user_id = ${userId}`;
  const [change] = await sql`
    insert into session_changes (planned_session_id, user_id, reason, before, after)
    values (${sessionId}, ${userId}, 'start_today', ${JSON.stringify({ date: row.date })}, ${JSON.stringify({ date: today })})
    returning id
  `;
  const [updated] = await sql`select * from planned_sessions where id = ${sessionId} and user_id = ${userId}`;
  return { session: updated, change };
}
