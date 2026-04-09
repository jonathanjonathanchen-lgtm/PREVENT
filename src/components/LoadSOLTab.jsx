// ── LoadSOLTab ───────────────────────────────────────────────────────────────

import { C } from '../utils/constants.js';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Btn, Stat, ChartCard, Spinner, EmptyState, FileBar, Tt } from './ui/index.js';
import { minMaxDecimateMulti, minMaxDecimate } from '../utils/decimation.js';
import useBiomechanicsStore from '../store/useBiomechanicsStore.js';

export default function LoadSOLTab({ openUpload, removeFile }) {
  const activeJob = useBiomechanicsStore(s => s.getActiveJob());
  const { filesLoading, showTriggerCh, setShowTriggerCh } = useBiomechanicsStore();
  const loadsolFiles = activeJob?.loadsolFiles || [];

  if (filesLoading) return <div style={{display: "flex", justifyContent: "center", padding: 60}}><Spinner size={32}/></div>;

  const renderOne = (lsf, label) => {
    // Min-max decimation instead of stride sampling
    const d = minMaxDecimateMulti(lsf.data, ['left', 'right'], 200);
    return (
      <div key={lsf.id} style={{marginBottom: 24}}>
        {label && <div style={{fontSize: 13, fontWeight: 600, color: C.accent, marginBottom: 10}}>{label}</div>}
        <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 14}}>
          <Stat label="Left Peak" value={lsf.stats.leftMax.toFixed(0)} unit="N"/>
          <Stat label="Right Peak" value={lsf.stats.rightMax.toFixed(0)} unit="N"/>
          <Stat label="XSENS Blip" value={lsf.blipTime?.toFixed(3) || "\u2014"} unit="s"
            color={lsf.blipTime ? C.amber : undefined} sub={lsf.blipTime ? "trigger detected" : "not detected"}/>
          <Stat label="Duration" value={(lsf.data[lsf.data.length - 1]?.time || 0).toFixed(1)} unit="s"/>
        </div>
        {lsf.blipTime && (
          <div style={{background: C.amber + "15", border: `1px solid ${C.amber}50`, borderLeft: `4px solid ${C.amber}`, borderRadius: 8, padding: "10px 16px", fontSize: 12, color: C.amber, marginBottom: 14, display: "flex", gap: 8, alignItems: "center"}}>
            <span style={{fontSize: 16}}>{"\u26A1"}</span>
            <span><b>XSENS sync blip at t = {lsf.blipTime.toFixed(3)}s</b> \u2014 area1 trigger channel spike detected.</span>
          </div>
        )}
        <ChartCard title="Ground Reaction Forces \u2014 Left & Right" h={260}>
          <ResponsiveContainer><LineChart data={d}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="time" tick={{fill: C.muted, fontSize: 10}} stroke={C.border} unit="s"/>
            <YAxis tick={{fill: C.muted, fontSize: 10}} stroke={C.border} unit="N"/>
            <Tooltip content={Tt}/><Legend wrapperStyle={{fontSize: 11}}/>
            {lsf.blipTime && <ReferenceLine x={lsf.blipTime} stroke={C.amber} strokeWidth={2.5} label={{value: "\u26A1 XSENS Start", fill: C.amber, fontSize: 11, position: "insideTopRight"}}/>}
            <Line type="monotone" dataKey="left" stroke={C.sky} dot={false} strokeWidth={2} name="Left Foot" isAnimationActive={false}/>
            <Line type="monotone" dataKey="right" stroke={C.rose} dot={false} strokeWidth={2} name="Right Foot" isAnimationActive={false}/>
          </LineChart></ResponsiveContainer>
        </ChartCard>
        {lsf.data.some(d => d.trig > 0) && (
          <div style={{marginTop: 8}}>
            <button onClick={() => setShowTriggerCh(v => !v)}
              style={{background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
                padding: "4px 10px", color: C.muted, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 6}}>
              <span style={{fontSize: 10}}>{showTriggerCh ? "\u25BC" : "\u25B6"}</span>
              Sync Trigger Channel (area1)
            </button>
            {showTriggerCh && (
              <ChartCard title="Sync Trigger Channel (area1)" h={140}>
                <ResponsiveContainer><AreaChart data={minMaxDecimate(lsf.data, 'trig', 200)}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="time" tick={{fill: C.muted, fontSize: 10}} stroke={C.border} unit="s"/>
                  <YAxis tick={{fill: C.muted, fontSize: 10}} stroke={C.border} unit="N"/>
                  <Tooltip content={Tt}/>
                  {lsf.blipTime && <ReferenceLine x={lsf.blipTime} stroke={C.amber} strokeWidth={2}/>}
                  <Area type="monotone" dataKey="trig" stroke={C.amber} fill={C.amber + "30"} strokeWidth={2} name="Trigger" dot={false}/>
                </AreaChart></ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
      {!loadsolFiles.length ? (
        <EmptyState icon={"\uD83D\uDC5F"} title="No LoadSOL data" detail="Upload LoadSOL TXT. The area1 trigger channel will auto-detect the XSENS sync blip."
          action={activeJob && <Btn active onClick={() => openUpload("loadsol")}>Upload LoadSOL TXT</Btn>}/>
      ) : loadsolFiles.map((lsf, i) => renderOne(lsf, loadsolFiles.length > 1 ? lsf.name : null))}
    </div>
  );
}
