import { describe, it, expect } from "vitest";
import {
  nextWeightOnSuccess, cutWeight, epleyWorkingWeight,
  evaluateExercisePerformance, applyMissLogic, isLowerBody,
  weightForWeek, expandProgramWeeks,
} from "../api/_progression.js";

describe("isLowerBody", () => {
  it("treats the legs category as lower body", () => {
    expect(isLowerBody("legs")).toBe(true);
    expect(isLowerBody("back")).toBe(false);
    expect(isLowerBody(undefined)).toBe(false);
  });
});

describe("nextWeightOnSuccess", () => {
  it("adds 10 lb for lower body lifts", () => {
    expect(nextWeightOnSuccess(185, { category: "legs", equipment: "barbell" })).toBe(195);
  });
  it("adds 5 lb for upper body barbell/machine/cable lifts", () => {
    expect(nextWeightOnSuccess(135, { category: "chest", equipment: "barbell" })).toBe(140);
    expect(nextWeightOnSuccess(50, { category: "arms", equipment: "cable" })).toBe(55);
  });
  it("adds 2.5 lb per hand for upper body dumbbell lifts", () => {
    expect(nextWeightOnSuccess(40, { category: "shoulders", equipment: "dumbbells" })).toBe(42.5);
  });
});

describe("cutWeight", () => {
  it("cuts about 10%, rounded to the nearest 5 lb", () => {
    expect(cutWeight(185)).toBe(165); // 166.5 -> 165
    expect(cutWeight(100)).toBe(90);
    expect(cutWeight(135)).toBe(120); // 121.5 -> 120
  });
  it("never goes below zero", () => {
    expect(cutWeight(0)).toBe(0);
  });
});

describe("epleyWorkingWeight", () => {
  it("returns 0 when there is no logged weight or reps", () => {
    expect(epleyWorkingWeight({ weight: 0, reps: 8, rpe: 8 })).toBe(0);
    expect(epleyWorkingWeight({ weight: 100, reps: 0, rpe: 8 })).toBe(0);
  });
  it("estimates a higher working weight for a lower (easier) RPE", () => {
    const atRpe10 = epleyWorkingWeight({ weight: 135, reps: 8, rpe: 10 });
    const atRpe7 = epleyWorkingWeight({ weight: 135, reps: 8, rpe: 7 });
    expect(atRpe7).toBeGreaterThan(atRpe10);
  });
  it("rounds to the nearest 5 lb and floors at 5", () => {
    const w = epleyWorkingWeight({ weight: 45, reps: 5, rpe: 8 });
    expect(w % 5).toBe(0);
    expect(w).toBeGreaterThanOrEqual(5);
  });
});

describe("evaluateExercisePerformance", () => {
  const planned = { sets: [{ reps_min: 6, reps_max: 8, weight: 135 }, { reps_min: 6, reps_max: 8, weight: 135 }] };

  it("is a success when every set hits reps_max at the target weight", () => {
    const logged = [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }];
    expect(evaluateExercisePerformance(planned, logged)).toBe("success");
  });

  it("is a miss when any set falls below reps_min", () => {
    const logged = [{ reps: 8, weight: 135 }, { reps: 4, weight: 135 }];
    expect(evaluateExercisePerformance(planned, logged)).toBe("miss");
  });

  it("is a hold when sets are within range but not maxed", () => {
    const logged = [{ reps: 7, weight: 135 }, { reps: 6, weight: 135 }];
    expect(evaluateExercisePerformance(planned, logged)).toBe("hold");
  });

  it("holds when nothing was logged", () => {
    expect(evaluateExercisePerformance(planned, [])).toBe("hold");
  });
});

describe("applyMissLogic", () => {
  it("records the first miss without changing weight", () => {
    const result = applyMissLogic(0, 135);
    expect(result).toEqual({ missStreak: 1, weight: 135, changed: false });
  });
  it("cuts the weight and resets the streak on a second consecutive miss", () => {
    const result = applyMissLogic(1, 135);
    expect(result.changed).toBe(true);
    expect(result.missStreak).toBe(0);
    expect(result.weight).toBe(cutWeightExpectation(135));
  });
});

function cutWeightExpectation(w) {
  return Math.round((w * 0.9) / 5) * 5;
}

describe("weightForWeek", () => {
  it("keeps week 1 at the baseline with no increase applied", () => {
    expect(weightForWeek(135, 1, 6, 5, 0.6)).toBe(135);
  });

  it("adds one increment per week after week 1", () => {
    expect(weightForWeek(135, 2, 6, 5, 0.6)).toBe(140);
    expect(weightForWeek(135, 3, 6, 5, 0.6)).toBe(145);
    expect(weightForWeek(135, 5, 6, 5, 0.6)).toBe(155);
  });

  it("applies deload_pct only on the final week, on top of that week's progressed weight", () => {
    // week 6 of 6 would otherwise be 135 + 5*5 = 160; deload cuts it to 60%
    expect(weightForWeek(135, 6, 6, 5, 0.6)).toBe(96);
  });

  it("never increases a bodyweight (0 lb) exercise", () => {
    expect(weightForWeek(0, 4, 6, 5, 0.6)).toBe(0);
  });

  it("defaults deload_pct to a no-op (1) when omitted", () => {
    expect(weightForWeek(100, 4, 4, 10)).toBe(130);
  });

  it("rounds to the nearest whole pound", () => {
    expect(weightForWeek(100, 3, 5, 2.5)).toBe(105); // 100 + 2*2.5
    expect(weightForWeek(100, 2, 5, 1.25)).toBe(101); // 101.25 -> 101
  });
});

describe("expandProgramWeeks", () => {
  const sessionTemplates = [
    { title: "Upper A", note: "push/pull", exercises: [
      { name: "Bench Press", sets: 3, reps_min: 6, reps_max: 8, weight: 135, rest_s: 90, cue: "drive" },
      { name: "Push-up", sets: 3, reps_min: 8, reps_max: 12, weight: 0, rest_s: 60, cue: "straight line" },
    ] },
    { title: "Lower A", note: "squat focus", exercises: [
      { name: "Squat", sets: 4, reps_min: 5, reps_max: 6, weight: 185, rest_s: 120, cue: "knees out" },
    ] },
  ];
  const progression = { upper_lb_per_week: 5, lower_lb_per_week: 10, deload_pct: 0.6 };
  const exerciseMeta = {
    "bench press": { isLowerBody: false },
    "push-up": { isLowerBody: false },
    "squat": { isLowerBody: true },
  };

  it("produces exactly weeks * templates.length sessions, in week-major order", () => {
    const result = expandProgramWeeks({ sessionTemplates, weeks: 4, progression, exerciseMeta });
    expect(result).toHaveLength(8);
    expect(result.map((s) => s.week)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(result.map((s) => s.title)).toEqual(["Upper A", "Lower A", "Upper A", "Lower A", "Upper A", "Lower A", "Upper A", "Lower A"]);
  });

  it("applies the upper vs lower increment per exercise based on exerciseMeta", () => {
    const result = expandProgramWeeks({ sessionTemplates, weeks: 3, progression, exerciseMeta });
    const week2Upper = result.find((s) => s.week === 2 && s.title === "Upper A");
    const week2Lower = result.find((s) => s.week === 2 && s.title === "Lower A");
    expect(week2Upper.exercises.find((e) => e.name === "Bench Press").weight).toBe(140); // 135 + 5
    expect(week2Lower.exercises.find((e) => e.name === "Squat").weight).toBe(195); // 185 + 10
  });

  it("keeps bodyweight exercises at 0 across every week", () => {
    const result = expandProgramWeeks({ sessionTemplates, weeks: 3, progression, exerciseMeta });
    for (const session of result) {
      const pushup = session.exercises.find((e) => e.name === "Push-up");
      if (pushup) expect(pushup.weight).toBe(0);
    }
  });

  it("deloads only the final week", () => {
    const result = expandProgramWeeks({ sessionTemplates, weeks: 4, progression, exerciseMeta });
    const week3Upper = result.find((s) => s.week === 3 && s.title === "Upper A");
    const week4Upper = result.find((s) => s.week === 4 && s.title === "Upper A");
    expect(week3Upper.exercises.find((e) => e.name === "Bench Press").weight).toBe(145); // 135 + 2*5, no deload
    expect(week4Upper.exercises.find((e) => e.name === "Bench Press").weight).toBe(90); // (135 + 3*5) * 0.6 = 90
  });

  it("falls back to isLowerBody: false (upper increment) for an exercise missing from exerciseMeta", () => {
    const result = expandProgramWeeks({
      sessionTemplates: [{ title: "X", note: "", exercises: [{ name: "Unknown Move", sets: 3, reps_min: 8, reps_max: 10, weight: 50, rest_s: 60, cue: "" }] }],
      weeks: 3, progression, exerciseMeta: {}, // week 2 of 3, so this isn't also the deload week
    });
    const week2 = result.find((s) => s.week === 2);
    expect(week2.exercises[0].weight).toBe(55); // 50 + upper increment (5), not lower (10)
  });
});
