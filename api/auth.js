import { sql } from "./_db.js";
import { withHandler } from "./_respond.js";
import {
  hashPassword, verifyPassword, signToken, setAuthCookie, clearAuthCookie,
  requireUser, httpError, MIN_PASSWORD_LENGTH,
} from "./_auth.js";
import { assertNotLocked, recordFailedLogin, resetLoginAttempts } from "./_rateLimit.js";
import { str, email as validateEmail, int } from "./_validate.js";

function sanitizeUser(u) {
  return {
    id: u.id, email: u.email, display_name: u.display_name,
    role: u.role, household_id: u.household_id, birth_year: u.birth_year,
    prefs: u.prefs || { view: "exercise", rest: "manual", secs: 90 },
  };
}

async function signup(req, res, body) {
  const email = validateEmail(body.email);
  const password = str(body.password, { field: "password", min: MIN_PASSWORD_LENGTH, max: 200 });
  const display_name = str(body.display_name, { field: "display_name", min: 1, max: 80 });
  const birth_year = body.birth_year ? int(body.birth_year, { field: "birth_year", min: 1900, max: new Date().getFullYear() }) : null;
  const invite_code = body.invite_code ? str(body.invite_code, { field: "invite_code", required: false, max: 32 }) : null;

  const [existing] = await sql`select id from users where email = ${email}`;
  if (existing) throw httpError(409, "An account with that email already exists", "email_taken");

  let household_id, role;
  let invite = null;
  if (invite_code) {
    [invite] = await sql`select * from household_invites where code = ${invite_code}`;
    if (!invite) throw httpError(400, "That invite code isn't valid", "invalid_invite");
    if (invite.used_by) throw httpError(400, "That invite code has already been used", "invalid_invite");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw httpError(400, "That invite code has expired", "invalid_invite");
    household_id = invite.household_id;
    role = "member";
  } else {
    const householdName = body.household_name ? str(body.household_name, { field: "household_name", max: 80, required: false }) : `${display_name}'s Household`;
    const [household] = await sql`insert into households (name) values (${householdName}) returning id`;
    household_id = household.id;
    role = "admin";
  }

  const password_hash = await hashPassword(password);
  const [user] = await sql`
    insert into users (household_id, role, email, password_hash, display_name, birth_year)
    values (${household_id}, ${role}, ${email}, ${password_hash}, ${display_name}, ${birth_year})
    returning id, household_id, role, email, display_name, birth_year
  `;
  await sql`insert into trainer_profiles (user_id) values (${user.id}) on conflict do nothing`;
  if (invite) await sql`update household_invites set used_by = ${user.id} where id = ${invite.id}`;

  setAuthCookie(res, signToken(user));
  return { user: sanitizeUser(user) };
}

async function login(req, res, body) {
  const email = validateEmail(body.email);
  const password = str(body.password, { field: "password", min: 1, max: 200 });

  const [user] = await sql`select * from users where email = ${email}`;
  if (!user) throw httpError(401, "Invalid email or password", "invalid_credentials");
  assertNotLocked(user);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordFailedLogin(sql, user.id, user.failed_attempts);
    throw httpError(401, "Invalid email or password", "invalid_credentials");
  }
  await resetLoginAttempts(sql, user.id);

  setAuthCookie(res, signToken(user));
  return { user: sanitizeUser(user) };
}

async function logout(req, res) {
  clearAuthCookie(res);
  return { ok: true };
}

async function me(req) {
  const session = requireUser(req);
  const [user] = await sql`select * from users where id = ${session.id}`;
  if (!user) throw httpError(401, "Session no longer valid");
  return { user: sanitizeUser(user) };
}

async function changePassword(req, res, body) {
  const session = requireUser(req);
  const current_password = str(body.current_password, { field: "current_password", min: 1, max: 200 });
  const new_password = str(body.new_password, { field: "new_password", min: MIN_PASSWORD_LENGTH, max: 200 });

  const [user] = await sql`select * from users where id = ${session.id}`;
  const ok = await verifyPassword(current_password, user.password_hash);
  if (!ok) throw httpError(401, "Current password is incorrect", "invalid_credentials");

  const password_hash = await hashPassword(new_password);
  await sql`update users set password_hash = ${password_hash} where id = ${session.id}`;
  return { ok: true };
}

async function updatePrefs(req, res, body) {
  const session = requireUser(req);
  const prefs = {
    view: body.view === "set" ? "set" : "exercise",
    rest: body.rest === "auto" ? "auto" : "manual",
    secs: int(body.secs, { field: "secs", min: 15, max: 600, required: false }) ?? 90,
  };
  await sql`update users set prefs = ${JSON.stringify(prefs)} where id = ${session.id}`;
  return { prefs };
}

export default withHandler({
  signup, login, logout, me,
  "change-password": changePassword,
  "update-prefs": updatePrefs,
});
