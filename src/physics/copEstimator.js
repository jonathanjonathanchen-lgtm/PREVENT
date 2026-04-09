// ── Center of Pressure (CoP) Heuristic Estimation ───────────────────────────
// LoadSOL provides normal GRF but lacks 2D CoP.
// This module estimates CoP dynamically based on the foot segment's pitch angle
// relative to the global floor plane.
//
// Biomechanical rationale:
// - During heel-strike / dorsiflexion (negative pitch), CoP shifts posteriorly toward heel
// - During toe-off / plantarflexion (positive pitch), CoP shifts anteriorly toward toes
// - During flat-foot midstance, CoP is approximately at geometric center
//
// Algorithm:
// 1. Extract foot segment pitch (rotation about mediolateral axis) from segment orientation
// 2. Map pitch angle to CoP fraction along foot length:
//    - Neutral (0°): CoP at 50% foot length
//    - Full dorsiflexion (~-20°): CoP at ~20% (near heel)
//    - Full plantarflexion (~+30°): CoP at ~85% (near toes)
// 3. Linear interpolation between these anchors

import { vget, vadd, vscale, vsub, getQuat, quatToRotMatrix } from './vectorUtils.js';

/**
 * Extract pitch angle (sagittal plane rotation) from a quaternion orientation.
 * Pitch = rotation about local X axis (mediolateral) in XSENS Z-up frame.
 *
 * @param {number[]} quat - [w,x,y,z] quaternion
 * @returns {number} - Pitch angle in degrees (positive = plantarflexion)
 */
function extractPitch(quat) {
  const [w, x, y, z] = quat;
  // Euler angle extraction for ZXY order (XSENS convention)
  // Pitch (rotation about X axis) = asin(2*(w*x + y*z))
  const sinPitch = 2 * (w * x + y * z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, sinPitch)));
  return pitch * (180 / Math.PI);
}

/**
 * Map foot pitch angle to CoP fraction along foot length.
 * Returns a value in [0, 1] where 0 = heel, 1 = toe tip.
 *
 * @param {number} pitchDeg - Foot pitch in degrees
 * @returns {number} - CoP fraction (0=heel, 1=toe)
 */
function pitchToCoP(pitchDeg) {
  // Piecewise linear mapping:
  // -20° (dorsiflexion) → 0.20 (near heel)
  //   0° (neutral)      → 0.50 (midfoot)
  // +30° (plantarflexion) → 0.85 (near toe)

  if (pitchDeg <= -20) return 0.20;
  if (pitchDeg >= 30) return 0.85;

  if (pitchDeg <= 0) {
    // Dorsiflexion region: -20° → 0°  maps to  0.20 → 0.50
    const t = (pitchDeg + 20) / 20; // 0 to 1
    return 0.20 + t * 0.30;
  } else {
    // Plantarflexion region: 0° → 30°  maps to  0.50 → 0.85
    const t = pitchDeg / 30; // 0 to 1
    return 0.50 + t * 0.35;
  }
}

/**
 * Estimate 3D CoP position for a foot given its segment data.
 *
 * @param {string} side - 'Right' or 'Left'
 * @param {object} frame - Frame with pos and orient arrays
 * @param {object} segIndex - Segment label → index map
 * @returns {{ cop: number[], fraction: number }} - 3D CoP position and fraction
 */
export function estimateCoP(side, frame, segIndex) {
  const footLabel = `${side}Foot`;
  const toeLabel  = `${side}Toe`;

  const footIdx = segIndex[footLabel];
  const toeIdx  = segIndex[toeLabel];

  if (footIdx == null) {
    // Fallback: just use toe position if available
    const toePos = toeIdx != null ? vget(frame.pos, toeIdx) : [0, 0, 0];
    return { cop: toePos, fraction: 1.0 };
  }

  const r_heel = vget(frame.pos, footIdx);  // foot segment origin ≈ ankle/heel
  const r_toe  = toeIdx != null ? vget(frame.pos, toeIdx) : vadd(r_heel, [0.2, 0, 0]);

  // Get foot orientation and extract pitch
  let fraction = 0.50; // default midfoot
  if (frame.orient?.length > footIdx * 4 + 3) {
    const quat = getQuat(frame.orient, footIdx);
    const pitch = extractPitch(quat);
    fraction = pitchToCoP(pitch);
  }

  // CoP = heel + fraction * (toe - heel), projected onto the floor (z=0 for global)
  const cop3d = vadd(r_heel, vscale(vsub(r_toe, r_heel), fraction));
  // Keep the vertical component at floor level (z ≈ min of heel/toe z, or 0)
  const floorZ = Math.min(r_heel[2], r_toe[2]);
  cop3d[2] = floorZ;

  return { cop: cop3d, fraction };
}
