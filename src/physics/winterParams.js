// ── Winter (2009) Table 4.1 segment parameters: [massFrac, comFracFromProx, kGyrFromCoM] ──
// XSENS provides joint positions → segment lengths are computed from actual kinematics.
// Mass fractions and CoM fractions taken directly from Winter (2009) Table 4.1.
export const WINTER = {
  Pelvis: [0.142, 0.895, 0.31],
  L5:  [0.070, 0.50, 0.30],
  L3:  [0.070, 0.44, 0.30],
  T12: [0.108, 0.50, 0.30],
  T8:  [0.108, 0.82, 0.30],
  Neck: [0.012, 0.50, 0.30],
  Head: [0.069, 1.00, 0.495],
  RightShoulder: [0.009, 0.712, 0.30], LeftShoulder: [0.009, 0.712, 0.30],
  RightUpperArm: [0.028, 0.436, 0.322], LeftUpperArm: [0.028, 0.436, 0.322],
  RightForeArm:  [0.016, 0.430, 0.303], LeftForeArm:  [0.016, 0.430, 0.303],
  RightHand:     [0.006, 0.506, 0.297], LeftHand:     [0.006, 0.506, 0.297],
  RightUpperLeg: [0.100, 0.433, 0.323], LeftUpperLeg: [0.100, 0.433, 0.323],
  RightLowerLeg: [0.0465, 0.433, 0.302], LeftLowerLeg: [0.0465, 0.433, 0.302],
  RightFoot:     [0.0145, 0.500, 0.475], LeftFoot:     [0.0145, 0.500, 0.475],
  RightToe:      [0.002, 0.500, 0.300],  LeftToe:      [0.002, 0.500, 0.300],
};

// Each segment's geometrical distal reference (for CoM & length)
export const SEG_DISTAL = {
  Pelvis:'L5', L5:'L3', L3:'T12', T12:'T8', T8:'Neck', Neck:'Head',
  RightShoulder:'RightUpperArm', RightUpperArm:'RightForeArm', RightForeArm:'RightHand',
  LeftShoulder:'LeftUpperArm',   LeftUpperArm:'LeftForeArm',   LeftForeArm:'LeftHand',
  RightUpperLeg:'RightLowerLeg', RightLowerLeg:'RightFoot', RightFoot:'RightToe',
  LeftUpperLeg:'LeftLowerLeg',   LeftLowerLeg:'LeftFoot',   LeftFoot:'LeftToe',
};

// Hand length for fingertip projection (approx 10cm from wrist to fingertip)
export const HAND_PROJECTION_LENGTH = 0.10;
