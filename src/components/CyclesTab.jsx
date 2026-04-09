// ── CyclesTab ────────────────────────────────────────────────────────────────

import { C, CYCLE_COLORS, KEY_JOINTS } from '../utils/constants.js';
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Btn, Stat, ChartCard, Spinner, EmptyState, FileBar, Tt } from './ui/index.js';
import { getJointAngles } from '../adapters/unifiedKinematicData.js';
import useBiomechanicsStore from '../store/useBiomechanicsStore.js';

export default function CyclesTab({ openUpload, removeFile }) {
  const activeJob = useBiomechanicsStore(s => s.getActiveJob());
  const { filesLoading, cycleJointKey, setCycleJointKey } = useBiomechanicsStore();
  const mvnxFiles = activeJob?.mvnxFiles || [];

  if (filesLoading) return <div style={{display: "flex", justifyContent: "center", padding: 60}}><Spinner size={32}/></div>;
  if (!mvnxFiles.length) return (
    <div>
      {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
      <EmptyState icon={"\uD83D\uDCCA"} title="No cycle data" detail="Upload multiple MVNX/CSV files (one per cycle/trial) to compare."
        action={<Btn active onClick={() => openUpload("mvnx")}>Upload Files</Btn>}/>
    </div>
  );

  const firstJoints = mvnxFiles[0]?.jointLabels || [];
  const availableKJ = KEY_JOINTS.map((kj, i) => ({...kj, ki: i, ji: firstJoints.findIndex(l => kj.r.test(l))})).filter(k => k.ji >= 0);
  const safeKey = Math.min(cycleJointKey, availableKJ.length - 1);
  const selected = availableKJ[safeKey] || availableKJ[0];
  if (!selected) return <EmptyState icon={"\u26A0"} title="No matching joints" detail="No clinical joints found in this file."/>;

  const N = 100;
  const interp = (frames, ji) => {
    // Use ergonomic joint angles when available (FE = index 2 in ZXY)
    const vals = (frames || []).map(f => {
      const angles = getJointAngles(f, ji);
      return angles.FE;
    });
    if (!vals.length) return Array(N).fill(0);
    return Array.from({length: N}, (_, i) => {
      const pos = (i / (N - 1)) * (vals.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
      return vals[lo] * (1 - (pos - lo)) + (vals[hi] ?? vals[lo]) * (pos - lo);
    });
  };

  const cycles = mvnxFiles.map((f, i) => ({
    name: f.name.replace(/\.mvnx\.mvnx$|\.mvnx$|\.csv$/i, ""),
    color: CYCLE_COLORS[i % CYCLE_COLORS.length],
    vals: interp(f.frames, selected.ji),
  }));
  const means = Array.from({length: N}, (_, i) => cycles.reduce((s, c) => s + c.vals[i], 0) / cycles.length);
  const sds = Array.from({length: N}, (_, i) => { const m = means[i]; return Math.sqrt(cycles.reduce((s, c) => s + (c.vals[i] - m) ** 2, 0) / cycles.length); });
  const pctData = Array.from({length: N}, (_, i) => {
    const pt = {pct: i, mean: +means[i].toFixed(2), hi: +(means[i] + sds[i]).toFixed(2), lo: +(means[i] - sds[i]).toFixed(2)};
    cycles.forEach(c => { pt[c.name] = +c.vals[i].toFixed(2); });
    return pt;
  });
  const n = cycles.length;
  const corr = cycles.map((a, i) => cycles.map((b, j) => {
    if (i === j) return 1;
    const ma = a.vals.reduce((s, v) => s + v, 0) / N, mb = b.vals.reduce((s, v) => s + v, 0) / N;
    const num = a.vals.reduce((s, v, k) => s + (v - ma) * (b.vals[k] - mb), 0);
    const da = Math.sqrt(a.vals.reduce((s, v) => s + (v - ma) ** 2, 0)), db = Math.sqrt(b.vals.reduce((s, v) => s + (v - mb) ** 2, 0));
    return da && db ? +(num / (da * db)).toFixed(3) : 0;
  }));

  return (
    <div>
      {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
      <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14}}>
        <div style={{fontSize: 11, color: C.muted, marginBottom: 8}}>Joint (ergonomic flex/ext):</div>
        <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
          {availableKJ.map((kj, i) => (
            <Btn key={i} small active={safeKey === i} onClick={() => setCycleJointKey(i)}>{kj.lbl}</Btn>
          ))}
        </div>
      </div>
      <ChartCard title={`Cycle Overlay \u2014 ${selected.lbl} FE (time-normalised)`} h={280}>
        <ResponsiveContainer>
          <ComposedChart data={pctData}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="pct" tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="%"/>
            <YAxis tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="\u00B0"/>
            <Tooltip content={Tt}/>
            <ReferenceLine y={0} stroke={C.border} strokeDasharray="3 3"/>
            <Area type="monotone" dataKey="hi" stroke="none" fill={C.teal} fillOpacity={0.12} legendType="none" name="SD+"/>
            <Area type="monotone" dataKey="lo" stroke="none" fill={C.bg} fillOpacity={1} legendType="none" name="SD\u2212"/>
            {cycles.map(c => <Line key={c.name} type="monotone" dataKey={c.name} stroke={c.color} dot={false} strokeWidth={1.5} opacity={0.8}/>)}
            <Line type="monotone" dataKey="mean" stroke={C.teal} dot={false} strokeWidth={2.5} name="Mean" strokeDasharray="6 2"/>
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      {n > 1 && (
        <ChartCard title="Correlation Matrix" h={n * 44 + 60}>
          <div style={{overflowX: "auto"}}>
            <table style={{borderCollapse: "collapse", fontSize: 11, color: C.text}}>
              <thead><tr>
                <th style={{padding: "4px 10px", color: C.muted}}/>
                {cycles.map((c, i) => <th key={i} style={{padding: "4px 10px", color: c.color, fontWeight: 600}}>{c.name}</th>)}
              </tr></thead>
              <tbody>{corr.map((row, i) => (
                <tr key={i}>
                  <td style={{padding: "4px 10px", color: cycles[i].color, fontWeight: 600}}>{cycles[i].name}</td>
                  {row.map((r, j) => (
                    <td key={j} style={{padding: "4px 10px", textAlign: "center",
                      background: i === j ? "transparent" : `rgba(13,148,136,${Math.abs(r) * 0.4})`,
                      color: i === j ? C.muted : r > 0.95 ? C.accent : r > 0.8 ? C.teal : C.amber, borderRadius: 4}}>
                      {i === j ? "\u2014" : r.toFixed(3)}
                    </td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </ChartCard>
      )}
      <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12}}>
        <Stat label="Cycles" value={n} unit="files"/>
        <Stat label="Peak (mean)" value={Math.max(...means).toFixed(1)} unit="\u00B0"/>
        <Stat label="Avg SD" value={(sds.reduce((s, v) => s + v, 0) / sds.length).toFixed(1)} unit="\u00B0" sub="variability"/>
        {n > 1 && <Stat label="Mean r" value={(corr.flat().filter((_, k) => k % (n + 1) !== 0).reduce((s, v) => s + v, 0) / (n * (n - 1))).toFixed(3)} sub="inter-cycle" color={C.teal}/>}
      </div>
    </div>
  );
}
