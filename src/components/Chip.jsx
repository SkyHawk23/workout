// Multi-select chip used by the intake flow (goals, equipment checklist).
export default function Chip({ checked, onChange, children }) {
  return (
    <label className="chip">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
