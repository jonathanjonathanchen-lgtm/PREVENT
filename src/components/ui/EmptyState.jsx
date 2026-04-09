import { C } from '../../utils/constants.js';

export const EmptyState = ({icon, title, detail, action}) => (
  <div style={{display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 48, textAlign: "center", color: C.muted, minHeight: 280}}>
    <div style={{fontSize: 38, marginBottom: 12}}>{icon}</div>
    <div style={{fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8}}>{title}</div>
    <div style={{fontSize: 12, marginBottom: 20, maxWidth: 360}}>{detail}</div>
    {action}
  </div>
);
