import { C } from '../../utils/constants.js';

export const Btn = ({onClick, children, active, danger, small, style: sx = {}}) => (
  <button onClick={onClick} style={{
    padding: small ? "4px 10px" : "6px 14px", borderRadius: 6, cursor: "pointer",
    fontSize: small ? 11 : 12, fontWeight: active ? 600 : 400,
    border: `1px solid ${danger ? C.red : active ? C.accent : C.border}`,
    background: danger ? "#dc262618" : active ? C.accent + "20" : "transparent",
    color: danger ? C.red : active ? C.accent : C.muted, ...sx
  }}>{children}</button>
);
