import { httpError } from "./_auth.js";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export function assertNotLocked(user) {
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    throw httpError(423, `Too many attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`, "locked");
  }
}

export async function recordFailedLogin(sql, userId, currentFailedAttempts) {
  const next = (currentFailedAttempts || 0) + 1;
  if (next >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString();
    await sql`update users set failed_attempts = ${next}, locked_until = ${lockedUntil} where id = ${userId}`;
  } else {
    await sql`update users set failed_attempts = ${next} where id = ${userId}`;
  }
}

export async function resetLoginAttempts(sql, userId) {
  await sql`update users set failed_attempts = 0, locked_until = null where id = ${userId}`;
}
