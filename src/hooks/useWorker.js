// ── Web Worker Hook ──────────────────────────────────────────────────────────
// Provides async React hooks for running parsers and inverse dynamics in workers.
// Each hook manages worker lifecycle, pending requests, and cleanup.

import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Generic hook for communicating with a Web Worker.
 * @param {Function} workerFactory - Function that creates the worker (e.g. () => new Worker(...))
 * @returns {{ run: (data) => Promise, running: boolean, terminate: () => void }}
 */
export function useWorker(workerFactory) {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());
  const [running, setRunning] = useState(false);
  const idRef = useRef(0);

  // Lazy-init worker
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const w = workerFactory();
      w.onmessage = (e) => {
        const { id, ...result } = e.data;
        const resolver = pendingRef.current.get(id);
        if (resolver) {
          pendingRef.current.delete(id);
          resolver(result);
          if (pendingRef.current.size === 0) setRunning(false);
        }
      };
      w.onerror = (err) => {
        // Reject all pending
        for (const [id, resolver] of pendingRef.current) {
          resolver({ ok: false, error: err.message });
        }
        pendingRef.current.clear();
        setRunning(false);
      };
      workerRef.current = w;
    }
    return workerRef.current;
  }, [workerFactory]);

  const run = useCallback((data) => {
    return new Promise((resolve) => {
      const id = ++idRef.current;
      pendingRef.current.set(id, resolve);
      setRunning(true);
      getWorker().postMessage({ ...data, id });
    });
  }, [getWorker]);

  const terminate = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    return () => terminate();
  }, [terminate]);

  return { run, running, terminate };
}

/**
 * Hook for MVNX parsing in a Web Worker.
 */
export function useMvnxWorker() {
  return useWorker(() =>
    new Worker(new URL('../workers/mvnxParser.worker.js', import.meta.url), { type: 'module' })
  );
}

/**
 * Hook for CSV parsing in a Web Worker.
 */
export function useCsvWorker() {
  return useWorker(() =>
    new Worker(new URL('../workers/csvParser.worker.js', import.meta.url), { type: 'module' })
  );
}

/**
 * Hook for inverse dynamics computation in a Web Worker.
 */
export function useInvDynWorker() {
  return useWorker(() =>
    new Worker(new URL('../workers/invDynEngine.worker.js', import.meta.url), { type: 'module' })
  );
}
