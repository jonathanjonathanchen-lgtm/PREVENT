import { useState, useRef, useCallback, useEffect, useMemo, Component } from "react";
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
const TABS = ["Skeleton","Cycles","LoadSOL","Forces & Dynamics","Jobs","Pipeline"];

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

// ── Read blob/file as text, auto-decompressing gzip ──────────────────────────
async function blobToText(blob) {
  const buf = await blob.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const decompressed = await new Response(
      new Blob([buf]).stream().pipeThrough(ds)
    ).text();
    return decompressed;
  }
  return new TextDecoder().decode(buf);
}

// ── MVNX Parser ───────────────────────────────────────────────────────────────
function parseMVNX(xmlStr) {
  try {
    console.log("[parseMVNX] length:", xmlStr.length,
      "first300:", JSON.stringify(xmlStr.slice(0, 300)),
      "last200:", JSON.stringify(xmlStr.slice(-200)));
    // Trim trailing content after the FIRST root closing tag
    const closeIdx = xmlStr.indexOf("</mvnx>");
    if (closeIdx !== -1) xmlStr = xmlStr.slice(0, closeIdx + "</mvnx>".length);
    else {
      // Try generic: find closing tag of whatever root element
      const rootMatch = xmlStr.match(/<(\w+)[\s>]/);
      if (rootMatch) {
        const tag = rootMatch[1];
        const ci = xmlStr.indexOf(`</${tag}>`);
        if (ci !== -1) xmlStr = xmlStr.slice(0, ci + `</${tag}>`.length);
      }
    }
    const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
    const pe = doc.querySelector("parsererror");
    if (pe) return { ok:false, error:"XML parse error: " + pe.textContent.slice(0, 300) };
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
    const firstBlip = data.find(d => d.trig > 5);
    if (firstBlip) blipTime = firstBlip.time;
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

// ── Winter (2009) Table 4.1 segment parameters: [massFrac, comFracFromProx, kGyrFromCoM] ──
// XSENS provides joint positions → segment lengths are computed from actual kinematics.
// Mass fractions and CoM fractions taken directly from Winter (2009) Table 4.1.
// Trunk segments: Winter groups spine into Pelvis / Abdomen / Thorax / Head+Neck.
// These are distributed across XSENS spine segments (Pelvis, L5, L3, T12, T8, Neck, Head).
const WINTER = {
  // Pelvis  — Winter Table 4.1: Pelvis (L4–L5/greater trochanter): mass=0.142, CoM from prox(L4–L5)=0.105
  // XSENS Pelvis segment vector goes inferior→superior toward L5/S1; CoM near superior end.
  Pelvis: [0.142, 0.895, 0.31],

  // L5 + L3  — Winter Abdomen (T12–L1/L4–L5): mass=0.139, CoM from prox(T12–L1)=0.44
  // Split equally across two XSENS lumbar segments.
  L5:  [0.070, 0.50, 0.30],
  L3:  [0.070, 0.44, 0.30],

  // T12 + T8  — Winter Thorax (C7–T1/T12–L1): mass=0.216, CoM from prox(C7–T1)=0.82
  // CoM is near the lower (T12–L1) end of the thorax; 0.82 applied to upper segment.
  T12: [0.108, 0.50, 0.30],
  T8:  [0.108, 0.82, 0.30],

  // Neck + Head  — Winter Head and neck (C7–T1/ear canal): mass=0.081, CoM from prox=1.000
  // Neck ~0.012 estimated; Head takes remainder.
  Neck: [0.012, 0.50, 0.30],
  Head: [0.069, 1.00, 0.495],

  // Shoulder  — Winter Table 4.1: no whole-body fraction listed; CoM from sternoclavicular=0.712
  RightShoulder: [0.009, 0.712, 0.30], LeftShoulder: [0.009, 0.712, 0.30],

  // Upper extremity  — exact Winter Table 4.1 values
  RightUpperArm: [0.028, 0.436, 0.322], LeftUpperArm: [0.028, 0.436, 0.322],
  RightForearm:  [0.016, 0.430, 0.303], LeftForearm:  [0.016, 0.430, 0.303],
  RightHand:     [0.006, 0.506, 0.297], LeftHand:     [0.006, 0.506, 0.297],

  // Lower extremity  — exact Winter Table 4.1 values
  RightUpperLeg: [0.100, 0.433, 0.323], LeftUpperLeg: [0.100, 0.433, 0.323],
  RightLowerLeg: [0.0465, 0.433, 0.302], LeftLowerLeg: [0.0465, 0.433, 0.302],
  RightFoot:     [0.0145, 0.500, 0.475], LeftFoot:     [0.0145, 0.500, 0.475],
  RightToe:      [0.002, 0.500, 0.300],  LeftToe:      [0.002, 0.500, 0.300],
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
// Quasi-static Newton-Euler inverse dynamics.
// Inertial terms (ma, Iα) are zero — valid for slow/sustained occupational tasks.
// Bottom-up from LoadSOL GRF for L5/S1; top-down from WiDACS for shoulders.
function computeInvDyn(mvnx, bodyMass, lsfData, forceData, forceOffset, forceDirKey, handSide) {
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

  // Quasi-static solve: ΣF=0, ΣM=0 (no inertial terms)
  const solve = (label, F_dist, M_dist, r_dist_force, frame) => {
    const idx = si[label];
    if (idx == null) return { F:[0,0,0], M:[0,0,0], r_prox:[0,0,0] };
    const [mf, cf] = WINTER[label] || [0.001, 0.5];
    const m  = mf * bodyMass;
    const r_prox     = vget(frame.pos, idx);
    const dLabel     = SEG_DISTAL[label];
    const r_dist_geo = dLabel && si[dLabel] != null ? vget(frame.pos, si[dLabel]) : vadd(r_prox,[0,0,0.1]);
    const r_com      = vadd(r_prox, vscale(vsub(r_dist_geo, r_prox), cf));
    // ΣF=0: F_prox = −F_dist − m·g  (g = G = [0,0,−9.81])
    const F_prox = vsub(vscale(G, -m), F_dist);
    // ΣM=0: M_prox = −M_dist − (r_prox−r_com)×F_prox − (r_dist−r_com)×F_dist
    const M_prox = vsub(vsub(vneg(M_dist),
      vcross(vsub(r_prox,       r_com), F_prox)),
      vcross(vsub(r_dist_force, r_com), F_dist));
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

    // ── Pelvis (quasi-static, dual hip inputs) ──
    const r_pelvis = vget(frame.pos, si['Pelvis']);
    const r_L5S1   = si['L5'] != null ? vget(frame.pos, si['L5']) : vadd(r_pelvis,[0,0,0.1]);
    const [mfP, cfP] = WINTER['Pelvis'];
    const m_p     = mfP * bodyMass;
    const r_com_p = vadd(r_pelvis, vscale(vsub(r_L5S1, r_pelvis), cfP));
    const F_hR    = vneg(R.thigh.F), M_hR = vneg(R.thigh.M);
    const F_hL    = vneg(L.thigh.F), M_hL = vneg(L.thigh.M);
    const r_hR    = vget(frame.pos, si['RightUpperLeg']);
    const r_hL    = vget(frame.pos, si['LeftUpperLeg']);
    // ΣF=0: F_L5S1 = −F_hR − F_hL − m_p·g
    const F_L5S1 = vsub(vsub(vscale(G, -m_p), F_hR), F_hL);
    // ΣM=0: M_L5S1 = −(r_L5S1−r_com)×F_L5S1 − (r_hR−r_com)×F_hR − (r_hL−r_com)×F_hL − M_hR − M_hL
    const tau_p  = vadd(vadd(
      vcross(vsub(r_L5S1, r_com_p), F_L5S1),
      vcross(vsub(r_hR,   r_com_p), F_hR)),
      vadd(vcross(vsub(r_hL, r_com_p), F_hL), vadd(M_hR, M_hL)));
    const M_L5S1 = vneg(tau_p);

    // ── Arms top-down (WiDACS), quasi-static ──
    const bilateral = handSide === 'bilateral';
    const doRight   = !handSide || handSide === 'right' || bilateral;
    const doLeft    = handSide === 'left' || bilateral;
    const dirs      = {'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1]};
    const armSolve  = (cap) => {
      const hand = `${cap}Hand`, fore = `${cap}Forearm`, upper = `${cap}UpperArm`;
      if (!forceData?.length || si[hand] == null) return null;
      const r_wrist = vget(frame.pos, si[hand]);
      const r_elbow = vget(frame.pos, si[fore] ?? si[upper]);
      const handDir = vnorm(vsub(r_wrist, r_elbow));
      const r_app   = vadd(r_wrist, vscale(handDir, 0.10));
      const fDir    = dirs[forceDirKey] || handDir;
      const F_app   = vscale(fDir, bilateral ? wF * 0.5 : wF);
      const h = solve(hand,  F_app,       [0,0,0],    r_app,       frame);
      const f = solve(fore,  vneg(h.F),   vneg(h.M),  h.r_prox,    frame);
      const u = solve(upper, vneg(f.F),   vneg(f.M),  f.r_prox,    frame);
      return u.M;
    };

    // FE ≈ M_Y (sagittal), LB ≈ M_X (frontal), AR ≈ M_Z (transverse), mag = resultant
    const fmt = M => ({
      FE: +M[1].toFixed(1), LB: +M[0].toFixed(1), AR: +M[2].toFixed(1),
      mag: +Math.sqrt(M[0]*M[0]+M[1]*M[1]+M[2]*M[2]).toFixed(1),
    });

    results.push({
      t:        +t.toFixed(3),
      L5S1:     fmt(M_L5S1),
      ...(doRight ? { shoulderR: fmt(armSolve('Right') || [0,0,0]) } : {}),
      ...(doLeft  ? { shoulderL: fmt(armSolve('Left')  || [0,0,0]) } : {}),
    });
  });
  return results;
}

// ── Force direction → SVG vector lookup (per skeleton view) ──────────────────
// World axes: XSENS Z-up frame → x=forward, y=left, z=up
// SVG: x increases right, y increases down
// Each entry: [dx, dy] unit vector in SVG space for the given world axis direction
const DIR_SVG = {
  //          front-view         side-view         top-view
  //          (proj: y,z)        (proj: x,z)       (proj: x,y → y inverted for SVG)
  "+x": { front:[ 0,-1], side:[ 1, 0], top:[ 1, 0] }, // forward → up in front, right in side, right in top
  "-x": { front:[ 0, 1], side:[-1, 0], top:[-1, 0] },
  "+y": { front:[-1, 0], side:[ 0, 0], top:[ 0,-1] }, // left → left in front, none in side, up in top
  "-y": { front:[ 1, 0], side:[ 0, 0], top:[ 0, 1] },
  "+z": { front:[ 0,-1], side:[ 0,-1], top:[ 0, 0] }, // up → up in both front/side, none in top
  "-z": { front:[ 0, 1], side:[ 0, 1], top:[ 0, 0] },
};

// ── Force Event: average N trials + optional plateau extension ───────────────
function computeAveraged(event, forceFiles) {
  const files = (event.fileIndices || []).map(i => forceFiles[i]).filter(f => f?.data?.length);
  if (!files.length) return [];
  const dt = files[0].data.length > 1 ? files[0].data[1].time - files[0].data[0].time : 0.002;
  const tMax = Math.min(...files.map(f => f.data[f.data.length - 1].time));
  const interp1 = (data, t) => {
    const i = data.findIndex(d => d.time >= t);
    if (i <= 0) return data[0]?.force ?? 0;
    if (i >= data.length) return data[data.length - 1]?.force ?? 0;
    const d0 = data[i-1], d1 = data[i];
    return d0.force + (t - d0.time) / ((d1.time - d0.time) || 1) * (d1.force - d0.force);
  };
  const base = [];
  for (let t = 0; t <= tMax + 1e-9; t = +(t + dt).toFixed(6)) {
    const vals = files.map(f => interp1(f.data, t));
    base.push({ time: +t.toFixed(3), force: +(vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(1) });
  }
  // Stop at: cut the curve at a specific time
  const stopAt = event.stopAt ?? null;
  let result = stopAt != null ? base.filter(d => d.time <= stopAt + 1e-9) : base;
  // Plateau extension: from plateauT, hold plateauF for plateauDur seconds
  const { plateauT, plateauF, plateauDur } = event;
  if (plateauT != null && plateauF != null && (plateauDur || 0) > 0) {
    const splitIdx = result.findIndex(d => d.time >= plateauT);
    const pre  = splitIdx >= 0 ? result.slice(0, splitIdx) : result;
    const nExt = Math.round(plateauDur / dt);
    const ext  = Array.from({length: nExt}, (_,i) => ({
      time: +(plateauT + (i+1) * dt).toFixed(3),
      force: plateauF,
      plateau: true,
    }));
    return [...pre, ...ext];
  }
  return result;
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
  const [open, setOpen] = useState(false);
  if (!job) return null;
  const nM = job.mvnxFiles?.length||0, nL = job.loadsolFiles?.length||0, nF = job.forceFiles?.length||0;
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
    <div style={{marginBottom:14}}>
      <button onClick={()=>setOpen(v=>!v)} style={{
        display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",
        background:C.card,border:`1px solid ${C.border}`,borderRadius:open?"8px 8px 0 0":8,
        padding:"6px 12px",cursor:"pointer",color:C.muted,fontSize:11}}>
        <span style={{fontSize:9}}>{open?"▼":"▶"}</span>
        <span style={{fontWeight:500,color:C.text}}>Files</span>
        <span style={{opacity:.6}}>{nM} MVNX · {nL} LoadSOL · {nF} WiDACS</span>
        <span style={{marginLeft:"auto",fontSize:10,color:C.accent}}>{open?"hide":"manage"}</span>
      </button>
      {open&&(
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",
          background:C.card,border:`1px solid ${C.border}`,borderTop:"none",
          borderRadius:"0 0 8px 8px",padding:"8px 12px"}}>
          {job.mvnxFiles.map((f,i)=>(
            <Chip key={i} color={C.teal} label={f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i,"")}
              onX={()=>onRemove("mvnx",i)}/>
          ))}
          <Chip color={C.teal} label="+ MVNX" onAdd={()=>onUpload("mvnx")}/>
          {(job.loadsolFiles||[]).map((f,i)=>(
            <Chip key={i} color={C.sky} label={f.name} onX={()=>onRemove("loadsol",i)}/>
          ))}
          <Chip color={C.sky} label="+ LoadSOL" onAdd={()=>onUpload("loadsol")}/>
          {(job.forceFiles||[]).map((f,i)=>(
            <Chip key={i} color={C.violet} label={f.name} onX={()=>onRemove("force",i)}/>
          ))}
          <Chip color={C.violet} label="+ Force CSV" onAdd={()=>onUpload("force")}/>
        </div>
      )}
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

// ── Error boundary — catches render crashes and shows the error instead of black screen ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error('Render error:', e, info); }
  render() {
    if (this.state.error) return (
      <div style={{background:C.card,border:`1px solid ${C.red}`,borderRadius:10,padding:20,margin:16,color:C.text}}>
        <div style={{fontWeight:700,color:C.red,marginBottom:8}}>Render error (check console)</div>
        <pre style={{fontSize:11,color:C.muted,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{this.state.error?.message}</pre>
        <button onClick={()=>this.setState({error:null})} style={{marginTop:10,padding:"4px 12px",borderRadius:6,background:C.accent,color:"#000",border:"none",cursor:"pointer",fontSize:12}}>Dismiss</button>
      </div>
    );
    return this.props.children;
  }
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
  return <ErrorBoundary><Dashboard session={session}/></ErrorBoundary>;
}


// ── Main Dashboard ────────────────────────────────────────────────────────────
function Dashboard({ session }) {
  const [jobs,        setJobs]        = useState([]);
  const [activeJobId, setActiveJobId] = useState(() => localStorage.getItem('bmech_activeJob') || null);
  const [tab,         setTab]         = useState(0);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [filesLoading,setFilesLoading]= useState(false);
  const [loadingMsg,   setLoadingMsg]  = useState("");

  const [saveError,       setSaveError]       = useState(null);

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
  const [bodyMass,       setBodyMass]       = useState(75);

  // Force files — per-file settings keyed by storagePath
  const [forceFileSets,  setForceFileSets]  = useState({});  // {[sp]: {offset, dirKey}}
  const [activeForceIdx, setActiveForceIdx] = useState(0);

  // Force events — grouped measurements per task type
  const [forceEvents,    setForceEvents]    = useState({}); // keyed by MVNX storagePath
  // [{id,label,type,hand,tStart,fileIndices[],plateauT,plateauF,plateauDur}]
  const [activeEventId,  setActiveEventId]  = useState(null);
  const [showForcePanel, setShowForcePanel] = useState(false);
  // Plateau: double-click a point → modal to enter duration
  const [plateauModal,   setPlateauModal]   = useState(null); // {t, f, durStr}
  const fpChartRef                          = useRef(null);

  // Forces / settings
  const [forceBlocks,    setForceBlocks]    = useState([]); // kept for DB compat, UI removed
  const [showTriggerCh,    setShowTriggerCh]    = useState(false);
  const [showMomComponents,setShowMomComponents] = useState(false);

  const fileInputRef       = useRef();
  const loadedJobsRef      = useRef(new Set());
  const readyToSaveRef     = useRef(false);

  const activeJob = jobs.find(j => j.id === activeJobId);

  // Derived force file — per-file offset + direction from forceFileSets
  const activeForce      = activeJob?.forceFiles?.[activeForceIdx] ?? null;
  const _afSets          = forceFileSets[activeForce?.storagePath] ?? {};
  const forceOffset      = _afSets.offset  ?? 0;
  const forceDirKey      = _afSets.dirKey   ?? 'hand';
  const setForceOffset   = v => { if (!activeForce) return; setForceFileSets(p => ({...p, [activeForce.storagePath]: {...(p[activeForce.storagePath]||{}), offset: v}})); };
  const setForceDirKey   = v => { if (!activeForce) return; setForceFileSets(p => ({...p, [activeForce.storagePath]: {...(p[activeForce.storagePath]||{}), dirKey: v}})); };

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
          forceFiles: [],
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
        return await blobToText(data);
      };

      const mvnxRecs  = records.filter(r => r.file_type === "mvnx").sort((a,b) => a.sort_order - b.sort_order);
      const lsRecs    = records.filter(r => r.file_type === "loadsol").sort((a,b) => a.sort_order - b.sort_order);
      const forceRecs = records.filter(r => r.file_type === "force").sort((a,b) => a.sort_order - b.sort_order);

      const total = mvnxRecs.length + lsRecs.length + forceRecs.length;
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

      const forceFiles = [];
      for (const fRec of forceRecs) {
        const text = await dl(`${fRec.file_name} (${++done}/${total})`, fRec.storage_path);
        if (text) {
          const p = parseForceFile(text);
          if (p.ok) forceFiles.push({ id: fRec.id, storagePath: fRec.storage_path, name: fRec.file_name, ...p });
        }
      }

      setJobs(prev => prev.map(j => j.id === activeJobId ? { ...j, mvnxFiles, loadsolFiles, forceFiles } : j));
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
    setForceBlocks([]);
    setJointPanels([{jointKey:0, planes:4}]);
    setSkelFrame(0); setSkelFileIdx(0); setSkelPlaying(false);
    setSkelLoadsolIdx(0); setLoadsolPairings({});
    setBodyMass(75); setForceFileSets({}); setActiveForceIdx(0);
    setForceEvents({}); setActiveEventId(null); setShowForcePanel(false);

    const { data } = await supabase
      .from("job_settings")
      .select("*")
      .eq("job_id", jobId)
      .maybeSingle();

    if (data) {
      // force_blocks stores legacy array OR wrapped object {blocks, events, fileSets}
      const fb = data.force_blocks;
      if (Array.isArray(fb)) {
        setForceBlocks(fb);
      } else if (fb && typeof fb === 'object') {
        setForceBlocks(fb.blocks || []);
        if (fb.events && !Array.isArray(fb.events)) {
          setForceEvents(fb.events); // { [mvnxPath]: [...] }
        } else if (Array.isArray(fb.events) && fb.events.length) {
          setForceEvents({ '__default__': fb.events }); // legacy migration
          setActiveEventId(fb.events[0]?.id || null);
        }
        if (fb.fileSets) setForceFileSets(fb.fileSets);
      }
      if (data.joint_panels?.length) {
        setJointPanels(data.joint_panels.map(p => ({
          ...p,
          planes: typeof p.planes === 'number' ? p.planes : (p.planes || [0]).reduce((m,x) => m|(1<<x), 0),
        })));
      }
      if (data.loadsol_pairings) setLoadsolPairings(data.loadsol_pairings);
      if (data.body_mass > 0)    setBodyMass(data.body_mass);
    }
    // Short delay so the save effect doesn't fire immediately after loading
    setTimeout(() => { readyToSaveRef.current = true; }, 600);
  };

  // ── Auto-save settings when they change ──────────────────────────────────
  useEffect(() => {
    if (!activeJobId || !readyToSaveRef.current) return;
    const timer = setTimeout(async () => {
      const payload = {
        force_blocks: { blocks: forceBlocks, events: forceEvents, fileSets: forceFileSets },
        joint_panels: jointPanels,
        loadsol_pairings: loadsolPairings,
        body_mass: bodyMass,
        updated_at: new Date().toISOString(),
      };
      // Try update first; if no row exists yet, insert
      const { data: updated, error: updateErr } = await supabase
        .from("job_settings").update(payload).eq("job_id", activeJobId).select("job_id");
      if (updateErr) {
        console.error("[biomechanics] settings save failed:", updateErr.message);
        setSaveError(updateErr.message); return;
      }
      if (!updated?.length) {
        const { error: insertErr } = await supabase
          .from("job_settings").insert({ job_id: activeJobId, ...payload });
        if (insertErr) {
          console.error("[biomechanics] settings insert failed:", insertErr.message);
          setSaveError(insertErr.message); return;
        }
      }
      setSaveError(null);
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeJobId, forceBlocks, jointPanels, loadsolPairings, bodyMass, forceFileSets, forceEvents]); // eslint-disable-line

  // ── Remember active job across refreshes ─────────────────────────────────
  useEffect(() => {
    if (activeJobId) localStorage.setItem('bmech_activeJob', activeJobId);
    else localStorage.removeItem('bmech_activeJob');
  }, [activeJobId]);

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
      const job = { ...data, createdAt: new Date(data.created_at).toLocaleDateString(), mvnxFiles: [], loadsolFiles: [], forceFiles: [], _fileRecords: [] };
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
      const text = await blobToText(file);
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
      const sortOrder = uploadType === "mvnx"    ? (activeJob?.mvnxFiles?.length    || 0)
                      : uploadType === "loadsol" ? (activeJob?.loadsolFiles?.length  || 0)
                      : uploadType === "force"   ? (activeJob?.forceFiles?.length    || 0) : 0;
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
        if (uploadType === "force")   return { ...j, forceFiles: [...(j.forceFiles||[]), f], _fileRecords: [...j._fileRecords, rec] };
        return j;
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
    if (type === "force")   fileObj = job.forceFiles[idx];
    if (!fileObj) return;

    if (fileObj.storagePath) await supabase.storage.from(BUCKET).remove([fileObj.storagePath]);
    if (fileObj.id) await supabase.from("job_files").delete().eq("id", fileObj.id);

    setJobs(prev => prev.map(j => {
      if (j.id !== activeJobId) return j;
      if (type === "mvnx")    return { ...j, mvnxFiles: j.mvnxFiles.filter((_,i) => i !== idx) };
      if (type === "loadsol") return { ...j, loadsolFiles: j.loadsolFiles.filter((_,i) => i !== idx) };
      if (type === "force")   return { ...j, forceFiles: j.forceFiles.filter((_,i) => i !== idx) };
      return j;
    }));
    if (type === "force") {
      setActiveForceIdx(prev => Math.max(0, Math.min(prev, job.forceFiles.length - 2)));
      setForceEvents(prev => {
        const updated = {};
        for (const [key, evs] of Object.entries(prev)) {
          updated[key] = evs.map(ev => ({
            ...ev,
            fileIndices: (ev.fileIndices || [])
              .filter(i => i !== idx)
              .map(i => i > idx ? i - 1 : i),
          }));
        }
        return updated;
      });
    }
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
    if (!activeForce?.data) return [];
    return activeForce.data.map(d => ({...d, time:+(d.time+forceOffset).toFixed(3)}));
  }, [activeForce, forceOffset]);

  const extendedForce = null;

  // Memoised joint panel data — only recomputes when panels or MVNX file changes,
  // NOT on every skelFrame tick. This prevents Recharts from reinitialising every frame.
  const activeSkelMvnx = activeJob?.mvnxFiles?.[skelFileIdx];

  // Component-level force event accessors for the active MVNX file (used by both Skeleton and Forces tabs)
  const mvnxKey = activeSkelMvnx?.storagePath || '__default__';
  const curEvs  = forceEvents[mvnxKey] || [];
  const setCurEvs = updater => setForceEvents(prev => ({
    ...prev,
    [mvnxKey]: typeof updater === 'function' ? updater(prev[mvnxKey] || []) : updater,
  }));
  const activeEvent   = curEvs.find(e => e.id === activeEventId) || null;
  const forceFilesList = activeJob?.forceFiles || [];
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

  // Active LoadSOL — null if no pairing set (or explicitly "none")
  // Auto-pair only when there is exactly one LoadSOL file and no explicit entry
  const _lsAll = activeJob?.loadsolFiles || [];
  const lsfIdx = (skelFileIdx in loadsolPairings)
    ? loadsolPairings[skelFileIdx]
    : (_lsAll.length === 1 ? 0 : null);
  const activeLsf = (lsfIdx != null) ? (_lsAll[lsfIdx] ?? null) : null;

  // Clipped LoadSOL data aligned to XSENS t=0
  const clippedLsf = useMemo(() => {
    if (!activeLsf?.data?.length) return null;
    if (activeLsf.blipTime == null) return activeLsf.data;
    return activeLsf.data
      .filter(d => d.time >= activeLsf.blipTime)
      .map(d => ({...d, time: +(d.time - activeLsf.blipTime).toFixed(3)}));
  }, [activeLsf]);

  // Pre-compute averaged data for all force events (keyed by event id)
  // so animation frames never call computeAveraged directly
  const allEvAveraged = useMemo(() => {
    try {
      const forceFilesList = activeJob?.forceFiles || [];
      const result = {};
      for (const evs of Object.values(forceEvents)) {
        for (const ev of evs) {
          result[ev.id] = computeAveraged(ev, forceFilesList);
        }
      }
      return result;
    } catch(e) { console.error('allEvAveraged crash:', e); return {}; }
  }, [forceEvents, activeJob?.forceFiles]); // eslint-disable-line

  const averagedEvData = activeEvent ? (allEvAveraged[activeEvent.id] || []) : [];

  // Active force event averaged data (preferred over raw file for Dynamics)
  const activeEvForDyn = useMemo(() => {
    try {
      const allEvs = Object.values(forceEvents).flat();
      const ev = allEvs.find(e => e.id === activeEventId);
      if (!ev || !(ev.fileIndices?.length)) return null;
      const avg = allEvAveraged[ev.id] || [];
      if (!avg.length) return null;
      // Shift to align with XSENS timeline (tStart)
      return { data: avg.map(d => ({...d, time: +(d.time + (ev.tStart||0)).toFixed(3)})), tStart: ev.tStart||0, dirKey: ev.hand==='left'?'-y':'+y', hand: ev.hand||'right' };
    } catch(e) { console.error('activeEvForDyn crash:', e); return null; }
  }, [forceEvents, activeEventId, activeJob?.forceFiles]); // eslint-disable-line

  // Inverse dynamics — recomputes only when inputs change, NOT per frame
  const invDynData = useMemo(() => {
    try {
      const fd       = activeEvForDyn?.data || activeForce?.data;
      const fDir     = activeEvForDyn?.dirKey || forceDirKey;
      const fOff     = activeEvForDyn ? 0 : (activeLsf?.blipTime ?? forceOffset);
      const handSide = activeEvForDyn?.hand || 'right';
      return computeInvDyn(activeSkelMvnx, bodyMass, clippedLsf, fd, fOff, fDir, handSide);
    } catch(e) { console.error('invDynData crash:', e); return []; }
  }, [activeSkelMvnx, bodyMass, clippedLsf, activeForce, forceOffset, forceDirKey, activeEvForDyn]); // eslint-disable-line

  // ── Forces right column (memoized so skeleton playback doesn't re-render charts) ──
  const forcesRightCol = useMemo(() => {
    try {
      const mvnxFiles = activeJob?.mvnxFiles || [];
      const hasMvnx   = !!activeSkelMvnx?.frames?.length;
      const hasData   = invDynData?.length > 0;
      const hasLS     = !!clippedLsf?.length;
      const evStart   = activeEvent?.tStart ?? null;
      const evDur     = averagedEvData.length ? averagedEvData[averagedEvData.length-1].time : 0;
      const evEnd     = evStart != null ? evStart + evDur : null;

      const jChart = (title, dataKey, color=C.accent) => {
        const d = invDynData?.map(r => {
          const v = r[dataKey];
          if (!v) return null;
          return { t: r.t, mag: v.mag, FE: v.FE, LB: v.LB, AR: v.AR };
        }).filter(Boolean) || [];
        if (!d.length) return null;
        const peakMag = Math.max(...d.map(r => r.mag||0));
        return (
          <ChartCard key={dataKey} title={<span>{title}<span style={{fontSize:10,color:C.muted,marginLeft:6}}>peak {peakMag.toFixed(0)} Nm</span></span>} h={190}>
            <ResponsiveContainer>
              <LineChart data={d}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="t" type="number" tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="s"/>
                <YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="Nm"/>
                <Tooltip content={Tt}/>
                <ReferenceLine y={0} stroke={C.border} strokeDasharray="3 3"/>
                {evStart!=null && evEnd!=null && (
                  <ReferenceArea x1={evStart} x2={evEnd} fill={C.accent} fillOpacity={0.08}/>
                )}
                {showMomComponents ? (
                  <>
                    <Line type="monotone" dataKey="FE" stroke={C.teal}  dot={false} strokeWidth={1.5} name="FE (flex/ext)"/>
                    <Line type="monotone" dataKey="LB" stroke={C.amber} dot={false} strokeWidth={1.5} name="LB (lat bend)"/>
                    <Line type="monotone" dataKey="AR" stroke={C.rose}  dot={false} strokeWidth={1.5} name="AR (axial rot)"/>
                    <Legend wrapperStyle={{fontSize:9}}/>
                  </>
                ) : (
                  <Line type="monotone" dataKey="mag" stroke={color} dot={false} strokeWidth={2} name="Resultant"/>
                )}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        );
      };

      return (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Config bar */}
          <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",
            background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:12,color:C.muted}}>Body mass:</span>
              <input type="number" step="any" min={20} max={250} value={bodyMass}
                onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>0)setBodyMass(v);}}
                style={{width:58,background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:"3px 8px",color:C.accent,fontSize:12}}/>
              <span style={{fontSize:12,color:C.muted}}>kg</span>
            </div>
            {mvnxFiles.length > 1 && (
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:12,color:C.muted}}>MVNX:</span>
                <select value={skelFileIdx} onChange={e=>setSkelFileIdx(+e.target.value)}
                  style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:"3px 6px",color:C.text,fontSize:11}}>
                  {mvnxFiles.map((f,i)=><option key={i} value={i}>{f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i,"")}</option>)}
                </select>
              </div>
            )}
            <div style={{fontSize:11,color:C.muted,marginLeft:"auto"}}>
              {hasMvnx?"✓ MVNX":"✗ MVNX"} · {hasLS?"✓ LoadSOL":"✗ LoadSOL"}
              {activeLsf?.blipTime!=null && <span style={{color:C.amber,marginLeft:6}}>⚡ blip {activeLsf.blipTime.toFixed(2)}s</span>}
            </div>
          </div>

          {/* Charts / empty states */}
          {!hasMvnx ? (
            <EmptyState icon="⚙️" title="No MVNX loaded" detail="Select a job with MVNX data to compute shoulder moments."/>
          ) : !hasData ? (
            <EmptyState icon="📐" title="No dynamics data" detail="Assign force events to hands to compute shoulder moments."/>
          ) : (
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,
                borderBottom:`1px solid ${C.accent}40`,paddingBottom:6}}>
                <span style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:"uppercase",letterSpacing:.5}}>
                  Shoulder Moments — Quasi-Static
                </span>
                <button onClick={()=>setShowMomComponents(v=>!v)} style={{
                  marginLeft:"auto",background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                  padding:"3px 10px",color:showMomComponents?C.accent:C.muted,fontSize:11,cursor:"pointer"}}>
                  {showMomComponents ? "Show resultant" : "Show FE / LB / AR"}
                </button>
              </div>
              {!hasLS && (
                <div style={{background:C.amber+"15",border:`1px solid ${C.amber}40`,borderRadius:8,
                  padding:"8px 12px",fontSize:11,color:C.amber}}>
                  No LoadSOL paired — L5/S1 bottom-up will be zero. Pair in Skeleton tab.
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14}}>
                {jChart("L5/S1 — Bottom-Up (via LoadSOL)", "L5S1", C.sky)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14}}>
                {jChart("Right Shoulder", "shoulderR", C.amber)}
                {jChart("Left Shoulder",  "shoulderL", C.emerald)}
              </div>
              {/* Peak table */}
              <div style={{overflowX:"auto",background:C.card,border:`1px solid ${C.border}`,borderRadius:8}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${C.border}`}}>
                      {["Joint","Peak (Nm)",...(showMomComponents?["Peak FE","Peak LB","Peak AR"]:[])].map(h=>(
                        <th key={h} style={{textAlign:"left",padding:"7px 12px",color:C.muted,fontWeight:600}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {label:"L5/S1 (bottom-up)", key:"L5S1",     clr:C.sky},
                      {label:"R Shoulder",         key:"shoulderR", clr:C.amber},
                      {label:"L Shoulder",         key:"shoulderL", clr:C.emerald},
                    ].map(({label,key,clr}) => {
                      const d = invDynData.map(r => r[key]).filter(Boolean);
                      if (!d.length) return null;
                      const pk = c => Math.max(...d.map(r => Math.abs(r[c]||0))).toFixed(1);
                      return (
                        <tr key={key} style={{borderBottom:`1px solid ${C.border}20`}}>
                          <td style={{padding:"6px 12px",color:clr,fontWeight:500}}>{label}</td>
                          <td style={{padding:"6px 12px",color:C.accent,fontWeight:600}}>{pk("mag")}</td>
                          {showMomComponents&&<td style={{padding:"6px 12px",color:C.teal}}>{pk("FE")}</td>}
                          {showMomComponents&&<td style={{padding:"6px 12px",color:C.amber}}>{pk("LB")}</td>}
                          {showMomComponents&&<td style={{padding:"6px 12px",color:C.rose}}>{pk("AR")}</td>}
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
    } catch(e) { console.error('forcesRightCol crash:', e); return <div style={{color:C.red,padding:20}}>Chart render error (see console)</div>; }
  }, [invDynData, showMomComponents, activeEvent, averagedEvData, activeLsf, clippedLsf, bodyMass, skelFileIdx, activeSkelMvnx, activeJob?.mvnxFiles]); // eslint-disable-line

  // ── Shared constants ─────────────────────────────────────────────────────────
  const TYPE_OPTS = ['push','lift','pinch','pull','carry'];
  const HAND_OPTS = [{v:'right',l:'Right'},{v:'left',l:'Left'},{v:'bilateral',l:'Both'}];
  const DIR_OPTS  = [
    {v:'auto',l:'Auto (hand axis)'},{v:'+x',l:'Forward (+X)'},{v:'-x',l:'Backward (−X)'},
    {v:'+y',l:'Left (+Y)'},{v:'-y',l:'Right (−Y)'},{v:'+z',l:'Up (+Z)'},{v:'-z',l:'Down (−Z)'},
  ];

  // ── Skeleton viewer core (SVG + playback controls) — used by Skeleton & Forces tabs ──
  const renderSkeletonCore = ({showForcePanelToggle=true}={}) => {
    const mvnx   = activeSkelMvnx;
    const hasData = !!mvnx?.frames?.length;
    const frame  = hasData ? mvnx.frames[Math.min(skelFrame, mvnx.frames.length-1)] : null;
    const positions = frame?.pos?.length ? frame.pos : REF_POS;
    const boneList  = mvnx?.bones?.length ? mvnx.bones : BONES;
    const W=300, H=420;
    const pts = projectPos(positions, skelView, W, H);
    const ft  = frame?.time || 0;

    return (
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
        <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:10}}>
          {["front","side","top"].map(v=>(
            <Btn key={v} active={skelView===v} small onClick={()=>setSkelView(v)}>{v[0].toUpperCase()+v.slice(1)}</Btn>
          ))}
        </div>
        <svg width={W} height={H} style={{display:"block",margin:"0 auto"}}>
          <rect width={W} height={H} fill={C.bg} rx={8}/>
          {[0.25,0.5,0.75].map(p=>(
            <line key={p} x1={0} y1={H*p} x2={W} y2={H*p} stroke={C.border} strokeWidth={0.5} strokeDasharray="4 4"/>
          ))}
          {pts.length>0&&boneList.map(([a,b],i)=>{
            const pa=pts[a],pb=pts[b]; if(!pa||!pb) return null;
            const la=mvnx?.segLabels?.[a]||"",lb=mvnx?.segLabels?.[b]||"";
            const isR=/right/i.test(la)||/right/i.test(lb);
            const isL=/left/i.test(la)||/left/i.test(lb);
            return <line key={i} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]}
              stroke={isR?C.sky:isL?C.rose:C.amber} strokeWidth={isR||isL?3:4} strokeLinecap="round"/>;
          })}
          {pts.map((pt,i)=>{
            if(!pt) return null;
            const lbl=mvnx?.segLabels?.[i]||"";
            return <circle key={i} cx={pt[0]} cy={pt[1]} r={/head/i.test(lbl)?7:4}
              fill={/head/i.test(lbl)?C.amber:C.accent} opacity={0.9}/>;
          })}
          {/* Force arrows */}
          {(()=>{
            if(!curEvs.length) return null;
            const arrows=[], segLabels=mvnx?.segLabels||[];
            const rHi=segLabels.findIndex(l=>/right.*hand|hand.*right/i.test(l));
            const lHi=segLabels.findIndex(l=>/left.*hand|hand.*left/i.test(l));
            curEvs.forEach(ev=>{
              if(!ev.fileIndices?.length) return;
              const avgData=allEvAveraged[ev.id]||[];
              if(!avgData.length) return;
              const localT=ft-(ev.tStart||0);
              if(localT<0||localT>avgData[avgData.length-1].time+0.5) return;
              let forceMag=0;
              if(localT<=avgData[0].time) forceMag=avgData[0].force;
              else if(localT>=avgData[avgData.length-1].time) forceMag=avgData[avgData.length-1].force;
              else { for(let k=0;k<avgData.length-1;k++){if(localT>=avgData[k].time&&localT<=avgData[k+1].time){const frac=(localT-avgData[k].time)/(avgData[k+1].time-avgData[k].time);forceMag=avgData[k].force+frac*(avgData[k+1].force-avgData[k].force);break;}}}
              if(forceMag<1) return;
              const peakForce=Math.max(...avgData.map(d=>d.force),1);
              const arrowLen=Math.max(12,(forceMag/peakForce)*70);
              const dirKey=ev.direction||'auto';
              let svgDir=null;
              if(dirKey!=='auto'&&DIR_SVG[dirKey]){const vec=DIR_SVG[dirKey][skelView]||[0,-1];const m=Math.sqrt(vec[0]**2+vec[1]**2)||1;svgDir=[vec[0]/m,vec[1]/m];}
              const hands=ev.hand==='bilateral'?[rHi,lHi]:ev.hand==='left'?[lHi]:[rHi];
              hands.forEach((hIdx,hi)=>{
                if(hIdx<0||!pts[hIdx]) return;
                const[hx,hy]=pts[hIdx];
                let dx=0,dy=-1;
                if(!svgDir){const isRight=ev.hand==='right'||(ev.hand==='bilateral'&&hi===0);const fIdx=segLabels.findIndex(l=>isRight?/right.*(forearm|lowerarm|wrist)/i.test(l):/left.*(forearm|lowerarm|wrist)/i.test(l));if(fIdx>=0&&pts[fIdx]){const[fx,fy]=pts[fIdx];const rm=Math.sqrt((hx-fx)**2+(hy-fy)**2)||1;dx=(hx-fx)/rm;dy=(hy-fy)/rm;}}else[dx,dy]=svgDir;
                const tipX=hx+dx*arrowLen,tipY=hy+dy*arrowLen;
                const hl=8,ang=Math.atan2(dy,dx);
                const color=ev.hand==='left'||(ev.hand==='bilateral'&&hi===1)?"#4ade80":"#fbbf24";
                arrows.push(<g key={`arr-${ev.id}-${hi}`}>
                  <line x1={hx} y1={hy} x2={tipX} y2={tipY} stroke={color} strokeWidth={2.5} strokeLinecap="round"/>
                  <line x1={tipX} y1={tipY} x2={tipX-hl*Math.cos(ang-0.5)} y2={tipY-hl*Math.sin(ang-0.5)} stroke={color} strokeWidth={2.5} strokeLinecap="round"/>
                  <line x1={tipX} y1={tipY} x2={tipX-hl*Math.cos(ang+0.5)} y2={tipY-hl*Math.sin(ang+0.5)} stroke={color} strokeWidth={2.5} strokeLinecap="round"/>
                  <text x={tipX+dx*4} y={tipY+dy*4+4} fill={color} fontSize={9} textAnchor="middle" fontWeight="bold">{forceMag.toFixed(0)}N</text>
                </g>);
              });
            });
            return arrows;
          })()}
          {!hasData&&<text x={W/2} y={H-16} textAnchor="middle" fill={C.muted} fontSize={11}>Reference pose — upload MVNX</text>}
        </svg>
        {hasData ? (
          <div style={{marginTop:10}}>
            <div style={{display:"flex",gap:5,justifyContent:"center",marginBottom:6,flexWrap:"wrap"}}>
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
        {showForcePanelToggle&&(
          <div style={{marginTop:12,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
            <Btn active={showForcePanel} onClick={()=>setShowForcePanel(p=>!p)}
              style={{width:"100%",justifyContent:"center",textAlign:"center"}}>
              {showForcePanel?"✕ Close Force Panel":"⚡ Force Events"}
            </Btn>
          </div>
        )}
      </div>
    );
  };

  // ── Force event panel — used by Skeleton & Forces tabs ────────────────────
  const renderForcePanel = () => {
    const updateEvent = (patch) => setCurEvs(prev =>
      prev.map(e => e.id === activeEventId ? {...e, ...patch} : e));
    const handleChartDblClick = (e) => {
      if(!activeEvent||!averagedEvData.length) return;
      const container=fpChartRef.current; if(!container) return;
      const rect=container.getBoundingClientRect();
      const plotLeft=52,plotWidth=rect.width-8-plotLeft;
      const domainMax=averagedEvData[averagedEvData.length-1]?.time||1;
      const xFrac=Math.max(0,Math.min(1,(e.clientX-rect.left-plotLeft)/plotWidth));
      const t=+(xFrac*domainMax).toFixed(3);
      const near=averagedEvData.reduce((best,d)=>Math.abs(d.time-t)<Math.abs(best.time-t)?d:best,averagedEvData[0]);
      setPlateauModal({t:near.time,f:near.force,durStr:activeEvent.plateauDur>0?String(activeEvent.plateauDur):'1'});
    };
    const validTrials=(activeEvent?.fileIndices||[]).filter(i=>i<forceFilesList.length).length;
    const stride=Math.max(1,Math.floor(averagedEvData.length/400));
    const displayData=averagedEvData.filter((_,i)=>i%stride===0);

    return (
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14,
        display:"flex",flexDirection:"column",gap:10,overflow:"auto",maxHeight:"calc(100vh - 200px)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.accent,textTransform:"uppercase",letterSpacing:.5}}>Force Events</div>
          <Btn small active onClick={()=>{
            const id=`ev_${Date.now()}`;
            const newEv={id,label:`Event ${curEvs.length+1}`,type:'push',hand:'right',
              direction:'auto',tStart:0,fileIndices:[],stopAt:null,plateauT:null,plateauF:null,plateauDur:0};
            setCurEvs(prev=>[...prev,newEv]);
            setActiveEventId(id);
          }}>+ New</Btn>
        </div>
        {curEvs.length===0&&(
          <div style={{fontSize:11,color:C.muted,padding:"10px 0",textAlign:"center"}}>No events yet — click + New to create one.</div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {curEvs.map(ev=>{
            const nTrials=(ev.fileIndices||[]).filter(i=>i<forceFilesList.length).length;
            const isActive=ev.id===activeEventId;
            return (
              <div key={ev.id} onClick={()=>setActiveEventId(ev.id)} style={{
                display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:7,cursor:"pointer",
                background:isActive?C.accent+"18":"transparent",border:`1px solid ${isActive?C.accent:C.border}`}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:isActive?600:400,color:isActive?C.accent:C.text,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.label}</div>
                  <div style={{fontSize:10,color:C.muted}}>{ev.type} · {ev.hand} · {nTrials} trial{nTrials!==1?'s':''}</div>
                </div>
                <Btn small danger onClick={e=>{e.stopPropagation();
                  setCurEvs(prev=>prev.filter(x=>x.id!==ev.id));
                  if(activeEventId===ev.id) setActiveEventId(null);
                }}>×</Btn>
              </div>
            );
          })}
        </div>
        {activeEvent&&(
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,display:"flex",flexDirection:"column",gap:8}}>
            <input value={activeEvent.label} onChange={e=>updateEvent({label:e.target.value})}
              style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",
                color:C.text,fontSize:12,width:"100%",boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {TYPE_OPTS.map(t=>(
                <Btn key={t} small active={activeEvent.type===t} onClick={()=>updateEvent({type:t})}>{t}</Btn>
              ))}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:C.muted,minWidth:36}}>Hand:</span>
              {HAND_OPTS.map(({v,l})=>(
                <Btn key={v} small active={activeEvent.hand===v} onClick={()=>updateEvent({hand:v})}>{l}</Btn>
              ))}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:C.muted,minWidth:36}}>Dir:</span>
              <select value={activeEvent.direction||'auto'} onChange={e=>updateEvent({direction:e.target.value})}
                style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:"3px 6px",color:C.text,fontSize:11,flex:1}}>
                {DIR_OPTS.map(({v,l})=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:C.muted,minWidth:36}}>Start:</span>
              <input type="number" step="0.01" value={activeEvent.tStart??0}
                onChange={e=>updateEvent({tStart:parseFloat(e.target.value)||0})}
                style={{width:70,background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,
                  padding:"3px 8px",color:C.accent,fontSize:11}}/>
              <span style={{fontSize:11,color:C.muted}}>s</span>
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:2}}>Trials (WiDACS files):</div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {forceFilesList.map((f,fi)=>{
                const sel=(activeEvent.fileIndices||[]).includes(fi);
                return (
                  <div key={fi} onClick={()=>updateEvent({fileIndices:sel?(activeEvent.fileIndices||[]).filter(x=>x!==fi):[...(activeEvent.fileIndices||[]),fi]})}
                    style={{display:"flex",alignItems:"center",gap:7,padding:"4px 8px",borderRadius:5,cursor:"pointer",
                      background:sel?C.violet+"20":"transparent",border:`1px solid ${sel?C.violet:C.border}`}}>
                    <span style={{fontSize:10,color:sel?C.violet:C.muted}}>{sel?"✓":"○"}</span>
                    <span style={{fontSize:11,color:sel?C.text:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                  </div>
                );
              })}
              {forceFilesList.length===0&&<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No WiDACS files uploaded yet.</div>}
            </div>
            {validTrials>0&&(
              <>
                <div ref={fpChartRef} style={{height:120}} onDoubleClick={handleChartDblClick}>
                  <ResponsiveContainer>
                    <LineChart data={displayData} margin={{left:0,right:8,top:4,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis dataKey="time" type="number" domain={["auto","auto"]} tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="s"/>
                      <YAxis tick={{fill:C.muted,fontSize:9}} stroke={C.border} unit="N" width={44}/>
                      <Tooltip content={Tt}/>
                      <Line type="monotone" dataKey="force" stroke={C.violet} dot={false} strokeWidth={2} name="Avg force"/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {validTrials>1&&(()=>{
                  const traces=(activeEvent.fileIndices||[]).filter(fi=>fi<forceFilesList.length)
                    .map((fi,i)=>{const f=forceFilesList[fi];if(!f?.data)return null;const s=Math.max(1,Math.floor(f.data.length/200));return{data:f.data.filter((_,j)=>j%s===0),color:CYCLE_COLORS[i%CYCLE_COLORS.length]};}).filter(Boolean);
                  return (<div style={{height:60,marginTop:4}}><ResponsiveContainer>
                    <LineChart margin={{left:0,right:8,top:2,bottom:0}}>
                      <XAxis type="number" dataKey="time" domain={["auto","auto"]} tick={{fill:C.muted,fontSize:8}} stroke={C.border} unit="s"/>
                      <YAxis tick={{fill:C.muted,fontSize:8}} stroke={C.border} unit="N" width={44}/>
                      {traces.map((tr,i)=><Line key={i} data={tr.data} type="monotone" dataKey="force" stroke={tr.color} dot={false} strokeWidth={1} opacity={0.5} name={`T${i+1}`}/>)}
                    </LineChart>
                  </ResponsiveContainer></div>);
                })()}
              </>
            )}
          </div>
        )}
        {plateauModal&&activeEvent&&(
          <div style={{position:"fixed",inset:0,background:"#00000080",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}
            onClick={()=>setPlateauModal(null)}>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:24,width:320}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4}}>Extend Plateau</div>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>
                At <b style={{color:C.accent}}>{plateauModal.t.toFixed(3)}s</b>, force = <b style={{color:C.violet}}>{plateauModal.f.toFixed(1)} N</b>
              </div>
              <input type="number" step="0.1" min={0} autoFocus value={plateauModal.durStr}
                onChange={e=>setPlateauModal(m=>({...m,durStr:e.target.value}))}
                onKeyDown={e=>{if(e.key==='Enter'){const v=parseFloat(plateauModal.durStr);if(!isNaN(v)&&v>0){setCurEvs(prev=>prev.map(ev=>ev.id===activeEventId?{...ev,plateauT:plateauModal.t,plateauF:plateauModal.f,plateauDur:v}:ev));setPlateauModal(null);}}if(e.key==='Escape')setPlateauModal(null);}}
                style={{width:"100%",background:C.bg,border:`1px solid ${C.accent}`,borderRadius:6,padding:"8px 12px",color:C.text,fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:16}}/>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <Btn small onClick={()=>setPlateauModal(null)}>Cancel</Btn>
                <Btn small active onClick={()=>{const v=parseFloat(plateauModal.durStr);if(!isNaN(v)&&v>0){setCurEvs(prev=>prev.map(ev=>ev.id===activeEventId?{...ev,plateauT:plateauModal.t,plateauF:plateauModal.f,plateauDur:v}:ev));setPlateauModal(null);}}}>Apply</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  TAB 0 — SKELETON (merged with overview)
  // ════════════════════════════════════════════════════════════════════════════
  const renderSkeleton = () => {
    const mvnxFiles = activeJob?.mvnxFiles || [];
    const mvnx  = mvnxFiles[skelFileIdx];
    const hasData = !!mvnx?.frames?.length;
    const frame = hasData ? mvnx.frames[Math.min(skelFrame, mvnx.frames.length-1)] : null;
    const ft = frame?.time || 0;

    const loadsolFilesList = activeJob?.loadsolFiles || [];
    const lsfIdx = (skelFileIdx in loadsolPairings)
      ? loadsolPairings[skelFileIdx]
      : (loadsolFilesList.length === 1 ? 0 : null);
    const lsf = (lsfIdx != null) ? (loadsolFilesList[lsfIdx] ?? null) : null;
    const hasLS = !!lsf?.data?.length;

    const blipTime = lsf?.blipTime;

    if (filesLoading) return (
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:300,gap:14}}>
        <Spinner size={32}/><div style={{fontSize:13,color:C.muted}}>{loadingMsg||"Loading files…"}</div>
      </div>
    );


    // ── Main render ───────────────────────────────────────────────────────
    return (
      <div>
        {/* File bar */}
        {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}

        {/* Compact stats row */}
        {activeJob && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:12}}>
            <Stat label="Cycles"      value={mvnxFiles.length||"—"}                                     unit="files"/>
            <Stat label="Duration"    value={mvnx?.duration?.toFixed(1)||"—"}                            unit="s"/>
            <Stat label="GRF Peak R"  value={lsf?.stats?.rightMax?.toFixed(0)||"—"}                     unit="N"/>
            <Stat label="GRF Peak L"  value={lsf?.stats?.leftMax?.toFixed(0)||"—"}                      unit="N"/>
            <Stat label="Blip"        value={blipTime?.toFixed(3)||"—"}                                  unit="s" color={blipTime?C.amber:undefined}/>
            <Stat label="Force Events" value={curEvs?.length||"—"}                                     unit=""/>
          </div>
        )}

        {/* Cycle / LoadSOL selectors */}
        {(mvnxFiles.length > 0 || loadsolFilesList.length > 0) && (
          <div style={{marginBottom:10,background:C.bg,borderRadius:7,border:`1px solid ${C.border}`,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 16px 1fr",alignItems:"center",
              padding:"5px 10px",borderBottom:`1px solid ${C.border}`,fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>
              <span>MVNX Cycle</span><span/>
              <span>LoadSOL</span>
            </div>
            {mvnxFiles.map((f,i) => {
              const pairedIdx = loadsolPairings[i] ?? (loadsolFilesList.length === 1 ? 0 : null);
              const isActive = skelFileIdx === i;
              return (
                <div key={i} onClick={()=>{
                  setSkelFileIdx(i); setSkelFrame(0); setSkelPlaying(false);
                  if (pairedIdx != null) setSkelLoadsolIdx(pairedIdx);
                }} style={{
                  display:"grid",gridTemplateColumns:"1fr 16px 1fr",alignItems:"center",
                  padding:"6px 10px",cursor:"pointer",
                  background: isActive ? C.accent+"18" : "transparent",
                  borderBottom: i < mvnxFiles.length-1 ? `1px solid ${C.border}` : "none",
                }}>
                  <span style={{fontSize:12,color:isActive?C.accent:C.text,fontWeight:isActive?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {f.name.replace(/\.mvnx\.mvnx$|\.mvnx$/i,"")}
                  </span>
                  <span style={{textAlign:"center",color:C.muted,fontSize:11}}>→</span>
                  {loadsolFilesList.length > 0 ? (
                    <select value={pairedIdx ?? ""} onClick={e=>e.stopPropagation()}
                      onChange={e=>{
                        const v = e.target.value === "" ? null : +e.target.value;
                        setLoadsolPairings(prev=>({...prev,[i]:v}));
                        if (isActive && v != null) setSkelLoadsolIdx(v);
                      }}
                      style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:4,
                        padding:"2px 4px",color:pairedIdx!=null?C.text:C.muted,fontSize:11,width:"100%"}}>
                      <option value="">— none —</option>
                      {loadsolFilesList.map((ls,li)=>(
                        <option key={li} value={li}>{ls.name.replace(/\.txt$/i,"")}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>no LoadSOL</span>
                  )}
                </div>
              );
            })}
            {mvnxFiles.length === 0 && loadsolFilesList.length > 0 && (
              <div style={{padding:"8px 10px",fontSize:12,color:C.muted,fontStyle:"italic"}}>Upload MVNX to pair cycles</div>
            )}
          </div>
        )}

        {/* Two-column layout: skeleton | right panel */}
        {!activeJobId ? (
          <EmptyState icon="🗂" title="No job selected" detail="Create or select a job to get started."
            action={<Btn active onClick={()=>setShowJobModal(true)}>Create Job</Btn>}/>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:showForcePanel?"300px 1fr":"300px 1fr",gap:14,alignItems:"start"}}>

            {renderSkeletonCore()}

            {/* ── Right column: force panel OR joint panels ── */}
            {showForcePanel ? renderForcePanel() : (
              <div>
                {jointPanels.map((panel,pi) => {
                  const kj   = KEY_JOINTS[panel.jointKey];
                  const data = panelData[pi] || [];
                  const ji = hasData ? mvnx.jointLabels?.findIndex(l => kj.r.test(l)) : -1;
                  const curAngles = (ji >= 0 && frame?.ja) ? {
                    LB: frame.ja[ji*3]?.toFixed(1),
                    AR: frame.ja[ji*3+1]?.toFixed(1),
                    FE: frame.ja[ji*3+2]?.toFixed(1),
                  } : null;
                  return (
                    <ChartCard key={pi} h={180} title={
                      <span>{kj.lbl}{curAngles&&panel.planes>0&&(
                        <span style={{fontSize:10,fontWeight:400,color:C.muted,marginLeft:8}}>
                          {[0,1,2].filter(pli=>panel.planes&(1<<pli)).map(pli=>`${PLANE_LABELS[pli]}: ${curAngles[PLANE_LABELS[pli]]}°`).join("  ")}
                        </span>
                      )}</span>
                    } action={
                      <div style={{display:"flex",gap:4,alignItems:"center"}}>
                        {PLANE_LABELS.map((pl,pli) => (
                          <Btn key={pl} small active={!!(panel.planes & (1<<pli))}
                            onClick={()=>setJointPanels(prev=>prev.map((p,i)=>
                              i!==pi ? p : {...p, planes: p.planes ^ (1<<pli)}))}>
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
                  <Btn small onClick={()=>setJointPanels(prev=>[...prev,{jointKey:0,planes:4}])}>+ Add Joint Panel</Btn>
                </div>

                {hasLS&&(()=>{
                  const clipped = lsf.blipTime != null
                    ? lsf.data.filter(d => d.time >= lsf.blipTime).map(d => ({...d, time: +(d.time - lsf.blipTime).toFixed(3)}))
                    : lsf.data;
                  const stride = Math.max(1, Math.floor(clipped.length/200));
                  const d = clipped.filter((_,i) => i%stride===0);
                  return (
                    <ChartCard title="LoadSOL GRF (aligned)" h={150}>
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
              </div>
            )}
          </div>
        )}
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
            <div style={{marginTop:8}}>
              <button onClick={()=>setShowTriggerCh(v=>!v)}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                  padding:"4px 10px",color:C.muted,fontSize:11,cursor:"pointer",display:"flex",
                  alignItems:"center",gap:6}}>
                <span style={{fontSize:10}}>{showTriggerCh?"▼":"▶"}</span>
                Sync Trigger Channel (area1)
              </button>
              {showTriggerCh&&(
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
  //  TAB 4 — FORCES & DYNAMICS (combined)
  // ════════════════════════════════════════════════════════════════════════════
  const renderForces = () => {
    if (filesLoading) return <div style={{display:"flex",justifyContent:"center",padding:60}}><Spinner size={32}/></div>;

    return (
      <div>
        {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}

        <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:14,alignItems:"start",marginTop:10}}>

          {/* ── Left column: skeleton viewer + force events panel ── */}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {renderSkeletonCore({showForcePanelToggle:false})}
            <ErrorBoundary key={activeEventId||'none'}>
              {renderForcePanel()}
            </ErrorBoundary>
          </div>

          {/* ── Right column: memoized — does NOT re-render on skelFrame changes ── */}
          <ErrorBoundary>
            {forcesRightCol}
          </ErrorBoundary>
        </div>
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
  //  ROOT RENDER
  // ════════════════════════════════════════════════════════════════════════════
  const panels = [renderSkeleton,renderCycles,renderLoadSOL,renderForces,renderJobs,renderPipeline];
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
      {saveError && (
        <div style={{background:"#7f1d1d",borderBottom:`1px solid #dc2626`,padding:"10px 24px",fontSize:12,color:"#fca5a5"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontWeight:600}}>⚠ Settings save failed: {saveError}</span>
            <span style={{cursor:"pointer",opacity:.7,marginLeft:12}} onClick={()=>setSaveError(null)}>✕</span>
          </div>
          <div style={{marginBottom:4}}>Run this in <strong>Supabase → SQL Editor</strong> to create all required columns:</div>
          <pre style={{background:"rgba(0,0,0,.4)",padding:"8px 10px",borderRadius:4,fontSize:11,margin:0,overflowX:"auto",userSelect:"all"}}>{`ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS extend_duration numeric DEFAULT 0;
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS force_blocks jsonb DEFAULT '[]';
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS joint_panels jsonb DEFAULT '[]';
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS loadsol_pairings jsonb DEFAULT '{}';
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS body_mass numeric DEFAULT 75;
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz;
-- ensure job_id is unique so saves work correctly:
ALTER TABLE job_settings ADD CONSTRAINT job_settings_job_id_key UNIQUE (job_id);`}</pre>
        </div>
      )}
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
