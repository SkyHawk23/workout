import { randomBytes } from "node:crypto";
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
    timezone: u.timezone || "UTC",
    prefs: u.prefs || { view: "exercise", rest: "manual", secs: 90 },
  };
}

async function signup(req, res, body) {
  const email = validateEmail(body.email);
  const password = str(body.password, { field: "password", min: MIN_PASSWORD_LENGTH, max: 200 });
  const display_name = str(body.display_name, { field: "display_name", min: 1, max: 80 });
  const birth_year = body.birth_year ? int(body.birth_year, { field: "birth_year", min: 1900, max: new Date().getFullYear() }) : null;
  const invite_code = body.invite_code ? str(body.invite_code, { field: "invite_code", required: false, max: 32 }) : null;
  const timezone = body.timezone ? str(body.timezone, { field: "timezone", required: false, max: 100 }) : "UTC";

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
    insert into users (household_id, role, email, password_hash, display_name, birth_year, timezone)
    values (${household_id}, ${role}, ${email}, ${password_hash}, ${display_name}, ${birth_year}, ${timezone})
    returning id, household_id, role, email, display_name, birth_year, timezone
  `;
  await sql`insert into trainer_profiles (user_id) values (${user.id}) on conflict do nothing`;
  if (invite) await sql`update household_invites set used_by = ${user.id} where id = ${invite.id}`;

  setAuthCookie(res, signToken(user));
  return { user: sanitizeUser(user) };
}

async function login(req, res, body) {
  const email = validateEmail(body.email);
  const password = str(body.password, { field: "password", min: 1, max: 200 });
  const timezone = body.timezone ? str(body.timezone, { field: "timezone", required: false, max: 100 }) : null;

  const [user] = await sql`select * from users where email = ${email}`;
  if (!user) throw httpError(401, "Invalid email or password", "invalid_credentials");
  assertNotLocked(user);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordFailedLogin(sql, user.id, user.failed_attempts);
    throw httpError(401, "Invalid email or password", "invalid_credentials");
  }
  await resetLoginAttempts(sql, user.id);

  // Keep the member's timezone current — it's what "today" and week
  // boundaries are computed in, and a device/location can change.
  if (timezone && timezone !== user.timezone) {
    await sql`update users set timezone = ${timezone} where id = ${user.id}`;
    user.timezone = timezone;
  }

  setAuthCookie(res, signToken(user));
  return { user: sanitizeUser(user) };
}

// "Try the demo": signs anyone into one shared demo member, no password.
// Temporary, for letting people test the app and watch. A shared account
// (rather than one per visitor) keeps AI spend under a single member's
// monthly token cap. It's a plain member, not a household admin, so it
// can't mint invite codes that pull real accounts into its household. Its
// password is random and never shown, so this action is the only way in.
const DEMO_EMAIL = "demo@workout.lilleylabs.com";

async function demo(req, res, body) {
  const timezone = body.timezone ? str(body.timezone, { field: "timezone", required: false, max: 100 }) : "UTC";
  let [user] = await sql`select * from users where email = ${DEMO_EMAIL}`;
  if (!user) {
    const [household] = await sql`insert into households (name) values ('Demo household') returning id`;
    const password_hash = await hashPassword(randomBytes(24).toString("hex"));
    [user] = await sql`
      insert into users (household_id, role, email, password_hash, display_name, timezone)
      values (${household.id}, 'member', ${DEMO_EMAIL}, ${password_hash}, 'Demo', ${timezone})
      on conflict (email) do nothing
      returning *
    `;
    if (!user) [user] = await sql`select * from users where email = ${DEMO_EMAIL}`; // lost a first-click race
    else await sql`insert into trainer_profiles (user_id) values (${user.id}) on conflict do nothing`;
  } else if (timezone !== user.timezone) {
    await sql`update users set timezone = ${timezone} where id = ${user.id}`;
    user.timezone = timezone;
  }
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

// ── Devices (Garmin watch pairing) ───────────────────────────────────────
// The watch's own actions (pair-start, pair-poll, today, start, log,
// finish) live in api/watch.js under bearer-token auth. These are the
// website-side half: claiming a pairing code and managing already-paired
// devices, all under the normal cookie session.
async function devicesList(req) {
  const session = requireUser(req);
  const devices = await sql`
    select id, name, paired_at, last_seen_at from devices
    where user_id = ${session.id} and token_hash is not null and revoked_at is null
    order by paired_at desc
  `;
  return { devices };
}

async function devicesConfirm(req, res, body) {
  const session = requireUser(req);
  const code = str(body.code, { field: "code", min: 6, max: 6 }).toUpperCase();
  const [row] = await sql`
    select id from devices where pair_code = ${code} and user_id is null and pair_expires_at > now()
  `;
  if (!row) throw httpError(400, "That code is invalid or has expired", "invalid_code");
  await sql`update devices set user_id = ${session.id} where id = ${row.id}`;
  return { ok: true };
}

async function devicesRename(req, res, body) {
  const session = requireUser(req);
  const id = str(body.id, { field: "id" });
  const name = str(body.name, { field: "name", min: 1, max: 60 });
  const [row] = await sql`update devices set name = ${name} where id = ${id} and user_id = ${session.id} returning id`;
  if (!row) throw httpError(404, "Device not found", "not_found");
  return { ok: true };
}

async function devicesRevoke(req, res, body) {
  const session = requireUser(req);
  const id = str(body.id, { field: "id" });
  const [row] = await sql`
    update devices set revoked_at = now(), token_hash = null
    where id = ${id} and user_id = ${session.id} returning id
  `;
  if (!row) throw httpError(404, "Device not found", "not_found");
  return { ok: true };
}

export default withHandler({
  signup, login, demo, logout, me,
  "change-password": changePassword,
  "update-prefs": updatePrefs,
  "devices-list": devicesList,
  "devices-confirm": devicesConfirm,
  "devices-rename": devicesRename,
  "devices-revoke": devicesRevoke,
});
