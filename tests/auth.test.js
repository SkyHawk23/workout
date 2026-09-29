import { describe, it, expect, vi } from "vitest";
import {
  hashPassword, verifyPassword, signToken, verifyToken, MIN_PASSWORD_LENGTH,
} from "../api/_auth.js";
import { assertNotLocked, recordFailedLogin, resetLoginAttempts } from "../api/_rateLimit.js";

describe("password hashing", () => {
  it("hashes a password and verifies it back", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("enforces a 10-character minimum via the exported constant", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });
});

describe("JWT session tokens", () => {
  const user = { id: "user-123", household_id: "house-456", role: "member" };

  it("round-trips the user id, household, and role", () => {
    const token = signToken(user);
    const payload = verifyToken(token);
    expect(payload.sub).toBe(user.id);
    expect(payload.household_id).toBe(user.household_id);
    expect(payload.role).toBe(user.role);
  });

  it("rejects a tampered token", () => {
    const token = signToken(user);
    expect(() => verifyToken(token + "x")).toThrow();
  });
});

describe("login lockout", () => {
  it("does not lock an account with no locked_until", () => {
    expect(() => assertNotLocked({ locked_until: null })).not.toThrow();
  });

  it("does not lock an account whose lock has already expired", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(() => assertNotLocked({ locked_until: past })).not.toThrow();
  });

  it("locks an account whose locked_until is in the future", () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(() => assertNotLocked({ locked_until: future })).toThrow(/too many attempts/i);
  });

  it("locks the account after the 5th failed attempt", async () => {
    const calls = [];
    const sql = vi.fn((strings, ...values) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    });

    await recordFailedLogin(sql, "user-1", 4); // this is the 5th attempt
    const call = calls[0];
    expect(call.text).toMatch(/locked_until/);
    expect(call.values).toContain(5); // failed_attempts becomes 5
  });

  it("does not set locked_until before the 5th attempt", async () => {
    const calls = [];
    const sql = vi.fn((strings, ...values) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    });

    await recordFailedLogin(sql, "user-1", 1); // this is the 2nd attempt
    const call = calls[0];
    expect(call.text).not.toMatch(/locked_until/);
  });

  it("resets attempts and the lock on a successful login", async () => {
    const calls = [];
    const sql = vi.fn((strings, ...values) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    });
    await resetLoginAttempts(sql, "user-1");
    expect(calls[0].text).toMatch(/failed_attempts = 0/);
    expect(calls[0].text).toMatch(/locked_until = null/);
  });
});

// ── "Try the demo" ─────────────────────────────────────────────────────
// A tiny in-memory stand-in for the sql tag, just enough for auth.demo.
const db = vi.hoisted(() => ({ users: [], profiles: 0 }));
vi.mock("../api/_db.js", () => ({
  sql: async (strings, ...vals) => {
    const q = strings.join("?");
    if (q.startsWith("select * from users where email")) return db.users.filter((u) => u.email === vals[0]);
    if (q.includes("insert into households")) return [{ id: "house-demo" }];
    if (q.includes("insert into users")) {
      if (db.users.some((u) => u.email === vals[1])) return [];
      const user = { id: "user-demo", household_id: vals[0], email: vals[1], password_hash: vals[2], display_name: "Demo", role: "member", timezone: vals[3] };
      db.users.push(user);
      return [user];
    }
    if (q.includes("insert into trainer_profiles")) { db.profiles++; return []; }
    if (q.startsWith("update users set timezone")) { db.users[0].timezone = vals[0]; return []; }
    throw new Error(`unexpected query: ${q}`);
  },
}));

describe("demo login", async () => {
  const { default: handler } = await import("../api/auth.js");
  async function callDemo(timezone) {
    const res = {
      headers: {}, statusCode: 0, body: null, writableEnded: false,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    await handler({ method: "POST", query: { action: "demo" }, body: { timezone } }, res);
    return res;
  }

  it("creates one shared demo member on first use and signs every caller into it", async () => {
    const first = await callDemo("America/New_York");
    expect(first.statusCode).toBe(200);
    expect(first.body.user).toMatchObject({ email: "demo@workout.lilleylabs.com", role: "member" });
    expect(first.headers["Set-Cookie"]).toMatch(/HttpOnly/);
    // Its password is random, not something a visitor could type in.
    expect(await verifyPassword("", db.users[0].password_hash)).toBe(false);

    const second = await callDemo("Europe/London");
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(db.users).toHaveLength(1);
    expect(db.profiles).toBe(1);
    expect(second.body.user.timezone).toBe("Europe/London");
  });
});
