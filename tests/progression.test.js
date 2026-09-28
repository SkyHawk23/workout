import { describe, it, expect } from "vitest";
import {
  nextWeightOnSuccess, cutWeight, epleyWorkingWeight,
  evaluateExercisePerformance, applyMissLogic, isLowerBody,
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
