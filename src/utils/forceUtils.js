// ── Force Event Utilities ────────────────────────────────────────────────────
// Averaging, time normalization, and plateau extension for WiDACS force data.

export function computeAveraged(event, forceFiles) {
  const files = (event.fileIndices || []).map(i => forceFiles[i]).filter(f => f?.data?.length);
  if (!files.length) return [];
  const dt = files[0].data.length > 1 ? files[0].data[1].time - files[0].data[0].time : 0.002;
  const tMax = Math.min(...files.map(f => f.data[f.data.length - 1].time));
  const interp1 = (data, t) => {
    const i = data.findIndex(d => d.time >= t);
    if (i <= 0) return data[0]?.force ?? 0;
    if (i >= data.length) return data[data.length - 1]?.force ?? 0;
    const d0 = data[i-1], d1 = data[i];
    return d0.force + (t - d0.time) / ((d1.time - d0.time) || 1) * (d1.force - d0.force);
  };
  const base = [];
  for (let t = 0; t <= tMax + 1e-9; t = +(t + dt).toFixed(6)) {
    const vals = files.map(f => interp1(f.data, t));
    base.push({ time: +t.toFixed(3), force: +(vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(1) });
  }
  const stopAt = event.stopAt ?? null;
  let result = stopAt != null ? base.filter(d => d.time <= stopAt + 1e-9) : base;
  const { plateauT, plateauF, plateauDur } = event;
  if (plateauT != null && plateauF != null && (plateauDur || 0) > 0) {
    const splitIdx = result.findIndex(d => d.time >= plateauT);
    const pre  = splitIdx >= 0 ? result.slice(0, splitIdx) : result;
    const nExt = Math.round(plateauDur / dt);
    const ext  = Array.from({length: nExt}, (_,i) => ({
      time: +(plateauT + (i+1) * dt).toFixed(3),
      force: plateauF,
      plateau: true,
    }));
    return [...pre, ...ext];
  }
  return result;
}

export function normalizeForceTime(avgData, event) {
  if (!avgData?.length) return avgData;
  const srcDur = avgData[avgData.length - 1].time;
  if (srcDur <= 0) return avgData;
  const origDt = avgData.length > 1 ? avgData[1].time - avgData[0].time : 0.002;
  const lerpF = (data, t) => {
    const i = data.findIndex(d => d.time >= t);
    if (i <= 0) return data[0]?.force ?? 0;
    if (i >= data.length) return data[data.length - 1]?.force ?? 0;
    const d0 = data[i - 1], d1 = data[i];
    return d0.force + (t - d0.time) / ((d1.time - d0.time) || 1) * (d1.force - d0.force);
  };

  if (event.timeSegments?.length) {
    const result = [];
    let tgtOffset = 0;
    for (const seg of event.timeSegments) {
      const srcLen = (seg.srcEnd - seg.srcStart) || 1;
      const tgtDur = seg.tgtDur || srcLen;
      const ratio = srcLen / tgtDur;
      for (let lt = 0; lt < tgtDur + origDt * 0.5; lt += origDt) {
        const srcT = seg.srcStart + lt * ratio;
        result.push({ time: +(tgtOffset + lt).toFixed(4), force: +lerpF(avgData, srcT).toFixed(1) });
      }
      tgtOffset += tgtDur;
    }
    return result;
  }

  if (event.tEnd != null) {
    const tgtDur = event.tEnd - (event.tStart || 0);
    if (tgtDur <= 0 || Math.abs(tgtDur - srcDur) < 0.01) return avgData;
    const ratio = srcDur / tgtDur;
    const result = [];
    for (let t = 0; t <= tgtDur + origDt * 0.5; t += origDt) {
      result.push({ time: +t.toFixed(4), force: +lerpF(avgData, t * ratio).toFixed(1) });
    }
    return result;
  }

  return avgData;
}
