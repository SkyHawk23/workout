import { describe, it, expect } from "vitest";
import { runTool, nextTrainingDates } from "../api/trainer.js";
import { localToday, weekdayOf } from "../lib/date.js";

// A fake tagged-template sql client that answers every query with an empty
// row set — enough to exercise the "session not found" branch that every
// runTool case checks before it touches anything else.
function fakeSqlAlwaysEmpty() {
  return async () => [];
}

describe("runTool — a failed lookup never produces a changeCard", () => {
  const session = { id: "user-1", household_id: "h1", role: "member" };
  const cases = [
    ["modify_session", { session_id: "missing", exercises: [], reason: "test" }],
    ["swap_exercise", { session_id: "missing", from: "Squat", to: "Leg Press", reason: "test" }],
    ["reschedule", { session_id: "missing", date: "2026-01-01" }],
    ["skip_session", { session_id: "missing", reason: "test" }],
    ["start_session_today", { session_id: "missing" }],
  ];

  for (const [name, input] of cases) {
    it(`${name} returns an error result and no changeCard when the session isn't found`, async () => {
      const out = await runTool(session, name, input, { sqlClient: fakeSqlAlwaysEmpty(), timezone: "UTC" });
      expect(out.result.error).toBeTruthy();
      expect(out.changeCard).toBeUndefined();
    });
  }

  it("an unknown tool name returns an error result and no changeCard", async () => {
    const out = await runTool(session, "not_a_real_tool", {}, { sqlClient: fakeSqlAlwaysEmpty(), timezone: "UTC" });
    expect(out.result.error).toBeTruthy();
    expect(out.changeCard).toBeUndefined();
  });
});

describe("nextTrainingDates", () => {
  it("includes today when today is a preferred training day", () => {
    const timezone = "UTC";
    const today = localToday(timezone);
    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const todayName = WEEKDAYS[weekdayOf(today)];

    const dates = nextTrainingDates([todayName], 1, timezone);
    expect(dates[0]).toBe(today);
  });

  it("returns exactly `count` dates, all on preferred weekdays", () => {
    const dates = nextTrainingDates(["Monday", "Wednesday", "Friday"], 5, "UTC");
    expect(dates).toHaveLength(5);
    for (const d of dates) {
      const day = weekdayOf(d);
      expect([1, 3, 5]).toContain(day);
    }
  });

  it("returns an empty array when no preferred days are given", () => {
    expect(nextTrainingDates([], 3, "UTC")).toEqual([]);
  });
});
