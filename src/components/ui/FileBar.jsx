import { useState } from 'react';
import { C } from '../../utils/constants.js';

export const FileBar = ({job, onUpload, onRemove}) => {
  const [open, setOpen] = useState(false);
  if (!job) return null;
  const nM = job.mvnxFiles?.length || 0, nL = job.loadsolFiles?.length || 0, nF = job.forceFiles?.length || 0;

  const Chip = ({color, label, onX, onAdd}) => (
    <div onClick={onAdd} style={{
      display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 9px",
      borderRadius: 12, cursor: onAdd ? "pointer" : "default",
      background: onAdd ? "transparent" : color + "18",
      border: `1px solid ${onAdd ? C.border : color + "60"}`,
      color: onAdd ? C.muted : color, whiteSpace: "nowrap"
    }}>
      <span>{label}</span>
      {onX && <span onClick={e => {e.stopPropagation(); onX();}} style={{cursor: "pointer", opacity: .7, fontSize: 15, lineHeight: 1, marginLeft: 2}}>\u00D7</span>}
    </div>
  );

  return (
    <div style={{marginBottom: 14}}>
      <button onClick={() => setOpen(v => !v)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
        background: C.card, border: `1px solid ${C.border}`, borderRadius: open ? "8px 8px 0 0" : 8,
        padding: "6px 12px", cursor: "pointer", color: C.muted, fontSize: 11}}>
        <span style={{fontSize: 9}}>{open ? "\u25BC" : "\u25B6"}</span>
        <span style={{fontWeight: 500, color: C.text}}>Files</span>
        <span style={{opacity: .6}}>{nM} MVNX \u00B7 {nL} LoadSOL \u00B7 {nF} WiDACS</span>
        <span style={{marginLeft: "auto", fontSize: 10, color: C.accent}}>{open ? "hide" : "manage"}</span>
      </button>
      {open && (
        <div style={{display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
          background: C.card, border: `1px solid ${C.border}`, borderTop: "none",
          borderRadius: "0 0 8px 8px", padding: "8px 12px"}}>
          {job.mvnxFiles.map((f, i) => (
            <Chip key={i} color={C.teal} label={f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i, "")}
              onX={() => onRemove("mvnx", i)}/>
          ))}
          <Chip color={C.teal} label="+ MVNX" onAdd={() => onUpload("mvnx")}/>
          <Chip color={C.teal} label="+ CSV/XLSX" onAdd={() => onUpload("csv")}/>
          {(job.loadsolFiles || []).map((f, i) => (
            <Chip key={i} color={C.sky} label={f.name} onX={() => onRemove("loadsol", i)}/>
          ))}
          <Chip color={C.sky} label="+ LoadSOL" onAdd={() => onUpload("loadsol")}/>
          {(job.forceFiles || []).map((f, i) => (
            <Chip key={i} color={C.violet} label={f.name} onX={() => onRemove("force", i)}/>
          ))}
          <Chip color={C.violet} label="+ Force CSV" onAdd={() => onUpload("force")}/>
        </div>
      )}
    </div>
  );
};
