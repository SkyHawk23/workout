import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import Dialog from "../components/Dialog.jsx";
import Btn from "../components/Btn.jsx";

// Shared "start a workout" flow for Today/Preview/History: if the member
// has a paired watch, ask whether to run it here or send it to the watch
// instead of jumping straight into the web Run screen. There's no push
// channel to the physical watch — "send to watch" means queuing this
// session as today's via the same start-today move the "Train now anyway"
// button already uses, so the watch's own `today` poll picks it up.
export function useStartWorkout() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(null); // planned_session id awaiting a choice
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function begin(sessionId) {
    let hasWatch = false;
    try {
      const res = await api("auth", "devices-list", {});
      hasWatch = (res.devices || []).length > 0;
    } catch {
      hasWatch = false;
    }
    if (hasWatch) { setPending(sessionId); setSent(false); }
    else navigate(`/run/${sessionId}`);
  }

  async function sendToWatch() {
    if (!pending) return;
    setBusy(true);
    try {
      await api("program", "start-today", { id: pending });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  function runOnWeb() {
    const id = pending;
    setPending(null);
    navigate(`/run/${id}`);
  }

  const modal = pending && (
    <Dialog
      title={sent ? "Sent to your watch" : "Run this on your watch?"}
      actions={sent ? (
        <Btn style={{ minHeight: 44 }} onClick={() => setPending(null)}>Done</Btn>
      ) : (
        <>
          <Btn variant="ghost" style={{ minHeight: 44 }} onClick={runOnWeb}>Run on web</Btn>
          <Btn style={{ minHeight: 44 }} disabled={busy} onClick={sendToWatch}>{busy ? "Sending…" : "Send to watch"}</Btn>
        </>
      )}
    >
      <div style={{ fontSize: 14, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
        {sent
          ? "Open The Daily Lift on your watch — it'll show up as today's workout."
          : "Your watch is paired. Send this workout there instead of running it here?"}
      </div>
    </Dialog>
  );

  return { begin, modal };
}
