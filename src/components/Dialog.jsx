export default function Dialog({ title, children, actions, maxWidth = 340 }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" style={{ maxWidth }}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}
