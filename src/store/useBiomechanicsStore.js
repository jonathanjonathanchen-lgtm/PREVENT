// ── Zustand Store ────────────────────────────────────────────────────────────
// Manages parsed UnifiedKinematicData and forceEvents outside the React render
// cycle to prevent cascading re-renders. Only UI-bound slices trigger renders.

import { create } from 'zustand';

const useBiomechanicsStore = create((set, get) => ({
  // ── Jobs ──
  jobs: [],
  activeJobId: localStorage.getItem('bmech_activeJob') || null,
  jobsLoading: true,
  filesLoading: false,
  loadingMsg: "",
  loadedJobs: new Set(),

  setJobs: (jobs) => set({ jobs }),
  updateJob: (jobId, updater) => set(state => ({
    jobs: state.jobs.map(j => j.id === jobId ? (typeof updater === 'function' ? updater(j) : { ...j, ...updater }) : j),
  })),
  setActiveJobId: (id) => {
    if (id) localStorage.setItem('bmech_activeJob', id);
    else localStorage.removeItem('bmech_activeJob');
    set({ activeJobId: id });
  },
  setJobsLoading: (v) => set({ jobsLoading: v }),
  setFilesLoading: (v) => set({ filesLoading: v }),
  setLoadingMsg: (v) => set({ loadingMsg: v }),
  markJobLoaded: (id) => set(state => {
    const s = new Set(state.loadedJobs);
    s.add(id);
    return { loadedJobs: s };
  }),
  isJobLoaded: (id) => get().loadedJobs.has(id),

  // ── Active Job Derived ──
  getActiveJob: () => {
    const s = get();
    return s.jobs.find(j => j.id === s.activeJobId) || null;
  },

  // ── Skeleton / Playback ──
  skelFrame: 0,
  skelView: "front",
  skelFileIdx: 0,
  skelPlaying: false,
  skelSpeed: 1,
  skelLoadsolIdx: 0,

  setSkelFrame: (v) => set(state => ({ skelFrame: typeof v === 'function' ? v(state.skelFrame) : v })),
  setSkelView: (v) => set({ skelView: v }),
  setSkelFileIdx: (v) => set({ skelFileIdx: v }),
  setSkelPlaying: (v) => set(state => ({ skelPlaying: typeof v === 'function' ? v(state.skelPlaying) : v })),
  setSkelSpeed: (v) => set({ skelSpeed: v }),
  setSkelLoadsolIdx: (v) => set({ skelLoadsolIdx: v }),

  // ── LoadSOL pairings ──
  loadsolPairings: {},
  setLoadsolPairings: (v) => set(state => ({
    loadsolPairings: typeof v === 'function' ? v(state.loadsolPairings) : v,
  })),

  // ── Joint panels ──
  jointPanels: [{ jointKey: 0, planes: 4 }], // bit2=FE default
  setJointPanels: (v) => set(state => ({
    jointPanels: typeof v === 'function' ? v(state.jointPanels) : v,
  })),

  // ── Body mass ──
  bodyMass: 75,
  setBodyMass: (v) => set({ bodyMass: v }),

  // ── Force events ──
  forceEvents: {},
  activeEventId: null,
  showForcePanel: false,
  forceFileSets: {},

  setForceEvents: (v) => set(state => ({
    forceEvents: typeof v === 'function' ? v(state.forceEvents) : v,
  })),
  setActiveEventId: (v) => set({ activeEventId: v }),
  setShowForcePanel: (v) => set(state => ({
    showForcePanel: typeof v === 'function' ? v(state.showForcePanel) : v,
  })),
  setForceFileSets: (v) => set(state => ({
    forceFileSets: typeof v === 'function' ? v(state.forceFileSets) : v,
  })),

  // ── Physics toggle ──
  useRigidBody: true,  // true = XSENS pre-filtered, false = Butterworth
  butterworthCutoff: 6,
  setUseRigidBody: (v) => set({ useRigidBody: v }),
  setButterworthCutoff: (v) => set({ butterworthCutoff: v }),

  // ── UI state ──
  tab: 0,
  showJobModal: false,
  showUploadModal: false,
  uploadType: "mvnx",
  showMomComponents: false,
  showTriggerCh: false,
  cycleJointKey: 0,
  saveError: null,

  setTab: (v) => set({ tab: v }),
  setShowJobModal: (v) => set({ showJobModal: v }),
  setShowUploadModal: (v) => set({ showUploadModal: v }),
  setUploadType: (v) => set({ uploadType: v }),
  setShowMomComponents: (v) => set(state => ({
    showMomComponents: typeof v === 'function' ? v(state.showMomComponents) : v,
  })),
  setShowTriggerCh: (v) => set(state => ({
    showTriggerCh: typeof v === 'function' ? v(state.showTriggerCh) : v,
  })),
  setCycleJointKey: (v) => set({ cycleJointKey: v }),
  setSaveError: (v) => set({ saveError: v }),

  // ── Bulk reset for job switch ──
  resetJobState: () => set({
    skelFrame: 0,
    skelFileIdx: 0,
    skelPlaying: false,
    skelLoadsolIdx: 0,
    loadsolPairings: {},
    jointPanels: [{ jointKey: 0, planes: 4 }],
    bodyMass: 75,
    forceEvents: {},
    activeEventId: null,
    showForcePanel: false,
    forceFileSets: {},
  }),
}));

export default useBiomechanicsStore;
