export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Select({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </Field>
  );
}

export function TextInput({ label, ...p }) {
  return (
    <Field label={label}>
      <input className="input" {...p} />
    </Field>
  );
}

export function TextArea({ label, ...p }) {
  return (
    <Field label={label}>
      <textarea className="input" {...p} />
    </Field>
  );
}
