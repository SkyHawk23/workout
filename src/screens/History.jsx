import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import Btn from "../components/Btn.jsx";
import { fmtDate } from "../lib/helpers.js";

export default function History() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({}); // {id: detail[]}

  useEffect(() => {
    api("sessions", "history", {}).then((res) => setSessions(res.sessions || [])).finally(() => setLoading(false));
  }, []);

  async function toggle(session) {
    if (openId === session.id) { setOpenId(null); return; }
    setOpenId(session.id);
    if (!details[session.id]) {
      const res = await api("sessions", "history-detail", { session_log_id: session.id });
      setDetails((d) => ({ ...d, [session.id]: res.detail }));
    }
  }

  async function remove(session) {
    if (!confirm("Remove this session from your history?")) return;
    await api("sessions", "delete", { session_log_id: session.id });
    setSessions((s) => s.filter((x) => x.id !== session.id));
    setOpenId((o) => (o === session.id ? null : o));
  }

  return (
    <div style={{ padding: "28px 20px 0" }}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 28, letterSpacing: "-0.4px" }}>History</div>
      {loading && <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: "var(--space-4)" }}>Loading…</div>}
      {!loading && sessions.length === 0 && <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: "var(--space-4)" }}>No sessions logged yet.</div>}
      {sessions.map((h) => {
        const open = openId === h.id;
        return (
          <div key={h.id} style={{ padding: "4px 0", borderBottom: "1px solid var(--color-divider)" }}>
            <div onClick={() => toggle(h)} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-2)", padding: "14px 0", cursor: "pointer", minHeight: 44 }}>
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18 }}>
                  {h.name} {h.source === "watch" && <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>⌚ Watch</span>}
                </div>
                <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginTop: 3 }}>{h.sets} sets{h.mins ? ` · ${h.mins} min` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flex: "none" }}>
                <div style={{ fontSize: 13, color: "var(--color-neutral-700)", whiteSpace: "nowrap" }}>{fmtDate(h.date)}</div>
                <div style={{ fontSize: 12, color: "var(--color-accent-700)", whiteSpace: "nowrap" }}>{open ? "Hide" : "Details"}</div>
              </div>
            </div>
            {open && (
              <div style={{ padding: "0 0 var(--space-4)", display: "flex", flexDirection: "column", gap: 8 }}>
                {(details[h.id] || []).map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: 15 }}>
                    <div style={{ color: "var(--color-neutral-800)" }}>{d.name}</div>
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, whiteSpace: "nowrap" }}>{d.target}</div>
                  </div>
                ))}
                <Btn variant="ghost" style={{ alignSelf: "flex-start", minHeight: 36, padding: "0 12px", marginTop: 4 }} onClick={() => remove(h)}>Remove</Btn>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
