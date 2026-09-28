import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useStore } from "../store/useStore.js";
import Btn from "../components/Btn.jsx";
import Seg from "../components/Seg.jsx";
import { TextInput } from "../components/Field.jsx";
import { kicker } from "../lib/helpers.js";
import { localToday } from "../../lib/date.js";

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

  useEffect(() => {
    api("household", "get", {}).then((res) => setHousehold(res)).catch(() => {});
    api("trainer", "get-profile", {}).then((res) => setLimitations(res.profile?.limitations || "")).catch(() => {});
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
        <div style={kicker("var(--color-neutral-700)")}>Your data</div>
        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", margin: "6px 0 12px", lineHeight: 1.5 }}>Download everything The Daily Lift knows about your training.</div>
        <Btn variant="secondary" style={{ width: "100%", minHeight: 44 }} onClick={exportData}>Export my data</Btn>
      </div>
    </div>
  );
}
