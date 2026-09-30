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

// A planned-session "set" is {reps_min, reps_max, weight, rpe_target} for a
// normal set, or {hold_s} for a timed one (a stretch, plank, or other hold).
export function setTarget(set) {
  if (set.hold_s) return `Hold ${set.hold_s}s`;
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

// Pulls the video id out of a youtube.com/watch?v=ID or youtube.com/shorts/ID
// url so we can show YouTube's own thumbnail without an <iframe> embed.
export function youtubeThumbnail(url) {
  if (!url) return null;
  const match = url.match(/(?:[?&]v=|\/shorts\/)([\w-]{6,})/);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}

export function listNames(session) {
  return (session.exercises || []).map((e) => e.name).join(" · ");
}

export const kicker = (color) => ({ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color });

export function genClientId() {
  return crypto.randomUUID();
}
