import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useStore } from "./store/useStore.js";
import { initOutboxSync } from "./lib/outbox.js";
import Masthead from "./components/Masthead.jsx";
import TabBar from "./components/TabBar.jsx";

import Login from "./screens/Login.jsx";
import Signup from "./screens/Signup.jsx";
import Intake from "./screens/Intake.jsx";
import Today from "./screens/Today.jsx";
import Program from "./screens/Program.jsx";
import Preview from "./screens/Preview.jsx";
import Run from "./screens/Run.jsx";
import Done from "./screens/Done.jsx";
import Trainer from "./screens/Trainer.jsx";
import History from "./screens/History.jsx";
import Progress from "./screens/Progress.jsx";
import Settings from "./screens/Settings.jsx";

const NO_CHROME = ["/run", "/done"];

function Shell({ children }) {
  const location = useLocation();
  const chromeOn = !NO_CHROME.some((p) => location.pathname.startsWith(p));
  const sessionsLoggedCount = useStore((s) => s.sessionsLoggedCount);
  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", background: "var(--color-neutral-300)" }}>
      <div style={{ width: "100%", maxWidth: 430, minHeight: "100vh", background: "var(--color-bg)", position: "relative", paddingBottom: chromeOn ? 84 : 0 }}>
        {chromeOn && <Masthead sessionsLogged={sessionsLoggedCount} />}
        {children}
        {chromeOn && <TabBar />}
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, authChecked } = useStore();
  const location = useLocation();
  if (!authChecked) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function Loading() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-neutral-300)" }}>
      <div style={{ width: "100%", maxWidth: 430, background: "var(--color-bg)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--color-neutral-700)" }}>
        Loading…
      </div>
    </div>
  );
}

export default function App() {
  const bootstrap = useStore((s) => s.bootstrap);
  const authChecked = useStore((s) => s.authChecked);
  const user = useStore((s) => s.user);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (user) initOutboxSync();
  }, [user]);

  if (!authChecked) return <Loading />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/today" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/today" replace /> : <Signup />} />
      <Route
        path="/intake"
        element={
          <RequireAuth>
            <Intake />
          </RequireAuth>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Shell>
              <Routes>
                <Route path="today" element={<Today />} />
                <Route path="program" element={<Program />} />
                <Route path="program/:id" element={<Preview />} />
                <Route path="run/:sessionId" element={<Run />} />
                <Route path="done" element={<Done />} />
                <Route path="trainer" element={<Trainer />} />
                <Route path="history" element={<History />} />
                <Route path="progress" element={<Progress />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/today" replace />} />
              </Routes>
            </Shell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
