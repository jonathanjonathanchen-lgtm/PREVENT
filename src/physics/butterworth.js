// ── 4th-Order Zero-Lag Butterworth Low-Pass Digital Filter ──────────────────
// Implements a forward-backward (filtfilt) 2nd-order Butterworth cascade
// to achieve 4th-order zero-phase response.
//
// DSP Theory:
// A 2nd-order Butterworth has maximally flat magnitude in the passband.
// Transfer function: H(s) = 1 / (s^2 + sqrt(2)*s + 1), normalized to cutoff wc.
//
// Bilinear transform (Tustin's method) maps s-domain to z-domain:
//   s = (2/T) * (1 - z^-1) / (1 + z^-1)
//
// For zero-phase (zero-lag): apply filter forward, then reverse the output
// and apply again. This squares the magnitude response and cancels phase,
// yielding a 4th-order Butterworth magnitude with zero group delay.

/**
 * Design 2nd-order Butterworth low-pass filter coefficients.
 * @param {number} fc - Cutoff frequency (Hz)
 * @param {number} fs - Sampling frequency (Hz)
 * @returns {{b: number[], a: number[]}} - Numerator and denominator coefficients
 */
export function designButterworth2(fc, fs) {
  // Pre-warp the cutoff frequency for bilinear transform
  const wc = Math.tan(Math.PI * fc / fs);
  const wc2 = wc * wc;
  const sqrt2 = Math.SQRT2;

  // Bilinear transform of 2nd-order Butterworth prototype
  // H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
  const k = 1 + sqrt2 * wc + wc2;

  const b0 = wc2 / k;
  const b1 = 2 * wc2 / k;
  const b2 = wc2 / k;
  const a1 = (2 * wc2 - 2) / k;
  const a2 = (1 - sqrt2 * wc + wc2) / k;

  return { b: [b0, b1, b2], a: [1, a1, a2] };
}

/**
 * Apply IIR filter (Direct Form II) to signal in one direction.
 * @param {number[]} signal - Input signal
 * @param {number[]} b - Numerator coefficients
 * @param {number[]} a - Denominator coefficients [1, a1, a2]
 * @returns {number[]} - Filtered signal
 */
function applyFilter(signal, b, a) {
  const n = signal.length;
  const out = new Float64Array(n);
  // State variables for Direct Form II transposed
  let w1 = 0, w2 = 0;

  // Edge padding: reflect first sample to reduce transient
  const x0 = signal[0];
  // Pre-run filter on mirrored initial samples to warm up state
  for (let i = Math.min(30, n - 1); i >= 0; i--) {
    const x = 2 * x0 - signal[i]; // reflected
    const y = b[0] * x + w1;
    w1 = b[1] * x - a[1] * y + w2;
    w2 = b[2] * x - a[2] * y;
  }

  for (let i = 0; i < n; i++) {
    const x = signal[i];
    const y = b[0] * x + w1;
    w1 = b[1] * x - a[1] * y + w2;
    w2 = b[2] * x - a[2] * y;
    out[i] = y;
  }
  return Array.from(out);
}

/**
 * Zero-phase (forward-backward) filtering — achieves 4th-order from 2nd-order section.
 * Equivalent to MATLAB's filtfilt with a 2nd-order Butterworth section.
 * @param {number[]} signal - Input signal
 * @param {number} fc - Cutoff frequency (Hz)
 * @param {number} fs - Sampling frequency (Hz)
 * @returns {number[]} - Zero-phase filtered signal
 */
export function filtfiltButterworth4(signal, fc, fs) {
  if (signal.length < 12) return signal.slice(); // too short to filter
  if (fc >= fs / 2) return signal.slice(); // cutoff above Nyquist

  const { b, a } = designButterworth2(fc, fs);

  // Forward pass
  let y = applyFilter(signal, b, a);
  // Reverse
  y.reverse();
  // Backward pass (second application of 2nd-order = 4th-order total)
  y = applyFilter(y, b, a);
  // Reverse back to original time direction
  y.reverse();

  return y;
}

/**
 * Numerically derive acceleration from position using the Butterworth-filtered path.
 * 1. Filter position with zero-lag 4th-order Butterworth
 * 2. Central difference for velocity
 * 3. Central difference for acceleration
 *
 * @param {number[]} position - 1D position signal
 * @param {number} fs - Sampling rate (Hz)
 * @param {number} fc - Cutoff frequency for Butterworth (Hz), default 6 Hz
 * @returns {number[]} - Acceleration signal (same length, edges zero-padded)
 */
export function butterworthAccelFromPosition(position, fs, fc = 6) {
  const n = position.length;
  if (n < 5) return new Array(n).fill(0);

  const filtered = filtfiltButterworth4(position, fc, fs);
  const dt = 1.0 / fs;

  // Central difference velocity: v[i] = (x[i+1] - x[i-1]) / (2*dt)
  const vel = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    vel[i] = (filtered[i + 1] - filtered[i - 1]) / (2 * dt);
  }
  vel[0] = vel[1];
  vel[n - 1] = vel[n - 2];

  // Central difference acceleration: a[i] = (v[i+1] - v[i-1]) / (2*dt)
  const acc = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    acc[i] = (vel[i + 1] - vel[i - 1]) / (2 * dt);
  }
  acc[0] = acc[1];
  acc[n - 1] = acc[n - 2];

  return acc;
}

/**
 * Derive 3D acceleration from 3-component position arrays using Butterworth filter.
 * @param {number[][]} positionsPerFrame - Array of [x,y,z] per frame for a single point
 * @param {number} fs - Sample rate
 * @param {number} fc - Cutoff frequency (Hz)
 * @returns {number[][]} - Array of [ax,ay,az] per frame
 */
export function butterworth3DAccel(positionsPerFrame, fs, fc = 6) {
  const n = positionsPerFrame.length;
  if (n < 5) return positionsPerFrame.map(() => [0, 0, 0]);

  const px = positionsPerFrame.map(p => p[0]);
  const py = positionsPerFrame.map(p => p[1]);
  const pz = positionsPerFrame.map(p => p[2]);

  const ax = butterworthAccelFromPosition(px, fs, fc);
  const ay = butterworthAccelFromPosition(py, fs, fc);
  const az = butterworthAccelFromPosition(pz, fs, fc);

  return ax.map((_, i) => [ax[i], ay[i], az[i]]);
}
