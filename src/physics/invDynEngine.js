// ── Format-Agnostic Inverse Dynamics Engine (Newton-Euler, quasi-dynamic) ────
// Accepts UnifiedKinematicData interface — works identically for MVNX or CSV input.
// Includes inertial terms: SigmaF = m*a_com, SigmaM = I*alpha + omega x (I*omega)
//
// Hybrid kinematics toggle:
//   useRigidBody=true  → XSENS pre-filtered data via rigid body kinematics
//   useRigidBody=false → custom Butterworth-derived acceleration from position
//
// Bottom-up GRF uses dynamic CoP estimation from foot pitch angle.
// Top-down hand force uses hand segment orientation for local coordinate frame.

import { vadd, vsub, vscale, vneg, vcross, vmag, vnorm, vget, getQuat, quatToRotMatrix, mat3MulVec } from './vectorUtils.js';
import { WINTER, SEG_DISTAL, HAND_PROJECTION_LENGTH } from './winterParams.js';
import { rigidBodyComAccel, centralDiffComAccel } from './rigidBodyKinematics.js';
import { butterworth3DAccel } from './butterworth.js';
import { estimateCoP } from './copEstimator.js';
import { minMaxDecimate } from '../utils/decimation.js';
import { DIRS } from '../utils/constants.js';

/**
 * Compute inverse dynamics for all frames.
 *
 * @param {object} kinData - UnifiedKinematicData
 * @param {number} bodyMass - Subject body mass (kg)
 * @param {Array|null} lsfData - Clipped LoadSOL data [{time, left, right}]
 * @param {Array} forceEventsList - [{data, tStart, dirKey, hand}]
 * @param {object} options - { useRigidBody: boolean, butterworthCutoff: number }
 * @returns {Array} - [{t, L5S1:{FE,LB,AR,mag}, shoulderR:{...}, shoulderL:{...}}]
 */
export function computeInvDyn(kinData, bodyMass, lsfData, forceEventsList, options = {}) {
  const { useRigidBody = true, butterworthCutoff = 6 } = options;

  if (!kinData?.frames?.length || !(bodyMass > 0)) return [];

  const G  = [0, 0, -9.81];
  const si = kinData.segIndex || {};
  const nf = kinData.frames.length;
  const fps = kinData.frameRate || 60;

  // Pre-compute Butterworth accelerations if needed
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

  // CoM acceleration dispatch
  const getComAccel = (label, fi) => {
    if (!useRigidBody && bwAccels?.[label]) {
      return bwAccels[label][fi] || [0,0,0];
    }
    const frame = kinData.frames[fi];
    if (useRigidBody && frame.acc?.length) {
      return rigidBodyComAccel(label, frame, si);
    }
    return centralDiffComAccel(label, fi, kinData.frames, si, fps);
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

  const interpGRF = (t) => ({
    right: Math.max(0, interp(lsfData, t, 'time', 'right')),
    left:  Math.max(0, interp(lsfData, t, 'time', 'left')),
  });

  const interpEvForce = (ev, t) => {
    const localT = t - (ev.tStart || 0);
    if (!ev.data?.length || localT < 0) return 0;
    if (localT > ev.data[ev.data.length - 1].time + 0.01) return 0;
    return Math.max(0, interp(ev.data, localT, 'time', 'force'));
  };

  // Solve single segment
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

    const F_prox = vsub(vsub(vscale(a_com, m), F_dist), vscale(G, m));
    const M_prox = vsub(vsub(vsub(tau_inertial, M_dist),
      vcross(vsub(r_prox, r_com), F_prox)),
      vcross(vsub(r_dist_force, r_com), F_dist));

    return { F: F_prox, M: M_prox, r_prox };
  };

  // Use min-max decimation stride
  const targetFrames = 300;
  const stride = Math.max(1, Math.floor(nf / targetFrames));
  const results = [];

  kinData.frames.forEach((frame, fi) => {
    if (fi % stride !== 0 || !frame.pos?.length) return;
    const t   = frame.time;
    const grf = interpGRF(t);

    // ── Legs (bottom-up) with dynamic CoP ──
    const leg = (side) => {
      const UL=`${side}UpperLeg`, LL=`${side}LowerLeg`, FT=`${side}Foot`, TOE=`${side}Toe`;
      const grfVal = side==='Right' ? grf.right : grf.left;

      // Dynamic CoP estimation based on foot pitch
      const { cop } = estimateCoP(side, frame, si);
      const r_grf = cop; // Use estimated CoP instead of locked toe position

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

    const F_hR = vneg(R.thigh.F), M_hR = vneg(R.thigh.M);
    const F_hL = vneg(L.thigh.F), M_hL = vneg(L.thigh.M);
    const r_hR = vget(frame.pos, si['RightUpperLeg']);
    const r_hL = vget(frame.pos, si['LeftUpperLeg']);

    const F_L5S1 = vsub(vsub(vsub(vscale(a_com_p, m_p), F_hR), F_hL), vscale(G, m_p));
    const tau_p = vadd(vadd(vadd(
      vcross(vsub(r_L5S1, r_com_p), F_L5S1),
      vcross(vsub(r_hR,   r_com_p), F_hR)),
      vcross(vsub(r_hL,   r_com_p), F_hL)),
      vadd(M_hR, M_hL));
    const M_L5S1 = vsub(tau_p_inertial, tau_p);

    // ── Arms (top-down) — uses hand segment orientation for force application ──
    const armSolve = (cap) => {
      const sideLower = cap.toLowerCase();
      const hand = `${cap}Hand`, fore = `${cap}ForeArm`, upper = `${cap}UpperArm`;
      if (si[hand] == null) return null;

      const r_wrist = vget(frame.pos, si[hand]);

      // Use hand segment orientation to define local coordinate frame
      // rather than assuming force aligns with forearm axis
      let handDir;
      const handIdx = si[hand];
      if (frame.orient?.length > handIdx * 4 + 3) {
        const q = getQuat(frame.orient, handIdx);
        const R_hand = quatToRotMatrix(q);
        // Local longitudinal axis of hand (XSENS: X-forward in local frame)
        handDir = vnorm(mat3MulVec(R_hand, [1, 0, 0]));
      } else {
        // Fallback: forearm direction
        const r_elbow = vget(frame.pos, si[fore] ?? si[upper]);
        handDir = vnorm(vsub(r_wrist, r_elbow));
      }

      // Project fingertip 10cm along hand's local longitudinal axis
      const r_fingertip = vadd(r_wrist, vscale(handDir, HAND_PROJECTION_LENGTH));

      let F_app = [0,0,0];
      for (const ev of (forceEventsList || [])) {
        const isBilateral = ev.hand === 'bilateral';
        const applies = (sideLower === 'right' && (ev.hand === 'right' || isBilateral)) ||
                        (sideLower === 'left'  && (ev.hand === 'left'  || isBilateral));
        if (!applies || !ev.data?.length) continue;
        const fMag = interpEvForce(ev, t);
        if (fMag <= 0) continue;

        // Force direction: use hand orientation-based local frame
        let fDir;
        if (ev.dirKey && ev.dirKey !== 'auto' && DIRS[ev.dirKey]) {
          fDir = DIRS[ev.dirKey];
        } else {
          // Auto: use hand's local coordinate frame for force direction
          // This accounts for wrist flexion/extension
          fDir = handDir;
        }

        F_app = vadd(F_app, vscale(fDir, isBilateral ? fMag * 0.5 : fMag));
      }

      // Apply force at fingertip, not wrist
      const h = solve(hand,  F_app,       [0,0,0],    r_fingertip, frame, fi);
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

    // Extract CoM positions for all frames
    const comPositions = frames.map(f => {
      const r_prox = vget(f.pos, segIdx);
      const r_dist = (dIdx != null) ? vget(f.pos, dIdx) : vadd(r_prox, [0, 0, 0.1]);
      return vadd(r_prox, vscale(vsub(r_dist, r_prox), cf));
    });

    // Apply Butterworth filter and differentiate
    result[seg] = butterworth3DAccel(comPositions, fps, cutoff);
  }

  return result;
}
