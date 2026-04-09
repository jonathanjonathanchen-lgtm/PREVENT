import { C } from '../../utils/constants.js';

export const Tt = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{background: "#0f172aee", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12}}>
      <div style={{color: C.muted, marginBottom: 4}}>{typeof label === "number" ? label.toFixed(2) : label}s</div>
      {payload.map((p, i) => <div key={i} style={{color: p.color}}>{p.name}: <b>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</b></div>)}
    </div>
  );
};
