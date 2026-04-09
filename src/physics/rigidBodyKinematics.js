// ── Rigid Body Kinematics for CoM Acceleration ──────────────────────────────
// Uses XSENS pre-filtered segment data to compute CoM acceleration via:
//   a_com = a_origin + alpha x r_com + omega x (omega x r_com)
//
// Where:
//   a_origin  = segment origin acceleration (from XSENS `acceleration` array)
//   alpha     = angular acceleration (from XSENS `angularAcceleration`)
//   omega     = angular velocity (from XSENS `angularVelocity`)
//   r_com     = vector from segment origin to CoM (in global frame)

import { vadd, vcross, vscale, vsub, vget } from './vectorUtils.js';
import { WINTER, SEG_DISTAL } from './winterParams.js';

/**
 * Compute CoM acceleration for a segment using rigid body kinematics
 * from XSENS pre-filtered acceleration, angular velocity, angular acceleration.
 *
 * @param {string} segLabel - Segment name (e.g. "RightForeArm")
 * @param {object} frame - UnifiedKinematicData frame with pos, acc, angVel, angAcc
 * @param {object} segIndex - Map of segment label → index
 * @returns {number[]} - [ax, ay, az] CoM acceleration in global frame
 */
export function rigidBodyComAccel(segLabel, frame, segIndex) {
  const idx = segIndex[segLabel];
  if (idx == null || !frame.acc?.length) return [0, 0, 0];

  const winterParams = WINTER[segLabel];
  if (!winterParams) return [0, 0, 0];
  const [, comFrac] = winterParams;

  // Segment origin position and acceleration
  const r_origin = vget(frame.pos, idx);
  const a_origin = vget(frame.acc, idx);

  // Angular velocity and acceleration at segment origin
  const omega = frame.angVel?.length > idx * 3 + 2 ? vget(frame.angVel, idx) : [0, 0, 0];
  const alpha = frame.angAcc?.length > idx * 3 + 2 ? vget(frame.angAcc, idx) : [0, 0, 0];

  // Distal point for CoM vector
  const dLabel = SEG_DISTAL[segLabel];
  const r_distal = (dLabel && segIndex[dLabel] != null)
    ? vget(frame.pos, segIndex[dLabel])
    : vadd(r_origin, [0, 0, 0.1]);

  // r_com = comFrac * (r_distal - r_origin), relative to segment origin
  const r_com = vscale(vsub(r_distal, r_origin), comFrac);

  // a_com = a_origin + alpha × r_com + omega × (omega × r_com)
  const alphaXr = vcross(alpha, r_com);
  const omegaXr = vcross(omega, r_com);
  const omegaXomegaXr = vcross(omega, omegaXr);

  return vadd(vadd(a_origin, alphaXr), omegaXomegaXr);
}

/**
 * Fallback: CoM acceleration via central finite difference of CoM position.
 * Used when XSENS acceleration data is unavailable or when Butterworth mode is active.
 */
export function centralDiffComAccel(segLabel, frameIndex, frames, segIndex, fps) {
  const diffH = Math.max(1, Math.round(fps / 10));
  const nf = frames.length;
  const i0 = Math.max(0, frameIndex - diffH);
  const i2 = Math.min(nf - 1, frameIndex + diffH);
  const f0 = frames[i0], f1 = frames[frameIndex], f2 = frames[i2];

  if (!f0?.pos?.length || !f2?.pos?.length) return [0, 0, 0];

  const comPos = (frame) => {
    const idx = segIndex[segLabel];
    if (idx == null) return [0, 0, 0];
    const winterParams = WINTER[segLabel];
    if (!winterParams) return [0, 0, 0];
    const [, cf] = winterParams;
    const r_prox = vget(frame.pos, idx);
    const dLabel = SEG_DISTAL[segLabel];
    const r_dist = (dLabel && segIndex[dLabel] != null)
      ? vget(frame.pos, segIndex[dLabel])
      : vadd(r_prox, [0, 0, 0.1]);
    return vadd(r_prox, vscale(vsub(r_dist, r_prox), cf));
  };

  const r0 = comPos(f0), r1 = comPos(f1), r2 = comPos(f2);
  const dtH = diffH / fps;
  // a = (r2 - 2*r1 + r0) / dt^2
  return vscale(vadd(vsub(r2, vscale(r1, 2)), r0), 1 / (dtH * dtH));
}
