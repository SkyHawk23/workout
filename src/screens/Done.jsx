import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Btn from "../components/Btn.jsx";
import { useStore } from "../store/useStore.js";
import { kicker } from "../lib/helpers.js";

export default function Done() {
  const location = useLocation();
  const navigate = useNavigate();
  const refreshSessionsLoggedCount = useStore((s) => s.refreshSessionsLoggedCount);
  const { title, sets, mins, weightChanges } = location.state || {};

  useEffect(() => { refreshSessionsLoggedCount(); }, [refreshSessionsLoggedCount]);

  return (
    <div style={{ padding: "60px 20px 0" }}>
      <div style={kicker("var(--color-accent-2-700)")}>Filed</div>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 40, lineHeight: 1.05, marginTop: 10, letterSpacing: "-0.8px" }}>
        {title ? title + " done" : "Workout done"}
      </div>
      <div style={{ fontSize: 17, color: "var(--color-neutral-800)", marginTop: "var(--space-3)", lineHeight: 1.6 }}>
        {sets != null ? `${sets} sets · ${mins} min · filed to your history` : "Filed to your history"}
      </div>

      {weightChanges?.length > 0 && (
        <div style={{ marginTop: "var(--space-6)" }}>
          <div style={kicker("var(--color-neutral-700)")}>Next time</div>
          {weightChanges.map((c, i) => (
            <div key={i} style={{ fontSize: 15, marginTop: 8 }}>
              {c.exercise_name}: {c.before_weight} &rarr; {c.after_weight} lb
            </div>
          ))}
        </div>
      )}

      <Btn style={{ width: "100%", minHeight: 54, fontSize: 17, marginTop: "var(--space-6)" }} onClick={() => navigate("/today", { replace: true })}>Back to today</Btn>
    </div>
  );
}
