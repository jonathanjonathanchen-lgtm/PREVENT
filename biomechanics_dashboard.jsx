// ── Biomechanics Dashboard — Orchestrator ────────────────────────────────────
// Thin shell: auth wrapper, Supabase data loading, settings persistence,
// and tab routing. All rendering delegated to modular components.
// All heavy computation runs in Web Workers via async hooks.

import { useState, useRef, useCallback, useEffect, useMemo, Component } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ── Internal modules ──
import { C, TABS, KEY_JOINTS, PLANE_LABELS, PLANE_COLORS, PLANE_NAMES, BUCKET } from "./src/utils/constants.js";
import { supabase } from "./src/utils/supabase.js";
import { blobToText, parseLoadSOL, parseForceFile } from "./src/utils/parsers.js";
import { computeAveraged, normalizeForceTime } from "./src/utils/forceUtils.js";
import { parseMVNX } from "./src/adapters/mvnxAdapter.js";
import { getJointAngles } from "./src/adapters/unifiedKinematicData.js";
import { computeInvDyn } from "./src/physics/invDynEngine.js";
import { filterKinPositions } from "./src/physics/butterworth.js";
import { minMaxDecimate } from "./src/utils/decimation.js";
import useBiomechanicsStore from "./src/store/useBiomechanicsStore.js";

// ── Components ──
import { Btn, Stat, ChartCard, Modal, Spinner, EmptyState, FileBar, Tt } from "./src/components/ui/index.js";
import LoginScreen from "./src/components/LoginScreen.jsx";
import SkeletonViewer from "./src/components/SkeletonViewer.jsx";
import DynamicsCharts from "./src/components/DynamicsCharts.jsx";
import ForcesPanel from "./src/components/ForcesPanel.jsx";
import CyclesTab from "./src/components/CyclesTab.jsx";
import LoadSOLTab from "./src/components/LoadSOLTab.jsx";
import JobsTab from "./src/components/JobsTab.jsx";
import PipelineTab from "./src/components/PipelineTab.jsx";
import AssumptionsTab from "./src/components/AssumptionsTab.jsx";

// ── Error Boundary ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error('Render error:', e, info); }
  render() {
    if (this.state.error) return (
      <div style={{background: C.card, border: `1px solid ${C.red}`, borderRadius: 10, padding: 20, margin: 16, color: C.text}}>
        <div style={{fontWeight: 700, color: C.red, marginBottom: 8}}>Render error (check console)</div>
        <pre style={{fontSize: 11, color: C.muted, whiteSpace: "pre-wrap", wordBreak: "break-all"}}>{this.state.error?.message}</pre>
        <button onClick={() => this.setState({error: null})} style={{marginTop: 10, padding: "4px 12px", borderRadius: 6, background: C.accent, color: "#000", border: "none", cursor: "pointer", fontSize: 12}}>Dismiss</button>
      </div>
    );
    return this.props.children;
  }
}

// ── Auth Wrapper ──
export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) return (
    <div style={{background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center"}}>
      <Spinner size={36}/>
    </div>
  );
  if (!session) return <LoginScreen/>;
  return <ErrorBoundary><Dashboard session={session}/></ErrorBoundary>;
}

// ── Main Dashboard ──
function Dashboard({ session }) {
  // ── Zustand store ──
  const store = useBiomechanicsStore();
  const {
    jobs, setJobs, activeJobId, setActiveJobId,
    setJobsLoading: setJobsLoadingStore,
    filesLoading, setFilesLoading, loadingMsg, setLoadingMsg,
    skelFrame, setSkelFrame, skelFileIdx, setSkelFileIdx,
    skelPlaying, setSkelPlaying, skelSpeed,
    loadsolPairings, setLoadsolPairings,
    jointPanels, setJointPanels,
    bodyMass, setBodyMass,
    forceEvents, setForceEvents, activeEventId, setActiveEventId,
    showForcePanel,
    forceFileSets, setForceFileSets,
    useRigidBody, butterworthCutoff,
    tab, setTab, showJobModal, setShowJobModal,
    showUploadModal, setShowUploadModal, uploadType, setUploadType,
    saveError, setSaveError,
    isJobLoaded, markJobLoaded, resetJobState,
  } = store;

  const [newJobName, setNewJobName] = useState("");
  const [forceBlocks, setForceBlocks] = useState([]);
  const fileInputRef = useRef();
  const readyToSaveRef = useRef(false);

  const activeJob = jobs.find(j => j.id === activeJobId);

  // ── Load all jobs on mount ──
  useEffect(() => {
    const load = async () => {
      setJobsLoadingStore(true);
      const { data } = await supabase.from("jobs").select("*, job_files(*)").order("created_at", { ascending: false });
      if (data) {
        setJobs(data.map(j => ({
          ...j, createdAt: new Date(j.created_at).toLocaleDateString(),
          mvnxFiles: [], loadsolFiles: [], forceFiles: [], _fileRecords: j.job_files || [],
        })));
      }
      setJobsLoadingStore(false);
    };
    load();
  }, []);

  // ── Lazy-load files when a job is selected ──
  useEffect(() => {
    if (!activeJobId) return;
    if (isJobLoaded(activeJobId)) { loadSettings(activeJobId); return; }
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;
    markJobLoaded(activeJobId);
    const records = job._fileRecords || [];
    if (!records.length) { loadSettings(activeJobId); return; }

    const doLoad = async () => {
      setFilesLoading(true);
      readyToSaveRef.current = false;

      const dl = async (name, path) => {
        setLoadingMsg(`Downloading ${name}…`);
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error || !data) return null;
        setLoadingMsg(`Parsing ${name}…`);
        return await blobToText(data);
      };

      const mvnxRecs = records.filter(r => r.file_type === "mvnx").sort((a, b) => a.sort_order - b.sort_order);
      const lsRecs = records.filter(r => r.file_type === "loadsol").sort((a, b) => a.sort_order - b.sort_order);
      const forceRecs = records.filter(r => r.file_type === "force").sort((a, b) => a.sort_order - b.sort_order);
      const total = mvnxRecs.length + lsRecs.length + forceRecs.length;
      let done = 0;

      const mvnxFiles = [];
      for (const rec of mvnxRecs) {
        const text = await dl(`${rec.file_name} (${++done}/${total})`, rec.storage_path);
        if (!text) continue;
        const p = parseMVNX(text);
        if (p.ok) mvnxFiles.push({ id: rec.id, storagePath: rec.storage_path, name: rec.file_name, ...p });
      }

      const loadsolFiles = [];
      for (const lsRec of lsRecs) {
        const text = await dl(`${lsRec.file_name} (${++done}/${total})`, lsRec.storage_path);
        if (text) { const p = parseLoadSOL(text); if (p.ok) loadsolFiles.push({ id: lsRec.id, storagePath: lsRec.storage_path, name: lsRec.file_name, ...p }); }
      }

      const forceFiles = [];
      for (const fRec of forceRecs) {
        const text = await dl(`${fRec.file_name} (${++done}/${total})`, fRec.storage_path);
        if (text) { const p = parseForceFile(text); if (p.ok) forceFiles.push({ id: fRec.id, storagePath: fRec.storage_path, name: fRec.file_name, ...p }); }
      }

      store.updateJob(activeJobId, { mvnxFiles, loadsolFiles, forceFiles });
      setFilesLoading(false);
      setLoadingMsg("");
      await loadSettings(activeJobId);
    };
    doLoad();
  }, [activeJobId, jobs.length]);

  // ── Load settings ──
  const loadSettings = async (jobId) => {
    readyToSaveRef.current = false;
    resetJobState();
    setForceBlocks([]);

    const { data } = await supabase.from("job_settings").select("*").eq("job_id", jobId).maybeSingle();
    if (data) {
      const fb = data.force_blocks;
      if (Array.isArray(fb)) setForceBlocks(fb);
      else if (fb && typeof fb === 'object') {
        setForceBlocks(fb.blocks || []);
        if (fb.events && !Array.isArray(fb.events)) setForceEvents(fb.events);
        else if (Array.isArray(fb.events) && fb.events.length) { setForceEvents({ '__default__': fb.events }); setActiveEventId(fb.events[0]?.id || null); }
        if (fb.fileSets) setForceFileSets(fb.fileSets);
      }
      if (data.joint_panels?.length) {
        setJointPanels(data.joint_panels.map(p => ({
          ...p, planes: typeof p.planes === 'number' ? p.planes : (p.planes || [0]).reduce((m, x) => m | (1 << x), 0),
        })));
      }
      if (data.loadsol_pairings) setLoadsolPairings(data.loadsol_pairings);
      if (data.body_mass > 0) setBodyMass(data.body_mass);
    }
    setTimeout(() => { readyToSaveRef.current = true; }, 600);
  };

  // ── Auto-save settings ──
  useEffect(() => {
    if (!activeJobId || !readyToSaveRef.current) return;
    const timer = setTimeout(async () => {
      const payload = {
        force_blocks: { blocks: forceBlocks, events: forceEvents, fileSets: forceFileSets },
        joint_panels: jointPanels, loadsol_pairings: loadsolPairings,
        body_mass: bodyMass, updated_at: new Date().toISOString(),
      };
      const { data: updated, error: updateErr } = await supabase.from("job_settings").update(payload).eq("job_id", activeJobId).select("job_id");
      if (updateErr) { setSaveError(updateErr.message); return; }
      if (!updated?.length) {
        const { error: insertErr } = await supabase.from("job_settings").insert({ job_id: activeJobId, ...payload });
        if (insertErr) { setSaveError(insertErr.message); return; }
      }
      setSaveError(null);
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeJobId, forceBlocks, jointPanels, loadsolPairings, bodyMass, forceFileSets, forceEvents]);

  // ── Skeleton animation ──
  useEffect(() => {
    if (!skelPlaying) return;
    const mvnx = activeJob?.mvnxFiles?.[skelFileIdx];
    if (!mvnx?.frames?.length) return;
    const id = setInterval(() => {
      setSkelFrame(f => { const n = f + 1; if (n >= mvnx.frames.length) { setSkelPlaying(false); return 0; } return n; });
    }, 1000 / ((mvnx.frameRate || 60) * skelSpeed));
    return () => clearInterval(id);
  }, [skelPlaying, activeJob, skelFileIdx, skelSpeed]);

  // ── Memoized data ──
  const rawSkelMvnx = activeJob?.mvnxFiles?.[skelFileIdx];
  // When Butterworth mode is active, filter positions + joint angles for display
  const activeSkelMvnx = useMemo(() => {
    if (useRigidBody || !rawSkelMvnx?.frames?.length) return rawSkelMvnx;
    return filterKinPositions(rawSkelMvnx, butterworthCutoff);
  }, [rawSkelMvnx, useRigidBody, butterworthCutoff]);
  const mvnxKey = activeSkelMvnx?.storagePath || '__default__';
  const curEvs = forceEvents[mvnxKey] || [];
  const setCurEvs = updater => setForceEvents(prev => ({
    ...prev, [mvnxKey]: typeof updater === 'function' ? updater(prev[mvnxKey] || []) : updater,
  }));
  const activeEvent = curEvs.find(e => e.id === activeEventId) || null;
  const forceFilesList = activeJob?.forceFiles || [];

  // Joint panel data — uses ergonomic angles when available
  const panelData = useMemo(() => {
    const mvnx = activeSkelMvnx;
    if (!mvnx?.frames?.length) return jointPanels.map(() => []);
    return jointPanels.map(panel => {
      const def = KEY_JOINTS[panel.jointKey];
      const ji = mvnx.jointLabels?.findIndex(l => def.r.test(l));
      if (ji == null || ji < 0) return [];
      // Min-max decimation instead of stride
      const raw = mvnx.frames.map(f => {
        const angles = getJointAngles(f, ji);
        return {
          t: +f.time.toFixed(2),
          ...(panel.planes & 1 ? { LB: +angles.LB.toFixed(2) } : {}),
          ...(panel.planes & 2 ? { AR: +angles.AR.toFixed(2) } : {}),
          ...(panel.planes & 4 ? { FE: +angles.FE.toFixed(2) } : {}),
        };
      });
      // Determine which key to use for decimation
      const dKey = (panel.planes & 4) ? 'FE' : (panel.planes & 1) ? 'LB' : 'AR';
      return minMaxDecimate(raw, dKey, 200);
    });
  }, [jointPanels, activeSkelMvnx]);

  // LoadSOL
  const _lsAll = activeJob?.loadsolFiles || [];
  const lsfIdx = (skelFileIdx in loadsolPairings) ? loadsolPairings[skelFileIdx] : (_lsAll.length === 1 ? 0 : null);
  const activeLsf = (lsfIdx != null) ? (_lsAll[lsfIdx] ?? null) : null;
  const clippedLsf = useMemo(() => {
    if (!activeLsf?.data?.length) return null;
    if (activeLsf.blipTime == null) return activeLsf.data;
    return activeLsf.data.filter(d => d.time >= activeLsf.blipTime).map(d => ({...d, time: +(d.time - activeLsf.blipTime).toFixed(3)}));
  }, [activeLsf]);

  // Force event pre-computation
  const allEvAveraged = useMemo(() => {
    try {
      const result = {};
      for (const evs of Object.values(forceEvents)) { for (const ev of evs) { result[ev.id] = computeAveraged(ev, forceFilesList); } }
      return result;
    } catch (e) { console.error('allEvAveraged crash:', e); return {}; }
  }, [forceEvents, activeJob?.forceFiles]);

  const averagedEvData = activeEvent ? (allEvAveraged[activeEvent.id] || []) : [];

  const allEvNormalized = useMemo(() => {
    try {
      const result = {};
      for (const evs of Object.values(forceEvents)) { for (const ev of evs) { result[ev.id] = normalizeForceTime(allEvAveraged[ev.id] || [], ev); } }
      return result;
    } catch (e) { console.error('allEvNormalized crash:', e); return {}; }
  }, [forceEvents, allEvAveraged]);

  const dynForceEvents = useMemo(() => {
    try {
      return (curEvs || []).filter(ev => (ev.fileIndices || []).length > 0).map(ev => ({
        data: allEvNormalized[ev.id] || [], tStart: ev.tStart || 0, dirKey: ev.direction || 'auto', hand: ev.hand || 'right',
      })).filter(ev => ev.data.length > 0);
    } catch (e) { return []; }
  }, [curEvs, allEvNormalized]);

  // Inverse dynamics — format-agnostic, uses physics toggle
  const invDynData = useMemo(() => {
    try {
      return computeInvDyn(activeSkelMvnx, bodyMass, clippedLsf, dynForceEvents, { useRigidBody, butterworthCutoff });
    } catch (e) { console.error('invDynData crash:', e); return []; }
  }, [activeSkelMvnx, bodyMass, clippedLsf, dynForceEvents, useRigidBody, butterworthCutoff]);

  // ── Helpers ──
  const openUpload = (type) => { setUploadType(type); setShowUploadModal(true); };

  const createJob = async () => {
    if (!newJobName.trim()) return;
    const { data, error } = await supabase.from("jobs").insert({ name: newJobName.trim() }).select().single();
    if (error) { alert("Create job error: " + error.message); return; }
    if (data) {
      const job = { ...data, createdAt: new Date(data.created_at).toLocaleDateString(), mvnxFiles: [], loadsolFiles: [], forceFiles: [], _fileRecords: [] };
      setJobs([job, ...jobs]);
      setActiveJobId(data.id);
      markJobLoaded(data.id);
      readyToSaveRef.current = true;
    }
    setNewJobName(""); setShowJobModal(false);
  };

  const handleFileUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !activeJobId) return;
    e.target.value = "";
    setShowUploadModal(false);

    for (const file of files) {
      const text = await blobToText(file);
      const storagePath = `${activeJobId}/${uploadType}/${Date.now()}_${file.name}`;

      let parsed;
      if (uploadType === "mvnx") {
        parsed = parseMVNX(text);
      } else if (uploadType === "loadsol") {
        parsed = parseLoadSOL(text);
      } else {
        parsed = parseForceFile(text);
      }
      if (!parsed.ok) { alert(`Parse error in ${file.name}: ${parsed.error}`); continue; }

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file);
      if (upErr) { alert(`Upload error: ${upErr.message}`); continue; }

      const fileType = uploadType;
      const sortOrder = fileType === "mvnx" ? (activeJob?.mvnxFiles?.length || 0)
        : fileType === "loadsol" ? (activeJob?.loadsolFiles?.length || 0)
        : (activeJob?.forceFiles?.length || 0);

      const { data: rec, error: dbErr } = await supabase.from("job_files").insert({
        job_id: activeJobId, file_type: fileType, file_name: file.name,
        storage_path: storagePath, sort_order: sortOrder,
        metadata: fileType === "mvnx" ? { frameRate: parsed.frameRate, duration: parsed.duration, sourceFormat: parsed.sourceFormat }
          : fileType === "loadsol" ? { blipTime: parsed.blipTime, stats: parsed.stats }
          : { stats: parsed.stats },
      }).select().single();
      if (dbErr) continue;

      store.updateJob(activeJobId, (j) => {
        const f = { id: rec.id, storagePath, name: file.name, ...parsed };
        if (fileType === "mvnx") return { ...j, mvnxFiles: [...j.mvnxFiles, f], _fileRecords: [...j._fileRecords, rec] };
        if (fileType === "loadsol") return { ...j, loadsolFiles: [...(j.loadsolFiles || []), f], _fileRecords: [...j._fileRecords, rec] };
        if (fileType === "force") return { ...j, forceFiles: [...(j.forceFiles || []), f], _fileRecords: [...j._fileRecords, rec] };
        return j;
      });
    }
  }, [activeJobId, uploadType, activeJob]);

  const removeFile = useCallback(async (type, idx) => {
    const job = jobs.find(j => j.id === activeJobId);
    if (!job) return;
    let fileObj;
    if (type === "mvnx") fileObj = job.mvnxFiles[idx];
    if (type === "loadsol") fileObj = job.loadsolFiles[idx];
    if (type === "force") fileObj = job.forceFiles[idx];
    if (!fileObj) return;
    if (fileObj.storagePath) await supabase.storage.from(BUCKET).remove([fileObj.storagePath]);
    if (fileObj.id) await supabase.from("job_files").delete().eq("id", fileObj.id);

    store.updateJob(activeJobId, (j) => {
      if (type === "mvnx") return { ...j, mvnxFiles: j.mvnxFiles.filter((_, i) => i !== idx) };
      if (type === "loadsol") return { ...j, loadsolFiles: j.loadsolFiles.filter((_, i) => i !== idx) };
      if (type === "force") return { ...j, forceFiles: j.forceFiles.filter((_, i) => i !== idx) };
      return j;
    });

    if (type === "force") {
      setForceEvents(prev => {
        const updated = {};
        for (const [key, evs] of Object.entries(prev)) {
          updated[key] = evs.map(ev => ({
            ...ev, fileIndices: (ev.fileIndices || []).filter(i => i !== idx).map(i => i > idx ? i - 1 : i),
          }));
        }
        return updated;
      });
    }
  }, [activeJobId, jobs]);

  // ── Skeleton Tab ──
  const renderSkeleton = () => {
    const mvnxFiles = activeJob?.mvnxFiles || [];
    const mvnx = mvnxFiles[skelFileIdx];
    const hasData = !!mvnx?.frames?.length;
    const frame = hasData ? mvnx.frames[Math.min(skelFrame, mvnx.frames.length - 1)] : null;
    const ft = frame?.time || 0;
    const loadsolFilesList = activeJob?.loadsolFiles || [];
    const lsfPairIdx = (skelFileIdx in loadsolPairings) ? loadsolPairings[skelFileIdx] : (loadsolFilesList.length === 1 ? 0 : null);
    const lsf = (lsfPairIdx != null) ? (loadsolFilesList[lsfPairIdx] ?? null) : null;
    const hasLS = !!lsf?.data?.length;

    if (filesLoading) return (
      <div style={{display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 14}}>
        <Spinner size={32}/><div style={{fontSize: 13, color: C.muted}}>{loadingMsg || "Loading files\…"}</div>
      </div>
    );

    return (
      <div>
        {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
        {activeJob && (
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginBottom: 12}}>
            <Stat label="Cycles" value={mvnxFiles.length || "—"} unit="files"/>
            <Stat label="Duration" value={mvnx?.duration?.toFixed(1) || "—"} unit="s"/>
            <Stat label="GRF Peak R" value={lsf?.stats?.rightMax?.toFixed(0) || "—"} unit="N"/>
            <Stat label="GRF Peak L" value={lsf?.stats?.leftMax?.toFixed(0) || "—"} unit="N"/>
            <Stat label="Frame Rate" value={mvnx?.frameRate || "—"} unit="Hz" color={C.teal}/>
            <Stat label="Force Events" value={curEvs?.length || "—"} unit=""/>
          </div>
        )}

        {/* Cycle / LoadSOL selectors */}
        {(mvnxFiles.length > 0 || loadsolFilesList.length > 0) && (
          <div style={{marginBottom: 10, background: C.bg, borderRadius: 7, border: `1px solid ${C.border}`, overflow: "hidden"}}>
            <div style={{display: "grid", gridTemplateColumns: "1fr 16px 1fr", alignItems: "center",
              padding: "5px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5}}>
              <span>MVNX Cycle</span><span/><span>LoadSOL</span>
            </div>
            {mvnxFiles.map((f, i) => {
              const pairedIdx = loadsolPairings[i] ?? (loadsolFilesList.length === 1 ? 0 : null);
              const isActive = skelFileIdx === i;
              return (
                <div key={i} onClick={() => { setSkelFileIdx(i); setSkelFrame(0); setSkelPlaying(false); }} style={{
                  display: "grid", gridTemplateColumns: "1fr 16px 1fr", alignItems: "center", padding: "6px 10px", cursor: "pointer",
                  background: isActive ? C.accent + "18" : "transparent", borderBottom: i < mvnxFiles.length - 1 ? `1px solid ${C.border}` : "none"}}>
                  <span style={{fontSize: 12, color: isActive ? C.accent : C.text, fontWeight: isActive ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>
                    {f.name.replace(/\.mvnx\.mvnx$|\.mvnx$|\.gz$/i, "")}
                  </span>
                  <span style={{textAlign: "center", color: C.muted, fontSize: 11}}>→</span>
                  {loadsolFilesList.length > 0 ? (
                    <select value={pairedIdx ?? ""} onClick={e => e.stopPropagation()}
                      onChange={e => { const v = e.target.value === "" ? null : +e.target.value; setLoadsolPairings(prev => ({...prev, [i]: v})); }}
                      style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 4px", color: pairedIdx != null ? C.text : C.muted, fontSize: 11, width: "100%"}}>
                      <option value="">{"— none —"}</option>
                      {loadsolFilesList.map((ls, li) => <option key={li} value={li}>{ls.name.replace(/\.txt$/i, "")}</option>)}
                    </select>
                  ) : <span style={{fontSize: 11, color: C.muted, fontStyle: "italic"}}>no LoadSOL</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Two-column layout */}
        {!activeJobId ? (
          <EmptyState icon="🗂" title="No job selected" detail="Create or select a job to get started."
            action={<Btn active onClick={() => setShowJobModal(true)}>Create Job</Btn>}/>
        ) : (
          <div style={{display: "grid", gridTemplateColumns: showForcePanel ? "300px 1fr" : "300px 1fr", gap: 14, alignItems: "start"}}>
            <SkeletonViewer mvnx={activeSkelMvnx} showForcePanelToggle={true}
              curEvs={curEvs} allEvNormalized={allEvNormalized} allEvAveraged={allEvAveraged} openUpload={openUpload}/>

            {showForcePanel ? (
              <ForcesPanel curEvs={curEvs} setCurEvs={setCurEvs} activeEvent={activeEvent}
                allEvNormalized={allEvNormalized} allEvAveraged={allEvAveraged} averagedEvData={averagedEvData}
                forceFilesList={forceFilesList} activeSkelMvnx={activeSkelMvnx}/>
            ) : (
              <div>
                {jointPanels.map((panel, pi) => {
                  const kj = KEY_JOINTS[panel.jointKey];
                  const data = panelData[pi] || [];
                  const ji = hasData ? mvnx.jointLabels?.findIndex(l => kj.r.test(l)) : -1;
                  const curAngles = (ji >= 0 && frame) ? getJointAngles(frame, ji) : null;
                  return (
                    <ChartCard key={pi} h={180} title={
                      <span>{kj.lbl}{curAngles && panel.planes > 0 && (
                        <span style={{fontSize: 10, fontWeight: 400, color: C.muted, marginLeft: 8}}>
                          {[0, 1, 2].filter(pli => panel.planes & (1 << pli)).map(pli => `${PLANE_LABELS[pli]}: ${curAngles[PLANE_LABELS[pli]]?.toFixed?.(1) ?? 0}°`).join("  ")}
                        </span>
                      )}</span>
                    } action={
                      <div style={{display: "flex", gap: 4, alignItems: "center"}}>
                        {PLANE_LABELS.map((pl, pli) => (
                          <Btn key={pl} small active={!!(panel.planes & (1 << pli))}
                            onClick={() => setJointPanels(prev => prev.map((p, i) => i !== pi ? p : {...p, planes: p.planes ^ (1 << pli)}))}>{pl}</Btn>
                        ))}
                        <select value={panel.jointKey}
                          onChange={e => setJointPanels(prev => prev.map((p, i) => i === pi ? {...p, jointKey: +e.target.value} : p))}
                          style={{background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 4px", color: C.muted, fontSize: 10, marginLeft: 4}}>
                          {KEY_JOINTS.map((kj, kji) => <option key={kji} value={kji}>{kj.lbl}</option>)}
                        </select>
                        {jointPanels.length > 1 && <Btn small danger onClick={() => setJointPanels(prev => prev.filter((_, i) => i !== pi))}>×</Btn>}
                      </div>
                    }>
                      <ResponsiveContainer>
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                          <XAxis dataKey="t" type="number" domain={[0, +(mvnx?.duration || 0).toFixed(2)]}
                            tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="s"/>
                          <YAxis tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="°"/>
                          <Tooltip content={Tt}/>
                          <ReferenceLine y={0} stroke={C.border} strokeDasharray="3 3"/>
                          <ReferenceLine x={ft} stroke={C.amber} strokeWidth={2} isFront/>
                          {PLANE_LABELS.map((pl, pli) => !!(panel.planes & (1 << pli)) && (
                            <Line key={pl} type="monotone" dataKey={pl} stroke={PLANE_COLORS[pli]} dot={false} strokeWidth={1.5} name={PLANE_NAMES[pli]} isAnimationActive={false}/>
                          ))}
                          {data.length > 0 && (panel.planes & (panel.planes - 1)) !== 0 && <Legend wrapperStyle={{fontSize: 10}}/>}
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  );
                })}
                <div style={{marginBottom: 12}}>
                  <Btn small onClick={() => setJointPanels(prev => [...prev, {jointKey: 0, planes: 4}])}>+ Add Joint Panel</Btn>
                </div>

                {hasLS && (() => {
                  const clipped = lsf.blipTime != null
                    ? lsf.data.filter(d => d.time >= lsf.blipTime).map(d => ({...d, time: +(d.time - lsf.blipTime).toFixed(3)}))
                    : lsf.data;
                  const d = minMaxDecimate(clipped, 'left', 200);
                  return (
                    <ChartCard title="LoadSOL GRF (aligned)" h={150}>
                      <ResponsiveContainer><LineChart data={d}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                        <XAxis dataKey="time" type="number" domain={[0, "auto"]} tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="s"/>
                        <YAxis tick={{fill: C.muted, fontSize: 9}} stroke={C.border} unit="N"/>
                        <Tooltip content={Tt}/>
                        <ReferenceLine x={ft} stroke={C.amber} strokeWidth={2} isFront/>
                        <Line type="monotone" dataKey="left" stroke={C.sky} dot={false} strokeWidth={1.5} name="L" isAnimationActive={false}/>
                        <Line type="monotone" dataKey="right" stroke={C.rose} dot={false} strokeWidth={1.5} name="R" isAnimationActive={false}/>
                      </LineChart></ResponsiveContainer>
                    </ChartCard>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Forces & Dynamics Tab ──
  const renderForces = () => {
    if (filesLoading) return <div style={{display: "flex", justifyContent: "center", padding: 60}}><Spinner size={32}/></div>;
    return (
      <div>
        {activeJob && <FileBar job={activeJob} onUpload={openUpload} onRemove={removeFile}/>}
        <div style={{display: "grid", gridTemplateColumns: "320px 1fr", gap: 14, alignItems: "start", marginTop: 10}}>
          <div style={{display: "flex", flexDirection: "column", gap: 10}}>
            <SkeletonViewer mvnx={activeSkelMvnx} showForcePanelToggle={false}
              curEvs={curEvs} allEvNormalized={allEvNormalized} allEvAveraged={allEvAveraged} openUpload={openUpload}/>
            <ErrorBoundary key={activeEventId || 'none'}>
              <ForcesPanel curEvs={curEvs} setCurEvs={setCurEvs} activeEvent={activeEvent}
                allEvNormalized={allEvNormalized} allEvAveraged={allEvAveraged} averagedEvData={averagedEvData}
                forceFilesList={forceFilesList} activeSkelMvnx={activeSkelMvnx}/>
            </ErrorBoundary>
          </div>
          <ErrorBoundary>
            <DynamicsCharts invDynData={invDynData} activeSkelMvnx={activeSkelMvnx} clippedLsf={clippedLsf}
              curEvs={curEvs} allEvNormalized={allEvNormalized} allEvAveraged={allEvAveraged}
              activeEventId={activeEventId} openUpload={openUpload}/>
          </ErrorBoundary>
        </div>
      </div>
    );
  };

  // ── Tab routing ──
  const panels = [
    renderSkeleton,
    () => <CyclesTab openUpload={openUpload} removeFile={removeFile}/>,
    () => <LoadSOLTab openUpload={openUpload} removeFile={removeFile}/>,
    renderForces,
    () => <JobsTab openUpload={openUpload}/>,
    () => <PipelineTab/>,
    () => <AssumptionsTab/>,
  ];

  // ── Modals ──
  const renderJobModal = () => (
    <Modal title="Create New Job" onClose={() => setShowJobModal(false)}>
      <div style={{marginBottom: 14}}>
        <label style={{display: "block", fontSize: 12, color: C.muted, marginBottom: 6}}>Job Name</label>
        <input value={newJobName} onChange={e => setNewJobName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && createJob()} autoFocus
          placeholder="e.g. Subject 01 \— Session A"
          style={{width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", color: C.text, fontSize: 13, boxSizing: "border-box"}}/>
      </div>
      <div style={{display: "flex", gap: 8, justifyContent: "flex-end"}}>
        <Btn onClick={() => setShowJobModal(false)}>Cancel</Btn>
        <Btn active onClick={createJob}>Create Job</Btn>
      </div>
    </Modal>
  );

  const renderUploadModal = () => {
    const info = {
      mvnx:    {icon: "🦴", title: "Upload MVNX Files", detail: "One .mvnx file per cycle trial (supports .mvnx.gz compressed)", accept: ".mvnx,.gz", multi: true},
      loadsol: {icon: "👟", title: "Upload LoadSOL TXT", detail: "Tab-separated TXT export from LoadSOL", accept: ".txt", multi: true},
      force:   {icon: "📈", title: "Upload Force CSV", detail: "Time (col 1), Force (col 2). WiDACS CSV works directly.", accept: ".csv,.txt", multi: false},
    }[uploadType];
    return (
      <Modal title="Upload Files" onClose={() => setShowUploadModal(false)}>
        <div style={{fontSize: 12, color: C.muted, marginBottom: 12}}>Job: <span style={{color: C.accent, fontWeight: 600}}>{activeJob?.name}</span></div>
        <div style={{display: "flex", gap: 6, marginBottom: 16}}>
          {[["mvnx", "🦴 MVNX"], ["loadsol", "👟 LoadSOL"], ["force", "📈 Force"]].map(([k, lbl]) => (
            <Btn key={k} active={uploadType === k} onClick={() => setUploadType(k)}>{lbl}</Btn>
          ))}
        </div>
        <div style={{background: C.bg, border: `2px dashed ${C.border}`, borderRadius: 8, padding: 32, textAlign: "center"}}>
          <div style={{fontSize: 30, marginBottom: 8}}>{info.icon}</div>
          <div style={{fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 5}}>{info.title}</div>
          <div style={{fontSize: 12, color: C.muted, marginBottom: 18}}>{info.detail}</div>
          <input ref={fileInputRef} type="file" multiple={info.multi} accept={info.accept} onChange={handleFileUpload} style={{display: "none"}}/>
          <Btn active onClick={() => fileInputRef.current?.click()}>Choose Files</Btn>
        </div>
      </Modal>
    );
  };

  // ── Root Render ──
  return (
    <div style={{background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background: `linear-gradient(135deg,${C.bg},${C.card})`, borderBottom: `1px solid ${C.border}`, padding: "14px 24px"}}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10}}>
          <div>
            <div style={{fontSize: 10, color: C.accent, textTransform: "uppercase", letterSpacing: 2, marginBottom: 3}}>OBEL · UWaterloo</div>
            <div style={{fontSize: 20, fontWeight: 700}}>Biomechanics Research Dashboard</div>
            <div style={{fontSize: 12, color: C.muted}}>MVNX · CSV · LoadSOL · WiDACS · Cycle Analysis · MSD Risk</div>
          </div>
          <div style={{display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap"}}>
            <select value={activeJobId || ""} onChange={e => setActiveJobId(e.target.value || null)}
              style={{background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", color: activeJobId ? C.text : C.muted, fontSize: 12}}>
              <option value="">{"— Select Job —"}</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
            <Btn active onClick={() => setShowJobModal(true)}>+ Job</Btn>
            {activeJobId && <Btn onClick={() => setShowUploadModal(true)}>⬆ Upload</Btn>}
            <div style={{display: "flex", alignItems: "center", gap: 8, paddingLeft: 8, borderLeft: `1px solid ${C.border}`}}>
              <span style={{fontSize: 11, color: C.muted}}>{session.user.email}</span>
              <Btn small danger onClick={() => supabase.auth.signOut()}>Sign Out</Btn>
            </div>
          </div>
        </div>
      </div>
      {saveError && (
        <div style={{background: "#7f1d1d", borderBottom: "1px solid #dc2626", padding: "10px 24px", fontSize: 12, color: "#fca5a5"}}>
          <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6}}>
            <span style={{fontWeight: 600}}>⚠ Settings save failed: {saveError}</span>
            <span style={{cursor: "pointer", opacity: .7, marginLeft: 12}} onClick={() => setSaveError(null)}>✕</span>
          </div>
          <div style={{marginBottom: 4}}>Run this in <strong>Supabase → SQL Editor</strong>:</div>
          <pre style={{background: "rgba(0,0,0,.4)", padding: "8px 10px", borderRadius: 4, fontSize: 11, margin: 0, overflowX: "auto", userSelect: "all"}}>{`ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS force_blocks jsonb DEFAULT '[]';
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS joint_panels jsonb DEFAULT '[]';
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS loadsol_pairings jsonb DEFAULT '{}';
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS body_mass numeric DEFAULT 75;
ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE job_settings ADD CONSTRAINT job_settings_job_id_key UNIQUE (job_id);`}</pre>
        </div>
      )}
      <div style={{display: "flex", gap: 4, padding: "10px 24px", borderBottom: `1px solid ${C.border}`, background: C.card, overflowX: "auto"}}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            padding: "7px 16px", borderRadius: 6, border: "none", whiteSpace: "nowrap", cursor: "pointer",
            background: tab === i ? C.accent + "20" : "transparent",
            color: tab === i ? C.accent : C.muted, fontSize: 12, fontWeight: tab === i ? 600 : 400
          }}>{t}</button>
        ))}
      </div>
      <div style={{padding: "18px 24px", maxWidth: 1200, margin: "0 auto"}}>{panels[tab]()}</div>
      {showJobModal && renderJobModal()}
      {showUploadModal && activeJobId && renderUploadModal()}
    </div>
  );
}
