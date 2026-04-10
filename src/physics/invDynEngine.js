// ── Inverse Dynamics Engine (Newton-Euler, quasi-dynamic) ────────────────────
// Bottom-up from LoadSOL GRF for L5/S1; top-down from WiDACS for shoulders.
// Includes inertial terms: ΣF = m·a_com, ΣM = I·α + ω×(I·ω)
//
// Default: central-difference CoM acceleration from segment positions (matches original).
// Optional Butterworth toggle: 4th-order zero-lag LPF-derived acceleration from position.

import { vadd, vsub, vscale, vneg, vcross, vmag, vnorm, vget } from './vectorUtils.js';
import { WINTER, SEG_DISTAL } from './winterParams.js';
import { butterworth3DAccel } from './butterworth.js';
import { estimateCoP } from './copEstimator.js';
import { DIRS } from '../utils/constants.js';

/**
 * Compute inverse dynamics for all frames.
 * Matches original monolith logic by default.
 */
export function computeInvDyn(kinData, bodyMass, lsfData, forceEventsList, options = {}) {
  const { useRigidBody = true, butterworthCutoff = 6 } = options;

  if (!kinData?.frames?.length || !(bodyMass > 0)) return [];

  const G  = [0, 0, -9.81];
  const si = kinData.segIndex || {};
  const nf = kinData.frames.length;
  const fps = kinData.frameRate || 60;

  // Pre-compute Butterworth accelerations if toggled
  let bwAccels = null;
  if (!useRigidBody) {
    bwAccels = precomputeButterworthAccels(kinData, butterworthCutoff);
  }

  // Mean segment lengths from first 10 frames
  const segLen = {};
  const refFrames = kinData.frames.slice(0, Math.min(10, nf)).filter(f => f.pos?.length);
  Object.entries(SEG_DISTAL).forEach(([seg, dSeg]) => {
    const pi = si[seg], di = si[dSeg];
    if (pi == null || di == null) return;
    const lens = refFrames.map(f => vmag(vsub(vget(f.pos,di), vget(f.pos,pi))));
    segLen[seg] = lens.reduce((a,b)=>a+b,0) / (lens.length||1) || 0.1;
  });

  // Central-difference step for numerical CoM acceleration (~100ms window)
  const diffH = Math.max(1, Math.round(fps / 10));

  // CoM position for a given segment in a given frame
  const comPos = (label, frame) => {
    const idx = si[label];
    if (idx == null) return [0,0,0];
    const [, cf] = WINTER[label] || [0, 0.5];
    const r_prox = vget(frame.pos, idx);
    const dLabel = SEG_DISTAL[label];
    const r_dist = dLabel && si[dLabel] != null ? vget(frame.pos, si[dLabel]) : vadd(r_prox,[0,0,0.1]);
    return vadd(r_prox, vscale(vsub(r_dist, r_prox), cf));
  };

  // CoM acceleration via central finite difference of position (original method)
  const comAccelCentralDiff = (label, fi) => {
    const i0 = Math.max(0, fi - diffH), i2 = Math.min(nf - 1, fi + diffH);
    const f0 = kinData.frames[i0], f2 = kinData.frames[i2];
    if (!f0?.pos?.length || !f2?.pos?.length) return [0,0,0];
    const r0 = comPos(label, f0), r1 = comPos(label, kinData.frames[fi]), r2 = comPos(label, f2);
    const dtH = diffH / fps;
    return vscale(vadd(vsub(r2, vscale(r1, 2)), r0), 1 / (dtH * dtH));
  };

  // CoM acceleration dispatch
  const getComAccel = (label, fi) => {
    if (!useRigidBody && bwAccels?.[label]) {
      return bwAccels[label][fi] || [0,0,0];
    }
    return comAccelCentralDiff(label, fi);
  };

  // Linear interpolation
  const interp = (data, t, tKey, vKey) => {
    if (!data?.length) return 0;
    const i = data.findIndex(d => d[tKey] >= t);
    if (i <= 0) return data[0]?.[vKey] ?? 0;
    if (i >= data.length) return data[data.length-1]?.[vKey] ?? 0;
    const d0=data[i-1], d1=data[i], frac=(t-d0[tKey])/(d1[tKey]-d0[tKey]||1);
    return d0[vKey] + frac*(d1[vKey]-d0[vKey]);
  };

  const has3Comp = lsfData?.[0]?.leftHeel != null;

  const interpGRF = (t) => {
    const right = Math.max(0, interp(lsfData, t, 'time', 'right'));
    const left  = Math.max(0, interp(lsfData, t, 'time', 'left'));
    // 3-compartment forces for Davidson CoP estimation
    const rightComp = has3Comp ? {
      heel:    Math.max(0, interp(lsfData, t, 'time', 'rightHeel')),
      medial:  Math.max(0, interp(lsfData, t, 'time', 'rightMedial')),
      lateral: Math.max(0, interp(lsfData, t, 'time', 'rightLateral')),
    } : null;
    const leftComp = has3Comp ? {
      heel:    Math.max(0, interp(lsfData, t, 'time', 'leftHeel')),
      medial:  Math.max(0, interp(lsfData, t, 'time', 'leftMedial')),
      lateral: Math.max(0, interp(lsfData, t, 'time', 'leftLateral')),
    } : null;
    return { right, left, rightComp, leftComp };
  };

  const interpEvForce = (ev, t) => {
    const localT = t - (ev.tStart || 0);
    if (!ev.data?.length || localT < 0) return 0;
    if (localT > ev.data[ev.data.length - 1].time + 0.01) return 0;
    return Math.max(0, interp(ev.data, localT, 'time', 'force'));
  };

  // Solve single segment (Newton-Euler)
  const solve = (label, F_dist, M_dist, r_dist_force, frame, fi) => {
    const idx = si[label];
    if (idx == null) return { F:[0,0,0], M:[0,0,0], r_prox:[0,0,0] };
    const [mf, cf, kf] = WINTER[label] || [0.001, 0.5, 0.3];
    const m  = mf * bodyMass;
    const L  = segLen[label] || 0.1;
    const I  = m * (kf * L) * (kf * L);

    const r_prox     = vget(frame.pos, idx);
    const dLabel     = SEG_DISTAL[label];
    const r_dist_geo = dLabel && si[dLabel] != null ? vget(frame.pos, si[dLabel]) : vadd(r_prox,[0,0,0.1]);
    const r_com      = vadd(r_prox, vscale(vsub(r_dist_geo, r_prox), cf));

    const a_com = getComAccel(label, fi);
    const omega = frame.angVel?.length > idx*3+2 ? vget(frame.angVel, idx) : [0,0,0];
    const alpha = frame.angAcc?.length > idx*3+2 ? vget(frame.angAcc, idx) : [0,0,0];
    const tau_inertial = vadd(vscale(alpha, I), vcross(omega, vscale(omega, I)));

    // Newton: F_prox = m·a_com − F_dist − m·G
    const F_prox = vsub(vsub(vscale(a_com, m), F_dist), vscale(G, m));
    // Euler about CoM
    const M_prox = vsub(vsub(vsub(tau_inertial, M_dist),
      vcross(vsub(r_prox, r_com), F_prox)),
      vcross(vsub(r_dist_force, r_com), F_dist));

    return { F: F_prox, M: M_prox, r_prox };
  };

  const stride = Math.max(1, Math.floor(nf / 200));
  const results = [];

  kinData.frames.forEach((frame, fi) => {
    if (fi % stride !== 0 || !frame.pos?.length) return;
    const t   = frame.time;
    const grf = interpGRF(t);

    // ── Legs (bottom-up) — GRF at estimated CoP (Davidson et al. 2025) or toe ──
    const leg = (side) => {
      const UL=`${side}UpperLeg`, LL=`${side}LowerLeg`, FT=`${side}Foot`, TOE=`${side}Toe`;
      const grfVal = side==='Right' ? grf.right : grf.left;
      const comp   = side==='Right' ? grf.rightComp : grf.leftComp;
      const { cop: r_grf } = estimateCoP(side, frame, si, comp);
      const foot   = solve(FT,  [0,0,grfVal], [0,0,0],   r_grf,        frame, fi);
      const shank  = solve(LL,  vneg(foot.F), vneg(foot.M), foot.r_prox, frame, fi);
      const thigh  = solve(UL,  vneg(shank.F),vneg(shank.M),shank.r_prox,frame, fi);
      return { foot, shank, thigh };
    };
    const R = leg('Right'), L = leg('Left');

    // ── Pelvis (dual hip inputs + inertia) ──
    const pelvisIdx = si['Pelvis'];
    const r_pelvis = vget(frame.pos, pelvisIdx);
    const r_L5S1   = si['L5'] != null ? vget(frame.pos, si['L5']) : vadd(r_pelvis,[0,0,0.1]);
    const [mfP, cfP, kfP] = WINTER['Pelvis'];
    const m_p     = mfP * bodyMass;
    const L_p     = segLen['Pelvis'] || 0.1;
    const I_p     = m_p * (kfP * L_p) * (kfP * L_p);
    const r_com_p = vadd(r_pelvis, vscale(vsub(r_L5S1, r_pelvis), cfP));
    const a_com_p = getComAccel('Pelvis', fi);
    const omega_p = frame.angVel?.length > pelvisIdx*3+2 ? vget(frame.angVel, pelvisIdx) : [0,0,0];
    const alpha_p = frame.angAcc?.length > pelvisIdx*3+2 ? vget(frame.angAcc, pelvisIdx) : [0,0,0];
    const tau_p_inertial = vadd(vscale(alpha_p, I_p), vcross(omega_p, vscale(omega_p, I_p)));

    const F_hR    = vneg(R.thigh.F), M_hR = vneg(R.thigh.M);
    const F_hL    = vneg(L.thigh.F), M_hL = vneg(L.thigh.M);
    const r_hR    = vget(frame.pos, si['RightUpperLeg']);
    const r_hL    = vget(frame.pos, si['LeftUpperLeg']);

    const F_L5S1 = vsub(vsub(vsub(vscale(a_com_p, m_p), F_hR), F_hL), vscale(G, m_p));
    const tau_p = vadd(vadd(vadd(
      vcross(vsub(r_L5S1, r_com_p), F_L5S1),
      vcross(vsub(r_hR,   r_com_p), F_hR)),
      vcross(vsub(r_hL,   r_com_p), F_hL)),
      vadd(M_hR, M_hL));
    const M_L5S1 = vsub(tau_p_inertial, tau_p);

    // ── Arms (top-down) — force at hand CoM (Winter 2009) ──
    const armSolve = (cap) => {
      const sideLower = cap.toLowerCase();
      const hand = `${cap}Hand`, fore = `${cap}ForeArm`, upper = `${cap}UpperArm`;
      if (si[hand] == null) return null;
      const r_wrist = vget(frame.pos, si[hand]);
      const r_elbow = vget(frame.pos, si[fore] ?? si[upper]);
      const handDir = vnorm(vsub(r_wrist, r_elbow));
      // Force applied at hand CoM: 50.6% of hand length from wrist (Winter 2009)
      const hLen = segLen[hand] || 0.10;
      const [, hCf] = WINTER[hand] || [0.006, 0.506];
      const r_app = vadd(r_wrist, vscale(handDir, hLen * hCf));
      let F_app = [0,0,0];
      for (const ev of (forceEventsList || [])) {
        const isBilateral = ev.hand === 'bilateral';
        const applies = (sideLower === 'right' && (ev.hand === 'right' || isBilateral)) ||
                        (sideLower === 'left'  && (ev.hand === 'left'  || isBilateral));
        if (!applies || !ev.data?.length) continue;
        const fMag = interpEvForce(ev, t);
        if (fMag <= 0) continue;
        const fDir = (ev.dirKey && ev.dirKey !== 'auto' && DIRS[ev.dirKey]) ? DIRS[ev.dirKey] : handDir;
        F_app = vadd(F_app, vscale(fDir, isBilateral ? fMag * 0.5 : fMag));
      }
      const h = solve(hand,  F_app,       [0,0,0],    r_app,       frame, fi);
      const f = solve(fore,  vneg(h.F),   vneg(h.M),  h.r_prox,    frame, fi);
      const u = solve(upper, vneg(f.F),   vneg(f.M),  f.r_prox,    frame, fi);
      return u.M;
    };

    const fmt = M => ({
      FE: +M[1].toFixed(1), LB: +M[0].toFixed(1), AR: +M[2].toFixed(1),
      mag: +Math.sqrt(M[0]*M[0]+M[1]*M[1]+M[2]*M[2]).toFixed(1),
    });

    results.push({
      t:        +t.toFixed(3),
      L5S1:     fmt(M_L5S1),
      shoulderR: fmt(armSolve('Right') || [0,0,0]),
      shoulderL: fmt(armSolve('Left')  || [0,0,0]),
    });
  });
  return results;
}

/**
 * Pre-compute Butterworth-derived CoM accelerations for all segments.
 * Called once when useRigidBody=false, results cached per computation.
 */
function precomputeButterworthAccels(kinData, cutoff) {
  const si = kinData.segIndex;
  const frames = kinData.frames;
  const fps = kinData.frameRate;
  const result = {};

  for (const [seg, dSeg] of Object.entries(SEG_DISTAL)) {
    const segIdx = si[seg];
    const dIdx = si[dSeg];
    if (segIdx == null) continue;

    const winterParams = WINTER[seg];
    if (!winterParams) continue;
    const [, cf] = winterParams;

    const comPositions = frames.map(f => {
      const r_prox = vget(f.pos, segIdx);
      const r_dist = (dIdx != null) ? vget(f.pos, dIdx) : vadd(r_prox, [0, 0, 0.1]);
      return vadd(r_prox, vscale(vsub(r_dist, r_prox), cf));
    });

    result[seg] = butterworth3DAccel(comPositions, fps, cutoff);
  }

  return result;
}
