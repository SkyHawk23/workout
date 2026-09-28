import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useStore } from "../store/useStore.js";
import Btn from "../components/Btn.jsx";
import Dialog from "../components/Dialog.jsx";
import { kicker, fmtDate, totalSets } from "../lib/helpers.js";
import { localToday, startOfWeek, addDays } from "../../lib/date.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_BADGE = { planned: null, done: "badge-done", skipped: "badge-skipped" };

export default function Program() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(localToday(user?.timezone)));
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(null); // session being rescheduled
  const [moveDate, setMoveDate] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api("program", "week", { start: weekStart })
      .then((res) => setSessions(res.sessions || []))
      .finally(() => setLoading(false));
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  async function skip(session) {
    if (!confirm(`Skip "${session.title}"?`)) return;
    await api("program", "skip", { id: session.id });
    load();
  }

  async function saveMove() {
    if (!moving || !moveDate) return;
    await api("program", "reschedule", { id: moving.id, date: moveDate });
    setMoving(null);
    load();
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div style={{ padding: "28px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 28, letterSpacing: "-0.4px" }}>Program</div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Btn variant="ghost" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => setWeekStart((w) => addDays(w, -7))}>&larr;</Btn>
          <Btn variant="ghost" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => setWeekStart((w) => addDays(w, 7))}>&rarr;</Btn>
        </div>
      </div>
      <div style={{ ...kicker("var(--color-neutral-700)"), marginTop: 6 }}>{fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}</div>

      {loading ? (
        <div style={{ color: "var(--color-neutral-700)", marginTop: "var(--space-6)" }}>Loading…</div>
      ) : (
        <div style={{ marginTop: "var(--space-4)" }}>
          {days.map((date, i) => {
            const daySessions = sessions.filter((s) => s.date === date);
            return (
              <div key={date} style={{ padding: "16px 0", borderBottom: "1px solid var(--color-divider)" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>{WEEKDAYS[i]} · {fmtDate(date)}</div>
                {daySessions.length === 0 ? (
                  <div style={{ fontSize: 15, color: "var(--color-neutral-500)", marginTop: 6 }}>—</div>
                ) : (
                  daySessions.map((s) => (
                    <div key={s.id} style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-2)" }}>
                        <div onClick={() => navigate(`/program/${s.id}`)} style={{ cursor: "pointer", flex: 1 }}>
                          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18 }}>
                            {s.title} {STATUS_BADGE[s.status] && <span className={`badge ${STATUS_BADGE[s.status]}`} style={{ marginLeft: 6 }}>{s.status}</span>}
                          </div>
                          <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginTop: 2 }}>{totalSets(s)} sets</div>
                        </div>
                      </div>
                      {s.status === "planned" && (
                        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: 6 }}>
                          <Btn variant="ghost" style={{ minHeight: 32, padding: 0, fontSize: 13 }} onClick={() => { setMoving(s); setMoveDate(s.date); }}>Move to…</Btn>
                          <Btn variant="ghost" style={{ minHeight: 32, padding: 0, fontSize: 13 }} onClick={() => skip(s)}>Skip</Btn>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {moving && (
        <Dialog
          title="Move session"
          actions={<>
            <Btn variant="ghost" style={{ minHeight: 44 }} onClick={() => setMoving(null)}>Cancel</Btn>
            <Btn style={{ minHeight: 44 }} onClick={saveMove}>Save</Btn>
          </>}
        >
          <div className="field">
            <label>New date</label>
            <input className="input" type="date" autoComplete="off" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
