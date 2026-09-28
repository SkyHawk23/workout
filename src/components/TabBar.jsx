import { useLocation, useNavigate } from "react-router-dom";

const NAV = [
  { path: "/today", label: "Today" },
  { path: "/program", label: "Program" },
  { path: "/trainer", label: "Trainer" },
  { path: "/history", label: "History" },
  { path: "/progress", label: "Progress" },
];

export default function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div style={{ position: "fixed", bottom: 0, width: "100%", maxWidth: 430, background: "var(--color-bg)", borderTop: "1px solid var(--color-text)" }}>
      <div style={{ display: "flex" }}>
        {NAV.map((n) => {
          const active = location.pathname.startsWith(n.path);
          return (
            <button
              key={n.path}
              onClick={() => navigate(n.path)}
              style={{
                flex: 1, minHeight: 56, background: "none", border: "none", cursor: "pointer",
                padding: "8px 2px", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                color: active ? "var(--color-accent-700)" : "var(--color-neutral-700)",
              }}
            >
              {n.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
