import { C } from '../../utils/constants.js';

export const Stat = ({label, value, unit, sub, color}) => (
  <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px"}}>
    <div style={{fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4}}>{label}</div>
    <div style={{fontSize: 22, fontWeight: 700, color: color || C.text}}>
      {value}<span style={{fontSize: 13, color: C.muted, marginLeft: 4}}>{unit}</span>
    </div>
    {sub && <div style={{fontSize: 11, color: C.muted, marginTop: 2}}>{sub}</div>}
  </div>
);
