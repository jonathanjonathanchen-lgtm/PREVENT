// ── Vector utilities (global frame, Z-up) ────────────────────────────────────
export const vadd   = (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const vsub   = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const vscale = (v,s) => [v[0]*s, v[1]*s, v[2]*s];
export const vneg   = a     => [-a[0],-a[1],-a[2]];
export const vcross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const vmag   = v     => Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
export const vnorm  = v     => { const m=vmag(v)||1; return vscale(v,1/m); };
export const vget   = (arr,i) => (arr?.length > i*3+2) ? [arr[i*3],arr[i*3+1],arr[i*3+2]] : [0,0,0];
export const vdot   = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

// Quaternion → 3×3 rotation matrix (column-major flat array or row-getter)
// q = [w, x, y, z] (scalar-first, XSENS convention)
export function quatToRotMatrix(q) {
  const [w,x,y,z] = q;
  const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
  // Row-major 3×3
  return [
    1-2*(yy+zz), 2*(xy-wz),   2*(xz+wy),
    2*(xy+wz),   1-2*(xx+zz), 2*(yz-wx),
    2*(xz-wy),   2*(yz+wx),   1-2*(xx+yy),
  ];
}

// Multiply 3×3 matrix (row-major flat) by 3-vector
export function mat3MulVec(m, v) {
  return [
    m[0]*v[0]+m[1]*v[1]+m[2]*v[2],
    m[3]*v[0]+m[4]*v[1]+m[5]*v[2],
    m[6]*v[0]+m[7]*v[1]+m[8]*v[2],
  ];
}

// Extract quaternion for segment i from flat orientation array (XSENS: q0,q1,q2,q3 = w,x,y,z)
export function getQuat(orientArr, segIdx) {
  const base = segIdx * 4;
  if (!orientArr || orientArr.length <= base + 3) return [1,0,0,0]; // identity
  return [orientArr[base], orientArr[base+1], orientArr[base+2], orientArr[base+3]];
}
