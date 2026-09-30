import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useStore } from "../store/useStore.js";
import { queueSet, flushOutbox } from "../lib/outbox.js";
import { outboxAll } from "../lib/idb.js";
import { getOrCreateRunClientId, clearRunClientId } from "../lib/runClientId.js";
import { genClientId, kicker, setTarget, totalSets } from "../lib/helpers.js";
import Btn from "../components/Btn.jsx";
import Dialog from "../components/Dialog.jsx";
import { useVideoLinks } from "../hooks/useVideoLinks.js";

export default function Run() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const prefs = useStore((s) => s.prefs);
  const videoLinks = useVideoLinks();

  const [session, setSession] = useState(null);
  const [sessionLogId, setSessionLogId] = useState(null);
  const [exercises, setExercises] = useState([]); // local working copy — steppers only affect this run
  const [exIndex, setExIndex] = useState(0);
  const [done, setDone] = useState([]);
  const [logged, setLogged] = useState({});
  const [startedAt, setStartedAt] = useState(null);
  const [paused, setPaused] = useState(false);
  const [pausedMs, setPausedMs] = useState(0);
  const [restShown, setRestShown] = useState(false);
  const [restOn, setRestOn] = useState(false);
  const [restLeft, setRestLeft] = useState(0);
  const [, setClockTick] = useState(0);
  const [pendingRpe, setPendingRpe] = useState(null); // {exIndex, setIndex} awaiting an RPE answer (calibration only)
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const [holdLeft, setHoldLeft] = useState(null); // seconds left on a timed set's countdown, or null when the current set isn't timed
  const restSecsRef = useRef(90);
  const restShownRef = useRef(false); // so the 1s interval (registered once) can read the latest restShown without a stale closure

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { session: s } = await api("program", "session", { id: sessionId });
        if (cancelled) return;
        setSession(s);
        setExercises(JSON.parse(JSON.stringify(s.exercises || [])));
        setDone((s.exercises || []).map(() => 0));

        const client_id = getOrCreateRunClientId(sessionId);
        const { session_log_id } = await api("sessions", "start", { client_id, planned_session_id: sessionId });
        if (cancelled) return;
        setSessionLogId(session_log_id);
        setStartedAt(Date.now());
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => { restSecsRef.current = prefs.secs; }, [prefs.secs]);
  useEffect(() => { restShownRef.current = restShown; }, [restShown]);

  useEffect(() => {
    const t = setInterval(() => {
      setClockTick((c) => c + 1);
      setRestOn((on) => {
        if (!on) return on;
        setRestLeft((left) => {
          if (left <= 1) { setRestOn(false); setRestShown(false); return 0; }
          return left - 1;
        });
        return on;
      });
      setHoldLeft((left) => (left === null || left <= 0 || restShownRef.current ? left : left - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // A timed set's countdown auto-starts the moment it becomes current, and
  // resets whenever the current set changes (a new set, a new exercise, or
  // an un-mark via tick()).
  useEffect(() => {
    const currentEx = exercises[exIndex];
    const count = done[exIndex] || 0;
    const cs = currentEx?.sets?.[Math.min(count, (currentEx?.sets.length || 1) - 1)];
    setHoldLeft(cs?.hold_s || null);
  }, [exercises, exIndex, done]);

  // Auto-completes a timed set the moment its countdown reaches zero —
  // completeSet() is a hoisted function declaration, defined below.
  useEffect(() => {
    if (holdLeft === 0) completeSet();
  }, [holdLeft]);

  if (error) return <div style={{ padding: "22px 20px 0", color: "var(--color-accent-2-700)" }}>{error}</div>;
  if (!session || !sessionLogId) return <div style={{ padding: "22px 20px 0", color: "var(--color-neutral-700)" }}>Loading…</div>;

  const ex = exercises[exIndex];
  const doneCount = done[exIndex] || 0;
  const doneTotal = done.reduce((a, b) => a + b, 0);
  const pct = Math.round((doneTotal / totalSets({ exercises })) * 100) + "%";
  const currentSet = ex?.sets?.[Math.min(doneCount, ex.sets.length - 1)] || {};
  const hasWeight = !!currentSet.weight;
  const primaryLabel = doneCount + 1 >= (ex?.sets.length || 1)
    ? (exIndex + 1 >= exercises.length ? "Finish workout" : "Done — next exercise")
    : `Set ${doneCount + 1} done`;
  const upNext = exIndex + 1 < exercises.length ? `Up next: ${exercises[exIndex + 1].name}` : "Last exercise of the session.";
  const setLabel = `Set ${Math.min(doneCount + 1, ex.sets.length)} of ${ex.sets.length}`;
  const mm = Math.floor(restLeft / 60), ss = String(restLeft % 60).padStart(2, "0");

  function startRest() {
    setRestShown(true);
    setRestLeft(restSecsRef.current);
    setRestOn(prefs.rest === "auto");
  }

  function logCurrentSet(setIndex, rpe) {
    const target = ex.sets[setIndex];
    queueSet({
      client_id: genClientId(), session_log_id: sessionLogId,
      exercise_id: ex.exercise_id, exercise_name: ex.name,
      set_index: setIndex, reps: target.reps_max, weight: target.weight || 0,
      rpe: rpe ?? null, completed_at: new Date().toISOString(),
    });
    setLogged((lg) => ({ ...lg, [exIndex + ":" + setIndex]: target.weight || 0 }));
  }

  function completeSet() {
    if (session.is_calibration && hasWeight) {
      setPendingRpe({ exIndex, setIndex: doneCount });
      return;
    }
    advanceSet(doneCount);
  }

  function advanceSet(setIndex, rpe) {
    logCurrentSet(setIndex, rpe);
    const doneNow = setIndex + 1;
    if (doneNow >= ex.sets.length) { advanceExercise(); return; }
    setDone((d) => { const nd = d.slice(); nd[exIndex] = doneNow; return nd; });
    startRest();
  }

  function advanceExercise() {
    if (exIndex + 1 >= exercises.length) { finish(); return; }
    setDone((d) => { const nd = d.slice(); nd[exIndex] = ex.sets.length; return nd; });
    setExIndex((i) => i + 1);
    setRestShown(false); setRestOn(false); setRestLeft(0);
  }

  function skip() {
    advanceExercise();
  }

  function tick(setIndex) {
    const isDone = setIndex < doneCount;
    if (isDone) {
      // un-mark — best-effort local only; the server keeps whatever already synced
      setDone((d) => { const nd = d.slice(); nd[exIndex] = setIndex; return nd; });
    } else {
      advanceSet(setIndex);
    }
  }

  function bumpWeight(delta) {
    setExercises((exs) => exs.map((e, i) => i !== exIndex ? e : { ...e, sets: e.sets.map((s) => ({ ...s, weight: Math.max(0, s.weight + delta) })) }));
  }
  function bumpReps(delta) {
    setExercises((exs) => exs.map((e, i) => i !== exIndex ? e : { ...e, sets: e.sets.map((s) => ({ ...s, reps_min: Math.max(1, s.reps_min + delta), reps_max: Math.max(1, s.reps_max + delta) })) }));
  }

  function sessionToggle() {
    if (paused) { setPaused(false); setStartedAt(Date.now() - pausedMs); }
    else { setPaused(true); setPausedMs(Date.now() - startedAt); }
  }
  const sessMs = paused ? pausedMs : Date.now() - startedAt;
  const sessSec = Math.max(0, Math.floor(sessMs / 1000));
  const sessionClock = String(Math.floor(sessSec / 60)).padStart(2, "0") + ":" + String(sessSec % 60).padStart(2, "0");

  function restAction() {
    if (restOn) setRestOn(false);
    else { setRestOn(true); setRestLeft((l) => l || restSecsRef.current); }
  }
  function restSkip() { setRestOn(false); setRestShown(false); setRestLeft(0); }

  async function finish() {
    setFinishing(true);
    setRestOn(false); setRestShown(false);
    try {
      await waitForOutboxDrain(sessionLogId);
      const result = await api("sessions", "finish", { session_log_id: sessionLogId, ended_at: new Date().toISOString() });
      clearRunClientId(sessionId);
      const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
      navigate("/done", { replace: true, state: { title: session.title, sets: result.sets_logged, mins, weightChanges: result.weight_changes } });
    } catch (err) {
      setError(err.message);
      setFinishing(false);
    }
  }

  if (finishing) {
    return (
      <div style={{ padding: "60px 20px 0" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 26 }}>Syncing…</div>
        <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8 }}>Making sure every set made it to the server before filing this session.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "22px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
        <span>{session.title}</span>
        <button onClick={finish} style={{ background: "none", border: "none", color: "var(--color-neutral-700)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", cursor: "pointer", padding: 4 }}>End</button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", marginTop: 8 }}>
        <div className="tabular" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 26, lineHeight: 1, flex: 1 }}>{sessionClock}</div>
        <Btn variant="ghost" style={{ minHeight: 36, padding: "0 12px", fontSize: 13, whiteSpace: "nowrap" }} onClick={sessionToggle}>{paused ? "Resume" : "Pause"}</Btn>
      </div>
      <div style={{ height: 3, background: "var(--color-neutral-300)", marginTop: 10 }}>
        <div style={{ height: 3, background: "var(--color-accent)", width: pct }} />
      </div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <div style={{ fontSize: 13, color: "var(--color-neutral-700)", letterSpacing: "0.06em" }}>Exercise {exIndex + 1} of {exercises.length}</div>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.8px", marginTop: 8 }}>{ex.name}</div>
        <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 10, fontStyle: "italic", lineHeight: 1.5 }}>{ex.cue}</div>
        {videoLinks[ex.exercise_id] && (
          <a href={videoLinks[ex.exercise_id]} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", fontSize: 14, color: "var(--color-accent-700)", marginTop: 8 }}>
            Watch form video &#8599;
          </a>
        )}
      </div>

      <div style={{ marginTop: "var(--space-6)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--color-divider)" }}>
        <div style={kicker("var(--color-accent-700)")}>{setLabel}</div>
        {currentSet.hold_s ? (
          <div className="tabular" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 52, lineHeight: 1, letterSpacing: "-1px", marginTop: 10 }}>
            {String(Math.floor((holdLeft ?? currentSet.hold_s) / 60)).padStart(1, "0")}:{String((holdLeft ?? currentSet.hold_s) % 60).padStart(2, "0")}
          </div>
        ) : (
          <div className="tabular" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 40, lineHeight: 1, letterSpacing: "-1px", marginTop: 10 }}>{setTarget(currentSet)}</div>
        )}
        {!currentSet.hold_s && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4) var(--space-6)", marginTop: "var(--space-4)" }}>
            {hasWeight && (
              <div>
                <div style={kicker("var(--color-neutral-700)")}>Adjust weight</div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 8 }}>
                  <Btn variant="secondary" aria-label="Lower weight" style={{ minHeight: 46, width: 46, padding: 0, fontSize: 20 }} onClick={() => bumpWeight(-5)}>&minus;</Btn>
                  <div className="tabular" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18, minWidth: 62, textAlign: "center" }}>{currentSet.weight} lb</div>
                  <Btn variant="secondary" aria-label="Raise weight" style={{ minHeight: 46, width: 46, padding: 0, fontSize: 20 }} onClick={() => bumpWeight(5)}>+</Btn>
                </div>
              </div>
            )}
            <div>
              <div style={kicker("var(--color-neutral-700)")}>Adjust reps</div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 8 }}>
                <Btn variant="secondary" aria-label="Lower reps" style={{ minHeight: 46, width: 46, padding: 0, fontSize: 20 }} onClick={() => bumpReps(-1)}>&minus;</Btn>
                <div className="tabular" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18, minWidth: 62, textAlign: "center" }}>{currentSet.reps_max} reps</div>
                <Btn variant="secondary" aria-label="Raise reps" style={{ minHeight: 46, width: 46, padding: 0, fontSize: 20 }} onClick={() => bumpReps(1)}>+</Btn>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-6)" }}>
        <Btn style={{ flex: 1, minHeight: 56, fontSize: 17 }} onClick={completeSet}>{primaryLabel}</Btn>
        <Btn variant="ghost" style={{ minHeight: 56, padding: "0 18px" }} onClick={skip}>Skip</Btn>
      </div>
      <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginTop: "var(--space-3)", lineHeight: 1.5 }}>{upNext}</div>

      {prefs.view === "exercise" && (
        <div style={{ marginTop: "var(--space-6)" }}>
          {ex.sets.map((s, i) => {
            const isDone = i < doneCount;
            const w = isDone ? (logged[exIndex + ":" + i] ?? s.weight) : s.weight;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "12px 2px", borderBottom: "1px solid var(--color-divider)", minHeight: 44 }}>
                <div style={{ flex: 1, fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>SET {i + 1}</div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18 }}>{setTarget({ ...s, weight: w })}</div>
                {isDone ? (
                  <Btn variant="ghost" style={{ minHeight: 40, padding: "0 12px", whiteSpace: "nowrap", color: "var(--color-accent-700)" }} onClick={() => tick(i)}>&#10003; Done</Btn>
                ) : (
                  <Btn variant="secondary" style={{ minHeight: 40, padding: "0 14px", whiteSpace: "nowrap" }} onClick={() => tick(i)}>Mark done</Btn>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendingRpe && (
        <Dialog title="How hard was that set?">
          <div style={{ fontSize: 14, color: "var(--color-neutral-700)", marginBottom: "var(--space-3)" }}>
            6 is easy, 10 is all-out. This calibrates your starting weights.
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            {[6, 7, 8, 9, 10].map((rpe) => (
              <Btn key={rpe} variant="secondary" style={{ minHeight: 44, width: 44, padding: 0 }} onClick={() => { const { setIndex } = pendingRpe; setPendingRpe(null); advanceSet(setIndex, rpe); }}>{rpe}</Btn>
            ))}
          </div>
        </Dialog>
      )}

      {restShown && (
        <div className="dialog-backdrop">
          <div className="dialog" style={{ maxWidth: 340 }}>
            <div className="dialog-title">Set logged — rest?</div>
            <div className="dialog-body">
              <div className="tabular" style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 52, lineHeight: 1, letterSpacing: "-1px" }}>{mm}:{ss}</div>
              <div style={{ fontSize: 14, color: "var(--color-neutral-700)", marginTop: 10, lineHeight: 1.5 }}>
                {restOn ? "Running — this closes itself when it hits zero." : "Start the clock, or skip straight to the next set."}
              </div>
            </div>
            <div className="dialog-actions">
              <Btn variant="ghost" style={{ minHeight: 44, whiteSpace: "nowrap" }} onClick={restSkip}>Skip rest</Btn>
              <Btn style={{ minHeight: 44, whiteSpace: "nowrap" }} onClick={restAction}>{restOn ? "Pause" : "Start timer"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function waitForOutboxDrain(sessionLogId) {
  for (;;) {
    await flushOutbox();
    const remaining = (await outboxAll()).filter((s) => s.session_log_id === sessionLogId);
    if (!remaining.length) return;
    await new Promise((resolve) => {
      const onOnline = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); resolve(); }, 2000);
      function cleanup() { clearTimeout(timer); window.removeEventListener("online", onOnline); }
      window.addEventListener("online", onOnline);
    });
  }
}
