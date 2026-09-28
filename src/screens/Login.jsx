import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useStore } from "../store/useStore.js";
import { TextInput } from "../components/Field.jsx";
import Btn from "../components/Btn.jsx";

export default function Login() {
  const login = useStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
      navigate(location.state?.from?.pathname || "/today", { replace: true });
    } catch (err) {
      setError(err.message || "Couldn't sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", background: "var(--color-neutral-300)" }}>
      <div style={{ width: "100%", maxWidth: 430, minHeight: "100vh", background: "var(--color-bg)", padding: "60px 20px 0" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 34, letterSpacing: "-0.5px", lineHeight: 1 }}>The Daily Lift</div>
        <div style={{ height: 4, background: "var(--color-text)", marginTop: 14, marginBottom: "var(--space-8)" }} />

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <TextInput label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div style={{ fontSize: 14, color: "var(--color-accent-2-700)" }}>{error}</div>}
          <Btn type="submit" disabled={busy} style={{ width: "100%", minHeight: 52, fontSize: 17 }}>
            {busy ? "Signing in…" : "Sign in"}
          </Btn>
        </form>

        <div style={{ fontSize: 14, color: "var(--color-neutral-700)", marginTop: "var(--space-4)" }}>
          New to The Daily Lift? <Link to="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
