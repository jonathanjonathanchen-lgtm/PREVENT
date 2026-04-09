// ── Min-Max Decimation Algorithm ─────────────────────────────────────────────
// Preserves local minima and maxima within each chunk, ensuring transient peaks
// and impacts are visually rendered rather than aliased away by naive stride sampling.
//
// For every chunk of `n` source frames, the algorithm preserves:
// - The data point containing the local minimum (of the primary data key)
// - The data point containing the local maximum (of the primary data key)
// This guarantees peak forces and impact transients remain visible in charts.

/**
 * Min-Max decimation: for each chunk, keep the min and max values.
 * Output length ≈ 2 * targetPoints (pairs of min,max per chunk).
 *
 * @param {Array<Object>} data - Source data array
 * @param {string} dataKey - Key to use for min/max comparison (e.g. 'force', 'left')
 * @param {number} targetPoints - Desired approximate output point count (actual = 2*target)
 * @returns {Array<Object>} - Decimated data preserving peaks and valleys
 */
export function minMaxDecimate(data, dataKey, targetPoints = 200) {
  if (!data?.length || data.length <= targetPoints * 2) return data;

  const chunkSize = Math.max(2, Math.floor(data.length / targetPoints));
  const result = [];

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    if (chunk.length === 0) continue;

    if (chunk.length === 1) {
      result.push(chunk[0]);
      continue;
    }

    let minIdx = 0, maxIdx = 0;
    let minVal = chunk[0][dataKey] ?? 0;
    let maxVal = minVal;

    for (let j = 1; j < chunk.length; j++) {
      const v = chunk[j][dataKey] ?? 0;
      if (v < minVal) { minVal = v; minIdx = j; }
      if (v > maxVal) { maxVal = v; maxIdx = j; }
    }

    // Output in temporal order (min before max or vice versa)
    if (minIdx === maxIdx) {
      result.push(chunk[minIdx]);
    } else if (minIdx < maxIdx) {
      result.push(chunk[minIdx]);
      result.push(chunk[maxIdx]);
    } else {
      result.push(chunk[maxIdx]);
      result.push(chunk[minIdx]);
    }
  }

  return result;
}

/**
 * Multi-key min-max decimation: preserves extrema across multiple data keys.
 * Useful for charts with multiple series (e.g. left foot + right foot).
 *
 * @param {Array<Object>} data - Source data array
 * @param {string[]} dataKeys - Keys to track for extrema
 * @param {number} targetPoints - Target output count
 * @returns {Array<Object>} - Decimated data
 */
export function minMaxDecimateMulti(data, dataKeys, targetPoints = 200) {
  if (!data?.length || data.length <= targetPoints * 2) return data;

  const chunkSize = Math.max(2, Math.floor(data.length / targetPoints));
  const result = [];

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    if (chunk.length === 0) continue;

    if (chunk.length === 1) {
      result.push(chunk[0]);
      continue;
    }

    // Track indices of extreme values across all keys
    const extremeIndices = new Set();

    for (const key of dataKeys) {
      let minIdx = 0, maxIdx = 0;
      let minVal = chunk[0][key] ?? 0;
      let maxVal = minVal;

      for (let j = 1; j < chunk.length; j++) {
        const v = chunk[j][key] ?? 0;
        if (v < minVal) { minVal = v; minIdx = j; }
        if (v > maxVal) { maxVal = v; maxIdx = j; }
      }

      extremeIndices.add(minIdx);
      extremeIndices.add(maxIdx);
    }

    // Sort by index (temporal order) and push
    const sorted = [...extremeIndices].sort((a, b) => a - b);
    for (const idx of sorted) {
      result.push(chunk[idx]);
    }
  }

  return result;
}
