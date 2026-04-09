// ── UnifiedKinematicData Interface ───────────────────────────────────────────
// Standard interface that both MVNX and CSV adapters normalize into.
// The inverse dynamics engine and all visualization components consume only this.
//
// Shape:
// {
//   frameRate: number,             // Hz (40 or 60 from XSENS)
//   duration: number,              // total seconds
//   segLabels: string[],           // segment names in order
//   segIndex: { [label]: number }, // label → index map
//   jointLabels: string[],         // joint names
//   bones: [number, number][],     // connectivity pairs (segment indices)
//   frames: UnifiedFrame[],
// }
//
// UnifiedFrame:
// {
//   time: number,                  // seconds
//   pos: number[],                 // flat [x,y,z, x,y,z, ...] per segment
//   ja: number[],                  // flat joint angles (ZXY Euler: [Z,X,Y, Z,X,Y, ...])
//   ergoJA: number[]|null,         // Ergonomic Joint Angles ZXY (preferred if available)
//   acc: number[],                 // flat segment acceleration [ax,ay,az, ...]
//   angVel: number[],              // flat angular velocity [wx,wy,wz, ...]
//   angAcc: number[],              // flat angular acceleration [αx,αy,αz, ...]
//   orient: number[],              // flat quaternion orientation [w,x,y,z, w,x,y,z, ...]
//   sensorFreeAcc: number[]|null,  // sensor free acceleration (if available)
// }

/**
 * Create an empty UnifiedKinematicData structure.
 */
export function createEmptyUnified() {
  return {
    ok: true,
    frameRate: 60,
    duration: 0,
    segLabels: [],
    segIndex: {},
    jointLabels: [],
    bones: [],
    frames: [],
  };
}

/**
 * Validate that a UnifiedKinematicData object has the required fields.
 */
export function validateUnified(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.frames)) return false;
  if (!Array.isArray(data.segLabels)) return false;
  if (typeof data.frameRate !== 'number') return false;
  return true;
}

/**
 * Extract joint angles from frame data.
 * ZXY Euler from MVNX: index 0 = Z = LB/Abd, index 1 = X = AR/IE, index 2 = Y = FE
 *
 * @param {object} frame - UnifiedFrame
 * @param {number} jointIdx - Joint index
 * @returns {{ LB: number, AR: number, FE: number }}
 */
export function getJointAngles(frame, jointIdx) {
  const src = frame.ja;
  if (!src || src.length <= jointIdx * 3 + 2) {
    return { LB: 0, AR: 0, FE: 0 };
  }
  return {
    LB: src[jointIdx * 3]     ?? 0,
    AR: src[jointIdx * 3 + 1] ?? 0,
    FE: src[jointIdx * 3 + 2] ?? 0,
  };
}
