import { C } from '../../utils/constants.js';

export const Modal = ({title, onClose, children, width = 520}) => (
  <div style={{position: "fixed", inset: 0, background: "#000000bb", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16}}>
    <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: width, maxHeight: "85vh", overflow: "auto"}}>
      <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.border}`}}>
        <div style={{fontSize: 16, fontWeight: 700, color: C.text}}>{title}</div>
        <button onClick={onClose} style={{background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 22, lineHeight: 1}}>×</button>
      </div>
      <div style={{padding: 20}}>{children}</div>
    </div>
  </div>
);
