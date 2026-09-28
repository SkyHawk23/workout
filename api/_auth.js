import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is not set");

export const COOKIE_NAME = "dl_session";
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, household_id: user.household_id, role: user.role },
    JWT_SECRET,
    { expiresIn: THIRTY_DAYS_S }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // throws on invalid/expired
}

function parseCookies(req) {
  if (req.cookies) return req.cookies; // Vercel's Node runtime parses this for us
  const header = req.headers?.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((p) => {
      const idx = p.indexOf("=");
      return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1).trim())];
    })
  );
}

export function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV !== "development";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${THIRTY_DAYS_S}`
  );
}

export function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Throws {status, error} on failure; callers should catch and respond.
export function requireUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) throw httpError(401, "Not signed in");
  try {
    const payload = verifyToken(token);
    return { id: payload.sub, household_id: payload.household_id, role: payload.role };
  } catch {
    throw httpError(401, "Session expired");
  }
}

export function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.safe = true; // deliberately thrown with a message meant for the client, even at 5xx (e.g. 502 from a flaky upstream)
  if (code) err.code = code;
  return err;
}
