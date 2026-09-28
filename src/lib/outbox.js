import { api } from "./api.js";
import { outboxAdd, outboxAll, outboxRemove } from "./idb.js";

const BATCH_CAP = 100;

export async function queueSet(entry) {
  // entry: {client_id, session_log_id, exercise_id, set_index, reps, weight, rpe, completed_at}
  await outboxAdd(entry);
  flushOutbox().catch(() => {});
}

export async function flushOutbox() {
  const pending = await outboxAll();
  if (!pending.length) return { synced: 0, remaining: 0 };

  const bySession = new Map();
  for (const p of pending) {
    if (!bySession.has(p.session_log_id)) bySession.set(p.session_log_id, []);
    bySession.get(p.session_log_id).push(p);
  }

  let synced = 0;
  for (const [session_log_id, sets] of bySession) {
    for (let i = 0; i < sets.length; i += BATCH_CAP) {
      const batch = sets.slice(i, i + BATCH_CAP);
      try {
        await api("sessions", "log-sets", { session_log_id, sets: batch });
        await Promise.all(batch.map((s) => outboxRemove(s.client_id)));
        synced += batch.length;
      } catch {
        // stay queued; a later flush (reconnect, next load) retries it
        return { synced, remaining: pending.length - synced };
      }
    }
  }
  return { synced, remaining: 0 };
}

export function initOutboxSync() {
  flushOutbox().catch(() => {});
  window.addEventListener("online", () => flushOutbox().catch(() => {}));
}
