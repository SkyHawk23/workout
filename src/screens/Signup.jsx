import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "../store/useStore.js";
import { TextInput } from "../components/Field.jsx";
import Btn from "../components/Btn.jsx";

export default function Signup() {
  const signup = useStore((s) => s.signup);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({
    display_name: "", email: "", password: "", birth_year: "",
    invite_code: searchParams.get("invite") || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signup({
        display_name: form.display_name, email: form.email, password: form.password,
        birth_year: form.birth_year ? Number(form.birth_year) : undefined,
        invite_code: form.invite_code || undefined,
      });
      navigate("/intake", { replace: true });
    } catch (err) {
      setError(err.message || "Couldn't create your account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", background: "var(--color-neutral-300)" }}>
      <div style={{ width: "100%", maxWidth: 430, minHeight: "100vh", background: "var(--color-bg)", padding: "60px 20px 40px" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 34, letterSpacing: "-0.5px", lineHeight: 1 }}>The Daily Lift</div>
        <div style={{ height: 4, background: "var(--color-text)", marginTop: 14, marginBottom: "var(--space-6)" }} />
        <div style={{ fontSize: 15, color: "var(--color-neutral-700)", marginBottom: "var(--space-6)", lineHeight: 1.5 }}>
          {form.invite_code ? "You've been invited to join a household on The Daily Lift." : "Starting a new household. You'll be able to invite family members once you're set up."}
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <TextInput label="Your name" autoComplete="name" required value={form.display_name} onChange={(e) => set("display_name", e.target.value)} />
          <TextInput label="Email" type="email" autoComplete="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
          <TextInput label="Password (at least 10 characters)" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={(e) => set("password", e.target.value)} />
          <TextInput label="Birth year" type="number" inputMode="numeric" autoComplete="bday-year" value={form.birth_year} onChange={(e) => set("birth_year", e.target.value)} />
          <TextInput label="Invite code (optional)" autoComplete="off" value={form.invite_code} onChange={(e) => set("invite_code", e.target.value.toUpperCase())} />
          {error && <div style={{ fontSize: 14, color: "var(--color-accent-2-700)" }}>{error}</div>}
          <Btn type="submit" disabled={busy} style={{ width: "100%", minHeight: 52, fontSize: 17 }}>
            {busy ? "Creating account…" : "Create account"}
          </Btn>
        </form>

        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", marginTop: "var(--space-4)" }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
