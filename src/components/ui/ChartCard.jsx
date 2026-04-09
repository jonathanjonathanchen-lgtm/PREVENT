import { C } from '../../utils/constants.js';

export const ChartCard = ({title, children, h = 280, action}) => (
  <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 12}}>
    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10}}>
      <div style={{fontSize: 12, fontWeight: 600, color: C.accent, textTransform: "uppercase", letterSpacing: .5}}>{title}</div>
      {action}
    </div>
    <div style={{height: h}}>{children}</div>
  </div>
);
