// Shared date helpers used by both api/*.js (Node/Vercel) and src/*.jsx
// (Vite/browser). Every "today" and week boundary in the app goes through
// these, computed in the member's own timezone — never the server's or the
// browser's local zone, which would put weekend sessions on the wrong day
// for a member traveling or a server running in UTC.

// Formats a Date as an ISO-shaped YYYY-MM-DD string in the given IANA
// timezone. en-CA happens to format that way already.
export function localDate(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function localToday(timezone) {
  return localDate(new Date(), timezone);
}

// Pure date-string arithmetic — once "today" has been resolved to an ISO
// date in the right timezone, everything downstream is timezone-agnostic.
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  return new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = Sunday
}

export function startOfWeek(iso) {
  const day = weekdayOf(iso);
  return addDays(iso, day === 0 ? -6 : 1 - day); // ISO week starts Monday
}
