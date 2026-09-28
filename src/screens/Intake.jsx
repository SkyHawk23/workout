import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import Btn from "../components/Btn.jsx";
import Seg from "../components/Seg.jsx";
import Chip from "../components/Chip.jsx";
import { TextInput, TextArea } from "../components/Field.jsx";
import { kicker } from "../lib/helpers.js";

const GOAL_OPTIONS = ["Build strength", "Build muscle", "Lose fat", "General fitness", "Sport performance"];
const EXPERIENCE_OPTIONS = [
  { value: "new", label: "New (under 6 months)" },
  { value: "some", label: "Some (6 months–2 years)" },
  { value: "experienced", label: "Experienced (2+ years)" },
];
const HOME_EQUIPMENT = ["Barbell + rack", "Dumbbells", "Adjustable bench", "Cable/pulley", "Kettlebells", "Pull-up bar", "Bands", "Bodyweight only"];
const SESSION_LENGTHS = [20, 30, 45, 60, 75];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const KNOWN_LIFTS = ["Squat", "Bench Press", "Deadlift", "Overhead Press", "Barbell Row"];

const STEP_COUNT = 7;

export default function Intake() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    goals: [], goalsOther: "",
    experience: "some",
    equipmentType: "gym", homeItems: [], dumbbellMax: "",
    days_per_week: 3, session_minutes: 30, preferred_days: [],
    limitations: "",
    birth_year: "",
    knowsWeights: false, working_weights: {},
  });

  function toggle(list, value) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      const goals = [...form.goals, ...(form.goalsOther.trim() ? [form.goalsOther.trim()] : [])];
      const equipment = form.equipmentType === "gym"
        ? { type: "gym" }
        : { type: "home", items: form.homeItems, dumbbell_max: form.dumbbellMax ? Number(form.dumbbellMax) : null };
      const working_weights = form.knowsWeights
        ? Object.fromEntries(Object.entries(form.working_weights).filter(([, v]) => v))
        : {};

      await api("trainer", "intake", {
        goals,
        experience: form.experience,
        equipment,
        schedule: { days_per_week: form.days_per_week, session_minutes: form.session_minutes, preferred_days: form.preferred_days },
        limitations: form.limitations,
        birth_year: form.birth_year ? Number(form.birth_year) : undefined,
        working_weights,
      });
      navigate("/today", { replace: true });
    } catch (err) {
      setError(err.message || "Couldn't build your program. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const canAdvance = [
    form.goals.length > 0 || form.goalsOther.trim(),
    !!form.experience,
    form.equipmentType === "gym" || form.homeItems.length > 0,
    form.preferred_days.length > 0,
    true,
    true,
    true,
  ][step];

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", background: "var(--color-neutral-300)" }}>
      <div style={{ width: "100%", maxWidth: 430, minHeight: "100vh", background: "var(--color-bg)", padding: "40px 20px 40px", display: "flex", flexDirection: "column" }}>
        <div style={{ height: 3, background: "var(--color-neutral-300)" }}>
          <div style={{ height: 3, background: "var(--color-accent)", width: `${((step + 1) / STEP_COUNT) * 100}%`, transition: "width .2s" }} />
        </div>
        <div style={{ ...kicker("var(--color-accent-700)"), marginTop: "var(--space-4)" }}>Step {step + 1} of {STEP_COUNT}</div>

        <div style={{ flex: 1, marginTop: "var(--space-3)" }}>
          {step === 0 && (
            <div>
              <h1 style={h1}>What are you training for?</h1>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
                {GOAL_OPTIONS.map((g) => (
                  <Chip key={g} checked={form.goals.includes(g)} onChange={() => setForm((f) => ({ ...f, goals: toggle(f.goals, g) }))}>{g}</Chip>
                ))}
              </div>
              <div style={{ marginTop: "var(--space-4)" }}>
                <TextInput label="Something else? (optional)" value={form.goalsOther} onChange={(e) => setForm((f) => ({ ...f, goalsOther: e.target.value }))} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 style={h1}>How much lifting experience do you have?</h1>
              <div style={{ marginTop: "var(--space-4)" }}>
                <Seg name="experience" value={form.experience} onChange={(v) => setForm((f) => ({ ...f, experience: v }))} options={EXPERIENCE_OPTIONS} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 style={h1}>What equipment do you have?</h1>
              <div style={{ marginTop: "var(--space-4)" }}>
                <Seg name="equipmentType" value={form.equipmentType} onChange={(v) => setForm((f) => ({ ...f, equipmentType: v }))} options={[{ value: "gym", label: "Commercial gym" }, { value: "home", label: "Home" }]} />
              </div>
              {form.equipmentType === "home" && (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
                    {HOME_EQUIPMENT.map((item) => (
                      <Chip key={item} checked={form.homeItems.includes(item)} onChange={() => setForm((f) => ({ ...f, homeItems: toggle(f.homeItems, item) }))}>{item}</Chip>
                    ))}
                  </div>
                  {form.homeItems.includes("Dumbbells") && (
                    <div style={{ marginTop: "var(--space-4)" }}>
                      <TextInput label="Heaviest dumbbell you have (lb, optional)" type="number" inputMode="numeric" value={form.dumbbellMax} onChange={(e) => setForm((f) => ({ ...f, dumbbellMax: e.target.value }))} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 style={h1}>What's your schedule?</h1>
              <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <div className="field">
                  <label>Days per week</label>
                  <select className="input" value={form.days_per_week} onChange={(e) => setForm((f) => ({ ...f, days_per_week: Number(e.target.value) }))}>
                    {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Session length</label>
                  <select className="input" value={form.session_minutes} onChange={(e) => setForm((f) => ({ ...f, session_minutes: Number(e.target.value) }))}>
                    {SESSION_LENGTHS.map((n) => <option key={n} value={n}>{n} min</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 5, color: "color-mix(in srgb, var(--color-text) 70%, transparent)" }}>Preferred training days</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                    {WEEKDAYS.map((d) => (
                      <Chip key={d} checked={form.preferred_days.includes(d)} onChange={() => setForm((f) => ({ ...f, preferred_days: toggle(f.preferred_days, d) }))}>{d.slice(0, 3)}</Chip>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h1 style={h1}>Any injuries or limitations?</h1>
              <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, lineHeight: 1.5 }}>Optional — your trainer will always work around these.</div>
              <div style={{ marginTop: "var(--space-4)" }}>
                <TextArea label="Injuries or limitations" rows={4} value={form.limitations} onChange={(e) => setForm((f) => ({ ...f, limitations: e.target.value }))} />
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h1 style={h1}>What year were you born?</h1>
              <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, lineHeight: 1.5 }}>Younger lifters get technique-first, moderate-load programming.</div>
              <div style={{ marginTop: "var(--space-4)" }}>
                <TextInput label="Birth year" type="number" inputMode="numeric" value={form.birth_year} onChange={(e) => setForm((f) => ({ ...f, birth_year: e.target.value }))} />
              </div>
            </div>
          )}

          {step === 6 && (
            <div>
              <h1 style={h1}>Do you know your working weights?</h1>
              <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginTop: 8, lineHeight: 1.5 }}>Optional — if not, week one calibrates them for you.</div>
              <div style={{ marginTop: "var(--space-4)" }}>
                <Seg name="knowsWeights" value={form.knowsWeights ? "yes" : "no"} onChange={(v) => setForm((f) => ({ ...f, knowsWeights: v === "yes" }))} options={[{ value: "no", label: "Not sure" }, { value: "yes", label: "I know them" }]} />
              </div>
              {form.knowsWeights && (
                <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {KNOWN_LIFTS.map((lift) => (
                    <TextInput key={lift} label={`${lift} (lb)`} type="number" inputMode="numeric"
                      value={form.working_weights[lift] || ""}
                      onChange={(e) => setForm((f) => ({ ...f, working_weights: { ...f.working_weights, [lift]: e.target.value } }))} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: 14, color: "var(--color-accent-2-700)", marginTop: "var(--space-3)" }}>{error}</div>}

        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-6)" }}>
          {step > 0 && <Btn variant="ghost" style={{ minHeight: 52, padding: "0 18px" }} onClick={() => setStep((s) => s - 1)}>Back</Btn>}
          {step < STEP_COUNT - 1 ? (
            <Btn style={{ flex: 1, minHeight: 52, fontSize: 17 }} disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>Next</Btn>
          ) : (
            <Btn style={{ flex: 1, minHeight: 52, fontSize: 17 }} disabled={busy} onClick={finish}>{busy ? "Building your program…" : "Build my program"}</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

const h1 = { fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 26, lineHeight: 1.15, letterSpacing: "-0.4px" };
