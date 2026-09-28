export default function Btn({ variant = "primary", style, children, ...p }) {
  return (
    <button className={`btn btn-${variant}`} style={style} {...p}>
      {children}
    </button>
  );
}
