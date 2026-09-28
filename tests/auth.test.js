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
