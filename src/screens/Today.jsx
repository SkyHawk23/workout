import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useStore } from "../store/useStore.js";
import Btn from "../components/Btn.jsx";
import { kicker, totalSets, listNames } from "../lib/helpers.js";
import { localToday, weekdayOf } from "../../lib/date.js";
import { useStartWorkout } from "../hooks/useStartWorkout.jsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function Today() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [program, setProgram] = useState(null);
  const [profile, setProfile] = useState(null);
  const [trainerNote, setTrainerNote] = useState("");
  const [error, setError] = useState("");
  const [startingToday, setStartingToday] = useState(false);
  const [building, setBuilding] = useState(false);
  const { begin, modal } = useStartWorkout();

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([api("program", "current"), api("trainer", "get-profile").catch(() => ({ profile: null }))])
      .then(([programRes, profileRes]) => {
        setSessions(programRes.sessions || []);
        setProgram(programRes.program);
        setProfile(profileRes.profile);
        setTrainerNote(profileRes.profile?.trainer_notes?.split(/(?<=[.!?])\s/)[0] || "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function buildProgram() {
    setBuilding(true);
    setError("");
    try {
      await api("trainer", "generate-program", {});
      await load();
    } catch (err) {
      setError(err.message || "Couldn't build your program. Try again.");
    } finally {
      setBuilding(false);
    }
  }

  if (loading) return <div style={{ padding: "28px 20px 0", color: "var(--color-neutral-700)" }}>Loading…</div>;

  const todayIso = localToday(user?.timezone);
  const planned = sessions.filter((s) => s.kind === "program" && s.status === "planned");
  const quick = sessions.filter((s) => s.kind === "quick" && s.status === "planned" && s.date === todayIso);
  const todaySession = planned.find((s) => s.date === todayIso);
  const nextUpcoming = planned.filter((s) => s.date > todayIso).sort((a, b) => a.date.localeCompare(b.date))[0];
  const profileComplete = !!profile?.schedule?.days_per_week;

  async function trainNowAnyway() {
    if (!nextUpcoming) return;
    setStartingToday(true);
    try {
      await api("program", "start-today", { id: nextUpcoming.id });
      navigate(`/run/${nextUpcoming.id}`);
    } catch (err) {
      setError(err.message || "Couldn't start that session");
      setStartingToday(false);
    }
  }

  return (
    <div>
      <div style={{ padding: "28px 20px 0" }}>
        {todaySession ? (
          <SessionCard title="Today" session={todaySession} onBegin={() => begin(todaySession.id)} onPreview={() => navigate(`/program/${todaySession.id}`)} />
        ) : !program && profileComplete ? (
          <div>
            <div style={{ ...kicker("var(--color-accent-700)"), marginBottom: 8 }}>Today</div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: "-0.4px" }}>Your program isn't built yet.</div>
            <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, lineHeight: 1.5 }}>
              Your intake answers are saved — build your program from them whenever you're ready.
            </div>
            <Btn style={{ width: "100%", minHeight: 52, fontSize: 17, marginTop: "var(--space-4)" }} disabled={building} onClick={buildProgram}>
              {building ? "Building your program…" : "Build my program"}
            </Btn>
          </div>
        ) : (
          <div>
            <div style={{ ...kicker("var(--color-accent-700)"), marginBottom: 8 }}>Today</div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: "-0.4px" }}>Rest day.</div>
            {nextUpcoming && (
              <>
                <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, lineHeight: 1.5 }}>
                  Next up: {WEEKDAYS[weekdayOf(nextUpcoming.date)]} — {nextUpcoming.title}.
                </div>
                <Btn variant="ghost" style={{ minHeight: 44, marginTop: "var(--space-3)" }} disabled={startingToday} onClick={trainNowAnyway}>
                  {startingToday ? "Starting…" : "Train now anyway"}
                </Btn>
              </>
            )}
            {!nextUpcoming && !quick.length && (
              <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, lineHeight: 1.5 }}>Nothing planned yet. Ask your Trainer to build a program.</div>
            )}
          </div>
        )}
      </div>

      {error && <div style={{ padding: "0 20px", marginTop: "var(--space-3)", fontSize: 14, color: "var(--color-accent-2-700)" }}>{error}</div>}

      {quick.map((s) => (
        <div key={s.id} style={{ padding: "0 20px", marginTop: "var(--space-6)" }}>
          <SessionCard title="Quick workout" session={s} onBegin={() => begin(s.id)} onPreview={() => navigate(`/program/${s.id}`)} />
        </div>
      ))}

      {trainerNote && (
        <div style={{ padding: "40px 20px 0" }}>
          <div style={kicker("var(--color-neutral-700)")}>From your trainer</div>
          <div style={{ fontSize: 15, marginTop: 8, lineHeight: 1.6, fontStyle: "italic", color: "var(--color-neutral-800)" }}>{trainerNote}</div>
        </div>
      )}
      {modal}
    </div>
  );
}

function SessionCard({ title, session, onBegin, onPreview }) {
  return (
    <div>
      <div style={{ ...kicker("var(--color-accent-700)"), marginBottom: 8 }}>{title}</div>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 30, lineHeight: 1.1, letterSpacing: "-0.4px" }}>{session.title}</div>
      <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, lineHeight: 1.5 }}>{session.note} · {totalSets(session)} sets</div>
      <div style={{ fontSize: 15, marginTop: 12, lineHeight: 1.6 }}>{listNames(session)}</div>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        <Btn style={{ flex: 1, minHeight: 52, fontSize: 17 }} onClick={onBegin}>Start workout</Btn>
        <Btn variant="ghost" style={{ minHeight: 52, padding: "0 18px", whiteSpace: "nowrap" }} onClick={onPreview}>See steps</Btn>
      </div>
    </div>
  );
}
