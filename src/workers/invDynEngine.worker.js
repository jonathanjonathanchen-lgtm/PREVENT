// ── Inverse Dynamics Web Worker ──────────────────────────────────────────────
// Runs the computationally expensive Newton-Euler solver off the main thread.
// Imports the full physics engine and posts results back.

// NOTE: Vite handles worker bundling. Use `import` for module workers.
import { computeInvDyn } from '../physics/invDynEngine.js';

self.onmessage = function(e) {
  const { kinData, bodyMass, lsfData, forceEventsList, options, id } = e.data;

  try {
    const results = computeInvDyn(kinData, bodyMass, lsfData, forceEventsList, options);
    self.postMessage({ id, ok: true, results });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
