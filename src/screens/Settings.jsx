import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useStore } from "../store/useStore.js";
import Btn from "../components/Btn.jsx";
import Seg from "../components/Seg.jsx";
import Dialog from "../components/Dialog.jsx";
import { TextInput } from "../components/Field.jsx";
import { kicker } from "../lib/helpers.js";
import { localToday } from "../../lib/date.js";

// Relative time with hour granularity, for "Last synced 2 hours ago" — a
// device's last_seen_at/paired_at are full timestamps, unlike the
// date-only strings agoText() in helpers.js is built for.
function timeAgo(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function Settings() {
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);

  const [household, setHousehold] = useState(null);
  const [inviteCode, setInviteCode] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordNote, setPasswordNote] = useState("");
  const [limitations, setLimitations] = useState("");
  const [profileNote, setProfileNote] = useState("");

  const [devices, setDevices] = useState([]);
  const [addingWatch, setAddingWatch] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [pairNote, setPairNote] = useState("");
  const [pairError, setPairError] = useState("");
  const [pairing, setPairing] = useState(false);
  const [renaming, setRenaming] = useState(null); // {id, name}

  const [weights, setWeights] = useState([]);
  const [editingWeight, setEditingWeight] = useState(null); // {exercise_id, name, weight}
  const [savingWeight, setSavingWeight] = useState(false);

  const loadDevices = () => api("auth", "devices-list", {}).then((res) => setDevices(res.devices || [])).catch(() => {});
  const loadWeights = () => api("trainer", "working-weights", {}).then((res) => setWeights(res.weights || [])).catch(() => {});

  useEffect(() => {
    api("household", "get", {}).then((res) => setHousehold(res)).catch(() => {});
    api("trainer", "get-profile", {}).then((res) => setLimitations(res.profile?.limitations || "")).catch(() => {});
    loadDevices();
    loadWeights();
  }, []);

  async function changePassword(e) {
    e.preventDefault();
    setPasswordNote("");
    try {
      await api("auth", "change-password", { current_password: currentPassword, new_password: newPassword });
      setPasswordNote("Password updated.");
      setCurrentPassword(""); setNewPassword("");
    } catch (err) {
      setPasswordNote(err.message);
    }
  }

  async function createInvite() {
    const res = await api("household", "create-invite", {});
    setInviteCode(res.code);
  }

  async function removeMember(memberId) {
    if (!confirm("Remove this member? Their program and history will be deleted.")) return;
    await api("household", "remove-member", { user_id: memberId });
    const res = await api("household", "get", {});
    setHousehold(res);
  }

  async function saveLimitations() {
    setProfileNote("");
    try {
      await api("trainer", "update-profile", { limitations });
      if (confirm("Saved. Regenerate your program to reflect this change now?")) {
        await api("trainer", "generate-program", {});
        setProfileNote("Program regenerated.");
      } else {
        setProfileNote("Saved.");
      }
    } catch (err) {
      setProfileNote(err.message);
    }
  }

  async function exportData() {
    const data = await api("export", "export", {});
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `daily-lift-export-${localToday(user?.timezone)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function doLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function openAddWatch() {
    setPairCode(""); setPairNote(""); setPairError(""); setAddingWatch(true);
  }

  async function confirmPair() {
    setPairError(""); setPairing(true);
    try {
      await api("auth", "devices-confirm", { code: pairCode });
      setPairNote("Paired! Your watch will finish connecting in a few seconds.");
      loadDevices();
    } catch (err) {
      setPairError(err.message || "That code is invalid or has expired");
    } finally {
      setPairing(false);
    }
  }

  async function saveRename() {
    if (!renaming) return;
    await api("auth", "devices-rename", { id: renaming.id, name: renaming.name });
    setRenaming(null);
    loadDevices();
  }

  async function removeDevice(device) {
    if (!confirm(`Remove "${device.name}"? It will need to be paired again to sync.`)) return;
    await api("auth", "devices-revoke", { id: device.id });
    loadDevices();
  }

  async function saveWeight() {
    if (!editingWeight) return;
    setSavingWeight(true);
    try {
      await api("trainer", "set-working-weight", { exercise_id: editingWeight.exercise_id, weight: editingWeight.weight });
      setEditingWeight(null);
      loadWeights();
    } finally {
      setSavingWeight(false);
    }
  }

  return (
    <div style={{ padding: "28px 20px 0" }}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 28, letterSpacing: "-0.4px" }}>Settings</div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Account</div>
        <div style={{ fontSize: 17, marginTop: 8 }}>{user?.display_name}</div>
        <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>{user?.email}</div>
        <form onSubmit={changePassword} style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <TextInput label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <TextInput label="New password" type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          {passwordNote && <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>{passwordNote}</div>}
          <Btn variant="secondary" type="submit" style={{ minHeight: 40 }}>Change password</Btn>
        </form>
        <Btn variant="ghost" style={{ minHeight: 40, marginTop: "var(--space-2)" }} onClick={doLogout}>Log out</Btn>
      </div>

      <div style={{ marginTop: "var(--space-8)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Trainer profile</div>
        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", margin: "6px 0 12px", lineHeight: 1.5 }}>Injuries or limitations your trainer should always respect.</div>
        <textarea className="input" rows={3} autoComplete="off" value={limitations} onChange={(e) => setLimitations(e.target.value)} />
        {profileNote && <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginTop: 6 }}>{profileNote}</div>}
        <Btn variant="secondary" style={{ minHeight: 40, marginTop: "var(--space-2)" }} onClick={saveLimitations}>Save</Btn>
      </div>

      <div style={{ marginTop: "var(--space-8)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Workout view</div>
        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", margin: "6px 0 12px", lineHeight: 1.5 }}>How much the app shows you at once while you train.</div>
        <Seg name="wview" value={prefs.view} onChange={(v) => setPrefs({ view: v })} options={[{ value: "set", label: "Single set" }, { value: "exercise", label: "Single exercise" }]} />
      </div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Rest between sets</div>
        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", margin: "6px 0 12px", lineHeight: 1.5 }}>Auto starts the clock the moment you tick a set off.</div>
        <Seg name="wrest" value={prefs.rest} onChange={(v) => setPrefs({ rest: v })} options={[{ value: "auto", label: "Auto" }, { value: "manual", label: "Manual timer" }]} />
        <div className="field" style={{ marginTop: "var(--space-4)" }}>
          <label>Default rest length (seconds)</label>
          <input className="input" type="number" inputMode="numeric" autoComplete="off" value={prefs.secs} onChange={(e) => { const v = parseInt(e.target.value, 10); setPrefs({ secs: isNaN(v) ? 90 : v }); }} />
        </div>
      </div>

      <div style={{ marginTop: "var(--space-8)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Household</div>
        {household?.members?.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderBottom: "1px solid var(--color-divider)" }}>
            <div style={{ fontSize: 15 }}>{m.display_name} {m.role === "admin" && <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>· admin</span>}</div>
            {user?.role === "admin" && m.id !== user.id && (
              <Btn variant="ghost" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => removeMember(m.id)}>Remove</Btn>
            )}
          </div>
        ))}
        {user?.role === "admin" && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Btn variant="secondary" style={{ minHeight: 40 }} onClick={createInvite}>Create invite code</Btn>
            {inviteCode && <div style={{ fontSize: 15, marginTop: 8 }}>Code: <strong className="tabular">{inviteCode}</strong> — valid 7 days.</div>}
          </div>
        )}
      </div>

      <div style={{ marginTop: "var(--space-8)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Garmin watch</div>
        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", margin: "6px 0 12px", lineHeight: 1.5 }}>Pair a watch to run and log workouts right from your wrist.</div>
        {devices.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderBottom: "1px solid var(--color-divider)" }}>
            <div>
              <div style={{ fontSize: 15 }}>{d.name}</div>
              <div style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>Last synced {timeAgo(d.last_seen_at)}</div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Btn variant="ghost" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => setRenaming({ id: d.id, name: d.name })}>Rename</Btn>
              <Btn variant="ghost" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => removeDevice(d)}>Remove</Btn>
            </div>
          </div>
        ))}
        <Btn variant="secondary" style={{ minHeight: 40, marginTop: "var(--space-3)" }} onClick={openAddWatch}>Add a watch</Btn>
      </div>

      <div style={{ marginTop: "var(--space-8)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Working weights</div>
        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", margin: "6px 0 12px", lineHeight: 1.5 }}>
          The weight your trainer starts you at for each exercise. Changing one only affects future workouts.
        </div>
        {!weights.length && <div style={{ fontSize: 14, color: "var(--color-neutral-700)" }}>No working weights tracked yet.</div>}
        {weights.map((w) => (
          <div key={w.exercise_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderBottom: "1px solid var(--color-divider)" }}>
            <div style={{ fontSize: 15 }}>{w.name}</div>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
              <div style={{ fontSize: 15, color: "var(--color-neutral-700)" }} className="tabular">{w.weight} lb</div>
              <Btn variant="ghost" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => setEditingWeight({ ...w })}>Edit</Btn>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-8)" }}>
        <div style={kicker("var(--color-neutral-700)")}>Your data</div>
        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", margin: "6px 0 12px", lineHeight: 1.5 }}>Download everything The Daily Lift knows about your training.</div>
        <Btn variant="secondary" style={{ width: "100%", minHeight: 44 }} onClick={exportData}>Export my data</Btn>
      </div>

      {addingWatch && (
        <Dialog
          title="Add a watch"
          actions={<>
            <Btn variant="ghost" style={{ minHeight: 44 }} onClick={() => setAddingWatch(false)}>{pairNote ? "Done" : "Cancel"}</Btn>
            {!pairNote && <Btn style={{ minHeight: 44 }} disabled={pairing || pairCode.length !== 6} onClick={confirmPair}>{pairing ? "Pairing…" : "Pair"}</Btn>}
          </>}
        >
          {pairNote ? (
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>{pairNote}</div>
          ) : (
            <>
              <div style={{ fontSize: 14, color: "var(--color-neutral-700)", marginBottom: "var(--space-3)", lineHeight: 1.5 }}>
                Open The Daily Lift on your watch, choose <strong>Pair</strong>, and enter the code it shows.
              </div>
              <TextInput
                label="Pairing code" autoComplete="off" maxLength={6}
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              />
              {pairError && <div style={{ fontSize: 13, color: "var(--color-accent-2-700)", marginTop: 8 }}>{pairError}</div>}
            </>
          )}
        </Dialog>
      )}

      {renaming && (
        <Dialog
          title="Rename watch"
          actions={<>
            <Btn variant="ghost" style={{ minHeight: 44 }} onClick={() => setRenaming(null)}>Cancel</Btn>
            <Btn style={{ minHeight: 44 }} disabled={!renaming.name.trim()} onClick={saveRename}>Save</Btn>
          </>}
        >
          <TextInput label="Name" autoComplete="off" value={renaming.name} onChange={(e) => setRenaming((r) => ({ ...r, name: e.target.value }))} />
        </Dialog>
      )}

      {editingWeight && (
        <Dialog
          title={`Working weight — ${editingWeight.name}`}
          actions={<>
            <Btn variant="ghost" style={{ minHeight: 44 }} onClick={() => setEditingWeight(null)}>Cancel</Btn>
            <Btn style={{ minHeight: 44 }} disabled={savingWeight} onClick={saveWeight}>{savingWeight ? "Saving…" : "Save"}</Btn>
          </>}
        >
          <div className="field">
            <label>Weight (lb)</label>
            <input
              className="input" type="number" inputMode="numeric" autoComplete="off" min={0}
              value={editingWeight.weight}
              onChange={(e) => setEditingWeight((w) => ({ ...w, weight: Number(e.target.value) }))}
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}
