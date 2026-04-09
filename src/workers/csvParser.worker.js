// ── CSV Parser Web Worker ────────────────────────────────────────────────────
// Parses XSENS CSV exports off the main thread using PapaParse.
// Normalizes into UnifiedKinematicData and posts back to main thread.

import Papa from 'papaparse';

function extractSegLabels(headers) {
  const labels = [];
  const seen = new Set();
  for (const h of headers) {
    const match = h.match(/^(.+?)[\s_](X|Y|Z|q0|q1|q2|q3)$/i);
    if (match) {
      const label = match[1].replace(/\s+/g, '');
      if (!seen.has(label)) { seen.add(label); labels.push(label); }
    }
  }
  return labels;
}

function extractTriplets(row, headers, segLabels, suffix = ['_X', '_Y', '_Z']) {
  const flat = [];
  for (const seg of segLabels) {
    const vals = suffix.map(s => {
      const col = headers.findIndex(h => h === seg + s || h === `${seg}${s}` || h === `${seg} ${s.replace('_', '')}`);
      return col >= 0 ? (parseFloat(row[col]) || 0) : 0;
    });
    flat.push(...vals);
  }
  return flat;
}

function extractQuaternions(row, headers, segLabels) {
  const flat = [];
  for (const seg of segLabels) {
    for (const q of ['q0', 'q1', 'q2', 'q3']) {
      const col = headers.findIndex(h => h === `${seg}_${q}` || h === `${seg} ${q}`);
      flat.push(col >= 0 ? (parseFloat(row[col]) || 0) : (q === 'q0' ? 1 : 0));
    }
  }
  return flat;
}

function buildBones(segLabels, segIndex) {
  const connections = [
    ['Pelvis','L5'],['L5','L3'],['L3','T12'],['T12','T8'],['T8','Neck'],['Neck','Head'],
    ['T8','RightShoulder'],['RightShoulder','RightUpperArm'],['RightUpperArm','RightForeArm'],['RightForeArm','RightHand'],
    ['T8','LeftShoulder'],['LeftShoulder','LeftUpperArm'],['LeftUpperArm','LeftForeArm'],['LeftForeArm','LeftHand'],
    ['Pelvis','RightUpperLeg'],['RightUpperLeg','RightLowerLeg'],['RightLowerLeg','RightFoot'],['RightFoot','RightToe'],
    ['Pelvis','LeftUpperLeg'],['LeftUpperLeg','LeftLowerLeg'],['LeftLowerLeg','LeftFoot'],['LeftFoot','LeftToe'],
  ];
  return connections.filter(([a,b]) => segIndex[a] !== undefined && segIndex[b] !== undefined)
    .map(([a,b]) => [segIndex[a], segIndex[b]]);
}

self.onmessage = function(e) {
  const { csvFiles, id } = e.data;

  try {
    if (!csvFiles?.length) {
      self.postMessage({ id, ok: false, error: 'No CSV files provided' });
      return;
    }

    // Parse each file
    const parsed = csvFiles.map(f => {
      const result = Papa.parse(f.text, { skipEmptyLines: true, dynamicTyping: false });

      let frameRate = 60;
      let headerRowIdx = 0;
      let dataType = 'position';

      for (let i = 0; i < Math.min(20, result.data.length); i++) {
        const row = result.data[i];
        const line = row.join(',').toLowerCase();
        if (line.includes('frame rate') || line.includes('framerate')) {
          const frMatch = row.join(',').match(/(\d+(?:\.\d+)?)\s*(?:hz|fps)?/i);
          if (frMatch) frameRate = parseFloat(frMatch[1]);
        }
        if (line.includes('frame') && (line.includes('_x') || line.includes(' x') || line.includes('_q0'))) {
          headerRowIdx = i;
          break;
        }
      }

      const headers = result.data[headerRowIdx].map(h => h.trim());
      const rows = result.data.slice(headerRowIdx + 1).filter(r => r.length >= headers.length * 0.5);
      const headerStr = headers.join(',').toLowerCase();

      if (headerStr.includes('_q0') || headerStr.includes('orientation')) dataType = 'orientation';
      else if (headerStr.includes('angular') && headerStr.includes('velocity')) dataType = 'angularVelocity';
      else if (headerStr.includes('angular') && headerStr.includes('acceleration')) dataType = 'angularAcceleration';
      else if (headerStr.includes('acceleration')) dataType = 'acceleration';
      else if (headerStr.includes('joint') && headerStr.includes('angle')) dataType = 'jointAngle';

      return { headers, rows, dataType, frameRate, name: f.name };
    });

    const posFile = parsed.find(p => p.dataType === 'position') || parsed[0];
    const segLabels = extractSegLabels(posFile.headers);
    const segIndex = {};
    segLabels.forEach((l, i) => { segIndex[l] = i; });

    const byType = {};
    for (const p of parsed) byType[p.dataType] = p;

    const frameRate = posFile.frameRate;
    const nFrames = posFile.rows.length;
    const bones = buildBones(segLabels, segIndex);

    let jointLabels = [];
    if (byType.jointAngle) jointLabels = extractSegLabels(byType.jointAngle.headers);

    const frames = [];
    for (let fi = 0; fi < nFrames; fi++) {
      const frame = { time: fi / frameRate, pos:[], ja:[], ergoJA:null, acc:[], angVel:[], angAcc:[], orient:[], sensorFreeAcc:null };
      if (byType.position?.rows[fi]) frame.pos = extractTriplets(byType.position.rows[fi], byType.position.headers, segLabels);
      if (byType.acceleration?.rows[fi]) frame.acc = extractTriplets(byType.acceleration.rows[fi], byType.acceleration.headers, segLabels);
      if (byType.angularVelocity?.rows[fi]) frame.angVel = extractTriplets(byType.angularVelocity.rows[fi], byType.angularVelocity.headers, segLabels);
      if (byType.angularAcceleration?.rows[fi]) frame.angAcc = extractTriplets(byType.angularAcceleration.rows[fi], byType.angularAcceleration.headers, segLabels);
      if (byType.jointAngle?.rows[fi]) frame.ja = extractTriplets(byType.jointAngle.rows[fi], byType.jointAngle.headers, extractSegLabels(byType.jointAngle.headers));
      if (byType.orientation?.rows[fi]) frame.orient = extractQuaternions(byType.orientation.rows[fi], byType.orientation.headers, segLabels);
      frames.push(frame);
    }

    const duration = frames.length ? frames[frames.length - 1].time : 0;

    self.postMessage({
      id, ok: true, frameRate, segLabels, segIndex, jointLabels, bones, frames, duration, sourceFormat: 'csv',
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
