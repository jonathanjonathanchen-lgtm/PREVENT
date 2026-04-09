import { C } from '../utils/constants.js';

export default function PipelineTab() {
  return (
    <div>
      <p style={{color: C.accent, fontWeight: 600, fontSize: 16, marginBottom: 4}}>End-to-End Research Pipeline</p>
      <p style={{color: C.muted, fontSize: 13, marginBottom: 22}}>XSENS MVN \u00B7 LoadSOL \u00B7 WiDACS \u2192 biomechanical modelling \u2192 ML risk classification.</p>
      {[
        {s: "1", t: "Data Acquisition", c: C.sky, d: "XSENS MVN 40/60Hz \u00B7 LoadSOL insoles 200Hz \u00B7 WiDACS force gauge 500Hz", det: "Create a Job \u2192 upload MVNX or CSV files, LoadSOL TXT, WiDACS CSV per session"},
        {s: "2", t: "Skeleton Visualisation", c: C.amber, d: "3D\u21922D stick figure with hand segment orientation \u2192 fingertip projection", det: "Skeleton tab: configurable joint panels (Ergonomic ZXY angles), play/scrub, Butterworth toggle"},
        {s: "3", t: "Cycle Similarity", c: C.emerald, d: "Time-normalise cycles 0\u2013100%, overlay FE traces, Pearson r matrix", det: "Cycles tab: key clinical joints (L4/L5, shoulders, elbows, hips, knees)"},
        {s: "4", t: "Force Sync & Extension", c: C.violet, d: "Align WiDACS to MVNX via time offset, plateau extension, segment warping", det: "Forces tab: force events with trial averaging, time normalization"},
        {s: "5", t: "Inverse Dynamics", c: C.orange, d: "Quasi-dynamic Newton-Euler with hybrid kinematics: RB or Butterworth LPF", det: "Dynamic CoP estimation, hand-orientation-based force application, L5/S1 + shoulder moments"},
        {s: "6", t: "ML Classification", c: C.rose, d: "SVM-RBF \u00B7 LOOCV \u00B7 Binary MSD risk labels from injury records", det: "Metrics: Accuracy, PPV, Sensitivity, Specificity, F1, ROC/AUC"},
      ].map(p => (
        <div key={p.s} style={{display: "flex", gap: 14, marginBottom: 12, alignItems: "flex-start"}}>
          <div style={{width: 32, height: 32, borderRadius: "50%", background: p.c + "25", border: `2px solid ${p.c}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, fontWeight: 700, color: p.c}}>{p.s}</div>
          <div style={{flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px"}}>
            <div style={{fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3}}>{p.t}</div>
            <div style={{fontSize: 11, color: C.muted, marginBottom: 5}}>{p.d}</div>
            <div style={{fontSize: 11, color: p.c, background: p.c + "10", padding: "5px 9px", borderRadius: 5, borderLeft: `3px solid ${p.c}`}}>{p.det}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
