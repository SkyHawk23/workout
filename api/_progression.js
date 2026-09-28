// The progression engine. Pure, deterministic functions first (unit-tested
// in tests/progression.test.js without a database); the DB orchestration
// that reads logged sets and writes the results lives at the bottom.

const UPPER_DUMBBELL_INCREMENT = 2.5; // per hand
const UPPER_INCREMENT = 5;
const LOWER_INCREMENT = 10;

export function isLowerBody(category) {
  return category === "legs";
}

// How much weight to add after a clean success (every set hit reps_max).
export function nextWeightOnSuccess(currentWeight, { category, equipment }) {
  if (isLowerBody(category)) return currentWeight + LOWER_INCREMENT;
  if (equipment === "dumbbells") return currentWeight + UPPER_DUMBBELL_INCREMENT;
  return currentWeight + UPPER_INCREMENT;
}

// ~10% cut, rounded to the nearest 5 lb, after a second consecutive miss.
export function cutWeight(currentWeight) {
  const cut = currentWeight * 0.9;
  return Math.max(0, Math.round(cut / 5) * 5);
}

// Epley estimated 1RM, adjusted for RPE (an RPE below 10 means reps were left
// in the tank, so the true 1RM is higher than a naive Epley estimate),
// then scaled to a working weight for moderate-rep work.
export function epleyWorkingWeight({ weight, reps, rpe = 8, targetPct = 0.75 }) {
  if (!weight || !reps) return 0;
  const e1rm = weight * (1 + reps / 30);
  const rpeAdjusted = e1rm * (1 + Math.max(0, 10 - rpe) * 0.025);
  const working = rpeAdjusted * targetPct;
  return Math.max(5, Math.round(working / 5) * 5);
}

// Did every logged set hit reps_max at (or above) the prescribed weight?
// Did any logged set fall below reps_min? Anything else is a hold — no
// weight change, no miss recorded.
export function evaluateExercisePerformance(plannedExercise, loggedSets) {
  const sets = plannedExercise.sets || [];
  if (!loggedSets.length || !sets.length) return "hold";

  let allHitMax = true;
  let anyBelowMin = false;
  loggedSets.forEach((log, i) => {
    const target = sets[Math.min(i, sets.length - 1)];
    if (!target) return;
    if (log.reps < target.reps_max || (target.weight && log.weight < target.weight)) allHitMax = false;
    if (log.reps < target.reps_min) anyBelowMin = true;
  });

  if (anyBelowMin) return "miss";
  if (allHitMax) return "success";
  return "hold";
}

// previousMissStreak -> {missStreak, weight, changed}. First miss just
// records itself and holds the weight; a second consecutive miss cuts it.
export function applyMissLogic(previousMissStreak, currentWeight) {
  if ((previousMissStreak || 0) === 0) {
    return { missStreak: 1, weight: currentWeight, changed: false };
  }
  return { missStreak: 0, weight: cutWeight(currentWeight), changed: true };
}

// ── DB orchestration (called from api/sessions.js on finish) ────────────
// `sql` is passed in explicitly (rather than imported at module scope) so
// this file — and its pure functions above — can be unit-tested without a
// DATABASE_URL in the environment.
export async function applyProgressionForSession(sessionLogId, userId, sql) {
  const [sessionLog] = await sql`select planned_session_id from session_logs where id = ${sessionLogId} and user_id = ${userId}`;
  if (!sessionLog?.planned_session_id) return { summary: [], sessionChanges: [] };

  const [planned] = await sql`select * from planned_sessions where id = ${sessionLog.planned_session_id} and user_id = ${userId}`;
  if (!planned) return { summary: [], sessionChanges: [] };

  const loggedSets = await sql`
    select exercise_id, set_index, reps, weight, rpe from set_logs
    where session_log_id = ${sessionLogId} order by exercise_id, set_index
  `;
  const exerciseIds = [...new Set(loggedSets.map((s) => s.exercise_id))];
  if (!exerciseIds.length) return { summary: [], sessionChanges: [] };

  const exerciseRows = await sql`select id, name, category, equipment, is_bodyweight from exercises where id = any(${exerciseIds})`;
  const exerciseById = Object.fromEntries(exerciseRows.map((e) => [e.id, e]));

  const [profile] = await sql`select working_weights from trainer_profiles where user_id = ${userId}`;
  const workingWeights = { ...(profile?.working_weights || {}) };

  const summary = []; // ephemeral, for the Done screen: "Bench 140 -> 145 lb"
  const sessionChanges = []; // persisted as session_changes rows, one per affected planned_session

  for (const exId of exerciseIds) {
    const exercise = exerciseById[exId];
    if (!exercise || exercise.is_bodyweight) continue;

    const plannedExercise = (planned.exercises || []).find((e) => e.exercise_id === exId);
    const setsForExercise = loggedSets.filter((s) => s.exercise_id === exId);
    const prevState = workingWeights[exId] || { weight: plannedExercise?.sets?.[0]?.weight || 0, miss_streak: 0 };

    let nextState = prevState;
    let reason = null;

    if (planned.is_calibration) {
      const best = setsForExercise.reduce((a, b) => (b.weight * b.reps > (a?.weight || 0) * (a?.reps || 0) ? b : a), null);
      if (best) {
        const weight = epleyWorkingWeight({ weight: Number(best.weight), reps: best.reps, rpe: Number(best.rpe) || 8 });
        nextState = { weight, miss_streak: 0 };
        reason = "calibration";
      }
    } else if (plannedExercise) {
      const outcome = evaluateExercisePerformance(plannedExercise, setsForExercise);
      if (outcome === "success") {
        const weight = nextWeightOnSuccess(prevState.weight, exercise);
        nextState = { weight, miss_streak: 0 };
        reason = "progression";
      } else if (outcome === "miss") {
        const result = applyMissLogic(prevState.miss_streak, prevState.weight);
        nextState = { weight: result.weight, miss_streak: result.missStreak };
        if (result.changed) reason = "progression";
      }
    }

    workingWeights[exId] = nextState;
    if (reason && nextState.weight !== prevState.weight) {
      const touched = await bumpFutureSessions(sql, planned.program_id, exId, nextState.weight, planned.date);
      for (const t of touched) {
        sessionChanges.push({
          planned_session_id: t.planned_session_id, reason,
          before: { exercises: t.before_exercises }, after: { exercises: t.after_exercises },
        });
      }
      summary.push({ exercise_name: exercise.name, before_weight: prevState.weight, after_weight: nextState.weight });
    }
  }

  await sql`
    update trainer_profiles set working_weights = ${JSON.stringify(workingWeights)}, updated_at = now()
    where user_id = ${userId}
  `;

  return { summary, sessionChanges };
}

async function bumpFutureSessions(sql, programId, exerciseId, newWeight, afterDate) {
  if (!programId) return [];
  const futureSessions = await sql`
    select id, exercises from planned_sessions
    where program_id = ${programId} and status = 'planned'
      and (date is null or date > ${afterDate})
  `;
  const touched = [];
  for (const row of futureSessions) {
    const exercises = row.exercises || [];
    let changed = false;
    const nextExercises = exercises.map((e) => {
      if (e.exercise_id !== exerciseId) return e;
      changed = true;
      return { ...e, sets: (e.sets || []).map((s) => ({ ...s, weight: newWeight })) };
    });
    if (changed) {
      await sql`update planned_sessions set exercises = ${JSON.stringify(nextExercises)}, revision = revision + 1, updated_at = now() where id = ${row.id}`;
      touched.push({ planned_session_id: row.id, before_exercises: exercises, after_exercises: nextExercises });
    }
  }
  return touched;
}
