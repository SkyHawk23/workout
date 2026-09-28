import { sql } from "./_db.js";
import { withHandler } from "./_respond.js";
import { requireUser } from "./_auth.js";

async function exportData(req) {
  const session = requireUser(req);

  const [user] = await sql`select id, email, display_name, role, birth_year, created_at from users where id = ${session.id}`;
  const [profile] = await sql`select * from trainer_profiles where user_id = ${session.id}`;
  const programs = await sql`select * from programs where user_id = ${session.id} order by created_at`;
  const plannedSessions = await sql`select * from planned_sessions where user_id = ${session.id} order by date`;
  const sessionLogs = await sql`select * from session_logs where user_id = ${session.id} order by started_at`;
  const setLogs = await sql`
    select sl.* from set_logs sl join session_logs s on s.id = sl.session_log_id where s.user_id = ${session.id}
    order by sl.completed_at
  `;
  const chatMessages = await sql`select role, content, created_at from chat_messages where user_id = ${session.id} order by created_at`;

  return {
    app: "the-daily-lift", version: 3, exported_at: new Date().toISOString(),
    user, trainer_profile: profile, programs, planned_sessions: plannedSessions,
    session_logs: sessionLogs, set_logs: setLogs, chat_messages: chatMessages,
  };
}

export default withHandler({ export: exportData });
