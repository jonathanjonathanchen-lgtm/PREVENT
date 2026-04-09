// ── Min-Max Decimation Hook ──────────────────────────────────────────────────
// Memoized hook that applies min-max decimation to chart data.

import { useMemo } from 'react';
import { minMaxDecimate, minMaxDecimateMulti } from '../utils/decimation.js';

/**
 * Hook that decimates data for chart rendering using min-max algorithm.
 *
 * @param {Array} data - Source data
 * @param {string} dataKey - Primary key for min/max comparison
 * @param {number} targetPoints - Target output count (actual ≈ 2x)
 * @returns {Array} - Decimated data
 */
export function useMinMaxDecimation(data, dataKey, targetPoints = 200) {
  return useMemo(
    () => minMaxDecimate(data, dataKey, targetPoints),
    [data, dataKey, targetPoints]
  );
}

/**
 * Hook that decimates data preserving extrema across multiple keys.
 */
export function useMultiKeyDecimation(data, dataKeys, targetPoints = 200) {
  return useMemo(
    () => minMaxDecimateMulti(data, dataKeys, targetPoints),
    [data, dataKeys, targetPoints]
  );
}
