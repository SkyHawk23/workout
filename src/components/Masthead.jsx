import { useNavigate } from "react-router-dom";

// Gear icon rendered as type (Broadsheet uses no icon assets) — a small ⚙ glyph
// in the same serif, sized and spaced like the rest of the masthead chrome.
export default function Masthead({ sessionsLogged }) {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return (
    <div style={{ padding: "26px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 34, letterSpacing: "-0.5px", lineHeight: 1 }}>
          The Daily Lift
        </div>
        <button
          onClick={() => navigate("/settings")}
          aria-label="Settings"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-neutral-700)", fontSize: 22, lineHeight: 1, padding: 4 }}
        >
          ⚙
        </button>
      </div>
      <div style={{ height: 4, background: "var(--color-text)", marginTop: 14 }} />
      <div
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0",
          fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-700)",
        }}
      >
        <span>{today}</span>
        <span>{sessionsLogged} sessions logged</span>
      </div>
      <div style={{ height: 1, background: "var(--color-text)" }} />
    </div>
  );
}
