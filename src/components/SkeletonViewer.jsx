// ── SkeletonViewer ───────────────────────────────────────────────────────────
// 2D skeleton SVG with force arrows and playback controls.
// Matches original rendering: bones, joint dots, force arrows from forearm→hand direction.

import { C, BONES, REF_POS, DIR_SVG } from '../utils/constants.js';
import { Btn } from './ui/index.js';
import useBiomechanicsStore from '../store/useBiomechanicsStore.js';

// Hand length (wrist → palm center, meters) for projected palm endpoint
const HAND_LEN = 0.10;

// Skeleton projection (XSENS Z-up)
// Appends two virtual palm-tip points (indices nSeg, nSeg+1) for R/L hands
function projectPos(flatPos, view, W, H, segLabels) {
  const pts3d = [];
  for (let i = 0; i + 2 < flatPos.length; i += 3) {
    pts3d.push([flatPos[i], flatPos[i+1], flatPos[i+2]]);
  }

  // Project palm endpoints from forearm→hand direction
  const rFore = segLabels?.findIndex(l => /rightforearm/i.test(l));
  const rHand = segLabels?.findIndex(l => /righthand/i.test(l));
  const lFore = segLabels?.findIndex(l => /leftforearm/i.test(l));
  const lHand = segLabels?.findIndex(l => /lefthand/i.test(l));

  const palmTip = (foreIdx, handIdx) => {
    if (foreIdx >= 0 && handIdx >= 0 && pts3d[foreIdx] && pts3d[handIdx]) {
      const f = pts3d[foreIdx], h = pts3d[handIdx];
      const dx = h[0]-f[0], dy = h[1]-f[1], dz = h[2]-f[2];
      const m = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
      return [h[0]+dx/m*HAND_LEN, h[1]+dy/m*HAND_LEN, h[2]+dz/m*HAND_LEN];
    }
    return handIdx >= 0 && pts3d[handIdx] ? pts3d[handIdx] : [0,0,0];
  };
  pts3d.push(palmTip(rFore, rHand)); // virtual index = nSeg
  pts3d.push(palmTip(lFore, lHand)); // virtual index = nSeg+1

  // 2D projection
  const pts = pts3d.map(([x, y, z]) => {
    if (view === "front") return [y, z];
    if (view === "side") return [x, z];
    return [y, x];
  });
  if (!pts.length) return [];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const [mnX, mxX] = [Math.min(...xs), Math.max(...xs)];
  const [mnY, mxY] = [Math.min(...ys), Math.max(...ys)];
  const pad = 30;
  const sc = Math.min((W-2*pad) / ((mxX-mnX) || 0.5), (H-2*pad) / ((mxY-mnY) || 2.0));
  const ox = W/2 - (mnX+mxX)/2 * sc, oy = H/2 + (mnY+mxY)/2 * sc;
  return pts.map(([px, py]) => [px * sc + ox, oy - py * sc]);
}

export default function SkeletonViewer({
  mvnx, showForcePanelToggle = true,
  curEvs = [], allEvNormalized = {}, allEvAveraged = {},
  openUpload,
}) {
  const {
    skelFrame, setSkelFrame, skelView, setSkelView,
    skelPlaying, setSkelPlaying, skelSpeed, setSkelSpeed,
    showForcePanel, setShowForcePanel,
    useRigidBody, setUseRigidBody,
    butterworthCutoff, setButterworthCutoff,
  } = useBiomechanicsStore();

  const hasData = !!mvnx?.frames?.length;
  const frame = hasData ? mvnx.frames[Math.min(skelFrame, mvnx.frames.length - 1)] : null;
  const positions = frame?.pos?.length ? frame.pos : REF_POS;
  const boneList = mvnx?.bones?.length ? mvnx.bones : BONES;
  const W = 270, H = 270;
  const segLabels = mvnx?.segLabels || [];
  const nSeg = Math.floor(positions.length / 3);
  const pts = projectPos(positions, skelView, W, H, segLabels);
  const ft = frame?.time || 0;
  // Virtual palm-tip indices appended by projectPos
  const rPalmIdx = nSeg, lPalmIdx = nSeg + 1;
  const rHandIdx = segLabels.findIndex(l => /righthand/i.test(l));
  const lHandIdx = segLabels.findIndex(l => /lefthand/i.test(l));

  // Force arrows — matches original logic exactly
  const renderForceArrows = () => {
    if (!curEvs.length) return null;
    const arrows = [];
    const handForces = { right: 0, left: 0 };
    // Force arrows originate from projected palm tips (not wrist)
    const rHi = rPalmIdx;
    const lHi = lPalmIdx;

    curEvs.forEach(ev => {
      if (!ev.fileIndices?.length) return;
      const avgData = allEvNormalized[ev.id] || allEvAveraged[ev.id] || [];
      if (!avgData.length) return;
      const localT = ft - (ev.tStart || 0);
      if (localT < 0 || localT > avgData[avgData.length - 1].time + 0.5) return;

      let forceMag = 0;
      if (localT <= avgData[0].time) forceMag = avgData[0].force;
      else if (localT >= avgData[avgData.length - 1].time) forceMag = avgData[avgData.length - 1].force;
      else {
        for (let k = 0; k < avgData.length - 1; k++) {
          if (localT >= avgData[k].time && localT <= avgData[k + 1].time) {
            const frac = (localT - avgData[k].time) / (avgData[k + 1].time - avgData[k].time);
            forceMag = avgData[k].force + frac * (avgData[k + 1].force - avgData[k].force);
            break;
          }
        }
      }
      if (forceMag < 1) return;

      if (ev.hand === 'right' || ev.hand === 'bilateral') handForces.right += ev.hand === 'bilateral' ? forceMag * 0.5 : forceMag;
      if (ev.hand === 'left' || ev.hand === 'bilateral') handForces.left += ev.hand === 'bilateral' ? forceMag * 0.5 : forceMag;

      const peakForce = Math.max(...avgData.map(d => d.force), 1);
      const arrowLen = Math.max(8, (forceMag / peakForce) * 40);
      const dirKey = ev.direction || 'auto';
      let svgDir = null;
      if (dirKey !== 'auto' && DIR_SVG[dirKey]) {
        const vec = DIR_SVG[dirKey][skelView] || [0, -1];
        const m = Math.sqrt(vec[0] ** 2 + vec[1] ** 2) || 1;
        svgDir = [vec[0] / m, vec[1] / m];
      }

      const hands = ev.hand === 'bilateral' ? [rHi, lHi] : ev.hand === 'left' ? [lHi] : [rHi];
      hands.forEach((hIdx, hi) => {
        if (hIdx < 0 || !pts[hIdx]) return;
        const [hx, hy] = pts[hIdx];
        let dx = 0, dy = -1;
        if (!svgDir) {
          const isRight = ev.hand === 'right' || (ev.hand === 'bilateral' && hi === 0);
          const fIdx = segLabels.findIndex(l => isRight ? /right.*(forearm|lowerarm|wrist)/i.test(l) : /left.*(forearm|lowerarm|wrist)/i.test(l));
          if (fIdx >= 0 && pts[fIdx]) {
            const [fx, fy] = pts[fIdx];
            const rm = Math.sqrt((hx - fx) ** 2 + (hy - fy) ** 2) || 1;
            dx = (hx - fx) / rm;
            dy = (hy - fy) / rm;
          }
        } else {
          [dx, dy] = svgDir;
        }

        const tipX = hx + dx * arrowLen, tipY = hy + dy * arrowLen;
        const hl = 5, ang = Math.atan2(dy, dx);
        const color = ev.hand === 'left' || (ev.hand === 'bilateral' && hi === 1) ? "#4ade80" : "#fbbf24";
        arrows.push(
          <g key={`arr-${ev.id}-${hi}`}>
            <line x1={hx} y1={hy} x2={tipX} y2={tipY} stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
            <line x1={tipX} y1={tipY} x2={tipX - hl * Math.cos(ang - 0.5)} y2={tipY - hl * Math.sin(ang - 0.5)} stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
            <line x1={tipX} y1={tipY} x2={tipX - hl * Math.cos(ang + 0.5)} y2={tipY - hl * Math.sin(ang + 0.5)} stroke={color} strokeWidth={1.8} strokeLinecap="round"/>
          </g>
        );
      });
    });

    // Force readout
    const hasAny = handForces.right > 0 || handForces.left > 0;
    if (hasAny) {
      const rVal = handForces.right, lVal = handForces.left;
      arrows.push(
        <g key="force-readout">
          <rect x={W - 95} y={H - 42} width={88} height={36} rx={5} fill={C.bg} fillOpacity={0.85} stroke={C.border} strokeWidth={0.5}/>
          <text x={W - 90} y={H - 25} fill={rVal > 0 ? "#fbbf24" : C.muted} fontSize={rVal > 0 ? 12 : 9} fontWeight={rVal > 0 ? "700" : "400"} fontFamily="monospace">
            {rVal > 0 ? `R ${rVal.toFixed(0)} N` : "R  —"}
          </text>
          <text x={W - 90} y={H - 10} fill={lVal > 0 ? "#4ade80" : C.muted} fontSize={lVal > 0 ? 12 : 9} fontWeight={lVal > 0 ? "700" : "400"} fontFamily="monospace">
            {lVal > 0 ? `L ${lVal.toFixed(0)} N` : "L  —"}
          </text>
        </g>
      );
    }
    return arrows;
  };

  return (
    <div style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14}}>
      <div style={{display: "flex", gap: 6, justifyContent: "center", marginBottom: 10}}>
        {["front", "side", "top"].map(v => (
          <Btn key={v} active={skelView === v} small onClick={() => setSkelView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </Btn>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{display: "block", margin: "0 auto", width: "100%", maxWidth: W}}>
        <rect width={W} height={H} fill={C.bg} rx={8} stroke={C.border} strokeWidth={1}/>
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p} x1={0} y1={H * p} x2={W} y2={H * p} stroke={C.border} strokeWidth={0.5} strokeDasharray="4 4"/>
        ))}

        {/* Bones */}
        {pts.length > 0 && boneList.map(([a, b], i) => {
          const pa = pts[a], pb = pts[b];
          if (!pa || !pb) return null;
          const la = mvnx?.segLabels?.[a] || "", lb = mvnx?.segLabels?.[b] || "";
          const isR = /right/i.test(la) || /right/i.test(lb);
          const isL = /left/i.test(la) || /left/i.test(lb);
          return <line key={i} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]}
            stroke={isR ? C.sky : isL ? C.rose : C.amber} strokeWidth={isR || isL ? 3 : 4} strokeLinecap="round"/>;
        })}

        {/* Palm bones (hand → projected palm tip) */}
        {rHandIdx >= 0 && pts[rHandIdx] && pts[rPalmIdx] && (
          <line x1={pts[rHandIdx][0]} y1={pts[rHandIdx][1]} x2={pts[rPalmIdx][0]} y2={pts[rPalmIdx][1]}
            stroke={C.sky} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="4 2"/>
        )}
        {lHandIdx >= 0 && pts[lHandIdx] && pts[lPalmIdx] && (
          <line x1={pts[lHandIdx][0]} y1={pts[lHandIdx][1]} x2={pts[lPalmIdx][0]} y2={pts[lPalmIdx][1]}
            stroke={C.rose} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="4 2"/>
        )}

        {/* Joint dots */}
        {pts.map((pt, i) => {
          if (!pt) return null;
          const lbl = mvnx?.segLabels?.[i] || "";
          return <circle key={i} cx={pt[0]} cy={pt[1]} r={/head/i.test(lbl) ? 7 : 4}
            fill={/head/i.test(lbl) ? C.amber : C.accent} opacity={0.9}/>;
        })}

        {/* Palm tip dots */}
        {pts[rPalmIdx] && rHandIdx >= 0 && <circle cx={pts[rPalmIdx][0]} cy={pts[rPalmIdx][1]} r={3} fill={C.sky} opacity={0.7}/>}
        {pts[lPalmIdx] && lHandIdx >= 0 && <circle cx={pts[lPalmIdx][0]} cy={pts[lPalmIdx][1]} r={3} fill={C.rose} opacity={0.7}/>}

        {/* Force arrows */}
        {renderForceArrows()}

        {!hasData && <text x={W / 2} y={H - 16} textAnchor="middle" fill={C.muted} fontSize={11}>Reference pose — upload MVNX</text>}
      </svg>

      {hasData ? (
        <div style={{marginTop: 10}}>
          <div style={{display: "flex", gap: 5, justifyContent: "center", marginBottom: 6, flexWrap: "wrap"}}>
            <Btn small onClick={() => { setSkelFrame(0); setSkelPlaying(false); }}>⏮</Btn>
            <Btn small active={skelPlaying} onClick={() => setSkelPlaying(p => !p)}>{skelPlaying ? "⏸" : "▶"}</Btn>
            <Btn small onClick={() => { setSkelPlaying(false); setSkelFrame(mvnx.frames.length - 1); }}>⏭</Btn>
            {[0.25, 0.5, 1, 2, 4].map(s => (
              <Btn key={s} small active={skelSpeed === s} onClick={() => setSkelSpeed(s)}>{s}×</Btn>
            ))}
          </div>
          <input type="range" min={0} max={mvnx.frames.length - 1} value={skelFrame}
            onChange={e => setSkelFrame(+e.target.value)} style={{width: "100%", accentColor: C.accent}}/>
          <div style={{display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 3}}>
            <span>t={ft.toFixed(2)}s</span>
            <span>{skelFrame + 1}/{mvnx.frames.length}</span>
            <span>{mvnx.duration?.toFixed(1)}s@{mvnx.frameRate}Hz</span>
          </div>
        </div>
      ) : (
        <div style={{textAlign: "center", marginTop: 14}}>
          <Btn active onClick={() => openUpload("mvnx")}>Upload MVNX</Btn>
        </div>
      )}

      {/* Butterworth / RigidBody toggle */}
      {hasData && (
        <div style={{marginTop: 8}}>
          <div style={{display: "flex", gap: 6, justifyContent: "center"}}>
            <Btn small active={useRigidBody} onClick={() => setUseRigidBody(true)}>
              XSENS Raw
            </Btn>
            <Btn small active={!useRigidBody} onClick={() => setUseRigidBody(false)}>
              Butterworth LPF
            </Btn>
          </div>
          {!useRigidBody && (
            <div style={{display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginTop: 6}}>
              <span style={{fontSize: 10, color: C.muted}}>Cutoff</span>
              <input type="range" min={2} max={15} step={1} value={butterworthCutoff}
                onChange={e => setButterworthCutoff(+e.target.value)}
                style={{width: 80, accentColor: C.accent}}/>
              <span style={{fontSize: 10, color: C.accent, fontWeight: 600, minWidth: 30}}>{butterworthCutoff} Hz</span>
            </div>
          )}
        </div>
      )}

      {showForcePanelToggle && (
        <div style={{marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10}}>
          <Btn active={showForcePanel} onClick={() => setShowForcePanel(p => !p)}
            style={{width: "100%", justifyContent: "center", textAlign: "center"}}>
            {showForcePanel ? "✕ Close Force Panel" : "⚡ Force Events"}
          </Btn>
        </div>
      )}
    </div>
  );
}
