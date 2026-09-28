export function fmtDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function agoText(iso) {
  if (!iso) return "never";
  const days = Math.round((Date.now() - new Date(iso + "T12:00:00").getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return days + " days ago";
  return Math.floor(days / 7) + " weeks ago";
}

// A planned-session "set" is {reps_min, reps_max, weight, rpe_target}.
export function setTarget(set) {
  const reps = set.reps_min === set.reps_max ? `${set.reps_max}` : `${set.reps_min}-${set.reps_max}`;
  return set.weight ? `${set.weight} lb × ${reps}` : `${reps} reps`;
}

export function exerciseTarget(ex) {
  const sets = ex.sets || [];
  if (!sets.length) return "";
  return `${sets.length} sets · ${setTarget(sets[0])}`;
}

export function totalSets(session) {
  return (session.exercises || []).reduce((n, e) => n + (e.sets || []).length, 0);
}

export function listNames(session) {
  return (session.exercises || []).map((e) => e.name).join(" · ");
}

export const kicker = (color) => ({ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color });

export function genClientId() {
  return crypto.randomUUID();
}
