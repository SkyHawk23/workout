import { httpError } from "./_auth.js";

export const CHAT_MESSAGE_MAX = 2000;
export const LOG_SETS_BATCH_MAX = 100;
export const TRAINER_NOTES_MAX = 1500;

export function str(value, { field, min = 0, max = 10000, required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw httpError(400, `${field} is required`, "validation");
    return "";
  }
  if (typeof value !== "string") throw httpError(400, `${field} must be a string`, "validation");
  if (value.length < min) throw httpError(400, `${field} is too short`, "validation");
  if (value.length > max) throw httpError(400, `${field} is too long`, "validation");
  return value;
}

export function email(value) {
  const v = str(value, { field: "email", min: 3, max: 254 }).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw httpError(400, "Not a valid email address", "validation");
  return v;
}

export function int(value, { field, min = -Infinity, max = Infinity, required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw httpError(400, `${field} is required`, "validation");
    return null;
  }
  const n = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isFinite(n)) throw httpError(400, `${field} must be a number`, "validation");
  if (n < min || n > max) throw httpError(400, `${field} out of range`, "validation");
  return n;
}

export function arr(value, { field, maxLen = 1000, required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw httpError(400, `${field} is required`, "validation");
    return [];
  }
  if (!Array.isArray(value)) throw httpError(400, `${field} must be an array`, "validation");
  if (value.length > maxLen) throw httpError(400, `${field} has too many items (max ${maxLen})`, "validation");
  return value;
}

export function oneOf(value, options, field) {
  if (!options.includes(value)) throw httpError(400, `${field} must be one of: ${options.join(", ")}`, "validation");
  return value;
}
