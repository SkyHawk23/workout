import { sql } from "./_db.js";
import { withHandler } from "./_respond.js";
import { requireUser, httpError } from "./_auth.js";
import { str, int, arr, CHAT_MESSAGE_MAX, TRAINER_NOTES_MAX } from "./_validate.js";
import { anthropic, TRAINER_MODEL, assertUnderTokenCap, recordTokenUsage } from "./_anthropic.js";
import { resolveExerciseId } from "./_exercises.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CHAT_HISTORY_LIMIT = 20;
const MAX_TOOL_ITERATIONS = 5;

function nextTrainingDates(preferredDays, count, fromDate = new Date()) {
  const wanted = new Set((preferredDays || []).map((d) => WEEKDAYS.indexOf(d)).filter((i) => i >= 0));
  if (!wanted.size) return [];
  const dates = [];
  const cursor = new Date(fromDate);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + 1); // start from tomorrow
  while (dates.length < count) {
    if (wanted.has(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function ageFromBirthYear(birthYear) {
  if (!birthYear) return null;
  return new Date().getUTCFullYear() - birthYear;
}

function systemPrompt(user, profile) {
  const age = ageFromBirthYear(user.birth_year);
  const youth = age !== null && age < 18;
  return [
    "You are the AI personal trainer for The Daily Lift, a family workout app. You are a supportive, direct strength coach who writes in short sentences.",
    "All weights are in pounds. Never use kilograms.",
    `Member: ${user.display_name}${age !== null ? `, age ${age}` : ""}.`,
    profile.limitations ? `Limitations/injuries to always respect: ${profile.limitations}` : "No reported limitations.",
    "If something hurts or the member describes pain, suggest a safe alternative and recommend seeing a medical professional. Never diagnose.",
    youth
      ? "This member is under 18: keep programming technique-first with moderate loads. Never suggest a 1-rep max or any max-effort attempt. Encourage adult supervision during training."
      : "",
    "When the member asks you to change their program, use your tools rather than just describing the change in prose — the tools are how changes actually take effect.",
    "regenerate_program requires the member to confirm in the app before it runs; when you call it, tell them you've queued it and they need to confirm.",
  ].filter(Boolean).join("\n");
}

function profileBlock(profile, weekSummary, recentSessions, trainerNotes) {
  return [
    `Goals: ${JSON.stringify(profile.goals || [])}`,
    `Experience: ${profile.experience || "unknown"}`,
    `Equipment: ${JSON.stringify(profile.equipment || {})}`,
    `Schedule: ${JSON.stringify(profile.schedule || {})}`,
    `This week's planned sessions: ${JSON.stringify(weekSummary)}`,
    `Last 5 completed sessions: ${JSON.stringify(recentSessions)}`,
    `Trainer notes (things you've learned about this member): ${trainerNotes || "(none yet)"}`,
  ].join("\n");
}

// ── Program generation (shared by intake, generate-program, and the
// regenerate_program chat tool once the member confirms it) ─────────────
const PROGRAM_TOOL = {
  name: "emit_program",
  description: "Emit the generated multi-week workout program as structured data.",
  input_schema: {
    type: "object",
    required: ["name", "weeks", "sessions"],
    properties: {
      name: { type: "string" },
      weeks: { type: "integer", minimum: 4, maximum: 8 },
      sessions: {
        type: "array",
        description: "Flat list of every session across every week, in chronological order (week 1 first session, week 1 second session, ... week N last session).",
        items: {
          type: "object",
          required: ["week", "title", "note", "exercises"],
          properties: {
            week: { type: "integer" },
            title: { type: "string" },
            note: { type: "string" },
            exercises: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "sets", "reps_min", "reps_max", "rest_s", "cue"],
                properties: {
                  name: { type: "string" },
                  sets: { type: "integer" },
                  reps_min: { type: "integer" },
                  reps_max: { type: "integer" },
                  weight: { type: "integer", description: "Starting working weight in pounds, 0 for bodyweight." },
                  rest_s: { type: "integer" },
                  cue: { type: "string", description: "One short, terse coaching cue." },
                },
              },
            },
          },
        },
      },
    },
  },
};

async function generateProgramCore(user, profile) {
  const daysPerWeek = int(profile.schedule?.days_per_week, { field: "days_per_week", min: 1, max: 7 });
  const hasKnownWeights = profile.working_weights && Object.keys(profile.working_weights).length > 0;
  const age = ageFromBirthYear(user.birth_year);

  let workingWeightsByName = {};
  if (hasKnownWeights) {
    const ids = Object.keys(profile.working_weights);
    const rows = await sql`select id, name from exercises where id = any(${ids})`;
    for (const row of rows) workingWeightsByName[row.name] = profile.working_weights[row.id].weight;
  }

  const prompt = `Build a multi-week (4-8 week) strength program for this member.
Goals: ${JSON.stringify(profile.goals)}
Experience: ${profile.experience}
Equipment available: ${JSON.stringify(profile.equipment)}
Days per week: ${daysPerWeek}, session length: ${profile.schedule?.session_minutes} minutes
${profile.limitations ? `Limitations: ${profile.limitations}` : "No limitations reported."}
${hasKnownWeights ? `Known current working weights (lb): ${JSON.stringify(workingWeightsByName)}` : "The member does not know their working weights — use conservative, achievable starting loads (or 0 for bodyweight moves) since week 1 is a calibration week."}
${age !== null && age < 18 ? "This member is under 18 — technique-first, moderate loads, no 1RM or max-effort testing." : ""}

Make the final week of the program a deload week (reduce volume or intensity). Emit the program using the emit_program tool — the sessions array must contain exactly weeks * ${daysPerWeek} entries, in chronological order.`;

  const response = await anthropic.messages.create({
    model: TRAINER_MODEL,
    max_tokens: 4000,
    system: "You are a strength and conditioning coach designing a structured training program. Weights are always in pounds.",
    tools: [PROGRAM_TOOL],
    tool_choice: { type: "tool", name: "emit_program" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw httpError(502, "The trainer didn't return a program. Try again.", "trainer_error");
  const generated = toolUse.input;

  const weeks = Math.max(4, Math.min(8, generated.weeks || 4));
  const dates = nextTrainingDates(profile.schedule?.preferred_days, weeks * daysPerWeek);
  const sessions = (generated.sessions || []).slice(0, dates.length);

  await sql`update programs set status = 'archived' where user_id = ${user.id} and status = 'active'`;
  const [program] = await sql`
    insert into programs (user_id, name, start_date, weeks, status, source)
    values (${user.id}, ${generated.name || "AI Program"}, ${dates[0] || null}, ${weeks}, 'active', 'ai')
    returning *
  `;

  const createdSessions = [];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const resolvedExercises = [];
    for (const ex of s.exercises || []) {
      const exercise = await resolveExerciseId(sql, user.id, ex.name);
      const weight = exercise.is_bodyweight ? 0 : ex.weight ?? 0;
      resolvedExercises.push({
        exercise_id: exercise.id,
        name: ex.name,
        cue: ex.cue || "",
        rest_s: ex.rest_s || 90,
        sets: Array.from({ length: Math.max(1, ex.sets || 3) }, () => ({
          reps_min: ex.reps_min || 8, reps_max: ex.reps_max || 10, weight, rpe_target: null,
        })),
      });
    }
    const isCalibration = s.week === 1 && !hasKnownWeights;
    const [row] = await sql`
      insert into planned_sessions (program_id, user_id, date, title, note, exercises, status, kind, is_calibration)
      values (${program.id}, ${user.id}, ${dates[i]}, ${s.title}, ${s.note || ""}, ${JSON.stringify(resolvedExercises)}, 'planned', 'program', ${isCalibration})
      returning *
    `;
    createdSessions.push(row);
  }

  return { program, sessions: createdSessions };
}

// ── Quick, one-off workout (shared by the standalone action and the
// create_quick_workout chat tool) ────────────────────────────────────────
const QUICK_TOOL = {
  name: "emit_quick_workout",
  description: "Emit a single one-off workout.",
  input_schema: {
    type: "object",
    required: ["title", "exercises"],
    properties: {
      title: { type: "string" },
      exercises: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "sets", "reps_min", "reps_max", "rest_s", "cue"],
          properties: {
            name: { type: "string" }, sets: { type: "integer" },
            reps_min: { type: "integer" }, reps_max: { type: "integer" },
            weight: { type: "integer" }, rest_s: { type: "integer" }, cue: { type: "string" },
          },
        },
      },
    },
  },
};

async function createQuickWorkoutCore(userId, { minutes, focus, equipment }) {
  const prompt = `Build ONE one-off workout for ${minutes} minutes, focus: ${focus}, equipment: ${equipment || "whatever's on hand"}. Emit it with the emit_quick_workout tool. Weights in pounds, 0 for bodyweight.`;
  const response = await anthropic.messages.create({
    model: TRAINER_MODEL,
    max_tokens: 1500,
    system: "You are a strength coach building a single workout. Weights are always in pounds.",
    tools: [QUICK_TOOL],
    tool_choice: { type: "tool", name: "emit_quick_workout" },
    messages: [{ role: "user", content: prompt }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw httpError(502, "The trainer didn't return a workout. Try again.", "trainer_error");
  const generated = toolUse.input;

  const resolvedExercises = [];
  for (const ex of generated.exercises || []) {
    const exercise = await resolveExerciseId(sql, userId, ex.name);
    const weight = exercise.is_bodyweight ? 0 : ex.weight ?? 0;
    resolvedExercises.push({
      exercise_id: exercise.id, name: ex.name, cue: ex.cue || "", rest_s: ex.rest_s || 60,
      sets: Array.from({ length: Math.max(1, ex.sets || 3) }, () => ({ reps_min: ex.reps_min || 8, reps_max: ex.reps_max || 12, weight, rpe_target: null })),
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  const [row] = await sql`
    insert into planned_sessions (program_id, user_id, date, title, note, exercises, status, kind)
    values (null, ${userId}, ${today}, ${generated.title || "Quick workout"}, ${`${equipment || "Bodyweight"}, built just now`}, ${JSON.stringify(resolvedExercises)}, 'planned', 'quick')
    returning *
  `;
  return row;
}

// ── Profile handlers ──────────────────────────────────────────────────
async function getProfile(req) {
  const session = requireUser(req);
  const [profile] = await sql`select * from trainer_profiles where user_id = ${session.id}`;
  return { profile };
}

async function intake(req, res, body) {
  const session = requireUser(req);
  const goals = arr(body.goals, { field: "goals", maxLen: 20 });
  const experience = str(body.experience, { field: "experience" });
  const equipment = body.equipment || {};
  const schedule = body.schedule || {};
  int(schedule.days_per_week, { field: "schedule.days_per_week", min: 1, max: 7 });
  int(schedule.session_minutes, { field: "schedule.session_minutes", min: 10, max: 180 });
  arr(schedule.preferred_days, { field: "schedule.preferred_days", maxLen: 7 });
  const limitations = str(body.limitations, { field: "limitations", required: false, max: 1000 });
  const birth_year = body.birth_year ? int(body.birth_year, { field: "birth_year", min: 1900, max: new Date().getFullYear() }) : null;

  const knownWeights = body.working_weights || {}; // {"Squat": 135, "Bench Press": 95, ...} or {}
  const working_weights = {};
  for (const [name, weight] of Object.entries(knownWeights)) {
    if (!weight) continue;
    const exercise = await resolveExerciseId(sql, session.id, name);
    working_weights[exercise.id] = { weight: Number(weight), miss_streak: 0 };
  }

  await sql`
    update trainer_profiles set goals = ${JSON.stringify(goals)}, experience = ${experience},
      equipment = ${JSON.stringify(equipment)}, schedule = ${JSON.stringify(schedule)},
      limitations = ${limitations}, working_weights = ${JSON.stringify(working_weights)}, updated_at = now()
    where user_id = ${session.id}
  `;
  if (birth_year) await sql`update users set birth_year = ${birth_year} where id = ${session.id}`;

  const [profile] = await sql`select * from trainer_profiles where user_id = ${session.id}`;
  const [user] = await sql`select * from users where id = ${session.id}`;
  const result = await generateProgramCore(user, profile);
  return result;
}

async function updateProfile(req, res, body) {
  const session = requireUser(req);
  const [existing] = await sql`select * from trainer_profiles where user_id = ${session.id}`;
  const goals = body.goals !== undefined ? arr(body.goals, { field: "goals", maxLen: 20 }) : existing.goals;
  const experience = body.experience !== undefined ? str(body.experience, { field: "experience" }) : existing.experience;
  const equipment = body.equipment !== undefined ? body.equipment : existing.equipment;
  const schedule = body.schedule !== undefined ? body.schedule : existing.schedule;
  const limitations = body.limitations !== undefined ? str(body.limitations, { field: "limitations", required: false, max: 1000 }) : existing.limitations;

  await sql`
    update trainer_profiles set goals = ${JSON.stringify(goals)}, experience = ${experience},
      equipment = ${JSON.stringify(equipment)}, schedule = ${JSON.stringify(schedule)},
      limitations = ${limitations}, updated_at = now()
    where user_id = ${session.id}
  `;
  const [profile] = await sql`select * from trainer_profiles where user_id = ${session.id}`;
  return { profile };
}

async function generateProgram(req) {
  const session = requireUser(req);
  const [user] = await sql`select * from users where id = ${session.id}`;
  const [profile] = await sql`select * from trainer_profiles where user_id = ${session.id}`;
  if (!profile?.schedule?.days_per_week) throw httpError(400, "Complete intake before generating a program", "no_profile");
  return generateProgramCore(user, profile);
}

async function quickWorkout(req, res, body) {
  const session = requireUser(req);
  const minutes = int(body.minutes, { field: "minutes", min: 5, max: 180 });
  const focus = str(body.focus, { field: "focus" });
  const equipment = str(body.equipment, { field: "equipment", required: false });
  const row = await createQuickWorkoutCore(session.id, { minutes, focus, equipment });
  return { session: row };
}

// ── Chat ───────────────────────────────────────────────────────────────
const CHAT_TOOLS = [
  { name: "get_history", description: "Get the member's recent training history.", input_schema: { type: "object", properties: { days: { type: "integer" } }, required: ["days"] } },
  { name: "get_program", description: "Get upcoming planned sessions.", input_schema: { type: "object", properties: { weeks_ahead: { type: "integer" } }, required: ["weeks_ahead"] } },
  { name: "modify_session", description: "Replace the exercises in one planned session.", input_schema: { type: "object", properties: { session_id: { type: "string" }, exercises: { type: "array" }, reason: { type: "string" } }, required: ["session_id", "exercises", "reason"] } },
  { name: "swap_exercise", description: "Swap one exercise in a planned session for another.", input_schema: { type: "object", properties: { session_id: { type: "string" }, from: { type: "string" }, to: { type: "string" }, reason: { type: "string" } }, required: ["session_id", "from", "to", "reason"] } },
  { name: "reschedule", description: "Move a planned session to a different date.", input_schema: { type: "object", properties: { session_id: { type: "string" }, date: { type: "string" } }, required: ["session_id", "date"] } },
  { name: "skip_session", description: "Mark a planned session as skipped.", input_schema: { type: "object", properties: { session_id: { type: "string" }, reason: { type: "string" } }, required: ["session_id", "reason"] } },
  { name: "update_profile", description: "Update fields on the member's trainer profile.", input_schema: { type: "object", properties: { fields: { type: "object" } }, required: ["fields"] } },
  { name: "regenerate_program", description: "Queue a full program regeneration. Requires the member to confirm in the app before it runs.", input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
  { name: "create_quick_workout", description: "Create a one-off workout for today.", input_schema: { type: "object", properties: { minutes: { type: "integer" }, focus: { type: "string" } }, required: ["minutes", "focus"] } },
];

async function runTool(session, name, input) {
  switch (name) {
    case "get_history": {
      const days = Math.min(90, input.days || 30);
      const rows = await sql`
        select started_at, ended_at from session_logs
        where user_id = ${session.id} and ended_at is not null
          and started_at > ${new Date(Date.now() - days * 86400000).toISOString()}
        order by started_at desc
      `;
      return { result: { sessions: rows.length, dates: rows.map((r) => r.started_at.toISOString().slice(0, 10)) } };
    }
    case "get_program": {
      const weeksAhead = Math.min(8, input.weeks_ahead || 2);
      const rows = await sql`
        select id, date, title, status from planned_sessions
        where user_id = ${session.id} and status = 'planned'
          and date <= ${new Date(Date.now() + weeksAhead * 7 * 86400000).toISOString().slice(0, 10)}
        order by date
      `;
      return { result: { sessions: rows } };
    }
    case "modify_session": {
      const [row] = await sql`select * from planned_sessions where id = ${input.session_id} and user_id = ${session.id}`;
      if (!row) return { result: { error: "Session not found" } };
      await sql`update planned_sessions set exercises = ${JSON.stringify(input.exercises)}, revision = revision + 1, updated_at = now() where id = ${row.id} and user_id = ${session.id}`;
      const [change] = await sql`
        insert into session_changes (planned_session_id, user_id, reason, before, after)
        values (${row.id}, ${session.id}, 'trainer_modify', ${JSON.stringify({ exercises: row.exercises })}, ${JSON.stringify({ exercises: input.exercises })})
        returning id
      `;
      return {
        result: { ok: true },
        changeCard: { change_id: change.id, summary: `Trainer changed "${row.title}": ${input.reason}` },
      };
    }
    case "swap_exercise": {
      const [row] = await sql`select * from planned_sessions where id = ${input.session_id} and user_id = ${session.id}`;
      if (!row) return { result: { error: "Session not found" } };
      const toExercise = await resolveExerciseId(sql, session.id, input.to);
      const nextExercises = (row.exercises || []).map((e) =>
        e.name.toLowerCase() === input.from.toLowerCase()
          ? { ...e, exercise_id: toExercise.id, name: input.to, sets: (e.sets || []).map((s) => ({ ...s, weight: toExercise.is_bodyweight ? 0 : s.weight })) }
          : e
      );
      await sql`update planned_sessions set exercises = ${JSON.stringify(nextExercises)}, revision = revision + 1, updated_at = now() where id = ${row.id} and user_id = ${session.id}`;
      const [change] = await sql`
        insert into session_changes (planned_session_id, user_id, reason, before, after)
        values (${row.id}, ${session.id}, 'trainer_swap', ${JSON.stringify({ exercises: row.exercises })}, ${JSON.stringify({ exercises: nextExercises })})
        returning id
      `;
      return {
        result: { ok: true },
        changeCard: { change_id: change.id, summary: `Trainer changed "${row.title}": swapped ${input.from} for ${input.to} (${input.reason}).` },
      };
    }
    case "reschedule": {
      const [row] = await sql`select * from planned_sessions where id = ${input.session_id} and user_id = ${session.id}`;
      if (!row) return { result: { error: "Session not found" } };
      await sql`update planned_sessions set date = ${input.date}, revision = revision + 1, updated_at = now() where id = ${row.id} and user_id = ${session.id}`;
      const [change] = await sql`
        insert into session_changes (planned_session_id, user_id, reason, before, after)
        values (${row.id}, ${session.id}, 'reschedule', ${JSON.stringify({ date: row.date })}, ${JSON.stringify({ date: input.date })})
        returning id
      `;
      return { result: { ok: true }, changeCard: { change_id: change.id, summary: `Trainer moved "${row.title}" to ${input.date}.` } };
    }
    case "skip_session": {
      const [row] = await sql`select * from planned_sessions where id = ${input.session_id} and user_id = ${session.id}`;
      if (!row) return { result: { error: "Session not found" } };
      await sql`update planned_sessions set status = 'skipped', revision = revision + 1, updated_at = now() where id = ${row.id} and user_id = ${session.id}`;
      const [change] = await sql`
        insert into session_changes (planned_session_id, user_id, reason, before, after)
        values (${row.id}, ${session.id}, 'skip', ${JSON.stringify({ status: row.status })}, ${JSON.stringify({ status: "skipped" })})
        returning id
      `;
      return { result: { ok: true }, changeCard: { change_id: change.id, summary: `Trainer skipped "${row.title}": ${input.reason}` } };
    }
    case "update_profile": {
      const [existing] = await sql`select * from trainer_profiles where user_id = ${session.id}`;
      const merged = { ...existing, ...input.fields };
      await sql`
        update trainer_profiles set goals = ${JSON.stringify(merged.goals)}, experience = ${merged.experience},
          equipment = ${JSON.stringify(merged.equipment)}, schedule = ${JSON.stringify(merged.schedule)},
          limitations = ${merged.limitations}, updated_at = now()
        where user_id = ${session.id}
      `;
      return { result: { ok: true } };
    }
    case "regenerate_program":
      return { result: { queued: true }, pendingConfirmation: { reason: input.reason } };
    case "create_quick_workout": {
      const row = await createQuickWorkoutCore(session.id, { minutes: input.minutes, focus: input.focus });
      return { result: { session_id: row.id, title: row.title }, changeCard: { summary: `Trainer built a quick workout: "${row.title}".` } };
    }
    default:
      return { result: { error: "Unknown tool" } };
  }
}

async function chat(req, res, body) {
  const session = requireUser(req);
  const userMessage = str(body.message, { field: "message", min: 1, max: CHAT_MESSAGE_MAX });

  await assertUnderTokenCap(sql, session.id);

  const [user] = await sql`select * from users where id = ${session.id}`;
  const [profile] = await sql`select * from trainer_profiles where user_id = ${session.id}`;

  const weekSummary = await sql`
    select title, date, status from planned_sessions where user_id = ${session.id}
      and date >= ${new Date().toISOString().slice(0, 10)}
    order by date limit 14
  `;
  const recentSessions = await sql`
    select coalesce(ps.title, 'Workout') as title, sl.started_at::date as date
    from session_logs sl left join planned_sessions ps on ps.id = sl.planned_session_id
    where sl.user_id = ${session.id} and sl.ended_at is not null
    order by sl.started_at desc limit 5
  `;

  const priorMessages = await sql`
    select role, content from chat_messages where user_id = ${session.id}
    order by created_at desc limit ${CHAT_HISTORY_LIMIT}
  `;
  const messages = priorMessages.reverse().map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: "user", content: userMessage });

  const system = [
    { type: "text", text: systemPrompt(user, profile), cache_control: { type: "ephemeral" } },
    { type: "text", text: profileBlock(profile, weekSummary, recentSessions, profile.trainer_notes), cache_control: { type: "ephemeral" } },
  ];

  const changeCards = [];
  let pendingConfirmation = null;
  let totalTokens = 0;
  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: TRAINER_MODEL, max_tokens: 1500, system, tools: CHAT_TOOLS, messages,
    });
    totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const textBlocks = response.content.filter((b) => b.type === "text");
    finalText = textBlocks.map((b) => b.text).join("\n") || finalText;

    if (!toolUses.length) break;

    messages.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const call of toolUses) {
      const { result, changeCard, pendingConfirmation: pc } = await runTool(session, call.name, call.input);
      if (changeCard) changeCards.push(changeCard);
      if (pc) pendingConfirmation = pc;
      toolResults.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  await recordTokenUsage(sql, session.id, totalTokens);
  await sql`insert into chat_messages (user_id, role, content) values (${session.id}, 'user', ${JSON.stringify(userMessage)})`;
  await sql`insert into chat_messages (user_id, role, content) values (${session.id}, 'assistant', ${JSON.stringify(finalText)})`;

  if (finalText) {
    const notesPrompt = `Given this exchange, is there anything new and durable worth remembering about this member (injuries, preferences, schedule changes)? Current notes: "${profile.trainer_notes || ""}". Member said: "${userMessage}". Reply with the FULL updated notes text (max ${TRAINER_NOTES_MAX} chars), or reply with exactly the current notes unchanged if nothing new.`;
    try {
      const notesResp = await anthropic.messages.create({
        model: TRAINER_MODEL, max_tokens: 400,
        messages: [{ role: "user", content: notesPrompt }],
      });
      const notes = notesResp.content.find((b) => b.type === "text")?.text?.slice(0, TRAINER_NOTES_MAX);
      if (notes) await sql`update trainer_profiles set trainer_notes = ${notes}, updated_at = now() where user_id = ${session.id}`;
    } catch {
      // notes are best-effort; never fail the chat turn over them
    }
  }

  return { reply: finalText, changeCards, pendingConfirmation };
}

export default withHandler({
  "get-profile": getProfile,
  intake,
  "update-profile": updateProfile,
  "generate-program": generateProgram,
  chat,
  "quick-workout": quickWorkout,
});
