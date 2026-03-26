import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  LineChart, Line, AreaChart, Area, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from "recharts";

// ── Supabase ─────────────────────────────────────────────────────────────────
// Replace with your values from https://app.supabase.com → Settings → API
const SUPABASE_URL  = "https://sxgmpqmnimvfwrfzvzst.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6VZcThL-U2X5Je73Xla3NQ_KAhKlOGi";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = "biomechanics-files";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  teal:"#0d9488", amber:"#d97706", rose:"#e11d48", sky:"#0284c7",
  violet:"#7c3aed", emerald:"#059669", orange:"#f97316", pink:"#ec4899",
  bg:"#0f172a", card:"#1e293b", border:"#334155",
  text:"#e2e8f0", muted:"#94a3b8", accent:"#2dd4bf", red:"#dc2626"
};
const CYCLE_COLORS = [C.teal, C.amber, C.rose, C.sky, C.violet, C.emerald, C.orange, C.pink];
const TABS = ["Overview","Skeleton","Cycles","LoadSOL","Forces","Dynamics","Jobs","Pipeline"];

// ── Skeleton bone fallback (Z-up XSENS: x=forward, y=left, z=up) ─────────────
const BONES = [
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],
  [4,7],[7,8],[8,9],[9,10],
  [4,11],[11,12],[12,13],[13,14],
  [0,15],[15,16],[16,17],[17,18],
  [0,19],[19,20],[20,21],[21,22]
];
const REF_POS = [
   0.000,  0.000, 1.031,  -0.054,  0.000, 1.105,  -0.054,  0.000, 1.185,
  -0.054,  0.000, 1.299,  -0.054,  0.000, 1.417,  -0.054,  0.000, 1.617,
  -0.054,  0.000, 1.708,  -0.054, -0.036, 1.541,  -0.054, -0.230, 1.541,
  -0.054, -0.518, 1.541,  -0.054, -0.748, 1.541,  -0.054,  0.036, 1.541,
  -0.054,  0.230, 1.541,  -0.054,  0.518, 1.541,  -0.054,  0.748, 1.541,
   0.000, -0.078, 1.031,   0.000, -0.078, 0.586,   0.000, -0.078, 0.144,
   0.187, -0.078, 0.061,   0.000,  0.078, 1.031,   0.000,  0.078, 0.586,
   0.000,  0.078, 0.144,   0.187,  0.078, 0.061,
];

// ── Key joints for clinical analysis ─────────────────────────────────────────
const KEY_JOINTS = [
  {r:/jl5s1/i,           lbl:"L4/L5 (jL5S1)",   plane:["FE","LB","AR"]},
  {r:/jl4l3/i,           lbl:"L3/L4 (jL4L3)",   plane:["FE","LB","AR"]},
  {r:/jl1t12/i,          lbl:"L1/T12",           plane:["FE","LB","AR"]},
  {r:/jt9t8/i,           lbl:"T8/T9 (jT9T8)",   plane:["FE","LB","AR"]},
  {r:/jrightshoulder$/i, lbl:"R Shoulder",       plane:["FE","AR","LB"]},
  {r:/jleftshoulder$/i,  lbl:"L Shoulder",       plane:["FE","AR","LB"]},
  {r:/jrightelbow/i,     lbl:"R Elbow",          plane:["FE","AR","LB"]},
  {r:/jleftelbow/i,      lbl:"L Elbow",          plane:["FE","AR","LB"]},
  {r:/jrighthip/i,       lbl:"R Hip",            plane:["FE","AR","LB"]},
  {r:/jlefthip/i,        lbl:"L Hip",            plane:["FE","AR","LB"]},
  {r:/jrightknee/i,      lbl:"R Knee",           plane:["FE","AR","LB"]},
  {r:/jleftknee/i,       lbl:"L Knee",           plane:["FE","AR","LB"]},
];
// ZXY Euler order from MVNX: index 0 = Z = LB/Abd, index 1 = X = AR/IE, index 2 = Y = FE
const PLANE_LABELS = ["LB","AR","FE"];
const PLANE_COLORS = [C.amber, C.rose, C.teal];
const PLANE_NAMES  = ["Lat Bend / Abd (°)","Axial Rot / IE (°)","Flex/Ext (°)"];

// ── MVNX Parser ───────────────────────────────────────────────────────────────
function parseMVNX(xmlStr) {
  try {
    const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
    if (doc.querySelector("parsererror")) return { ok:false, error:"XML parse error" };
    const subject = doc.querySelector("subject");
    const frameRate = parseFloat(subject?.getAttribute("frameRate") || "60");
    const segLabels = [];
    doc.querySelectorAll("segments > segment").forEach(s => segLabels.push(s.getAttribute("label")));
    const segIndex = Object.fromEntries(segLabels.map((l,i) => [l,i]));
    const jointLabels = [];
    const bones = [];
    doc.querySelectorAll("joints > joint").forEach(j => {
      jointLabels.push(j.getAttribute("label"));
      const c1 = j.querySelector("connector1")?.textContent?.split("/")?.[0];
      const c2 = j.querySelector("connector2")?.textContent?.split("/")?.[0];
      if (segIndex[c1] !== undefined && segIndex[c2] !== undefined)
        bones.push([segIndex[c1], segIndex[c2]]);
    });
    const frames = [];
    doc.querySelectorAll("frames > frame").forEach(f => {
      if (f.getAttribute("type") !== "normal") return;
      const ms = parseInt(f.getAttribute("time") || "0");
      const parse = sel => { const t = f.querySelector(sel)?.textContent?.trim()||""; return t ? t.split(/\s+/).map(Number) : []; };
      frames.push({ time: ms/1000, pos: parse("position"), ja: parse("jointAngle"),
        acc:    parse("acceleration"),
        angVel: parse("angularVelocity"),
        angAcc: parse("angularAcceleration") });
    });
    const duration = frames.length ? frames[frames.length-1].time : 0;
    return { ok:true, frameRate, segLabels, segIndex, jointLabels, bones, frames, duration };
  } catch(e) { return { ok:false, error:e.message }; }
}

// ── LoadSOL Parser ────────────────────────────────────────────────────────────
function parseLoadSOL(text) {
  try {
    const lines = text.split("\n").filter(l => l.trim());
    let dataStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].trim().split("\t");
      if (cols.length >= 5 && !isNaN(parseFloat(cols[0]))) { dataStart = i; break; }
    }
    const data = [];
    for (let i = dataStart; i < lines.length; i++) {
      const cols = lines[i].trim().split("\t");
      if (cols.length < 5) continue;
      const time  = parseFloat(cols[0]);
      const left  = Math.abs(parseFloat(cols[4])  || 0);
      const right = Math.abs(parseFloat(cols[9])  || 0);
      const trig  = Math.max(Math.abs(parseFloat(cols[11]) || 0), Math.abs(parseFloat(cols[12]) || 0));
      if (!isNaN(time)) data.push({ time, left, right, total: left+right, trig });
    }
    let blipTime = null;
    const trigValues = data.map(d => d.trig);
    const trigMax = Math.max(...trigValues);
    if (trigMax > 5) blipTime = data[trigValues.indexOf(trigMax)].time;
    const leftMax  = data.length ? Math.max(...data.map(d => d.left))  : 0;
    const rightMax = data.length ? Math.max(...data.map(d => d.right)) : 0;
    return { ok:true, data, blipTime, stats:{ leftMax, rightMax } };
  } catch(e) { return { ok:false, error:e.message }; }
}

// ── Force/WiDACS CSV Parser ───────────────────────────────────────────────────
function parseForceFile(text) {
  try {
    const lines = text.split("\n").filter(l => l.trim());
    let dataStart = 0;
    const dataIdx = lines.findIndex(l => l.trim().toUpperCase().startsWith("DATA:"));
    if (dataIdx >= 0) {
      dataStart = dataIdx + 2;
    } else {
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].trim().split(/[\t,]/);
        if (!isNaN(parseFloat(cols[0]))) { dataStart = i; break; }
      }
    }
    const data = [];
    for (let i = dataStart; i < lines.length; i++) {
      const cols = lines[i].trim().split(/[\t,]/);
      if (cols.length < 2) continue;
      const time = parseFloat(cols[0]);
      const force = parseFloat(cols[1]) || 0;
      if (!isNaN(time)) data.push({ time, force });
    }
    const peak = data.length ? Math.max(...data.map(d => d.force)) : 0;
    const peakTime = data.find(d => d.force === peak)?.time || 0;
    const impulse = data.length > 1
      ? data.slice(1).reduce((s,d,i) => s + (d.force + data[i].force)/2 * (d.time - data[i].time), 0)
      : 0;
    return { ok:true, data, stats:{ peak, peakTime, impulse: impulse.toFixed(2) } };
  } catch(e) { return { ok:false, error:e.message }; }
}

// ── Vector utilities (global frame, Z-up) ────────────────────────────────────
const vadd   = (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const vsub   = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const vscale = (v,s) => [v[0]*s, v[1]*s, v[2]*s];
const vneg   = a     => [-a[0],-a[1],-a[2]];
const vcross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vmag   = v     => Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
const vnorm  = v     => { const m=vmag(v)||1; return vscale(v,1/m); };
const vget   = (arr,i) => (arr?.length > i*3+2) ? [arr[i*3],arr[i*3+1],arr[i*3+2]] : [0,0,0];

// ── Winter (2009) segment parameters: [massFrac, comFracFromProx, kGyr] ──────
// Trunk mass distributed across XSENS spine segments
const WINTER = {
  Pelvis:[0.142,0.60,0.31], L5:[0.036,0.50,0.30], L3:[0.036,0.50,0.30],
  T12:[0.050,0.50,0.30],    T8:[0.085,0.50,0.30],  Neck:[0.012,0.50,0.30],
  Head:[0.081,0.58,0.495],
  RightShoulder:[0.009,0.50,0.30],  LeftShoulder:[0.009,0.50,0.30],
  RightUpperArm:[0.028,0.436,0.322],LeftUpperArm:[0.028,0.436,0.322],
  RightForearm: [0.016,0.430,0.303],LeftForearm: [0.016,0.430,0.303],
  RightHand:    [0.006,0.506,0.297],LeftHand:    [0.006,0.506,0.297],
  RightUpperLeg:[0.100,0.433,0.323],LeftUpperLeg:[0.100,0.433,0.323],
  RightLowerLeg:[0.046,0.433,0.302],LeftLowerLeg:[0.046,0.433,0.302],
  RightFoot:    [0.014,0.500,0.475],LeftFoot:    [0.014,0.500,0.475],
  RightToe:     [0.002,0.500,0.300],LeftToe:     [0.002,0.500,0.300],
};
// Each segment's geometrical distal reference (for CoM & length)
const SEG_DISTAL = {
  Pelvis:'L5', L5:'L3', L3:'T12', T12:'T8', T8:'Neck', Neck:'Head',
  RightShoulder:'RightUpperArm', RightUpperArm:'RightForearm', RightForearm:'RightHand',
  LeftShoulder:'LeftUpperArm',   LeftUpperArm:'LeftForearm',   LeftForearm:'LeftHand',
  RightUpperLeg:'RightLowerLeg', RightLowerLeg:'RightFoot', RightFoot:'RightToe',
  LeftUpperLeg:'LeftLowerLeg',   LeftLowerLeg:'LeftFoot',   LeftFoot:'LeftToe',
};

// ── Inverse Dynamics Engine (Newton-Euler, bottom-up) ────────────────────────
function computeInvDyn(mvnx, bodyMass, lsfData, forceData, forceOffset, forceDirKey) {
  if (!mvnx?.frames?.length || !(bodyMass > 0)) return [];
  const G  = [0, 0, -9.81];
  const si = mvnx.segIndex || {};

  // Mean segment lengths from first 10 frames
  const segLen = {};
  const refFrames = mvnx.frames.slice(0, Math.min(10, mvnx.frames.length)).filter(f => f.pos?.length);
  Object.entries(SEG_DISTAL).forEach(([seg, dSeg]) => {
    const pi = si[seg], di = si[dSeg];
    if (pi == null || di == null) return;
    const lens = refFrames.map(f => vmag(vsub(vget(f.pos,di), vget(f.pos,pi))));
    segLen[seg] = lens.reduce((a,b)=>a+b,0) / (lens.length||1) || 0.1;
  });

  // Solve one segment — returns proximal joint {F, M, r_prox}
  const solve = (label, F_dist, M_dist, r_dist_force, frame) => {
    const idx = si[label];
    if (idx == null) return { F:[0,0,0], M:[0,0,0], r_prox:[0,0,0] };
    const [mf, cf, kg] = WINTER[label] || [0.001,0.5,0.3];
    const m  = mf * bodyMass;
    const L  = segLen[label] || 0.1;
    const I  = m * Math.pow(kg * L, 2);
    const r_prox     = vget(frame.pos, idx);
    const dLabel     = SEG_DISTAL[label];
    const r_dist_geo = dLabel && si[dLabel] != null ? vget(frame.pos, si[dLabel]) : vadd(r_prox,[0,0,0.1]);
    const r_com      = vadd(r_prox, vscale(vsub(r_dist_geo, r_prox), cf));
    const a_com      = vget(frame.acc,    idx);
    const alpha      = vget(frame.angAcc, idx);
    // F equation: F_prox = m*(a-G) - F_dist
    const F_prox = vsub(vscale(vsub(a_com, G), m), F_dist);
    // M equation: M_prox = I*α - M_dist - (r_prox-r_com)×F_prox - (r_dist_force-r_com)×F_dist
    const ang_mom = vscale(alpha, I);
    const M_prox  = vsub(vsub(vsub(ang_mom, M_dist),
      vcross(vsub(r_prox,      r_com), F_prox)),
      vcross(vsub(r_dist_force,r_com), F_dist));
    return { F: F_prox, M: M_prox, r_prox };
  };

  // Linear interpolation helper
  const interp = (data, t, tKey, vKey) => {
    if (!data?.length) return 0;
    const i = data.findIndex(d => d[tKey] >= t);
    if (i <= 0) return data[0]?.[vKey] ?? 0;
    if (i >= data.length) return data[data.length-1]?.[vKey] ?? 0;
    const d0=data[i-1], d1=data[i], frac=(t-d0[tKey])/(d1[tKey]-d0[tKey]||1);
    return d0[vKey] + frac*(d1[vKey]-d0[vKey]);
  };
  const interpGRF = (t) => ({
    right: Math.max(0, interp(lsfData, t, 'time', 'right')),
    left:  Math.max(0, interp(lsfData, t, 'time', 'left')),
  });
  const interpF = (t) => Math.max(0, interp(forceData, t - forceOffset, 'time', 'force'));

  const stride = Math.max(1, Math.floor(mvnx.frames.length / 200));
  const results = [];

  mvnx.frames.forEach((frame, fi) => {
    if (fi % stride !== 0 || !frame.pos?.length) return;
    const t   = frame.time;
    const grf = interpGRF(t);
    const wF  = interpF(t);

    // ── Legs (bottom-up) ──
    const leg = (side) => {
      const UL=`${side}UpperLeg`, LL=`${side}LowerLeg`, FT=`${side}Foot`, TOE=`${side}Toe`;
      const grfVal = side==='Right' ? grf.right : grf.left;
      const r_toe  = vget(frame.pos, si[TOE] ?? si[FT]);
      const foot   = solve(FT,  [0,0,grfVal], [0,0,0],   r_toe,        frame);
      const shank  = solve(LL,  vneg(foot.F), vneg(foot.M), foot.r_prox, frame);
      const thigh  = solve(UL,  vneg(shank.F),vneg(shank.M),shank.r_prox,frame);
      return { foot, shank, thigh };
    };
    const R = leg('Right'), L = leg('Left');

    // ── Pelvis (dual hip inputs) ──
    const r_pelvis = vget(frame.pos, si['Pelvis']);
    const r_L5S1   = si['L5'] != null ? vget(frame.pos, si['L5']) : vadd(r_pelvis,[0,0,0.1]);
    const [mfP,cfP,kgP] = WINTER['Pelvis'];
    const m_p  = mfP * bodyMass;
    const I_p  = m_p * Math.pow(kgP*(segLen['Pelvis']||0.15), 2);
    const r_com_p = vadd(r_pelvis, vscale(vsub(r_L5S1, r_pelvis), cfP));
    const a_p  = vget(frame.acc, si['Pelvis']);
    const al_p = vget(frame.angAcc, si['Pelvis']);
    // Both hip forces act ON pelvis (Newton 3rd of thigh proximal)
    const F_hR  = vneg(R.thigh.F), M_hR = vneg(R.thigh.M);
    const F_hL  = vneg(L.thigh.F), M_hL = vneg(L.thigh.M);
    const r_hR  = vget(frame.pos, si['RightUpperLeg']);
    const r_hL  = vget(frame.pos, si['LeftUpperLeg']);
    // F_L5S1 = m*(a-G) - F_hR - F_hL
    const F_L5S1 = vsub(vsub(vscale(vsub(a_p,G),m_p), F_hR), F_hL);
    const ang_p  = vscale(al_p, I_p);
    const tau_p  = vadd(vadd(
      vcross(vsub(r_L5S1,r_com_p), F_L5S1),
      vcross(vsub(r_hR,  r_com_p), F_hR)),
      vadd(vcross(vsub(r_hL,r_com_p), F_hL), vadd(M_hR, M_hL)));
    const M_L5S1 = vsub(ang_p, tau_p);

    // ── Spine (upward from L5S1) ──
    const sp_L5  = solve('L5',  vneg(F_L5S1), vneg(M_L5S1), r_L5S1,      frame);
    const sp_L3  = solve('L3',  vneg(sp_L5.F),vneg(sp_L5.M),sp_L5.r_prox,frame);
    const sp_T12 = solve('T12', vneg(sp_L3.F),vneg(sp_L3.M),sp_L3.r_prox,frame);

    // ── Right arm top-down (WiDACS) ──
    let arm = null;
    if (forceData?.length && si['RightHand'] != null) {
      const r_wrist  = vget(frame.pos, si['RightHand']);
      const r_elbow  = vget(frame.pos, si['RightForearm'] ?? si['RightUpperArm']);
      const handDir  = vnorm(vsub(r_wrist, r_elbow));
      const r_app    = vadd(r_wrist, vscale(handDir, 0.10));
      const dirs     = {'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1]};
      const fDir     = dirs[forceDirKey] || handDir;
      const F_app    = vscale(fDir, wF);
      const h = solve('RightHand',    F_app,         [0,0,0],     r_app,       frame);
      const f = solve('RightForearm', vneg(h.F),     vneg(h.M),   h.r_prox,    frame);
      const u = solve('RightUpperArm',vneg(f.F),     vneg(f.M),   f.r_prox,    frame);
      arm = { wrist:h.M, elbow:f.M, shoulder:u.M };
    }

    // Convert 3D global moment → FE/LB/AR
    // Z-up global: X≈forward, Y≈left/right, Z=up
    // FE ≈ rot about Y-axis (M[1]), LB ≈ rot about X-axis (M[0]), AR ≈ rot about Z-axis (M[2])
    const fmt = M => ({ FE:+M[1].toFixed(1), LB:+M[0].toFixed(1), AR:+M[2].toFixed(1) });

    results.push({
      t:       +t.toFixed(3),
      ankleR:  fmt(R.foot.M),   ankleL: fmt(L.foot.M),
      kneeR:   fmt(R.shank.M),  kneeL:  fmt(L.shank.M),
      hipR:    fmt(R.thigh.M),  hipL:   fmt(L.thigh.M),
      L5S1:    fmt(M_L5S1),
      L4L3:    fmt(sp_L5.M),
      L1T12:   fmt(sp_L3.M),
      T9T8:    fmt(sp_T12.M),
      ...(arm ? { wristR:fmt(arm.wrist), elbowR:fmt(arm.elbow), shoulderR:fmt(arm.shoulder) } : {}),
    });
  });
  return results;
}

// ── Skeleton projection (XSENS Z-up) ─────────────────────────────────────────
function projectPos(flatPos, view, W, H) {
  const pts = [];
  for (let i = 0; i+2 < flatPos.length; i += 3) {
    const [x,y,z] = [flatPos[i], flatPos[i+1], flatPos[i+2]];
    if (view==="front") pts.push([y,z]);
    else if (view==="side") pts.push([x,z]);
    else pts.push([y,x]);
  }
  if (!pts.length) return [];
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  const [mnX,mxX]=[Math.min(...xs),Math.max(...xs)];
  const [mnY,mxY]=[Math.min(...ys),Math.max(...ys)];
  const pad=30;
  const sc=Math.min((W-2*pad)/((mxX-mnX)||0.5),(H-2*pad)/((mxY-mnY)||2.0));
  const ox=W/2-(mnX+mxX)/2*sc, oy=H/2+(mnY+mxY)/2*sc;
  return pts.map(([px,py])=>[px*sc+ox, oy-py*sc]);
}

// ── UI Atoms ──────────────────────────────────────────────────────────────────
const Stat = ({label,value,unit,sub,color}) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 16px"}}>
    <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{label}</div>
    <div style={{fontSize:22,fontWeight:700,color:color||C.text}}>
      {value}<span style={{fontSize:13,color:C.muted,marginLeft:4}}>{unit}</span>
    </div>
    {sub&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>{sub}</div>}
  </div>
);

const ChartCard = ({title,children,h=280,action}) => (
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:16,marginBottom:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div style={{fontSize:12,fontWeight:600,color:C.accent,textTransform:"uppercase",letterSpacing:.5}}>{title}</div>
      {action}
    </div>
    <div style={{height:h}}>{children}</div>
  </div>
);

const Tt = ({active,payload,label}) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:"#0f172aee",border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",fontSize:12}}>
      <div style={{color:C.muted,marginBottom:4}}>{typeof label==="number"?label.toFixed(2):label}s</div>
      {payload.map((p,i)=><div key={i} style={{color:p.color}}>{p.name}: <b>{typeof p.value==="number"?p.value.toFixed(2):p.value}</b></div>)}
    </div>
  );
};

const Btn = ({onClick,children,active,danger,small,style:sx={}}) => (
  <button onClick={onClick} style={{
    padding:small?"4px 10px":"6px 14px",borderRadius:6,cursor:"pointer",
    fontSize:small?11:12,fontWeight:active?600:400,
    border:`1px solid ${danger?C.red:active?C.accent:C.border}`,
    background:danger?"#dc262618":active?C.accent+"20":"transparent",
    color:danger?C.red:active?C.accent:C.muted,...sx
  }}>{children}</button>
);

const Modal = ({title,onClose,children,width=520}) => (
  <div style={{position:"fixed",inset:0,background:"#000000bb",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,width:"100%",maxWidth:width,maxHeight:"85vh",overflow:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text}}>{title}</div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
      </div>
      <div style={{padding:20}}>{children}</div>
    </div>
  </div>
);

const EmptyState = ({icon,title,detail,action}) => (
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:48,textAlign:"center",color:C.muted,minHeight:280}}>
    <div style={{fontSize:38,marginBottom:12}}>{icon}</div>
    <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:8}}>{title}</div>
    <div style={{fontSize:12,marginBottom:20,maxWidth:360}}>{detail}</div>
    {action}
  </div>
);

const Spinner = ({size=24,color=C.accent}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{animation:"spin 0.8s linear infinite"}}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <circle cx="12" cy="12" r="10" fill="none" stroke={C.border} strokeWidth="3"/>
    <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

const FileBar = ({job, onUpload, onRemove}) => {
  if (!job) return null;
  const Chip = ({color,label,onX,onAdd}) => (
    <div onClick={onAdd} style={{
      display:"flex",alignItems:"center",gap:5,fontSize:11,padding:"3px 9px",
      borderRadius:12,cursor:onAdd?"pointer":"default",
      background:onAdd?"transparent":color+"18",
      border:`1px solid ${onAdd?C.border:color+"60"}`,
      color:onAdd?C.muted:color,whiteSpace:"nowrap"
    }}>
      <span>{label}</span>
      {onX&&<span onClick={e=>{e.stopPropagation();onX();}} style={{cursor:"pointer",opacity:.7,fontSize:15,lineHeight:1,marginLeft:2}}>×</span>}
    </div>
  );
  return (
    <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
      <span style={{fontSize:11,color:C.muted,marginRight:2}}>Files:</span>
      {job.mvnxFiles.map((f,i)=>(
        <Chip key={i} color={C.teal} label={f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i,"")}
          onX={()=>onRemove("mvnx",i)}/>
      ))}
      <Chip color={C.teal} label="+ MVNX" onAdd={()=>onUpload("mvnx")}/>
      {(job.loadsolFiles||[]).map((f,i)=>(
        <Chip key={i} color={C.sky} label={f.name} onX={()=>onRemove("loadsol",i)}/>
      ))}
      <Chip color={C.sky} label="+ LoadSOL" onAdd={()=>onUpload("loadsol")}/>
      {job.forceFile
        ? <Chip color={C.violet} label={job.forceFile.name} onX={()=>onRemove("force")}/>
        : <Chip color={C.violet} label="+ Force CSV" onAdd={()=>onUpload("force")}/>}
    </div>
  );
};

// ── Login / Register Screen ───────────────────────────────────────────────────
function LoginScreen() {
  const [mode,     setMode]     = useState("login"); // "login" | "register"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false); // registration email sent

  const inp = (val, set, type="text", placeholder="") => (
    <input type={type} value={val} onChange={e=>set(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,
        padding:"10px 14px",color:C.text,fontSize:14,boxSizing:"border-box",marginBottom:12,outline:"none"}}/>
  );

  const submit = async () => {
    setError(""); setLoading(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setDone(true);
    }
    setLoading(false);
  };

  return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:400,padding:16}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:10,color:C.accent,textTransform:"uppercase",letterSpacing:3,marginBottom:6}}>OBEL · UWaterloo</div>
          <div style={{fontSize:24,fontWeight:700,color:C.text,marginBottom:6}}>Biomechanics Dashboard</div>
          <div style={{fontSize:13,color:C.muted}}>MVNX · LoadSOL · WiDACS · Cycle Analysis</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:28}}>
          {done ? (
            <div style={{textAlign:"center",color:C.accent}}>
              <div style={{fontSize:30,marginBottom:12}}>✓</div>
              <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>Check your email</div>
              <div style={{fontSize:12,color:C.muted}}>A confirmation link has been sent to {email}. Click it to activate your account, then sign in.</div>
              <div style={{marginTop:18}}><Btn active onClick={()=>{setMode("login");setDone(false);}}>Back to Sign In</Btn></div>
            </div>
          ) : (
            <>
              <div style={{display:"flex",gap:4,marginBottom:22,background:C.bg,borderRadius:8,padding:3}}>
                {["login","register"].map(m=>(
                  <button key={m} onClick={()=>{setMode(m);setError("");}}
                    style={{flex:1,padding:"7px",borderRadius:6,border:"none",cursor:"pointer",
                      background:mode===m?C.card:"transparent",color:mode===m?C.accent:C.muted,
                      fontSize:12,fontWeight:mode===m?600:400}}>
                    {m==="login"?"Sign In":"Register"}
                  </button>
                ))}
              </div>
              {inp(email,setEmail,"email","Email address")}
              {inp(password,setPassword,"password","Password")}
              {error&&<div style={{fontSize:12,color:C.red,marginBottom:12,padding:"8px 12px",background:C.red+"15",borderRadius:6}}>{error}</div>}
              <button onClick={submit} disabled={loading||!email||!password}
                style={{width:"100%",padding:"11px",borderRadius:8,border:"none",cursor:loading?"wait":"pointer",
                  background:C.accent,color:C.bg,fontSize:14,fontWeight:700,opacity:(loading||!email||!password)?0.6:1}}>
                {loading ? "..." : mode==="login" ? "Sign In" : "Create Account"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Auth Wrapper ──────────────────────────────────────────────────────────────
export default function App() {
  const [session,     setSession]     = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <Spinner size={36}/>
    </div>
  );
  if (!session) return <LoginScreen/>;
  return <Dashboard session={session}/>;
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
function Dashboard({ session }) {
  const [jobs,        setJobs]        = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [tab,         setTab]         = useState(0);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [filesLoading,setFilesLoading]= useState(false);
  const [loadingMsg,   setLoadingMsg]  = useState("");

  // Modals
  const [showJobModal,    setShowJobModal]    = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newJobName,      setNewJobName]      = useState("");
  const [uploadType,      setUploadType]      = useState("mvnx");

  // Job rename
  const [editingJobId,   setEditingJobId]   = useState(null);
  const [editingJobName, setEditingJobName] = useState("");

  // Skeleton
  const [skelFrame,      setSkelFrame]      = useState(0);
  const [skelView,       setSkelView]       = useState("front");
  const [skelFileIdx,    setSkelFileIdx]    = useState(0);
  const [skelPlaying,    setSkelPlaying]    = useState(false);
  const [skelSpeed,      setSkelSpeed]      = useState(1);
  const [skelLoadsolIdx, setSkelLoadsolIdx] = useState(0);
  const [loadsolPairings,setLoadsolPairings]= useState({});
  const [jointPanels, setJointPanels] = useState([{jointKey:0, planes:4}]); // bit2=FE default

  // Cycles
  const [cycleJointKey, setCycleJointKey] = useState(0);

  // Dynamics
  const [bodyMass,    setBodyMass]    = useState(75);
  const [forceDirKey, setForceDirKey] = useState('hand');

  // Forces / settings
  const [forceOffset,    setForceOffset]    = useState(0);
  const [extendDuration, setExtendDuration] = useState(0);
  const [forceBlocks,    setForceBlocks]    = useState([]);
  const [showBlockForm,  setShowBlockForm]  = useState(false);
  const [blockDraft,     setBlockDraft]     = useState({t0:"",t1:"",force:"",label:""});

  const fileInputRef       = useRef();
  const loadedJobsRef      = useRef(new Set());
  const readyToSaveRef     = useRef(false);

  const activeJob = jobs.find(j => j.id === activeJobId);

  // ── Load all jobs on mount ────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setJobsLoading(true);
      const { data } = await supabase
        .from("jobs")
        .select("*, job_files(*)")
        .order("created_at", { ascending: false });
      if (data) {
        setJobs(data.map(j => ({
          ...j,
          createdAt: new Date(j.created_at).toLocaleDateString(),
          mvnxFiles: [],
          loadsolFiles: [],
          forceFile: null,
          _fileRecords: j.job_files || [],
        })));
      }
      setJobsLoading(false);
    };
    load();
  }, []);

  // ── Lazy-load files when a job is selected ────────────────────────────────
  useEffect(() => {
    if (!activeJobId) return;
    if (loadedJobsRef.current.has(activeJobId)) {
      // Already loaded — restore settings
      loadSettings(activeJobId);
      return;
    }
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;

    loadedJobsRef.current.add(activeJobId);

    const records = job._fileRecords || [];
    if (!records.length) {
      loadSettings(activeJobId);
      return;
    }

    const doLoad = async () => {
      setFilesLoading(true);
      readyToSaveRef.current = false;

      const dl = async (name, path) => {
        setLoadingMsg(`Downloading ${name}…`);
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error || !data) return null;
        setLoadingMsg(`Parsing ${name}…`);
        return await data.text();
      };

      const mvnxRecs = records.filter(r => r.file_type === "mvnx").sort((a,b) => a.sort_order - b.sort_order);
      const lsRecs   = records.filter(r => r.file_type === "loadsol").sort((a,b) => a.sort_order - b.sort_order);
      const fRec     = records.find(r => r.file_type === "force");

      const total = mvnxRecs.length + lsRecs.length + (fRec?1:0);
      let done = 0;

      const mvnxFiles = [];
      for (const rec of mvnxRecs) {
        const text = await dl(`${rec.file_name} (${++done}/${total})`, rec.storage_path);
        if (!text) continue;
        const p = parseMVNX(text);
        if (p.ok) mvnxFiles.push({ id: rec.id, storagePath: rec.storage_path, name: rec.file_name, ...p });
      }

      const loadsolFiles = [];
      for (const lsRec of lsRecs) {
        const text = await dl(`${lsRec.file_name} (${++done}/${total})`, lsRec.storage_path);
        if (text) {
          const p = parseLoadSOL(text);
          if (p.ok) loadsolFiles.push({ id: lsRec.id, storagePath: lsRec.storage_path, name: lsRec.file_name, ...p });
        }
      }

      let forceFile = null;
      if (fRec) {
        const text = await dl(`${fRec.file_name} (${++done}/${total})`, fRec.storage_path);
        if (text) {
          const p = parseForceFile(text);
          if (p.ok) forceFile = { id: fRec.id, storagePath: fRec.storage_path, name: fRec.file_name, ...p };
        }
      }

      setJobs(prev => prev.map(j => j.id === activeJobId ? { ...j, mvnxFiles, loadsolFiles, forceFile } : j));
      setFilesLoading(false);
      setLoadingMsg("");
      await loadSettings(activeJobId);
    };

    doLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId, jobs.length]);

  // ── Load settings for active job ──────────────────────────────────────────
  const loadSettings = async (jobId) => {
    readyToSaveRef.current = false;
    setForceOffset(0); setExtendDuration(0); setForceBlocks([]);
    setJointPanels([{jointKey:0, planes:4}]);
    setSkelFrame(0); setSkelFileIdx(0); setSkelPlaying(false);
    setSkelLoadsolIdx(0); setLoadsolPairings({});
    setBodyMass(75); setForceDirKey('hand');

    const { data } = await supabase
      .from("job_settings")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();

    if (data) {
      setForceOffset(data.force_offset || 0);
      setExtendDuration(data.extend_duration || 0);
      setForceBlocks(data.force_blocks || []);
      if (data.joint_panels?.length) {
        setJointPanels(data.joint_panels.map(p => ({
          ...p,
          planes: typeof p.planes === 'number' ? p.planes : (p.planes || [0]).reduce((m,x) => m|(1<<x), 0),
        })));
      }
      if (data.loadsol_pairings) setLoadsolPairings(data.loadsol_pairings);
      if (data.body_mass > 0)   setBodyMass(data.body_mass);
      if (data.force_dir_key)   setForceDirKey(data.force_dir_key);
    }
    // Short delay so the save effect doesn't fire immediately after loading
    setTimeout(() => { readyToSaveRef.current = true; }, 600);
  };

  // ── Auto-save settings when they change ──────────────────────────────────
  useEffect(() => {
    if (!activeJobId || !readyToSaveRef.current) return;
    const timer = setTimeout(() => {
      supabase.from("job_settings").upsert({
        job_id: activeJobId,
        force_offset: forceOffset,
        extend_duration: extendDuration,
        force_blocks: forceBlocks,
        joint_panels: jointPanels,
        loadsol_pairings: loadsolPairings,
        body_mass: bodyMass,
        force_dir_key: forceDirKey,
        updated_at: new Date().toISOString(),
      }, { onConflict: "job_id" });
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeJobId, forceOffset, extendDuration, forceBlocks, jointPanels, loadsolPairings, bodyMass, forceDirKey]);

  // ── Job helpers ───────────────────────────────────────────────────────────
  const createJob = async () => {
    if (!newJobName.trim()) return;
    const { data, error } = await supabase
      .from("jobs")
      .insert({ name: newJobName.trim() })
      .select()
      .single();
    if (error) { alert("Create job error: " + error.message); return; }
    if (data) {
      const job = { ...data, createdAt: new Date(data.created_at).toLocaleDateString(), mvnxFiles: [], loadsolFiles: [], forceFile: null, _fileRecords: [] };
      setJobs(prev => [job, ...prev]);
      setActiveJobId(data.id);
      loadedJobsRef.current.add(data.id);
      readyToSaveRef.current = true;
    }
    setNewJobName(""); setShowJobModal(false);
  };

  const renameJob = async (jobId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await supabase.from("jobs").update({ name: trimmed }).eq("id", jobId);
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, name: trimmed } : j));
  };

  const deleteJob = async (jobId) => {
    // Storage files cascade-deleted via DB → storage cleanup handled separately
    await supabase.from("jobs").delete().eq("id", jobId);
    setJobs(prev => prev.filter(j => j.id !== jobId));
    loadedJobsRef.current.delete(jobId);
    if (activeJobId === jobId) setActiveJobId(null);
  };

  const openUpload = (type) => { setUploadType(type); setShowUploadModal(true); };

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !activeJobId) return;
    e.target.value = "";
    setShowUploadModal(false);

    for (const file of files) {
      const text = await file.text();
      const storagePath = `${activeJobId}/${uploadType}/${Date.now()}_${file.name}`;

      // Parse first — bail if invalid
      let parsed;
      if (uploadType === "mvnx")    parsed = parseMVNX(text);
      else if (uploadType === "loadsol") parsed = parseLoadSOL(text);
      else                               parsed = parseForceFile(text);
      if (!parsed.ok) { alert(`Parse error in ${file.name}: ${parsed.error}`); continue; }

      // Upload raw file to storage
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file);
      if (upErr) { alert(`Upload error: ${upErr.message}`); continue; }

      // Store metadata in DB
      const sortOrder = uploadType === "mvnx" ? (activeJob?.mvnxFiles?.length || 0) : 0;
      const { data: rec, error: dbErr } = await supabase.from("job_files").insert({
        job_id: activeJobId,
        file_type: uploadType,
        file_name: file.name,
        storage_path: storagePath,
        sort_order: sortOrder,
        metadata: uploadType === "mvnx"
          ? { frameRate: parsed.frameRate, duration: parsed.duration }
          : uploadType === "loadsol"
          ? { blipTime: parsed.blipTime, stats: parsed.stats }
          : { stats: parsed.stats },
      }).select().single();
      if (dbErr) continue;

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.id !== activeJobId) return j;
        const f = { id: rec.id, storagePath, name: file.name, ...parsed };
        if (uploadType === "mvnx")    return { ...j, mvnxFiles: [...j.mvnxFiles, f], _fileRecords: [...j._fileRecords, rec] };
        if (uploadType === "loadsol") return { ...j, loadsolFiles: [...(j.loadsolFiles||[]), f], _fileRecords: [...j._fileRecords, rec] };
        return { ...j, forceFile: f, _fileRecords: [...j._fileRecords, rec] };
      }));
    }
  }, [activeJobId, uploadType, activeJob]);

  // ── File remove ───────────────────────────────────────────────────────────
  const removeFile = useCallback(async (type, idx) => {
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;
    let fileObj;
    if (type === "mvnx")    fileObj = job.mvnxFiles[idx];
    if (type === "loadsol") fileObj = job.loadsolFiles[idx];
    if (type === "force")   fileObj = job.forceFile;
    if (!fileObj) return;

    if (fileObj.storagePath) await supabase.storage.from(BUCKET).remove([fileObj.storagePath]);
    if (fileObj.id) await supabase.from("job_files").delete().eq("id", fileObj.id);

    setJobs(prev => prev.map(j => {
      if (j.id !== activeJobId) return j;
      if (type === "mvnx")    return { ...j, mvnxFiles: j.mvnxFiles.filter((_,i) => i !== idx) };
      if (type === "loadsol") return { ...j, loadsolFiles: j.loadsolFiles.filter((_,i) => i !== idx) };
      return { ...j, forceFile: null };
    }));
  }, [activeJobId, jobs]);

  // ── Skeleton animation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!skelPlaying) return;
    const mvnx = activeJob?.mvnxFiles?.[skelFileIdx];
    if (!mvnx?.frames?.length) return;
    const id = setInterval(() => {
      setSkelFrame(f => { const n=f+1; if(n>=mvnx.frames.length){setSkelPlaying(false);return 0;} return n; });
    }, 1000/((mvnx.frameRate||60)*skelSpeed));
    return () => clearInterval(id);
  }, [skelPlaying, activeJob, skelFileIdx, skelSpeed]);

  // ── Derived force data ────────────────────────────────────────────────────
  const shiftedForce = useMemo(() => {
    const ff = activeJob?.forceFile;
    if (!ff?.data) return [];
    return ff.data.map(d => ({...d, time:+(d.time+forceOffset).toFixed(3)}));
  }, [activeJob, forceOffset]);

  const extendedForce = useMemo(() => {
    const ff = activeJob?.forceFile;
    if (!ff?.data?.length || extendDuration <= 0) return null;
    const peak = ff.stats.peak;
    const threshold = peak * 0.35;
    let susEnd = 0;
    for (let i = ff.data.length-1; i >= 0; i--) {
      if (ff.data[i].force > threshold) { susEnd = i; break; }
    }
    if (susEnd <= 0) return null;
    const susSlice = ff.data.slice(0, susEnd+1).filter(d => d.force > threshold);
    const susForce = susSlice.reduce((s,d) => s+d.force, 0) / susSlice.length;
    const dt = ff.data.length > 1 ? ff.data[1].time - ff.data[0].time : 0.002;
    const n = Math.round(extendDuration / dt);
    const base = ff.data[susEnd].time + forceOffset;
    return Array.from({length:n}, (_,i) => ({time:+(base+(i+1)*dt).toFixed(3), force:+susForce.toFixed(1), ext:true}));
  }, [activeJob, forceOffset, extendDuration]);

  // Memoised joint panel data — only recomputes when panels or MVNX file changes,
  // NOT on every skelFrame tick. This prevents Recharts from reinitialising every frame.
  const activeSkelMvnx = activeJob?.mvnxFiles?.[skelFileIdx];
  const panelData = useMemo(() => {
    const mvnx = activeSkelMvnx;
    if (!mvnx?.frames?.length) return jointPanels.map(() => []);
    return jointPanels.map(panel => {
      const def = KEY_JOINTS[panel.jointKey];
      const ji  = mvnx.jointLabels?.findIndex(l => def.r.test(l));
      if (ji == null || ji < 0) return [];
      const stride = Math.max(1, Math.floor(mvnx.frames.length / 200));
      return mvnx.frames.filter((_,i) => i % stride === 0).map(f => ({
        t: +f.time.toFixed(2),
        ...(panel.planes & 1 ? {LB: +(f.ja?.[ji*3]   ?? 0).toFixed(2)} : {}),  // Z = Lat Bend
        ...(panel.planes & 2 ? {AR: +(f.ja?.[ji*3+1] ?? 0).toFixed(2)} : {}),  // X = Axial Rot
        ...(panel.planes & 4 ? {FE: +(f.ja?.[ji*3+2] ?? 0).toFixed(2)} : {}),  // Y = Flex/Ext
      }));
    });
  }, [jointPanels, activeSkelMvnx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active LoadSOL (paired with current MVNX cycle)
  const lsfIdx = loadsolPairings[skelFileIdx] ?? skelLoadsolIdx;
  const activeLsf = activeJob?.loadsolFiles?.[lsfIdx] || activeJob?.loadsolFiles?.[0] || null;

  // Clipped LoadSOL data aligned to XSENS t=0
  const clippedLsf = useMemo(() => {
    if (!activeLsf?.data?.length) return null;
    if (activeLsf.blipTime == null) return activeLsf.data;
    return activeLsf.data
      .filter(d => d.time >= activeLsf.blipTime)
      .map(d => ({...d, time: +(d.time - activeLsf.blipTime).toFixed(3)}));
  }, [activeLsf]);

  // Inverse dynamics — recomputes only when inputs change, NOT per frame
  const invDynData = useMemo(() =>
    computeInvDyn(activeSkelMvnx, bodyMass, clippedLsf, activeJob?.forceFile?.data, forceOffset, forceDirKey),
  [activeSkelMvnx, bodyMass, clippedLsf, activeJob?.forceFile, forceOffset, forceDirKey]); // eslint-disable-line

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 0 — OVERVIEW
  // ════════════════════════════════════════════════════════════════════════════
  const renderOverview = () => {
    const hasMvnx = !!activeJob?.mvnxFiles?.length;
    const hasLS   = !!activeJob?.loadsolFiles?.length;
    const hasF    = !!activeJob?.forceFile;
    const sc = (ok,label,detail) => (
      <div style={{background:ok?C.accent+"12":C.card,border:`1px solid ${ok?C.accent+"50":C.border}`,borderRadius:8,padding:"10px 14px"}}>
        <div style={{fontSize:12,fontWeight:600,color:ok?C.accent:C.muted,marginBottom:2}}>{ok?"✓ ":"○ "}{label}</div>
        <div style={{fontSize:11,color:C.muted}}>{detail}</div>
      </div>
    );

    if (filesLoading) return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:300,gap:14}}>
        <Spinner size={32}/>
        <div style={{fontSize:13,color:C.muted}}>{loadingMsg || "Loading files from cloud…"}</div>
      </div>
    );

    return (
      <div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:18}}>
          {sc(hasMvnx,"MVNX",hasMvnx?`${activeJob.mvnxFiles.length} cycle(s)`:"Upload .mvnx")}
          {sc(hasLS,"LoadSOL",hasLS?`${activeJob.loadsolFiles.length} file(s)`:"Upload TXT")}
          {sc(hasF,"Force",hasF?activeJob.forceFile.name:"Upload CSV")}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:18}}>
          <Stat label="MVNX Cycles"    value={activeJob?.mvnxFiles?.length||"—"} unit="files"/>
          <Stat label="Trial Duration" value={activeJob?.mvnxFiles?.[0]?.duration?.toFixed(1)||"—"} unit="s"/>
          <Stat label="GRF Peak (R)"   value={activeJob?.loadsolFiles?.[0]?.stats?.rightMax?.toFixed(0)||"—"} unit="N"/>
          <Stat label="Force Peak"     value={activeJob?.forceFile?.stats?.peak?.toFixed(1)||"—"} unit="N"/>
          <Stat label="XSENS Blip"     value={activeJob?.loadsolFiles?.[0]?.blipTime?.toFixed(3)||"—"} unit="s"
            sub="sync marker" color={activeJob?.loadsolFiles?.[0]?.blipTime?C.amber:undefined}/>
        </div>
        {!activeJobId ? (
          <EmptyState icon="🗂" title="No job selected" detail="Create or select a job to get started."
            action={<Btn active onClick={()=>setShowJobModal(true)}>Create Job</Btn>}/>
        ) : !hasMvnx ? (
          <EmptyState icon="📁" title="No data loaded" detail="Upload MVNX, LoadSOL TXT, and force CSV."
            action={<Btn active onClick={()=>openUpload("mvnx")}>Upload Files</Btn>}/>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {(()=>{
              const mvnx = activeJob.mvnxFiles[0];
              const ji = mvnx.jointLabels?.findIndex(l => /jl5s1/i.test(l)) ?? 0;
              const stride = Math.max(1, Math.floor(mvnx.frames.length/150));
              const d = mvnx.frames.filter((_,i) => i%stride===0).map(f => ({t:+f.time.toFixed(2), fe:+(f.ja?.[ji*3+2]??0).toFixed(2)}));
              return <ChartCard title="L4/L5 Flex/Ext" h={180}><ResponsiveContainer><LineChart data={d}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="t" tick={{fill:C.muted,fontSize:9}} stroke={C.border}/><YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="°"/><Tooltip content={Tt}/><Line type="monotone" dataKey="fe" stroke={C.teal} dot={false} strokeWidth={1.5} name="FE"/></LineChart></ResponsiveContainer></ChartCard>;
            })()}
            {hasLS&&(()=>{
              const lsf = activeJob.loadsolFiles[0];
              const stride = Math.max(1, Math.floor(lsf.data.length/150));
              const d = lsf.data.filter((_,i) => i%stride===0);
              return <ChartCard title="LoadSOL GRF" h={180}><ResponsiveContainer><LineChart data={d}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="time" tick={{fill:C.muted,fontSize:9}} stroke={C.border}/><YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="N"/><Tooltip content={Tt}/>{lsf.blipTime&&<ReferenceLine x={lsf.blipTime} stroke={C.amber} strokeWidth={2}/>}<Line type="monotone" dataKey="left" stroke={C.sky} dot={false} strokeWidth={1.5} name="Left"/><Line type="monotone" dataKey="right" stroke={C.rose} dot={false} strokeWidth={1.5} name="Right"/></LineChart></ResponsiveContainer></ChartCard>;
            })()}
            {hasF&&<ChartCard title="Force" h={180}><ResponsiveContainer><AreaChart data={shiftedForce}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="time" tick={{fill:C.muted,fontSize:9}} stroke={C.border}/><YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="N"/><Tooltip content={Tt}/><Area type="monotone" dataKey="force" stroke={C.violet} fill={C.violet+"30"} strokeWidth={1.5} name="Force" dot={false}/></AreaChart></ResponsiveContainer></ChartCard>}
          </div>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 1 — SKELETON
  // ════════════════════════════════════════════════════════════════════════════
  const renderSkeleton = () => {
    const mvnxFiles = activeJob?.mvnxFiles || [];
    const mvnx  = mvnxFiles[skelFileIdx];
    const hasData = !!mvnx?.frames?.length;
    const frame = hasData ? mvnx.frames[Math.min(skelFrame, mvnx.frames.length-1)] : null;
    const positions = frame?.pos?.length ? frame.pos : REF_POS;
    const boneList  = mvnx?.bones?.length ? mvnx.bones : BONES;
    const W=300, H=440;
    const pts = projectPos(positions, skelView, W, H);
    const ft = frame?.time || 0;

    const loadsolFilesList = activeJob?.loadsolFiles || [];
    const lsfIdx = loadsolPairings[skelFileIdx] ?? skelLoadsolIdx;
    const lsf = loadsolFilesList[lsfIdx] || loadsolFilesList[0] || null;
    const hasLS = !!lsf?.data?.length;
    const ff   = activeJob?.forceFile;
    const hasF = !!ff?.data?.length;

    if (filesLoading) return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:300,gap:14}}>
        <Spinner size={32}/><div style={{fontSize:13,color:C.muted}}>Loading files…</div>
      </div>
    );

    return (
      <div>
        {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
        {mvnxFiles.length > 0 && (
          <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:12,color:C.muted}}>Cycle:</span>
            {mvnxFiles.map((f,i) => (
              <Btn key={i} active={skelFileIdx===i} onClick={()=>{
                setSkelFileIdx(i); setSkelFrame(0); setSkelPlaying(false);
                const paired = loadsolPairings[i];
                if (paired !== undefined) setSkelLoadsolIdx(paired);
              }}>
                {f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i,"")}
              </Btn>
            ))}
          </div>
        )}
        {loadsolFilesList.length > 1 && (
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:12,color:C.muted}}>LoadSOL:</span>
            {loadsolFilesList.map((f,i) => (
              <Btn key={i} active={(loadsolPairings[skelFileIdx]??skelLoadsolIdx)===i} small onClick={()=>{
                setSkelLoadsolIdx(i);
                setLoadsolPairings(prev=>({...prev,[skelFileIdx]:i}));
              }}>
                {f.name.replace(/\.txt$/i,"")}
              </Btn>
            ))}
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:14,alignItems:"start"}}>
          {/* SVG panel */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
            <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:10}}>
              {["front","side","top"].map(v=>(
                <Btn key={v} active={skelView===v} onClick={()=>setSkelView(v)} small>{v[0].toUpperCase()+v.slice(1)}</Btn>
              ))}
            </div>
            <svg width={W} height={H} style={{display:"block",margin:"0 auto"}}>
              <rect width={W} height={H} fill={C.bg} rx={8}/>
              {[0.25,0.5,0.75].map(p=>(
                <line key={p} x1={0} y1={H*p} x2={W} y2={H*p} stroke={C.border} strokeWidth={0.5} strokeDasharray="4 4"/>
              ))}
              {pts.length > 0 && boneList.map(([a,b],i) => {
                const pa=pts[a], pb=pts[b]; if (!pa||!pb) return null;
                const la=mvnx?.segLabels?.[a]||"", lb=mvnx?.segLabels?.[b]||"";
                const isR=/right/i.test(la)||/right/i.test(lb);
                const isL=/left/i.test(la)||/left/i.test(lb);
                return <line key={i} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]}
                  stroke={isR?C.sky:isL?C.rose:C.amber} strokeWidth={isR||isL?3:4} strokeLinecap="round"/>;
              })}
              {pts.map((pt,i) => {
                if (!pt) return null;
                const lbl = mvnx?.segLabels?.[i]||"";
                return <circle key={i} cx={pt[0]} cy={pt[1]} r={/head/i.test(lbl)?7:4} fill={/head/i.test(lbl)?C.amber:C.accent} opacity={0.9}/>;
              })}
              {!hasData&&<text x={W/2} y={H-16} textAnchor="middle" fill={C.muted} fontSize={11}>Reference pose — upload MVNX</text>}
            </svg>
            {hasData ? (
              <div style={{marginTop:10}}>
                <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:6,flexWrap:"wrap"}}>
                  <Btn small onClick={()=>{setSkelFrame(0);setSkelPlaying(false);}}>⏮</Btn>
                  <Btn small active={skelPlaying} onClick={()=>setSkelPlaying(p=>!p)}>{skelPlaying?"⏸":"▶"}</Btn>
                  <Btn small onClick={()=>{setSkelPlaying(false);setSkelFrame(mvnx.frames.length-1);}}>⏭</Btn>
                  {[0.25,0.5,1,2,4].map(s=>(
                    <Btn key={s} small active={skelSpeed===s} onClick={()=>setSkelSpeed(s)}>{s}×</Btn>
                  ))}
                </div>
                <input type="range" min={0} max={mvnx.frames.length-1} value={skelFrame}
                  onChange={e=>setSkelFrame(+e.target.value)} style={{width:"100%",accentColor:C.accent}}/>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.muted,marginTop:3}}>
                  <span>t={ft.toFixed(2)}s</span>
                  <span>{skelFrame+1}/{mvnx.frames.length}</span>
                  <span>{mvnx.duration?.toFixed(1)}s@{mvnx.frameRate}Hz</span>
                </div>
              </div>
            ) : (
              <div style={{textAlign:"center",marginTop:14}}>
                <Btn active onClick={()=>openUpload("mvnx")}>Upload MVNX</Btn>
              </div>
            )}
          </div>

          {/* Right column */}
          <div>
            {jointPanels.map((panel,pi) => {
              const kj   = KEY_JOINTS[panel.jointKey];
              const data = panelData[pi] || [];
              // Current angle values for live readout
              const ji = hasData ? mvnx.jointLabels?.findIndex(l => kj.r.test(l)) : -1;
              const curAngles = (ji >= 0 && frame?.ja) ? {
                LB: frame.ja[ji*3]?.toFixed(1),    // Z = Lat Bend
                AR: frame.ja[ji*3+1]?.toFixed(1),  // X = Axial Rot
                FE: frame.ja[ji*3+2]?.toFixed(1),  // Y = Flex/Ext
              } : null;
              return (
                <ChartCard key={pi} h={180} title={
                  <span>{kj.lbl}{curAngles&&panel.planes>0&&(
                    <span style={{fontSize:10,fontWeight:400,color:C.muted,marginLeft:8}}>
                      {[0,1,2].filter(pli=>panel.planes&(1<<pli)).map(pli=>`${PLANE_LABELS[pli]}: ${curAngles[PLANE_LABELS[pli]]}°`).join("  ")}
                    </span>
                  )}</span>
                }
                  action={
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      {PLANE_LABELS.map((pl,pli) => (
                        <Btn key={pl} small active={!!(panel.planes & (1<<pli))}
                          onClick={()=>setJointPanels(prev=>prev.map((p,i)=>
                            i!==pi ? p : {...p, planes: p.planes ^ (1<<pli)}
                          ))}>
                          {pl}
                        </Btn>
                      ))}
                      <select value={panel.jointKey}
                        onChange={e=>setJointPanels(prev=>prev.map((p,i)=>i===pi?{...p,jointKey:+e.target.value}:p))}
                        style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 4px",color:C.muted,fontSize:10,marginLeft:4}}>
                        {KEY_JOINTS.map((kj,kji)=><option key={kji} value={kji}>{kj.lbl}</option>)}
                      </select>
                      {jointPanels.length>1&&<Btn small danger onClick={()=>setJointPanels(prev=>prev.filter((_,i)=>i!==pi))}>×</Btn>}
                    </div>
                  }>
                  <ResponsiveContainer>
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis dataKey="t" type="number" domain={[0, +(mvnx?.duration||0).toFixed(2)]}
                        tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="s"/>
                      <YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="°"/>
                      <Tooltip content={Tt}/>
                      <ReferenceLine y={0} stroke={C.border} strokeDasharray="3 3"/>
                      <ReferenceLine x={ft} stroke={C.amber} strokeWidth={2} isFront/>
                      {PLANE_LABELS.map((pl,pli)=>!!(panel.planes & (1<<pli))&&(
                        <Line key={pl} type="monotone" dataKey={pl} stroke={PLANE_COLORS[pli]}
                          dot={false} strokeWidth={1.5} name={PLANE_NAMES[pli]}/>
                      ))}
                      {data.length>0&&(panel.planes&(panel.planes-1))!==0&&<Legend wrapperStyle={{fontSize:10}}/>}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              );
            })}
            <div style={{marginBottom:12}}>
              <Btn small onClick={()=>setJointPanels(prev=>[...prev,{jointKey:0,planes:1}])}>+ Add Joint Panel</Btn>
            </div>

            {hasLS&&(()=>{
              // Clip LoadSOL to blip time so t=0 aligns with XSENS start
              const clipped = lsf.blipTime != null
                ? lsf.data.filter(d => d.time >= lsf.blipTime).map(d => ({...d, time: +(d.time - lsf.blipTime).toFixed(3)}))
                : lsf.data;
              const stride = Math.max(1, Math.floor(clipped.length/200));
              const d = clipped.filter((_,i) => i%stride===0);
              return (
                <ChartCard title="LoadSOL GRF (clipped to XSENS start)" h={160}>
                  <ResponsiveContainer><LineChart data={d}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="time" type="number" domain={[0,"auto"]}
                      tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="s"/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="N"/>
                    <Tooltip content={Tt}/>
                    <ReferenceLine x={ft} stroke={C.amber} strokeWidth={2} isFront/>
                    <Line type="monotone" dataKey="left"  stroke={C.sky}  dot={false} strokeWidth={1.5} name="L"/>
                    <Line type="monotone" dataKey="right" stroke={C.rose} dot={false} strokeWidth={1.5} name="R"/>
                  </LineChart></ResponsiveContainer>
                </ChartCard>
              );
            })()}

            {hasF&&(
              <ChartCard title="Force (aligned to skeleton)" h={200}
                action={
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{fontSize:10,color:C.muted}}>offset:</span>
                    <input type="number" step="any" value={forceOffset}
                      onChange={e=>{ const v=parseFloat(e.target.value); if(!isNaN(v)) setForceOffset(v); }}
                      style={{width:64,background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 6px",color:C.accent,fontSize:11,textAlign:"center"}}/>
                    <span style={{fontSize:10,color:C.muted}}>s</span>
                    <Btn small onClick={()=>setForceOffset(0)}>0</Btn>
                  </div>
                }>
                <ResponsiveContainer>
                  <ComposedChart>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="time" type="number" domain={["auto","auto"]} tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="s"/>
                    <YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="N"/>
                    <Tooltip content={Tt}/>
                    <ReferenceLine x={+ft.toFixed(3)} stroke={C.amber} strokeWidth={2} strokeDasharray="3 2"/>
                    <Line data={shiftedForce} type="monotone" dataKey="force" stroke={C.violet} dot={false} strokeWidth={1.5} name="Force"/>
                    {extendedForce&&<Line data={extendedForce} type="monotone" dataKey="force" stroke={C.emerald} dot={false} strokeWidth={1.5} strokeDasharray="6 2" name="Extended"/>}
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 2 — CYCLES
  // ════════════════════════════════════════════════════════════════════════════
  const renderCycles = () => {
    const mvnxFiles = activeJob?.mvnxFiles || [];
    if (filesLoading) return <div style={{display:"flex",justifyContent:"center",padding:60}}><Spinner size={32}/></div>;
    if (!mvnxFiles.length) return (
      <div>{activeJob&&<FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
        <EmptyState icon="📊" title="No cycle data" detail="Upload multiple MVNX files (one per cycle/trial) to compare."
          action={<Btn active onClick={()=>openUpload("mvnx")}>Upload MVNX Files</Btn>}/>
      </div>
    );

    const firstJoints = mvnxFiles[0]?.jointLabels || [];
    const availableKJ = KEY_JOINTS.map((kj,i) => ({...kj, ki:i, ji:firstJoints.findIndex(l=>kj.r.test(l))})).filter(k=>k.ji>=0);
    const safeKey = Math.min(cycleJointKey, availableKJ.length-1);
    const selected = availableKJ[safeKey] || availableKJ[0];
    if (!selected) return <EmptyState icon="⚠" title="No matching joints" detail="No clinical joints found in this MVNX file."/>;

    const N=100;
    const interp = (frames, ji) => {
      const vals = (frames||[]).map(f => f.ja?.[ji*3] ?? 0);
      if (!vals.length) return Array(N).fill(0);
      return Array.from({length:N}, (_,i) => {
        const pos=(i/(N-1))*(vals.length-1), lo=Math.floor(pos), hi=Math.ceil(pos);
        return vals[lo]*(1-(pos-lo))+(vals[hi]??vals[lo])*(pos-lo);
      });
    };

    const cycles = mvnxFiles.map((f,i) => ({
      name: f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i,""),
      color: CYCLE_COLORS[i%CYCLE_COLORS.length],
      vals: interp(f.frames, selected.ji),
    }));
    const means = Array.from({length:N}, (_,i) => cycles.reduce((s,c)=>s+c.vals[i],0)/cycles.length);
    const sds   = Array.from({length:N}, (_,i) => { const m=means[i]; return Math.sqrt(cycles.reduce((s,c)=>s+(c.vals[i]-m)**2,0)/cycles.length); });
    const pctData = Array.from({length:N}, (_,i) => {
      const pt={pct:i, mean:+means[i].toFixed(2), hi:+(means[i]+sds[i]).toFixed(2), lo:+(means[i]-sds[i]).toFixed(2)};
      cycles.forEach(c => { pt[c.name]=+c.vals[i].toFixed(2); });
      return pt;
    });
    const n = cycles.length;
    const corr = cycles.map((a,i) => cycles.map((b,j) => {
      if (i===j) return 1;
      const ma=a.vals.reduce((s,v)=>s+v,0)/N, mb=b.vals.reduce((s,v)=>s+v,0)/N;
      const num=a.vals.reduce((s,v,k)=>s+(v-ma)*(b.vals[k]-mb),0);
      const da=Math.sqrt(a.vals.reduce((s,v)=>s+(v-ma)**2,0)), db=Math.sqrt(b.vals.reduce((s,v)=>s+(v-mb)**2,0));
      return da&&db ? +(num/(da*db)).toFixed(3) : 0;
    }));

    return (
      <div>
        {activeJob&&<FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",marginBottom:14}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Joint (flexion/extension):</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {availableKJ.map((kj,i)=>(
              <Btn key={i} small active={safeKey===i} onClick={()=>setCycleJointKey(i)}>{kj.lbl}</Btn>
            ))}
          </div>
        </div>
        <ChartCard title={`Cycle Overlay — ${selected.lbl} FE (time-normalised)`} h={280}>
          <ResponsiveContainer>
            <ComposedChart data={pctData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="pct" tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="%"/>
              <YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="°"/>
              <Tooltip content={Tt}/>
              <ReferenceLine y={0} stroke={C.border} strokeDasharray="3 3"/>
              <Area type="monotone" dataKey="hi" stroke="none" fill={C.teal} fillOpacity={0.12} legendType="none" name="SD+"/>
              <Area type="monotone" dataKey="lo" stroke="none" fill={C.bg} fillOpacity={1} legendType="none" name="SD−"/>
              {cycles.map(c=><Line key={c.name} type="monotone" dataKey={c.name} stroke={c.color} dot={false} strokeWidth={1.5} opacity={0.8}/>)}
              <Line type="monotone" dataKey="mean" stroke={C.teal} dot={false} strokeWidth={2.5} name="Mean" strokeDasharray="6 2"/>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        {n>1&&(
          <ChartCard title="Correlation Matrix" h={n*44+60}>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",fontSize:11,color:C.text}}>
                <thead><tr>
                  <th style={{padding:"4px 10px",color:C.muted}}/>
                  {cycles.map((c,i)=><th key={i} style={{padding:"4px 10px",color:c.color,fontWeight:600}}>{c.name}</th>)}
                </tr></thead>
                <tbody>{corr.map((row,i)=>(
                  <tr key={i}>
                    <td style={{padding:"4px 10px",color:cycles[i].color,fontWeight:600}}>{cycles[i].name}</td>
                    {row.map((r,j)=>(
                      <td key={j} style={{padding:"4px 10px",textAlign:"center",
                        background:i===j?"transparent":`rgba(13,148,136,${Math.abs(r)*0.4})`,
                        color:i===j?C.muted:r>0.95?C.accent:r>0.8?C.teal:C.amber,borderRadius:4}}>
                        {i===j?"—":r.toFixed(3)}
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </ChartCard>
        )}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
          <Stat label="Cycles" value={n} unit="files"/>
          <Stat label="Peak (mean)" value={Math.max(...means).toFixed(1)} unit="°"/>
          <Stat label="Avg SD" value={(sds.reduce((s,v)=>s+v,0)/sds.length).toFixed(1)} unit="°" sub="variability"/>
          {n>1&&<Stat label="Mean r" value={(corr.flat().filter((_,k)=>k%(n+1)!==0).reduce((s,v)=>s+v,0)/(n*(n-1))).toFixed(3)} sub="inter-cycle" color={C.teal}/>}
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 3 — LOADSOL
  // ════════════════════════════════════════════════════════════════════════════
  const renderLoadSOL = () => {
    const loadsolFiles = activeJob?.loadsolFiles || [];
    if (filesLoading) return <div style={{display:"flex",justifyContent:"center",padding:60}}><Spinner size={32}/></div>;
    const renderOne = (lsf, label) => {
      const stride = Math.max(1, Math.floor(lsf.data.length/300));
      const d = lsf.data.filter((_,i) => i%stride===0);
      return (
        <div key={lsf.id} style={{marginBottom:24}}>
          {label&&<div style={{fontSize:13,fontWeight:600,color:C.accent,marginBottom:10}}>{label}</div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:14}}>
            <Stat label="Left Peak"  value={lsf.stats.leftMax.toFixed(0)}  unit="N"/>
            <Stat label="Right Peak" value={lsf.stats.rightMax.toFixed(0)} unit="N"/>
            <Stat label="XSENS Blip" value={lsf.blipTime?.toFixed(3)||"—"} unit="s"
              color={lsf.blipTime?C.amber:undefined} sub={lsf.blipTime?"trigger detected":"not detected"}/>
            <Stat label="Duration" value={(lsf.data[lsf.data.length-1]?.time||0).toFixed(1)} unit="s"/>
          </div>
          {lsf.blipTime&&(
            <div style={{background:C.amber+"15",border:`1px solid ${C.amber}50`,borderLeft:`4px solid ${C.amber}`,borderRadius:8,padding:"10px 16px",fontSize:12,color:C.amber,marginBottom:14,display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:16}}>⚡</span>
              <span><b>XSENS sync blip at t = {lsf.blipTime.toFixed(3)}s</b> — area1 trigger channel spike detected.</span>
            </div>
          )}
          <ChartCard title="Ground Reaction Forces — Left & Right" h={260}>
            <ResponsiveContainer><LineChart data={d}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="time" tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="s"/>
              <YAxis tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="N"/>
              <Tooltip content={Tt}/><Legend wrapperStyle={{fontSize:11}}/>
              {lsf.blipTime&&<ReferenceLine x={lsf.blipTime} stroke={C.amber} strokeWidth={2.5} label={{value:"⚡ XSENS Start",fill:C.amber,fontSize:11,position:"insideTopRight"}}/>}
              <Line type="monotone" dataKey="left"  stroke={C.sky}  dot={false} strokeWidth={2} name="Left Foot"/>
              <Line type="monotone" dataKey="right" stroke={C.rose} dot={false} strokeWidth={2} name="Right Foot"/>
            </LineChart></ResponsiveContainer>
          </ChartCard>
          {lsf.data.some(d=>d.trig>0)&&(
            <ChartCard title="Sync Trigger Channel (area1)" h={140}>
              <ResponsiveContainer><AreaChart data={d}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="time" tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="s"/>
                <YAxis tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="N"/>
                <Tooltip content={Tt}/>
                {lsf.blipTime&&<ReferenceLine x={lsf.blipTime} stroke={C.amber} strokeWidth={2}/>}
                <Area type="monotone" dataKey="trig" stroke={C.amber} fill={C.amber+"30"} strokeWidth={2} name="Trigger" dot={false}/>
              </AreaChart></ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      );
    };
    return (
      <div>
        {activeJob&&<FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
        {!loadsolFiles.length ? (
          <EmptyState icon="👟" title="No LoadSOL data" detail="Upload LoadSOL TXT. The area1 trigger channel will auto-detect the XSENS sync blip."
            action={activeJobId&&<Btn active onClick={()=>openUpload("loadsol")}>Upload LoadSOL TXT</Btn>}/>
        ) : loadsolFiles.map((lsf,i) => renderOne(lsf, loadsolFiles.length>1 ? lsf.name : null))}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 4 — FORCES
  // ════════════════════════════════════════════════════════════════════════════
  const renderForces = () => {
    const ff  = activeJob?.forceFile;
    const lsf = activeJob?.loadsolFiles?.[0];
    if (filesLoading) return <div style={{display:"flex",justifyContent:"center",padding:60}}><Spinner size={32}/></div>;
    return (
      <div>
        {activeJob&&<FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
        {!ff ? (
          <EmptyState icon="📈" title="No force data" detail="Upload a WiDACS CSV or any CSV with time in col 1, force in col 2."
            action={activeJobId&&<Btn active onClick={()=>openUpload("force")}>Upload Force CSV</Btn>}/>
        ) : (()=>{
          const blipTime = lsf?.blipTime;
          return (
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:18}}>
                <Stat label="Peak Force"   value={ff.stats.peak.toFixed(1)} unit="N"/>
                <Stat label="Time to Peak" value={(ff.stats.peakTime+forceOffset).toFixed(3)} unit="s"/>
                <Stat label="Impulse"      value={ff.stats.impulse} unit="N·s"/>
                <Stat label="Time Offset"  value={forceOffset.toFixed(3)} unit="s"/>
              </div>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Time Sync — Offset</div>
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:200}}>
                    <input type="range" min={-120} max={120} step={0.01} value={forceOffset}
                      onChange={e=>setForceOffset(+e.target.value)} style={{width:"100%",accentColor:C.accent}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.muted}}>
                      <span>−120s</span><span>offset: {forceOffset.toFixed(2)}s</span><span>+120s</span>
                    </div>
                  </div>
                  {blipTime&&<Btn small onClick={()=>setForceOffset(blipTime)}>⚡ Snap to Blip ({blipTime.toFixed(2)}s)</Btn>}
                  <Btn small onClick={()=>setForceOffset(0)}>Reset</Btn>
                </div>
              </div>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Extend Sustained Push Phase</div>
                <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Appends extra time at the mean sustained force level after the recorded data ends (above 35% of peak).</div>
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:200}}>
                    <input type="range" min={0} max={120} step={0.5} value={extendDuration}
                      onChange={e=>setExtendDuration(+e.target.value)} style={{width:"100%",accentColor:C.emerald}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.muted}}>
                      <span>0s</span><span style={{color:extendDuration>0?C.emerald:C.muted}}>extend: {extendDuration.toFixed(1)}s</span><span>120s</span>
                    </div>
                  </div>
                  {extendDuration>0&&<Btn small onClick={()=>setExtendDuration(0)}>Clear</Btn>}
                </div>
              </div>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:600,color:C.accent,textTransform:"uppercase",letterSpacing:.5}}>Manual Force Blocks</div>
                  <Btn small active onClick={()=>setShowBlockForm(v=>!v)}>+ Add Block</Btn>
                </div>
                <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Insert estimated/constant force segments.</div>
                {showBlockForm&&(
                  <div style={{background:C.bg,borderRadius:8,padding:12,marginBottom:10,display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr auto",gap:8,alignItems:"end"}}>
                    {[["t0","Start (s)"],["t1","End (s)"],["force","Force (N)"],["label","Label"]].map(([k,lbl])=>(
                      <div key={k}>
                        <div style={{fontSize:10,color:C.muted,marginBottom:3}}>{lbl}</div>
                        <input value={blockDraft[k]} onChange={e=>setBlockDraft(b=>({...b,[k]:e.target.value}))}
                          style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:4,padding:"4px 8px",color:C.text,fontSize:11,boxSizing:"border-box"}}/>
                      </div>
                    ))}
                    <Btn small active onClick={()=>{
                      const {t0,t1,force,label}=blockDraft;
                      if (!isNaN(+t0)&&!isNaN(+t1)&&!isNaN(+force)) {
                        setForceBlocks(b=>[...b,{id:Date.now(),t0:+t0,t1:+t1,force:+force,label:label||"Block"}]);
                        setBlockDraft({t0:"",t1:"",force:"",label:""});
                        setShowBlockForm(false);
                      }
                    }}>Add</Btn>
                  </div>
                )}
                {forceBlocks.length>0&&(
                  <div style={{display:"grid",gap:4}}>
                    {forceBlocks.map(bl=>(
                      <div key={bl.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.bg,borderRadius:6,padding:"5px 10px",fontSize:11}}>
                        <span style={{color:C.emerald}}>{bl.label}</span>
                        <span style={{color:C.muted}}>{bl.t0}s – {bl.t1}s @ {bl.force}N</span>
                        <Btn small danger onClick={()=>setForceBlocks(b=>b.filter(x=>x.id!==bl.id))}>×</Btn>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <ChartCard title="Force vs Time" h={300}>
                <ResponsiveContainer>
                  <ComposedChart>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="time" type="number" domain={["auto","auto"]} tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="s"/>
                    <YAxis tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="N"/>
                    <Tooltip content={Tt}/>
                    {blipTime&&<ReferenceLine x={blipTime} stroke={C.amber} strokeWidth={2} strokeDasharray="4 2" label={{value:"⚡",fill:C.amber,fontSize:13,position:"insideTop"}}/>}
                    <ReferenceLine y={ff.stats.peak} stroke={C.rose} strokeDasharray="3 3" opacity={0.5}/>
                    {forceBlocks.map(bl=>(
                      <ReferenceArea key={bl.id} x1={bl.t0} x2={bl.t1} y1={0} y2={bl.force}
                        fill={C.emerald} fillOpacity={0.2} stroke={C.emerald} strokeWidth={1}
                        label={{value:bl.label,fill:C.emerald,fontSize:10,position:"insideTop"}}/>
                    ))}
                    <Line data={shiftedForce} type="monotone" dataKey="force" stroke={C.violet} dot={false} strokeWidth={2} name="Measured Force"/>
                    {extendedForce&&<Line data={extendedForce} type="monotone" dataKey="force" stroke={C.emerald} dot={false} strokeWidth={2} strokeDasharray="6 3" name="Extended"/>}
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
              {lsf&&(
                <ChartCard title="LoadSOL GRF Reference" h={180}>
                  <ResponsiveContainer><LineChart data={lsf.data.filter((_,i)=>i%Math.max(1,Math.floor(lsf.data.length/300))===0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="time" tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="s"/>
                    <YAxis tick={{fill:C.muted,fontSize:10}} stroke={C.border} unit="N"/>
                    <Tooltip content={Tt}/><Legend wrapperStyle={{fontSize:11}}/>
                    {blipTime&&<ReferenceLine x={blipTime} stroke={C.amber} strokeWidth={2}/>}
                    <Line type="monotone" dataKey="left"  stroke={C.sky}  dot={false} strokeWidth={1.5} name="L GRF"/>
                    <Line type="monotone" dataKey="right" stroke={C.rose} dot={false} strokeWidth={1.5} name="R GRF"/>
                  </LineChart></ResponsiveContainer>
                </ChartCard>
              )}
            </>
          );
        })()}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 5 — JOBS
  // ════════════════════════════════════════════════════════════════════════════
  const renderJobs = () => (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        <Btn active onClick={()=>setShowJobModal(true)}>+ New Job</Btn>
        {activeJobId&&<Btn onClick={()=>openUpload("mvnx")}>⬆ Upload Files</Btn>}
      </div>
      {jobsLoading ? (
        <div style={{display:"flex",justifyContent:"center",padding:60}}><Spinner size={32}/></div>
      ) : !jobs.length ? (
        <EmptyState icon="🗂" title="No jobs yet" detail="Create a job to organise files per subject/session."
          action={<Btn active onClick={()=>setShowJobModal(true)}>Create First Job</Btn>}/>
      ) : (
        <div style={{display:"grid",gap:10}}>
          {jobs.map(job => (
            <div key={job.id}
              style={{background:C.card,border:`1px solid ${activeJobId===job.id?C.accent:C.border}`,borderRadius:10,padding:14,cursor:"pointer"}}
              onClick={()=>setActiveJobId(job.id)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                {editingJobId===job.id ? (
                  <input value={editingJobName}
                    onChange={e=>setEditingJobName(e.target.value)}
                    onKeyDown={e=>{
                      if (e.key==="Enter") { renameJob(job.id, editingJobName); setEditingJobId(null); }
                      if (e.key==="Escape") setEditingJobId(null);
                    }}
                    onBlur={()=>{ renameJob(job.id, editingJobName); setEditingJobId(null); }}
                    onClick={e=>e.stopPropagation()} autoFocus
                    style={{background:C.bg,border:`1px solid ${C.accent}`,borderRadius:6,padding:"4px 10px",color:C.text,fontSize:14,fontWeight:700,flex:1,marginRight:8}}/>
                ) : (
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:activeJobId===job.id?C.accent:C.text,marginBottom:2}}>
                      {job.name}
                      {activeJobId===job.id&&<span style={{fontSize:11,fontWeight:400,color:C.muted,marginLeft:8}}>● active</span>}
                    </div>
                    <div style={{fontSize:11,color:C.muted}}>Created: {job.createdAt}</div>
                  </div>
                )}
                <div style={{display:"flex",gap:6}}>
                  <Btn small onClick={e=>{e.stopPropagation();setEditingJobId(job.id);setEditingJobName(job.name);}}>✏ Rename</Btn>
                  <Btn small danger onClick={e=>{e.stopPropagation();if(confirm(`Delete "${job.name}"?`)) deleteJob(job.id);}}>Delete</Btn>
                </div>
              </div>
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                {[["MVNX",(job._fileRecords||[]).filter(r=>r.file_type==="mvnx").length,C.teal],
                  ["LoadSOL",(job._fileRecords||[]).filter(r=>r.file_type==="loadsol").length,C.sky],
                  ["Force",(job._fileRecords||[]).filter(r=>r.file_type==="force").length,C.violet]
                ].map(([lbl,cnt,clr])=>(
                  <span key={lbl} style={{fontSize:11,padding:"3px 8px",borderRadius:12,background:cnt>0?clr+"20":"transparent",border:`1px solid ${cnt>0?clr+"60":C.border}`,color:cnt>0?clr:C.muted}}>{lbl}: {cnt}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 6 — PIPELINE
  // ════════════════════════════════════════════════════════════════════════════
  const renderPipeline = () => (
    <div>
      <p style={{color:C.accent,fontWeight:600,fontSize:16,marginBottom:4}}>End-to-End Research Pipeline</p>
      <p style={{color:C.muted,fontSize:13,marginBottom:22}}>XSENS MVN · LoadSOL · WiDACS → biomechanical modelling → ML risk classification.</p>
      {[
        {s:"1",t:"Data Acquisition",c:C.sky,d:"XSENS MVN 40Hz · LoadSOL insoles 200Hz · WiDACS force gauge 500Hz",det:"Create a Job → upload MVNX files (one per cycle), LoadSOL TXT, WiDACS CSV per session"},
        {s:"2",t:"Skeleton Visualisation",c:C.amber,d:"3D→2D stick figure from MVNX segment positions — segments & bones read from file",det:"Skeleton tab: configurable joint panels per plane (FE/LB/AR), play/scrub, LoadSOL+Force overlaid"},
        {s:"3",t:"Cycle Similarity",c:C.emerald,d:"Time-normalise cycles 0–100%, overlay FE traces, Pearson r matrix",det:"Cycles tab: key clinical joints (L4/L5, shoulders, elbows, hips, knees)"},
        {s:"4",t:"Force Sync & Extension",c:C.violet,d:"Align WiDACS to MVNX via time offset slider or ⚡ snap to LoadSOL blip",det:"Forces tab: extend sustained push phase, add manual force blocks for unmeasured segments"},
        {s:"5",t:"LoadSOL Sync Blip",c:C.orange,d:"Trigger channel (area1 col 11/12) — near-zero except for XSENS sync spike (~50N)",det:"LoadSOL tab: trigger channel plotted separately, blip time shown for alignment"},
        {s:"6",t:"ML Classification",c:C.rose,d:"SVM-RBF · LOOCV · Binary MSD risk labels from injury records",det:"Metrics: Accuracy, PPV, Sensitivity, Specificity, F1, ROC/AUC"},
      ].map(p=>(
        <div key={p.s} style={{display:"flex",gap:14,marginBottom:12,alignItems:"flex-start"}}>
          <div style={{width:32,height:32,borderRadius:"50%",background:p.c+"25",border:`2px solid ${p.c}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:13,fontWeight:700,color:p.c}}>{p.s}</div>
          <div style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px"}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:3}}>{p.t}</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:5}}>{p.d}</div>
            <div style={{fontSize:11,color:p.c,background:p.c+"10",padding:"5px 9px",borderRadius:5,borderLeft:`3px solid ${p.c}`}}>{p.det}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  //  MODALS
  // ════════════════════════════════════════════════════════════════════════════
  const renderJobModal = () => (
    <Modal title="Create New Job" onClose={()=>setShowJobModal(false)}>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,color:C.muted,marginBottom:6}}>Job Name</label>
        <input value={newJobName} onChange={e=>setNewJobName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&createJob()} autoFocus
          placeholder="e.g. Subject 01 — Session A"
          style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"8px 12px",color:C.text,fontSize:13,boxSizing:"border-box"}}/>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn onClick={()=>setShowJobModal(false)}>Cancel</Btn>
        <Btn active onClick={createJob}>Create Job</Btn>
      </div>
    </Modal>
  );

  const renderUploadModal = () => {
    const info = {
      mvnx:   {icon:"🦴",title:"Upload MVNX Files",  detail:"One .mvnx file per cycle trial",                   accept:".mvnx",    multi:true},
      loadsol:{icon:"👟",title:"Upload LoadSOL TXT", detail:"Tab-separated TXT export from LoadSOL (one per cycle)",accept:".txt",    multi:true},
      force:  {icon:"📈",title:"Upload Force CSV",   detail:"Time (col 1), Force (col 2). WiDACS CSV works directly.", accept:".csv,.txt",multi:false},
    }[uploadType];
    return (
      <Modal title="Upload Files" onClose={()=>setShowUploadModal(false)}>
        <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Job: <span style={{color:C.accent,fontWeight:600}}>{activeJob?.name}</span></div>
        <div style={{display:"flex",gap:6,marginBottom:16}}>
          {[["mvnx","🦴 MVNX"],["loadsol","👟 LoadSOL"],["force","📈 Force"]].map(([k,lbl])=>(
            <Btn key={k} active={uploadType===k} onClick={()=>setUploadType(k)}>{lbl}</Btn>
          ))}
        </div>
        <div style={{background:C.bg,border:`2px dashed ${C.border}`,borderRadius:8,padding:32,textAlign:"center"}}>
          <div style={{fontSize:30,marginBottom:8}}>{info.icon}</div>
          <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:5}}>{info.title}</div>
          <div style={{fontSize:12,color:C.muted,marginBottom:18}}>{info.detail}</div>
          <input ref={fileInputRef} type="file" multiple={info.multi} accept={info.accept} onChange={handleFileUpload} style={{display:"none"}}/>
          <Btn active onClick={()=>fileInputRef.current?.click()}>Choose Files</Btn>
        </div>
      </Modal>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 5 — DYNAMICS
  // ════════════════════════════════════════════════════════════════════════════
  const renderDynamics = () => {
    const hasMvnx = !!activeSkelMvnx?.frames?.length;
    const hasLS   = !!clippedLsf?.length;
    const hasF    = !!activeJob?.forceFile?.data?.length;
    const hasData = invDynData?.length > 0;

    // Build per-joint chart data from flat invDynData
    const jData = (key) => invDynData?.map(d => ({ t:d.t, FE:d[key]?.FE, LB:d[key]?.LB, AR:d[key]?.AR })) || [];

    const JointChart = ({title, dataKey, h=150}) => {
      const d = jData(dataKey);
      if (!d.length) return null;
      const peak = Math.max(...d.map(r => Math.abs(r.FE||0)));
      return (
        <ChartCard title={<span>{title}<span style={{fontSize:10,color:C.muted,marginLeft:8}}>peak FE {peak.toFixed(0)} Nm</span></span>} h={h}>
          <ResponsiveContainer>
            <LineChart data={d}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="t" type="number" tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="s"/>
              <YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="Nm"/>
              <Tooltip content={Tt}/>
              <ReferenceLine y={0} stroke={C.border} strokeDasharray="3 3"/>
              <Line type="monotone" dataKey="FE" stroke={C.teal}  dot={false} strokeWidth={1.5} name="FE"/>
              <Line type="monotone" dataKey="LB" stroke={C.amber} dot={false} strokeWidth={1.5} name="LB"/>
              <Line type="monotone" dataKey="AR" stroke={C.rose}  dot={false} strokeWidth={1.5} name="AR"/>
              <Legend wrapperStyle={{fontSize:10}}/>
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      );
    };

    const SecHdr = ({label, color}) => (
      <div style={{fontSize:11,fontWeight:700,color,textTransform:"uppercase",letterSpacing:1,
        margin:"18px 0 8px",borderBottom:`1px solid ${color}40`,paddingBottom:4}}>{label}</div>
    );

    return (
      <div>
        {/* Config bar */}
        <div style={{display:"flex",gap:14,marginBottom:16,alignItems:"center",flexWrap:"wrap",
          background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px"}}>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <span style={{fontSize:12,color:C.muted}}>Body mass:</span>
            <input type="number" step="any" min={20} max={250} value={bodyMass}
              onChange={e=>{const v=parseFloat(e.target.value); if(!isNaN(v)&&v>0) setBodyMass(v);}}
              style={{width:58,background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,
                padding:"3px 8px",color:C.accent,fontSize:12}}/>
            <span style={{fontSize:12,color:C.muted}}>kg</span>
          </div>
          {hasF && (
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:12,color:C.muted}}>WiDACS direction:</span>
              <select value={forceDirKey} onChange={e=>setForceDirKey(e.target.value)}
                style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,
                  padding:"3px 6px",color:C.text,fontSize:11}}>
                <option value="hand">Auto (hand direction)</option>
                <option value="+x">Push Forward (+X)</option>
                <option value="-x">Pull Back (−X)</option>
                <option value="+y">Push Left (+Y)</option>
                <option value="-y">Push Right (−Y)</option>
                <option value="+z">Lift (↑Z)</option>
                <option value="-z">Lower (↓Z)</option>
              </select>
            </div>
          )}
          <div style={{fontSize:11,color:C.muted,marginLeft:"auto"}}>
            {hasMvnx?"✓ MVNX":"✗ MVNX"} · {hasLS?"✓ LoadSOL":"✗ LoadSOL"} · {hasF?"✓ WiDACS":"✗ WiDACS"}
          </div>
        </div>

        {!hasMvnx && <EmptyState icon="⚙️" title="No MVNX loaded" detail="Select a job with MVNX data."/>}
        {hasMvnx && !hasLS && (
          <div style={{background:C.amber+"15",border:`1px solid ${C.amber}40`,borderRadius:8,
            padding:"10px 14px",marginBottom:12,fontSize:12,color:C.amber}}>
            No LoadSOL data — lower extremity and spinal moments will be zero (no ground reaction forces).
            Upload a LoadSOL file and set blip alignment to get meaningful results.
          </div>
        )}

        {hasData && (
          <>
            <SecHdr label="Lumbar Spine  (Bottom-Up via LoadSOL GRF)" color={C.accent}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:12,marginBottom:4}}>
              <JointChart title="L5/S1" dataKey="L5S1"/>
              <JointChart title="L4/L3" dataKey="L4L3"/>
              <JointChart title="L1/T12" dataKey="L1T12"/>
              <JointChart title="T9/T8"  dataKey="T9T8"/>
            </div>

            <SecHdr label="Lower Extremity  (Bottom-Up via LoadSOL GRF)" color={C.sky}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginBottom:4}}>
              <JointChart title="R Hip"   dataKey="hipR"/>
              <JointChart title="L Hip"   dataKey="hipL"/>
              <JointChart title="R Knee"  dataKey="kneeR"/>
              <JointChart title="L Knee"  dataKey="kneeL"/>
              <JointChart title="R Ankle" dataKey="ankleR"/>
              <JointChart title="L Ankle" dataKey="ankleL"/>
            </div>

            {hasF && (
              <>
                <SecHdr label="Right Upper Extremity  (Top-Down via WiDACS)" color={C.violet}/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginBottom:4}}>
                  <JointChart title="R Shoulder" dataKey="shoulderR"/>
                  <JointChart title="R Elbow"    dataKey="elbowR"/>
                  <JointChart title="R Wrist"    dataKey="wristR"/>
                </div>
              </>
            )}

            {/* Peak summary table */}
            <SecHdr label="Peak Joint Moment Summary" color={C.emerald}/>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${C.border}`}}>
                    {["Joint","Peak FE (Nm)","Peak LB (Nm)","Peak AR (Nm)"].map(h=>(
                      <th key={h} style={{textAlign:"left",padding:"4px 10px",color:C.muted,fontWeight:600}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {label:"L5/S1",  key:"L5S1"},
                    {label:"L4/L3",  key:"L4L3"},
                    {label:"R Hip",  key:"hipR"},
                    {label:"L Hip",  key:"hipL"},
                    {label:"R Knee", key:"kneeR"},
                    {label:"L Knee", key:"kneeL"},
                    ...(hasF?[{label:"R Shoulder",key:"shoulderR"},{label:"R Elbow",key:"elbowR"}]:[]),
                  ].map(({label,key}) => {
                    const d = invDynData.map(r => r[key]).filter(Boolean);
                    if (!d.length) return null;
                    const pk = (comp) => Math.max(...d.map(r => Math.abs(r[comp]||0))).toFixed(1);
                    return (
                      <tr key={key} style={{borderBottom:`1px solid ${C.border}20`}}>
                        <td style={{padding:"4px 10px",color:C.text,fontWeight:500}}>{label}</td>
                        <td style={{padding:"4px 10px",color:C.teal}}>{pk("FE")}</td>
                        <td style={{padding:"4px 10px",color:C.amber}}>{pk("LB")}</td>
                        <td style={{padding:"4px 10px",color:C.rose}}>{pk("AR")}</td>
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
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  ROOT RENDER
  // ════════════════════════════════════════════════════════════════════════════
  const panels = [renderOverview,renderSkeleton,renderCycles,renderLoadSOL,renderForces,renderDynamics,renderJobs,renderPipeline];
  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background:`linear-gradient(135deg,${C.bg},${C.card})`,borderBottom:`1px solid ${C.border}`,padding:"14px 24px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:10,color:C.accent,textTransform:"uppercase",letterSpacing:2,marginBottom:3}}>OBEL · UWaterloo</div>
            <div style={{fontSize:20,fontWeight:700}}>Biomechanics Research Dashboard</div>
            <div style={{fontSize:12,color:C.muted}}>MVNX · LoadSOL · WiDACS · Cycle Analysis · MSD Risk</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <select value={activeJobId||""} onChange={e=>setActiveJobId(e.target.value||null)}
              style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:activeJobId?C.text:C.muted,fontSize:12}}>
              <option value="">— Select Job —</option>
              {jobs.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
            <Btn active onClick={()=>setShowJobModal(true)}>+ Job</Btn>
            {activeJobId&&<Btn onClick={()=>setShowUploadModal(true)}>⬆ Upload</Btn>}
            <div style={{display:"flex",alignItems:"center",gap:8,paddingLeft:8,borderLeft:`1px solid ${C.border}`}}>
              <span style={{fontSize:11,color:C.muted}}>{session.user.email}</span>
              <Btn small danger onClick={()=>supabase.auth.signOut()}>Sign Out</Btn>
            </div>
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:4,padding:"10px 24px",borderBottom:`1px solid ${C.border}`,background:C.card,overflowX:"auto"}}>
        {TABS.map((t,i)=>(
          <button key={t} onClick={()=>setTab(i)} style={{
            padding:"7px 16px",borderRadius:6,border:"none",whiteSpace:"nowrap",cursor:"pointer",
            background:tab===i?C.accent+"20":"transparent",
            color:tab===i?C.accent:C.muted,fontSize:12,fontWeight:tab===i?600:400
          }}>{t}</button>
        ))}
      </div>
      <div style={{padding:"18px 24px",maxWidth:1200,margin:"0 auto"}}>{panels[tab]()}</div>
      {showJobModal&&renderJobModal()}
      {showUploadModal&&activeJobId&&renderUploadModal()}
    </div>
  );
}
