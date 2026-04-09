// ── CSV/XLSX → UnifiedKinematicData Adapter ──────────────────────────────────
// Parses standard XSENS .csv or .xlsx exports and normalizes into the
// UnifiedKinematicData interface.
//
// XSENS CSV exports typically have:
// - A header section with metadata (frame rate, segment names, etc.)
// - Column headers like: "Frame", "Time", "Pelvis_X", "Pelvis_Y", "Pelvis_Z", ...
// - Separate files for: Position, Velocity, Acceleration, Angular Velocity,
//   Angular Acceleration, Joint Angles, Orientation (quaternion), etc.
//
// This adapter handles two modes:
// 1. Single combined CSV (all data types in one file)
// 2. Multiple CSVs (one per data type), merged by frame index

import Papa from 'papaparse';

/**
 * Detect XSENS segment labels from CSV column headers.
 * Column patterns: "SegmentName_X", "SegmentName_Y", "SegmentName_Z"
 * or "SegmentName q0", "SegmentName q1", etc.
 */
function extractSegLabels(headers) {
  const labels = [];
  const seen = new Set();

  for (const h of headers) {
    // Match patterns like "Pelvis_X" or "Pelvis X" or "RightUpperArm_Y"
    const match = h.match(/^(.+?)[\s_](X|Y|Z|q0|q1|q2|q3)$/i);
    if (match) {
      const label = match[1].replace(/\s+/g, '');
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  return labels;
}

/**
 * Extract triplet values (X,Y,Z) for each segment from a row.
 */
function extractTriplets(row, headers, segLabels, suffix = ['_X', '_Y', '_Z']) {
  const flat = [];
  for (const seg of segLabels) {
    const vals = suffix.map(s => {
      const col = headers.findIndex(h =>
        h === seg + s || h === `${seg}${s}` || h === `${seg} ${s.replace('_', '')}`
      );
      return col >= 0 ? (parseFloat(row[col]) || 0) : 0;
    });
    flat.push(...vals);
  }
  return flat;
}

/**
 * Extract quaternion values (q0,q1,q2,q3) for each segment from a row.
 */
function extractQuaternions(row, headers, segLabels) {
  const flat = [];
  for (const seg of segLabels) {
    for (const q of ['q0', 'q1', 'q2', 'q3']) {
      const col = headers.findIndex(h =>
        h === `${seg}_${q}` || h === `${seg} ${q}`
      );
      flat.push(col >= 0 ? (parseFloat(row[col]) || 0) : (q === 'q0' ? 1 : 0));
    }
  }
  return flat;
}

/**
 * Parse a single XSENS CSV file.
 * @param {string} csvText - CSV file content
 * @param {string} dataType - 'position'|'acceleration'|'angularVelocity'|'angularAcceleration'|'jointAngle'|'orientation'
 * @returns {{ headers: string[], rows: string[][], dataType: string, frameRate: number }}
 */
function parseCSVFile(csvText, dataType = 'auto') {
  const result = Papa.parse(csvText, {
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  let frameRate = 60;
  let headerRowIdx = 0;

  // Scan for metadata and header row
  for (let i = 0; i < Math.min(20, result.data.length); i++) {
    const row = result.data[i];
    const line = row.join(',').toLowerCase();

    // Detect frame rate from metadata
    if (line.includes('frame rate') || line.includes('framerate') || line.includes('update rate')) {
      const frMatch = row.join(',').match(/(\d+(?:\.\d+)?)\s*(?:hz|fps)?/i);
      if (frMatch) frameRate = parseFloat(frMatch[1]);
    }

    // Detect header row (contains known XSENS column patterns)
    if (line.includes('frame') && (line.includes('_x') || line.includes(' x'))) {
      headerRowIdx = i;
      break;
    }
    // Also check for quaternion headers
    if (line.includes('_q0') || line.includes(' q0')) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = result.data[headerRowIdx].map(h => h.trim());
  const rows = result.data.slice(headerRowIdx + 1).filter(r => r.length >= headers.length * 0.5);

  // Auto-detect data type from headers
  if (dataType === 'auto') {
    const headerStr = headers.join(',').toLowerCase();
    if (headerStr.includes('orientation') || headerStr.includes('_q0')) dataType = 'orientation';
    else if (headerStr.includes('acceleration') && !headerStr.includes('angular')) dataType = 'acceleration';
    else if (headerStr.includes('angular') && headerStr.includes('velocity')) dataType = 'angularVelocity';
    else if (headerStr.includes('angular') && headerStr.includes('acceleration')) dataType = 'angularAcceleration';
    else if (headerStr.includes('joint') && headerStr.includes('angle')) dataType = 'jointAngle';
    else dataType = 'position'; // default
  }

  return { headers, rows, dataType, frameRate };
}

/**
 * Parse multiple XSENS CSV files and merge into UnifiedKinematicData.
 *
 * @param {Array<{text: string, name: string}>} csvFiles - Array of CSV file contents
 * @returns {object} UnifiedKinematicData
 */
export function parseXSENSCSVs(csvFiles) {
  try {
    if (!csvFiles?.length) return { ok: false, error: 'No CSV files provided' };

    // Parse all files
    const parsed = csvFiles.map(f => ({
      ...parseCSVFile(f.text),
      name: f.name,
    }));

    // Use position file (or first file) to establish segment labels and frame count
    const posFile = parsed.find(p => p.dataType === 'position') || parsed[0];
    const segLabels = extractSegLabels(posFile.headers);
    const segIndex = Object.fromEntries(segLabels.map((l, i) => [l, i]));

    const frameRate = posFile.frameRate;
    const nFrames = posFile.rows.length;

    // Build lookup for each data type
    const byType = {};
    for (const p of parsed) {
      byType[p.dataType] = p;
    }

    // Joint labels from jointAngle file headers
    let jointLabels = [];
    if (byType.jointAngle) {
      const jaHeaders = byType.jointAngle.headers;
      const jaSegs = extractSegLabels(jaHeaders);
      jointLabels = jaSegs; // Joint labels ≈ segment connections
    }

    // Build bones from segment label adjacency (simple chain heuristic)
    const bones = buildBones(segLabels, segIndex);

    // Assemble frames
    const frames = [];
    for (let fi = 0; fi < nFrames; fi++) {
      const time = fi / frameRate;
      const frame = {
        time,
        pos: [],
        ja: [],
        ergoJA: null,
        acc: [],
        angVel: [],
        angAcc: [],
        orient: [],
        sensorFreeAcc: null,
      };

      // Position
      if (byType.position?.rows[fi]) {
        frame.pos = extractTriplets(byType.position.rows[fi], byType.position.headers, segLabels);
      }

      // Acceleration
      if (byType.acceleration?.rows[fi]) {
        frame.acc = extractTriplets(byType.acceleration.rows[fi], byType.acceleration.headers, segLabels);
      }

      // Angular Velocity
      if (byType.angularVelocity?.rows[fi]) {
        frame.angVel = extractTriplets(byType.angularVelocity.rows[fi], byType.angularVelocity.headers, segLabels);
      }

      // Angular Acceleration
      if (byType.angularAcceleration?.rows[fi]) {
        frame.angAcc = extractTriplets(byType.angularAcceleration.rows[fi], byType.angularAcceleration.headers, segLabels);
      }

      // Joint Angles
      if (byType.jointAngle?.rows[fi]) {
        frame.ja = extractTriplets(byType.jointAngle.rows[fi], byType.jointAngle.headers,
          extractSegLabels(byType.jointAngle.headers));
      }

      // Orientation (quaternions)
      if (byType.orientation?.rows[fi]) {
        frame.orient = extractQuaternions(byType.orientation.rows[fi], byType.orientation.headers, segLabels);
      }

      frames.push(frame);
    }

    const duration = frames.length ? frames[frames.length - 1].time : 0;

    return {
      ok: true,
      frameRate,
      segLabels,
      segIndex,
      jointLabels,
      bones,
      frames,
      duration,
      sourceFormat: 'csv',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Build bone connectivity from XSENS segment labels.
 * Uses known XSENS body model topology.
 */
function buildBones(segLabels, segIndex) {
  // Standard XSENS body model connectivity
  const connections = [
    ['Pelvis', 'L5'], ['L5', 'L3'], ['L3', 'T12'], ['T12', 'T8'],
    ['T8', 'Neck'], ['Neck', 'Head'],
    ['T8', 'RightShoulder'], ['RightShoulder', 'RightUpperArm'],
    ['RightUpperArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
    ['T8', 'LeftShoulder'], ['LeftShoulder', 'LeftUpperArm'],
    ['LeftUpperArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'],
    ['Pelvis', 'RightUpperLeg'], ['RightUpperLeg', 'RightLowerLeg'],
    ['RightLowerLeg', 'RightFoot'], ['RightFoot', 'RightToe'],
    ['Pelvis', 'LeftUpperLeg'], ['LeftUpperLeg', 'LeftLowerLeg'],
    ['LeftLowerLeg', 'LeftFoot'], ['LeftFoot', 'LeftToe'],
  ];

  const bones = [];
  for (const [a, b] of connections) {
    if (segIndex[a] !== undefined && segIndex[b] !== undefined) {
      bones.push([segIndex[a], segIndex[b]]);
    }
  }
  return bones;
}

/**
 * Parse a single combined XSENS CSV that contains multiple data types.
 * @param {string} csvText - Combined CSV content
 * @returns {object} UnifiedKinematicData
 */
export function parseSingleXSENSCSV(csvText) {
  return parseXSENSCSVs([{ text: csvText, name: 'combined.csv' }]);
}
