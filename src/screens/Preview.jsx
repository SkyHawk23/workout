import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import Btn from "../components/Btn.jsx";
import { setTarget, totalSets } from "../lib/helpers.js";
import { useStartWorkout } from "../hooks/useStartWorkout.jsx";

export default function Preview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const { begin, modal } = useStartWorkout();

  useEffect(() => {
    api("program", "session", { id }).then((res) => setSession(res.session)).catch((err) => setError(err.message));
  }, [id]);

  if (error) return <div style={{ padding: "28px 20px 0", color: "var(--color-accent-2-700)" }}>{error}</div>;
  if (!session) return <div style={{ padding: "28px 20px 0", color: "var(--color-neutral-700)" }}>Loading…</div>;

  return (
    <div style={{ padding: "28px 20px 0" }}>
      <Btn variant="ghost" style={{ padding: 0, minHeight: 32, border: "none", fontSize: 14 }} onClick={() => navigate(-1)}>&larr; Back</Btn>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 32, lineHeight: 1.1, marginTop: 14, letterSpacing: "-0.4px" }}>{session.title}</div>
      <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8 }}>{session.note} · {(session.exercises || []).length} exercises · {totalSets(session)} sets</div>
      <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {(session.exercises || []).map((e, i) => (
          <div key={i} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, color: "var(--color-accent-700)", width: 26, flex: "none" }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, lineHeight: 1.25 }}>{e.name}</div>
              <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 3 }}>{(e.sets || []).length} sets · {setTarget((e.sets || [])[0] || {})}</div>
              <div style={{ fontSize: 14, color: "var(--color-neutral-700)", marginTop: 5, fontStyle: "italic", lineHeight: 1.5 }}>{e.cue}</div>
            </div>
          </div>
        ))}
      </div>
      <Btn style={{ width: "100%", minHeight: 54, fontSize: 17, margin: "var(--space-6) 0 var(--space-4)" }} onClick={() => begin(session.id)}>Start workout</Btn>
      {modal}
    </div>
  );
}
