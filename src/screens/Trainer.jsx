import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useStore } from "../store/useStore.js";
import Btn from "../components/Btn.jsx";
import Seg from "../components/Seg.jsx";
import { kicker } from "../lib/helpers.js";
import { localToday } from "../../lib/date.js";
import MarkdownLite from "../components/MarkdownLite.jsx";

const FOCUS_OPTIONS = ["Full body", "Upper body", "Lower body", "Core"];
const MINUTE_OPTIONS = ["20", "30", "45", "60"];

export default function Trainer() {
  const [mode, setMode] = useState("chat");
  return (
    <div style={{ padding: "28px 20px 0" }}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 28, letterSpacing: "-0.4px" }}>Trainer</div>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        <button className={mode === "chat" ? "btn btn-primary" : "btn btn-secondary"} style={{ flex: 1, minHeight: 40 }} onClick={() => setMode("chat")}>Ask</button>
        <button className={mode === "quick" ? "btn btn-primary" : "btn btn-secondary"} style={{ flex: 1, minHeight: 40 }} onClick={() => setMode("quick")}>Quick workout</button>
        <button className={mode === "custom" ? "btn btn-primary" : "btn btn-secondary"} style={{ flex: 1, minHeight: 40 }} onClick={() => setMode("custom")}>Build</button>
      </div>
      {mode === "chat" ? <Chat /> : mode === "quick" ? <QuickWorkout /> : <CustomWorkout />}
    </div>
  );
}

function Chat() {
  const [exchanges, setExchanges] = useState([]); // [{question, reply, changeCards, pendingConfirmation}]
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(e) {
    e.preventDefault();
    if (!message.trim() || busy) return;
    const question = message.trim();
    setMessage("");
    setError("");
    setBusy(true);
    setExchanges((ex) => [...ex, { question, reply: null }]);
    try {
      const res = await api("trainer", "chat", { message: question });
      setExchanges((ex) => ex.map((item, i) => (i === ex.length - 1 ? { ...item, reply: res.reply, changeCards: res.changeCards, pendingConfirmation: res.pendingConfirmation } : item)));
    } catch (err) {
      setError(err.message || "The trainer didn't respond. Try again.");
      setExchanges((ex) => ex.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  async function undo(changeId, exIdx, cardIdx) {
    await api("program", "undo-change", { change_id: changeId });
    setExchanges((ex) => ex.map((item, i) => i !== exIdx ? item : {
      ...item, changeCards: item.changeCards.map((c, j) => j !== cardIdx ? c : { ...c, undone: true }),
    }));
  }

  async function confirmRegenerate(exIdx) {
    setBusy(true);
    try {
      await api("trainer", "generate-program", {});
      setExchanges((ex) => ex.map((item, i) => i !== exIdx ? item : { ...item, pendingConfirmation: { ...item.pendingConfirmation, done: true } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ marginTop: "var(--space-6)" }}>
        {exchanges.length === 0 && (
          <div style={{ fontSize: 15, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
            Ask about your program, tell your trainer something hurts, or ask for a change.
          </div>
        )}
        {exchanges.map((item, i) => (
          <div key={i} style={{ padding: "var(--space-4) 0", borderBottom: "1px solid var(--color-divider)" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17, lineHeight: 1.4 }}>{item.question}</div>
            {item.reply == null ? (
              <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, fontStyle: "italic" }}>Thinking…</div>
            ) : (
              <div style={{ fontSize: 15, marginTop: 8, lineHeight: 1.6 }}><MarkdownLite text={item.reply} /></div>
            )}
            {item.changeCards?.map((card, j) => (
              <div key={j} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-divider)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)" }}>
                <div style={{ fontSize: 13, color: "var(--color-neutral-700)", fontStyle: "italic" }}>{card.summary}{card.undone ? " (undone)" : ""}</div>
                {!card.undone && card.change_id && <Btn variant="ghost" style={{ minHeight: 32, padding: "0 10px", whiteSpace: "nowrap" }} onClick={() => undo(card.change_id, i, j)}>Undo</Btn>}
              </div>
            ))}
            {item.pendingConfirmation && !item.pendingConfirmation.done && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-divider)" }}>
                <div style={{ fontSize: 14, marginBottom: 8 }}>Rebuild your whole program? {item.pendingConfirmation.reason}</div>
                <Btn style={{ minHeight: 40, padding: "0 14px" }} disabled={busy} onClick={() => confirmRegenerate(i)}>Confirm regenerate</Btn>
              </div>
            )}
            {item.pendingConfirmation?.done && (
              <div style={{ marginTop: 10, fontSize: 13, color: "var(--color-accent-700)" }}>Program regenerated.</div>
            )}
          </div>
        ))}
      </div>

      {error && <div style={{ fontSize: 14, color: "var(--color-accent-2-700)", marginTop: "var(--space-3)" }}>{error}</div>}

      <form onSubmit={send} style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        <input className="input" placeholder="Ask your trainer…" autoComplete="off" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
        <Btn type="submit" disabled={busy || !message.trim()} style={{ minHeight: 40, padding: "0 18px", whiteSpace: "nowrap" }}>Send</Btn>
      </form>
    </div>
  );
}

function QuickWorkout() {
  const [minutes, setMinutes] = useState("30");
  const [focus, setFocus] = useState("Full body");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function build() {
    setBusy(true);
    setNote("");
    try {
      const res = await api("trainer", "quick-workout", { minutes, focus, equipment: "whatever's on hand" });
      setNote(`Added "${res.session.title}" to today — head to Today to start it.`);
    } catch (err) {
      setNote(err.message || "Couldn't build a workout. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <div style={{ fontSize: 15, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>Two choices and you get a one-off workout for today.</div>
      <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div>
          <div style={{ ...kicker("var(--color-neutral-700)"), marginBottom: 8 }}>Time available</div>
          <Seg name="qw-minutes" value={minutes} onChange={setMinutes} options={MINUTE_OPTIONS.map((m) => ({ value: m, label: m }))} />
        </div>
        <div className="field">
          <label>Focus</label>
          <select className="input" value={focus} onChange={(e) => setFocus(e.target.value)}>
            {FOCUS_OPTIONS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <Btn style={{ width: "100%", minHeight: 52, fontSize: 17, marginTop: "var(--space-6)" }} disabled={busy} onClick={build}>{busy ? "Building…" : "Build the workout"}</Btn>
      {note && <div style={{ fontSize: 14, color: "var(--color-neutral-700)", marginTop: "var(--space-3)", lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

const BLANK_ROW = () => ({ exercise_id: "", sets: 3, reps: 8, weight: 0, rest_s: 90 });

function CustomWorkout() {
  const user = useStore((s) => s.user);
  const [catalog, setCatalog] = useState([]);
  const [title, setTitle] = useState("My Workout");
  const [date, setDate] = useState(() => localToday(user?.timezone));
  const [rows, setRows] = useState([BLANK_ROW()]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("trainer", "list-exercises", {}).then((res) => setCatalog(res.exercises || [])).catch(() => {});
  }, []);

  function updateRow(i, patch) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, BLANK_ROW()]);
  }
  function removeRow(i) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(""); setNote("");
    const valid = rows.filter((r) => r.exercise_id);
    if (!valid.length) { setError("Add at least one exercise."); return; }
    setBusy(true);
    try {
      await api("trainer", "custom-workout", {
        title, date,
        exercises: valid.map((r) => ({ exercise_id: r.exercise_id, sets: r.sets, reps: r.reps, weight: r.weight, rest_s: r.rest_s })),
      });
      setNote("Added to your Program.");
      setRows([BLANK_ROW()]);
    } catch (err) {
      setError(err.message || "Couldn't save that workout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "var(--space-6)" }}>
      <div style={{ fontSize: 15, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>Pick your own exercises, sets, reps, and weight.</div>

      <div className="field" style={{ marginTop: "var(--space-4)" }}>
        <label>Workout name</label>
        <input className="input" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field" style={{ marginTop: "var(--space-3)" }}>
        <label>Date</label>
        <input className="input" type="date" autoComplete="off" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {rows.map((row, i) => (
          <div key={i} style={{ padding: "var(--space-3)", border: "1px solid var(--color-divider)" }}>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <select className="input" style={{ flex: 1 }} value={row.exercise_id} onChange={(e) => updateRow(i, { exercise_id: e.target.value })}>
                <option value="">Choose an exercise…</option>
                {catalog.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
              </select>
              {rows.length > 1 && (
                <button aria-label="Remove exercise" onClick={() => removeRow(i)} style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, color: "var(--color-neutral-700)", cursor: "pointer", padding: "0 6px" }}>&times;</button>
              )}
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Sets</label>
                <input className="input" type="number" inputMode="numeric" autoComplete="off" min={1} max={10} value={row.sets} onChange={(e) => updateRow(i, { sets: Number(e.target.value) })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Reps</label>
                <input className="input" type="number" inputMode="numeric" autoComplete="off" min={1} max={100} value={row.reps} onChange={(e) => updateRow(i, { reps: Number(e.target.value) })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Weight (lb)</label>
                <input className="input" type="number" inputMode="numeric" autoComplete="off" min={0} value={row.weight} onChange={(e) => updateRow(i, { weight: Number(e.target.value) })} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Btn variant="ghost" style={{ width: "100%", minHeight: 40, marginTop: "var(--space-3)" }} onClick={addRow}>+ Add exercise</Btn>
      {error && <div style={{ fontSize: 13, color: "var(--color-accent-2-700)", marginTop: 8 }}>{error}</div>}
      {note && <div style={{ fontSize: 13, color: "var(--color-accent-700)", marginTop: 8 }}>{note}</div>}
      <Btn style={{ width: "100%", minHeight: 52, fontSize: 17, marginTop: "var(--space-4)" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Add to Program"}</Btn>
    </div>
  );
}
