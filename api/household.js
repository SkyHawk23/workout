import { randomBytes } from "node:crypto";
import { sql } from "./_db.js";
import { withHandler } from "./_respond.js";
import { requireUser, httpError } from "./_auth.js";
import { str } from "./_validate.js";

function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

async function requireAdmin(session) {
  if (session.role !== "admin") throw httpError(403, "Only the household admin can do that", "forbidden");
}

async function get(req) {
  const session = requireUser(req);
  const [household] = await sql`select id, name from households where id = ${session.household_id}`;
  const members = await sql`
    select id, display_name, role from users where household_id = ${session.household_id} order by created_at
  `;
  return { household, members };
}

async function createInvite(req, res, body) {
  const session = requireUser(req);
  await requireAdmin(session);
  const code = generateInviteCode();
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await sql`
    insert into household_invites (household_id, code, created_by, expires_at)
    values (${session.household_id}, ${code}, ${session.id}, ${expires_at})
  `;
  return { code, expires_at };
}

async function removeMember(req, res, body) {
  const session = requireUser(req);
  await requireAdmin(session);
  const user_id = str(body.user_id, { field: "user_id" });
  if (user_id === session.id) throw httpError(400, "You can't remove yourself", "validation");

  const [target] = await sql`select id from users where id = ${user_id} and household_id = ${session.household_id}`;
  if (!target) throw httpError(404, "That member isn't in your household", "not_found");

  await sql`delete from users where id = ${user_id} and household_id = ${session.household_id}`;
  return { ok: true };
}

export default withHandler({
  get,
  "create-invite": createInvite,
  "remove-member": removeMember,
});
