// Persists the session_log's client_id per planned_session in sessionStorage
// so a page reload mid-workout resumes the same session_log (the server
// treats client_id as an idempotency key) instead of starting a duplicate.
export function getOrCreateRunClientId(plannedSessionId) {
  const key = `dl_run_client_id:${plannedSessionId}`;
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}
export function clearRunClientId(plannedSessionId) {
  sessionStorage.removeItem(`dl_run_client_id:${plannedSessionId}`);
}
