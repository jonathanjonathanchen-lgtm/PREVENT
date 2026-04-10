// ── LoadSOL and Force/WiDACS Parsers ─────────────────────────────────────────

export function parseLoadSOL(text) {
  try {
    const lines = text.split("\n").filter(l => l.trim());
    let dataStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].trim().split("\t");
      if (cols.length >= 5 && !isNaN(parseFloat(cols[0]))) { dataStart = i; break; }
    }
    const data = [];
    for (let i = dataStart; i < lines.length; i++) {
      const cols = lines[i].trim().split("\t");
      if (cols.length < 5) continue;
      const time  = parseFloat(cols[0]);
      const left  = Math.abs(parseFloat(cols[4])  || 0);
      const right = Math.abs(parseFloat(cols[9])  || 0);
      const trig  = Math.max(Math.abs(parseFloat(cols[11]) || 0), Math.abs(parseFloat(cols[12]) || 0));
      const row = { time, left, right, total: left+right, trig };

      // 3-compartment forces for CoP estimation (Davidson et al. 2025)
      // LoadSOL 3-sensor layout: cols 1-3 = left (heel, medial, lateral), cols 6-8 = right
      if (cols.length >= 10) {
        const lH = Math.abs(parseFloat(cols[1]) || 0);
        const lM = Math.abs(parseFloat(cols[2]) || 0);
        const lL = Math.abs(parseFloat(cols[3]) || 0);
        const rH = Math.abs(parseFloat(cols[6]) || 0);
        const rM = Math.abs(parseFloat(cols[7]) || 0);
        const rL = Math.abs(parseFloat(cols[8]) || 0);
        // Validate: at least one compartment set has non-zero data
        if (lH + lM + lL > 0 || rH + rM + rL > 0) {
          row.leftHeel = lH;  row.leftMedial = lM;  row.leftLateral = lL;
          row.rightHeel = rH; row.rightMedial = rM; row.rightLateral = rL;
        }
      }

      if (!isNaN(time)) data.push(row);
    }
    let blipTime = null;
    const firstBlip = data.find(d => d.trig > 5);
    if (firstBlip) blipTime = firstBlip.time;
    const leftMax  = data.length ? Math.max(...data.map(d => d.left))  : 0;
    const rightMax = data.length ? Math.max(...data.map(d => d.right)) : 0;
    const has3Comp = data.length > 0 && data[0].leftHeel != null;
    return { ok:true, data, blipTime, stats:{ leftMax, rightMax, has3Comp } };
  } catch(e) { return { ok:false, error:e.message }; }
}

export function parseForceFile(text) {
  try {
    const lines = text.split("\n").filter(l => l.trim());
    let dataStart = 0;
    const dataIdx = lines.findIndex(l => l.trim().toUpperCase().startsWith("DATA:"));
    if (dataIdx >= 0) {
      dataStart = dataIdx + 2;
    } else {
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].trim().split(/[\t,]/);
        if (!isNaN(parseFloat(cols[0]))) { dataStart = i; break; }
      }
    }
    const data = [];
    for (let i = dataStart; i < lines.length; i++) {
      const cols = lines[i].trim().split(/[\t,]/);
      if (cols.length < 2) continue;
      const time = parseFloat(cols[0]);
      const force = parseFloat(cols[1]) || 0;
      if (!isNaN(time)) data.push({ time, force });
    }
    const peak = data.length ? Math.max(...data.map(d => d.force)) : 0;
    const peakTime = data.find(d => d.force === peak)?.time || 0;
    const impulse = data.length > 1
      ? data.slice(1).reduce((s,d,i) => s + (d.force + data[i].force)/2 * (d.time - data[i].time), 0)
      : 0;
    return { ok:true, data, stats:{ peak, peakTime, impulse: impulse.toFixed(2) } };
  } catch(e) { return { ok:false, error:e.message }; }
}

// Read blob/file as text, auto-decompressing gzip
export async function blobToText(blob) {
  const buf = await blob.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const decompressed = await new Response(
      new Blob([buf]).stream().pipeThrough(ds)
    ).text();
    return decompressed;
  }
  return new TextDecoder().decode(buf);
}
