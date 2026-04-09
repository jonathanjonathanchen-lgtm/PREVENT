// ── Palette ───────────────────────────────────────────────────────────────────
export const C = {
  teal:"#0d9488", amber:"#d97706", rose:"#e11d48", sky:"#0284c7",
  violet:"#7c3aed", emerald:"#059669", orange:"#f97316", pink:"#ec4899",
  bg:"#f8fafc", card:"#ffffff", border:"#e2e8f0",
  text:"#1e293b", muted:"#64748b", accent:"#0d9488", red:"#dc2626"
};

export const CYCLE_COLORS = [C.teal, C.amber, C.rose, C.sky, C.violet, C.emerald, C.orange, C.pink];
export const TABS = ["Skeleton","Cycles","LoadSOL","Forces & Dynamics","Jobs","Pipeline","Assumptions"];

// ── Skeleton bone fallback (Z-up XSENS: x=forward, y=left, z=up) ─────────────
export const BONES = [
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],
  [4,7],[7,8],[8,9],[9,10],
  [4,11],[11,12],[12,13],[13,14],
  [0,15],[15,16],[16,17],[17,18],
  [0,19],[19,20],[20,21],[21,22]
];

export const REF_POS = [
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
export const KEY_JOINTS = [
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
export const PLANE_LABELS = ["LB","AR","FE"];
export const PLANE_COLORS = [C.amber, C.rose, C.teal];
export const PLANE_NAMES  = ["Lat Bend / Abd (°)","Axial Rot / IE (°)","Flex/Ext (°)"];

// Force direction options for UI
export const TYPE_OPTS = ['push','lift','pinch','pull','carry'];
export const HAND_OPTS = [{v:'right',l:'Right'},{v:'left',l:'Left'},{v:'bilateral',l:'Both'}];
export const DIR_OPTS  = [
  {v:'auto',l:'Auto (hand axis)'},{v:'+x',l:'Forward (+X)'},{v:'-x',l:'Backward (−X)'},
  {v:'+y',l:'Left (+Y)'},{v:'-y',l:'Right (−Y)'},{v:'+z',l:'Up (+Z)'},{v:'-z',l:'Down (−Z)'},
];

// Force direction → SVG vector lookup (per skeleton view)
// World axes: XSENS Z-up frame → x=forward, y=left, z=up
// SVG: x increases right, y increases down
export const DIR_SVG = {
  "+x": { front:[ 0,-1], side:[ 1, 0], top:[ 1, 0] },
  "-x": { front:[ 0, 1], side:[-1, 0], top:[-1, 0] },
  "+y": { front:[-1, 0], side:[ 0, 0], top:[ 0,-1] },
  "-y": { front:[ 1, 0], side:[ 0, 0], top:[ 0, 1] },
  "+z": { front:[ 0,-1], side:[ 0,-1], top:[ 0, 0] },
  "-z": { front:[ 0, 1], side:[ 0, 1], top:[ 0, 0] },
};

// World direction unit vectors for inv dyn force application
export const DIRS = {'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1]};

export const BUCKET = "biomechanics-files";
