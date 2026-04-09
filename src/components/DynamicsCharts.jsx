// ── DynamicsCharts ───────────────────────────────────────────────────────────
// Right column of Forces & Dynamics tab: joint moment charts with playback cursor,
// overlap warnings, and peak table. Uses min-max decimation for charting.

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts';
import { C } from '../utils/constants.js';
import { ChartCard, Btn, EmptyState, Tt } from './ui/index.js';
import useBiomechanicsStore from '../store/useBiomechanicsStore.js';
import { minMaxDecimate } from '../utils/decimation.js';

export default function DynamicsCharts({
  invDynData, activeSkelMvnx, clippedLsf,
  curEvs, allEvNormalized, allEvAveraged, activeEventId,
  openUpload,
}) {
  const {
    bodyMass, setBodyMass, skelFileIdx, setSkelFileIdx, skelFrame,
    showMomComponents, setShowMomComponents,
    useRigidBody,
  } = useBiomechanicsStore();

  const mvnxFiles = useBiomechanicsStore(s => s.getActiveJob()?.mvnxFiles || []);

  const hasMvnx = !!activeSkelMvnx?.frames?.length;
  const hasData = invDynData?.length > 0;
  const hasLS = !!clippedLsf?.length;

  // Compute time ranges for ALL force events
  const allEvRanges = curEvs.filter(ev => (ev.fileIndices || []).length > 0).map(ev => {
    const normData = allEvNormalized[ev.id] || allEvAveraged[ev.id] || [];
    const dur = normData.length ? normData[normData.length - 1].time : 0;
    return { id: ev.id, label: ev.label, hand: ev.hand, tStart: ev.tStart || 0, tEnd: (ev.tStart || 0) + dur, color: ev.id === activeEventId ? C.accent : C.violet };
  });

  // Detect time overlaps
  const overlapRegions = [];
  for (let i = 0; i < allEvRanges.length; i++) {
    for (let j = i + 1; j < allEvRanges.length; j++) {
      const a = allEvRanges[i], b = allEvRanges[j];
      const handConflict = a.hand === b.hand || a.hand === 'bilateral' || b.hand === 'bilateral';
      if (!handConflict) continue;
      const oStart = Math.max(a.tStart, b.tStart), oEnd = Math.min(a.tEnd, b.tEnd);
      if (oEnd > oStart + 0.01) overlapRegions.push({ x1: oStart, x2: oEnd, evA: a.label, evB: b.label });
    }
  }

  const curTime = activeSkelMvnx?.frames?.[Math.min(skelFrame, (activeSkelMvnx?.frames?.length || 1) - 1)]?.time ?? null;

  // Memoized chart data with min-max decimation
  const forcesChartData = useMemo(() => {
    const chartFor = (dataKey) => {
      const raw = invDynData?.map(r => {
        const v = r[dataKey];
        if (!v) return null;
        return { t: r.t, mag: v.mag, FE: v.FE, LB: v.LB, AR: v.AR };
      }).filter(Boolean) || [];
      const d = minMaxDecimate(raw, 'mag', 200);
      const peakMag = raw.length ? Math.max(...raw.map(r => r.mag || 0)) : 0;
      return { data: d, peakMag };
    };
    return { L5S1: chartFor("L5S1"), shoulderR: chartFor("shoulderR"), shoulderL: chartFor("shoulderL") };
  }, [invDynData]);

  const jChart = (title, dataKey, color = C.accent) => {
    const { data: d, peakMag } = forcesChartData[dataKey] || { data: [], peakMag: 0 };
    if (!d.length) return null;
    return (
      <ChartCard key={dataKey} title={<span>{title}<span style={{fontSize: 10, color: C.muted, marginLeft: 6}}>peak {peakMag.toFixed(0)} Nm</span></span>} h={190}>
        <ResponsiveContainer>
          <LineChart data={d}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="t" type="number" tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="s"/>
            <YAxis tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="Nm"/>
            <Tooltip content={Tt}/>
            <ReferenceLine y={0} stroke={C.border} strokeDasharray="3 3"/>
            {curTime != null && <ReferenceLine x={curTime} stroke={C.accent} strokeWidth={1.5} strokeDasharray="4 2"/>}
            {allEvRanges.map(ev => (
              <ReferenceArea key={ev.id} x1={ev.tStart} x2={ev.tEnd} fill={ev.color} fillOpacity={ev.id === activeEventId ? 0.12 : 0.06}/>
            ))}
            {overlapRegions.map((ol, i) => (
              <ReferenceArea key={`ol-${i}`} x1={ol.x1} x2={ol.x2} fill={C.red} fillOpacity={0.18} strokeWidth={0}/>
            ))}
            {showMomComponents ? (
              <>
                <Line type="monotone" dataKey="FE" stroke={C.teal} dot={false} strokeWidth={1.5} name="FE (flex/ext)" isAnimationActive={false}/>
                <Line type="monotone" dataKey="LB" stroke={C.amber} dot={false} strokeWidth={1.5} name="LB (lat bend)" isAnimationActive={false}/>
                <Line type="monotone" dataKey="AR" stroke={C.rose} dot={false} strokeWidth={1.5} name="AR (axial rot)" isAnimationActive={false}/>
                <Legend wrapperStyle={{fontSize: 9}}/>
              </>
            ) : (
              <Line type="monotone" dataKey="mag" stroke={color} dot={false} strokeWidth={2} name="Resultant" isAnimationActive={false}/>
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    );
  };

  return (
    <div style={{display: "flex", flexDirection: "column", gap: 14}}>
      {/* Config bar */}
      <div style={{display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px"}}>
        <div style={{display: "flex", gap: 6, alignItems: "center"}}>
          <span style={{fontSize: 12, color: C.muted}}>Body mass:</span>
          <input type="number" step="any" min={20} max={250} value={bodyMass}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setBodyMass(v); }}
            style={{width: 58, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 8px", color: C.accent, fontSize: 12}}/>
          <span style={{fontSize: 12, color: C.muted}}>kg</span>
        </div>
        {mvnxFiles.length > 1 && (
          <div style={{display: "flex", gap: 6, alignItems: "center"}}>
            <span style={{fontSize: 12, color: C.muted}}>MVNX:</span>
            <select value={skelFileIdx} onChange={e => setSkelFileIdx(+e.target.value)}
              style={{background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 11}}>
              {mvnxFiles.map((f, i) => <option key={i} value={i}>{f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i, "")}</option>)}
            </select>
          </div>
        )}
        <div style={{fontSize: 11, color: C.muted, marginLeft: "auto"}}>
          {hasMvnx ? "✓ MVNX" : "✗ MVNX"} · {hasLS ? "✓ LoadSOL" : "✗ LoadSOL"}
          <span style={{marginLeft: 8, color: useRigidBody ? C.teal : C.amber}}>
            {useRigidBody ? "RB Kin" : "Butterworth"}
          </span>
        </div>
      </div>

      {/* Charts / empty states */}
      {!hasMvnx ? (
        <EmptyState icon="⚙️" title="No MVNX loaded" detail="Select a job with MVNX data to compute shoulder moments."/>
      ) : !hasData ? (
        <EmptyState icon="📐" title="No dynamics data" detail="Assign force events to hands to compute shoulder moments."/>
      ) : (
        <>
          <div style={{display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${C.accent}40`, paddingBottom: 6}}>
            <span style={{fontSize: 12, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: .5}}>
              Joint Moments — Quasi-Dynamic
            </span>
            <button onClick={() => setShowMomComponents(v => !v)} style={{
              marginLeft: "auto", background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
              padding: "3px 10px", color: showMomComponents ? C.accent : C.muted, fontSize: 11, cursor: "pointer"}}>
              {showMomComponents ? "Show resultant" : "Show FE / LB / AR"}
            </button>
          </div>

          {overlapRegions.length > 0 && (
            <div style={{background: C.red + "15", border: `1px solid ${C.red}40`, borderRadius: 8, padding: "8px 12px", fontSize: 11, color: C.red}}>
              <div style={{fontWeight: 600, marginBottom: 2}}>⚠ Force event time overlap detected</div>
              {overlapRegions.map((ol, i) => (
                <div key={i} style={{fontSize: 10}}>"{ol.evA}" & "{ol.evB}" overlap {ol.x1.toFixed(2)}–{ol.x2.toFixed(2)}s</div>
              ))}
            </div>
          )}

          {!hasLS && (
            <div style={{background: C.amber + "15", border: `1px solid ${C.amber}40`, borderRadius: 8, padding: "8px 12px", fontSize: 11, color: C.amber}}>
              No LoadSOL paired — L5/S1 bottom-up will be zero. Pair in Skeleton tab.
            </div>
          )}

          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14}}>
            {jChart("L5/S1 — Bottom-Up (via LoadSOL)", "L5S1", C.sky)}
          </div>
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14}}>
            {jChart("Right Shoulder", "shoulderR", C.amber)}
            {jChart("Left Shoulder", "shoulderL", C.emerald)}
          </div>

          {/* Peak table */}
          <div style={{overflowX: "auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8}}>
            <table style={{width: "100%", borderCollapse: "collapse", fontSize: 11}}>
              <thead>
                <tr style={{borderBottom: `1px solid ${C.border}`}}>
                  {["Joint", "Peak (Nm)", ...(showMomComponents ? ["Peak FE", "Peak LB", "Peak AR"] : [])].map(h => (
                    <th key={h} style={{textAlign: "left", padding: "7px 12px", color: C.muted, fontWeight: 600}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {label: "L5/S1 (bottom-up)", key: "L5S1", clr: C.sky},
                  {label: "R Shoulder", key: "shoulderR", clr: C.amber},
                  {label: "L Shoulder", key: "shoulderL", clr: C.emerald},
                ].map(({label, key, clr}) => {
                  const d = invDynData.map(r => r[key]).filter(Boolean);
                  if (!d.length) return null;
                  const pk = c => Math.max(...d.map(r => Math.abs(r[c] || 0))).toFixed(1);
                  return (
                    <tr key={key} style={{borderBottom: `1px solid ${C.border}20`}}>
                      <td style={{padding: "6px 12px", color: clr, fontWeight: 500}}>{label}</td>
                      <td style={{padding: "6px 12px", color: C.accent, fontWeight: 600}}>{pk("mag")}</td>
                      {showMomComponents && <td style={{padding: "6px 12px", color: C.teal}}>{pk("FE")}</td>}
                      {showMomComponents && <td style={{padding: "6px 12px", color: C.amber}}>{pk("LB")}</td>}
                      {showMomComponents && <td style={{padding: "6px 12px", color: C.rose}}>{pk("AR")}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
