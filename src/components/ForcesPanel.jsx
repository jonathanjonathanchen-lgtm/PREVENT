// ── ForcesPanel ──────────────────────────────────────────────────────────────
// Force event management panel: create/edit/delete events, assign trials,
// plateau extension, time normalization, segment warping.

import { useState, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import { C, CYCLE_COLORS, TYPE_OPTS, HAND_OPTS, DIR_OPTS } from '../utils/constants.js';
import { Btn, Tt } from './ui/index.js';
import { minMaxDecimate } from '../utils/decimation.js';
import useBiomechanicsStore from '../store/useBiomechanicsStore.js';

export default function ForcesPanel({
  curEvs, setCurEvs, activeEvent,
  allEvNormalized, allEvAveraged, averagedEvData,
  forceFilesList, activeSkelMvnx,
}) {
  const {
    activeEventId, setActiveEventId, skelFrame,
  } = useBiomechanicsStore();

  const [plateauModal, setPlateauModal] = useState(null);
  const fpChartRef = useRef(null);

  const updateEvent = (patch) => setCurEvs(prev =>
    prev.map(e => e.id === activeEventId ? {...e, ...patch} : e));

  const skelTime = activeSkelMvnx?.frames?.[Math.min(skelFrame, (activeSkelMvnx?.frames?.length || 1) - 1)]?.time ?? 0;
  const validTrials = (activeEvent?.fileIndices || []).filter(i => i < forceFilesList.length).length;
  const normEvData = activeEvent ? (allEvNormalized[activeEvent.id] || averagedEvData) : averagedEvData;
  const isNormalized = activeEvent?.tEnd != null || (activeEvent?.timeSegments?.length > 0);

  // Min-max decimated display data
  const displayData = minMaxDecimate(averagedEvData, 'force', 200);
  const displayNorm = minMaxDecimate(normEvData, 'force', 200);

  // Detect overlaps
  const panelEvRanges = curEvs.filter(ev => (ev.fileIndices || []).length > 0).map(ev => {
    const nd = allEvNormalized[ev.id] || allEvAveraged[ev.id] || [];
    const dur = nd.length ? nd[nd.length - 1].time : 0;
    return { id: ev.id, hand: ev.hand, tStart: ev.tStart || 0, tEnd: (ev.tStart || 0) + dur };
  });
  const overlappingIds = new Set();
  for (let i = 0; i < panelEvRanges.length; i++) {
    for (let j = i + 1; j < panelEvRanges.length; j++) {
      const a = panelEvRanges[i], b = panelEvRanges[j];
      const handConflict = a.hand === b.hand || a.hand === 'bilateral' || b.hand === 'bilateral';
      if (!handConflict) continue;
      const oStart = Math.max(a.tStart, b.tStart), oEnd = Math.min(a.tEnd, b.tEnd);
      if (oEnd > oStart + 0.01) { overlappingIds.add(a.id); overlappingIds.add(b.id); }
    }
  }

  return (
    <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14,
      display: "flex", flexDirection: "column", gap: 10, overflow: "auto", maxHeight: "calc(100vh - 200px)"}}>
      <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
        <div style={{fontSize: 13, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: .5}}>Force Events</div>
        <Btn small active onClick={() => {
          const id = `ev_${Date.now()}`;
          const newEv = {id, label: `Event ${curEvs.length + 1}`, type: 'push', hand: 'right',
            direction: 'auto', tStart: 0, tEnd: null, fileIndices: [], stopAt: null,
            plateauT: null, plateauF: null, plateauDur: 0, timeSegments: []};
          setCurEvs(prev => [...prev, newEv]);
          setActiveEventId(id);
        }}>+ New</Btn>
      </div>

      {curEvs.length === 0 && (
        <div style={{fontSize: 11, color: C.muted, padding: "10px 0", textAlign: "center"}}>No events yet — click + New to create one.</div>
      )}

      <div style={{display: "flex", flexDirection: "column", gap: 4}}>
        {curEvs.map(ev => {
          const nTrials = (ev.fileIndices || []).filter(i => i < forceFilesList.length).length;
          const isActive = ev.id === activeEventId;
          const hasOverlap = overlappingIds.has(ev.id);
          const avgData = allEvAveraged[ev.id] || [];
          const peakF = avgData.length ? Math.max(...avgData.map(d => d.force)) : 0;
          const borderColor = hasOverlap ? C.red : isActive ? C.accent : C.border;
          return (
            <div key={ev.id} onClick={() => setActiveEventId(ev.id)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, cursor: "pointer",
              background: hasOverlap ? C.red + "10" : isActive ? C.accent + "18" : "transparent",
              border: `1px solid ${borderColor}`}}>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{display: "flex", alignItems: "center", gap: 5}}>
                  <span style={{fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? C.accent : C.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{ev.label}</span>
                  {hasOverlap && <span style={{fontSize: 9, color: C.red, background: C.red + "20", padding: "1px 5px", borderRadius: 3, fontWeight: 600}}>OVERLAP</span>}
                </div>
                <div style={{fontSize: 10, color: C.muted}}>
                  {ev.type} · {ev.hand} · {nTrials} trial{nTrials !== 1 ? 's' : ''}
                  {peakF > 0 && <span style={{color: C.violet, marginLeft: 4}}>· {peakF.toFixed(0)} N peak</span>}
                </div>
              </div>
              <Btn small onClick={e => { e.stopPropagation();
                const id = `ev_${Date.now()}`;
                setCurEvs(prev => [...prev, {...ev, id, label: ev.label + ' (copy)'}]);
                setActiveEventId(id);
              }} style={{fontSize: 10}}>⧉</Btn>
              <Btn small danger onClick={e => { e.stopPropagation();
                setCurEvs(prev => prev.filter(x => x.id !== ev.id));
                if (activeEventId === ev.id) setActiveEventId(null);
              }}>×</Btn>
            </div>
          );
        })}
      </div>

      {activeEvent && (
        <div style={{borderTop: `1px solid ${C.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8}}>
          <input value={activeEvent.label} onChange={e => updateEvent({label: e.target.value})}
            style={{background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px",
              color: C.text, fontSize: 12, width: "100%", boxSizing: "border-box"}}/>
          <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
            {TYPE_OPTS.map(t => (
              <Btn key={t} small active={activeEvent.type === t} onClick={() => updateEvent({type: t})}>{t}</Btn>
            ))}
          </div>
          <div style={{display: "flex", gap: 6, alignItems: "center"}}>
            <span style={{fontSize: 11, color: C.muted, minWidth: 36}}>Hand:</span>
            {HAND_OPTS.map(({v, l}) => (
              <Btn key={v} small active={activeEvent.hand === v} onClick={() => updateEvent({hand: v})}>{l}</Btn>
            ))}
          </div>
          <div style={{display: "flex", gap: 6, alignItems: "center"}}>
            <span style={{fontSize: 11, color: C.muted, minWidth: 36}}>Dir:</span>
            <select value={activeEvent.direction || 'auto'} onChange={e => updateEvent({direction: e.target.value})}
              style={{background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 6px", color: C.text, fontSize: 11, flex: 1}}>
              {DIR_OPTS.map(({v, l}) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div style={{display: "flex", gap: 6, alignItems: "center"}}>
            <span style={{fontSize: 11, color: C.muted, minWidth: 36}}>Start:</span>
            <input type="number" step="0.01" value={activeEvent.tStart ?? 0}
              onChange={e => updateEvent({tStart: parseFloat(e.target.value) || 0})}
              style={{width: 70, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 8px", color: C.accent, fontSize: 11}}/>
            <span style={{fontSize: 11, color: C.muted}}>s</span>
            <Btn small onClick={() => updateEvent({tStart: +skelTime.toFixed(3)})} style={{fontSize: 10, padding: "2px 6px"}}>⏱ Set</Btn>
          </div>
          <div style={{display: "flex", gap: 6, alignItems: "center"}}>
            <span style={{fontSize: 11, color: C.muted, minWidth: 36}}>End:</span>
            <input type="number" step="0.01" value={activeEvent.tEnd ?? ''}
              placeholder={averagedEvData.length ? ((activeEvent.tStart || 0) + averagedEvData[averagedEvData.length - 1].time).toFixed(2) : 'auto'}
              onChange={e => { const v = e.target.value; updateEvent({tEnd: v === '' ? null : parseFloat(v) || 0}); }}
              style={{width: 70, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 8px", color: activeEvent.tEnd != null ? C.amber : C.muted, fontSize: 11}}/>
            <span style={{fontSize: 11, color: C.muted}}>s</span>
            <Btn small onClick={() => updateEvent({tEnd: +skelTime.toFixed(3)})} style={{fontSize: 10, padding: "2px 6px"}}>⏱ Set</Btn>
            {activeEvent.tEnd != null && <Btn small danger onClick={() => updateEvent({tEnd: null, timeSegments: []})}>✕</Btn>}
          </div>

          {/* Time normalization info */}
          {activeEvent.tEnd != null && (() => {
            const srcDur = averagedEvData.length ? averagedEvData[averagedEvData.length - 1].time : 0;
            const tgtDur = activeEvent.tEnd - (activeEvent.tStart || 0);
            const ratio = srcDur > 0 ? (tgtDur / srcDur).toFixed(2) : '—';
            return (
              <div style={{fontSize: 10, color: C.amber, background: C.amber + "12", padding: "6px 10px", borderRadius: 5, border: `1px solid ${C.amber}30`}}>
                <div style={{fontWeight: 600}}>Time Normalization Active</div>
                <div>Recorded: {srcDur.toFixed(2)}s → {tgtDur.toFixed(2)}s ({ratio}×)</div>
              </div>
            );
          })()}

          {/* Trials */}
          <div style={{fontSize: 11, color: C.muted, marginBottom: 2}}>Trials (WiDACS files):</div>
          <div style={{display: "flex", flexDirection: "column", gap: 3}}>
            {forceFilesList.map((f, fi) => {
              const sel = (activeEvent.fileIndices || []).includes(fi);
              return (
                <div key={fi} onClick={() => updateEvent({fileIndices: sel ? (activeEvent.fileIndices || []).filter(x => x !== fi) : [...(activeEvent.fileIndices || []), fi]})}
                  style={{display: "flex", alignItems: "center", gap: 7, padding: "4px 8px", borderRadius: 5, cursor: "pointer",
                    background: sel ? C.violet + "20" : "transparent", border: `1px solid ${sel ? C.violet : C.border}`}}>
                  <span style={{fontSize: 10, color: sel ? C.violet : C.muted}}>{sel ? "✓" : "○"}</span>
                  <span style={{fontSize: 11, color: sel ? C.text : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{f.name}</span>
                </div>
              );
            })}
            {forceFilesList.length === 0 && <div style={{fontSize: 11, color: C.muted, fontStyle: "italic"}}>No WiDACS files uploaded yet.</div>}
          </div>

          {/* Force preview chart */}
          {validTrials > 0 && (
            <>
              <div ref={fpChartRef} style={{height: isNormalized ? 150 : 120}}>
                <ResponsiveContainer>
                  {isNormalized ? (
                    <LineChart margin={{left: 0, right: 8, top: 4, bottom: 0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis type="number" dataKey="time" domain={["auto", "auto"]} tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="s"/>
                      <YAxis tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="N" width={44}/>
                      <Tooltip content={Tt}/>
                      <Line data={displayData} type="monotone" dataKey="force" stroke={C.muted} dot={false} strokeWidth={1} strokeDasharray="4 3" name="Original" opacity={0.5} isAnimationActive={false}/>
                      <Line data={displayNorm} type="monotone" dataKey="force" stroke={C.amber} dot={false} strokeWidth={2.5} name="Normalized" isAnimationActive={false}/>
                      <Legend wrapperStyle={{fontSize: 9}}/>
                    </LineChart>
                  ) : (
                    <LineChart data={displayData} margin={{left: 0, right: 8, top: 4, bottom: 0}}
                      onClick={e => { if (e?.activeLabel != null) setPlateauModal({t: e.activeLabel, f: e.activePayload?.[0]?.value ?? 0, durStr: activeEvent.plateauDur > 0 ? String(activeEvent.plateauDur) : '1'}); }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis dataKey="time" type="number" domain={["auto", "auto"]} tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="s"/>
                      <YAxis tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="N" width={44}/>
                      <Tooltip content={Tt}/>
                      {activeEvent.stopAt != null && <ReferenceLine x={activeEvent.stopAt} stroke={C.red} strokeWidth={1.5} strokeDasharray="4 2"/>}
                      {activeEvent.plateauT != null && <ReferenceLine x={activeEvent.plateauT} stroke={C.amber} strokeWidth={1.5} strokeDasharray="4 2"/>}
                      <Line type="monotone" dataKey="force" stroke={C.violet} dot={false} strokeWidth={2} name="Avg force" isAnimationActive={false}/>
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              <div style={{display: "flex", gap: 4, flexWrap: "wrap", fontSize: 10}}>
                <Btn small onClick={() => {
                  if (!averagedEvData.length) return;
                  const peakD = averagedEvData.reduce((a, b) => b.force > a.force ? b : a, averagedEvData[0]);
                  setPlateauModal({t: peakD.time, f: peakD.force, durStr: activeEvent.plateauDur > 0 ? String(activeEvent.plateauDur) : '1'});
                }}>Extend at peak</Btn>
                {activeEvent.stopAt != null
                  ? <Btn small danger onClick={() => updateEvent({stopAt: null})}>Clear stop</Btn>
                  : <Btn small onClick={() => { if (averagedEvData.length) { const last = averagedEvData[averagedEvData.length - 1]; updateEvent({stopAt: +(last.time * 0.8).toFixed(3)}); } }}>Set stop</Btn>}
                {(activeEvent.plateauT != null || activeEvent.stopAt != null) && (
                  <Btn small danger onClick={() => updateEvent({plateauT: null, plateauF: null, plateauDur: 0, stopAt: null})}>Reset all</Btn>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Plateau modal */}
      {plateauModal && activeEvent && (
        <div style={{position: "fixed", inset: 0, background: "#00000080", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center"}}
          onClick={() => setPlateauModal(null)}>
          <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, width: 320}} onClick={e => e.stopPropagation()}>
            <div style={{fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4}}>Extend Plateau</div>
            <div style={{fontSize: 12, color: C.muted, marginBottom: 14}}>
              At <b style={{color: C.accent}}>{plateauModal.t.toFixed(3)}s</b>, force = <b style={{color: C.violet}}>{plateauModal.f.toFixed(1)} N</b>
            </div>
            <input type="number" step="0.1" min={0} autoFocus value={plateauModal.durStr}
              onChange={e => setPlateauModal(m => ({...m, durStr: e.target.value}))}
              onKeyDown={e => {
                if (e.key === 'Enter') { const v = parseFloat(plateauModal.durStr); if (!isNaN(v) && v > 0) { setCurEvs(prev => prev.map(ev => ev.id === activeEventId ? {...ev, plateauT: plateauModal.t, plateauF: plateauModal.f, plateauDur: v} : ev)); setPlateauModal(null); } }
                if (e.key === 'Escape') setPlateauModal(null);
              }}
              style={{width: "100%", background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 14, boxSizing: "border-box", outline: "none", marginBottom: 16}}/>
            <div style={{display: "flex", gap: 8, justifyContent: "flex-end"}}>
              <Btn small onClick={() => setPlateauModal(null)}>Cancel</Btn>
              <Btn small active onClick={() => { const v = parseFloat(plateauModal.durStr); if (!isNaN(v) && v > 0) { setCurEvs(prev => prev.map(ev => ev.id === activeEventId ? {...ev, plateauT: plateauModal.t, plateauF: plateauModal.f, plateauDur: v} : ev)); setPlateauModal(null); } }}>Apply</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
