// ── Centre of Pressure (CoP) — Davidson et al. (2025) Weighted Algorithm ─────
// Estimates 2D CoP from 3-compartment LoadSOL insole forces.
//
// Eq 1 (A-P): CoP_AP = P_T·F_T/(F_T+F_H+ε) + P_H·F_H/(F_T+F_H+ε)
// Eq 2 (M-L): CoP_ML = P_M·F_M/(F_M+F_L+ε) + P_L·F_L/(F_M+F_L+ε)
//
// Where: F_T = F_M + F_L (forefoot total), F_H = heel, ε = 5 N
// Boundary positions clamped to 20–80% of foot length (A-P) and foot width (M-L).
//
// Falls back to toe-position when 3-compartment data is not available.

import { vget, vadd, vscale, vsub, vnorm, vmag } from './vectorUtils.js';

const EPS = 5; // N — prevents division by zero when foot is unloaded

// Boundary fractions (Davidson et al. — clamped 20–80%)
const P_T = 0.80; // toe boundary: 80% of foot length from heel
const P_H = 0.20; // heel boundary: 20% of foot length from heel
const P_M = 0.80; // medial boundary: 80% of foot width from lateral edge
const P_L = 0.20; // lateral boundary: 20% of foot width from lateral edge

// Typical adult foot width ≈ 38% of foot length (used when M-L can't be measured)
const FOOT_WIDTH_RATIO = 0.38;

/**
 * Estimate 3D CoP position using Davidson et al. (2025) weighted algorithm.
 *
 * @param {string} side - 'Right' or 'Left'
 * @param {object} frame - Kinematic frame with pos array (XSENS segment positions)
 * @param {object} segIndex - Segment label → index map
 * @param {object|null} comp - { heel, medial, lateral } forces in N, or null
 * @returns {{ cop: number[], apFrac: number }} - 3D CoP position and A-P fraction
 */
export function estimateCoP(side, frame, segIndex, comp) {
  const footIdx = segIndex[`${side}Foot`];
  const toeIdx  = segIndex[`${side}Toe`];

  // Fallback: toe position if no foot segment
  if (footIdx == null) {
    const toePos = toeIdx != null ? vget(frame.pos, toeIdx) : [0, 0, 0];
    return { cop: toePos, apFrac: 1.0 };
  }

  const r_heel = vget(frame.pos, footIdx);  // foot segment origin ≈ ankle/heel
  const r_toe  = toeIdx != null ? vget(frame.pos, toeIdx) : vadd(r_heel, [0.25, 0, 0]);

  // No compartment data → fall back to toe position (original method)
  if (!comp) {
    return { cop: r_toe, apFrac: 1.0 };
  }

  const { heel: F_H, medial: F_M, lateral: F_L } = comp;
  const F_T = F_M + F_L; // forefoot total

  // ── A-P CoP fraction (Eq 1) ──
  const dAP = F_T + F_H + EPS;
  const apFrac = (P_T * F_T + P_H * F_H) / dAP;

  // ── M-L CoP fraction (Eq 2) ──
  const dML = F_M + F_L + EPS;
  const mlFrac = (P_M * F_M + P_L * F_L) / dML;

  // ── Map fractions to 3D world coordinates ──
  // A-P axis: heel → toe direction
  const footVec = vsub(r_toe, r_heel);
  const footLen = vmag(footVec);
  const apDir = footLen > 0.01 ? vnorm(footVec) : [1, 0, 0];

  // M-L axis: perpendicular to A-P in the floor plane (Z-up)
  // cross([0,0,1], apDir) gives a vector pointing left in world frame
  let mlDir = [-apDir[1], apDir[0], 0];
  const mlMag = vmag(mlDir);
  mlDir = mlMag > 0.01 ? vscale(mlDir, 1 / mlMag) : [0, 1, 0];

  // mlDir points left (+Y). For right foot: medial = left (+Y), lateral = right (-Y).
  // For left foot: medial = right (-Y), lateral = left (+Y).
  // mlFrac goes from lateral (P_L=0.20) toward medial (P_M=0.80).
  // Offset from center (0.5) → positive = medial direction.
  const footWidth = footLen * FOOT_WIDTH_RATIO;
  const mlSign = side === 'Right' ? 1 : -1;
  const mlOffset = (mlFrac - 0.5) * footWidth * mlSign;

  // 3D CoP = heel + apFrac * footVec + mlOffset * mlDir
  const cop = vadd(
    vadd(r_heel, vscale(apDir, apFrac * footLen)),
    vscale(mlDir, mlOffset)
  );

  // Keep Z at floor level
  cop[2] = Math.min(r_heel[2], r_toe[2]);

  return { cop, apFrac };
}
