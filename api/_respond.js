// Wraps a Vercel Node function handler so every action shares the same
// error shape and status-code mapping, and so `requireUser` throws read
// cleanly as JSON responses.
export function withHandler(actions) {
  return async function handler(req, res) {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }
      const action = req.query?.action;
      const fn = actions[action];
      if (!fn) {
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const result = await fn(req, res, body);
      if (res.writableEnded) return; // handler already sent a custom response (e.g. streaming)
      res.status(200).json(result ?? { ok: true });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      // Only errors deliberately raised via httpError() (err.safe) carry a
      // message meant for the client — an unmarked exception (a raw
      // Postgres error, a bug) never gets echoed back, even at 5xx.
      const message = err.safe ? err.message : "Server error";
      res.status(status).json({ error: message, code: err.code });
    }
  };
}
