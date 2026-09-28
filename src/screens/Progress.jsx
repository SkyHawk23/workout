import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { kicker } from "../lib/helpers.js";

export default function Progress() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api("sessions", "stats", {}).then(setStats);
  }, []);

  if (!stats) return <div style={{ padding: "28px 20px 0", color: "var(--color-neutral-700)" }}>Loading…</div>;

  return (
    <div style={{ padding: "28px 20px 0" }}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 28, letterSpacing: "-0.4px" }}>Progress</div>

      {stats.streak > 0 && (
        <div style={{ fontSize: 15, color: "var(--color-accent-700)", marginTop: 8 }}>{stats.streak}-week streak</div>
      )}

      <div style={{ ...kicker("var(--color-neutral-700)"), marginTop: "var(--space-4)" }}>Sessions, last eight weeks</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-2)", height: 130, marginTop: "var(--space-3)", borderBottom: "1px solid var(--color-text)" }}>
        {stats.weeks.map((w, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
            <div className="tabular" style={{ fontSize: 12, color: "var(--color-neutral-700)", marginBottom: 4 }}>{w.count}</div>
            <div style={{ width: "100%", background: "var(--color-accent)", height: `${Math.min(100, (w.count / 4) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 6 }}>
        {stats.weeks.map((w, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "var(--color-neutral-700)" }}>{w.label}</div>)}
      </div>

      <div style={{ ...kicker("var(--color-neutral-700)"), marginTop: "var(--space-8)" }}>Heaviest set on record</div>
      {stats.prs.length === 0 && <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: "var(--space-3)" }}>No exercises recorded yet.</div>}
      {stats.prs.map((p) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "13px 0", borderBottom: "1px solid var(--color-divider)" }}>
          <div style={{ fontSize: 17 }}>{p.name}</div>
          <div className="tabular" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17 }}>{p.best}</div>
        </div>
      ))}
    </div>
  );
}
