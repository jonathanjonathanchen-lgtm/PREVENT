import { useState } from 'react';
import { C } from '../utils/constants.js';
import { supabase } from '../utils/supabase.js';
import { Btn, Spinner, EmptyState } from './ui/index.js';
import useBiomechanicsStore from '../store/useBiomechanicsStore.js';

export default function JobsTab({ openUpload }) {
  const {
    jobs, setJobs, activeJobId, setActiveJobId,
    jobsLoading, setShowJobModal, markJobLoaded,
  } = useBiomechanicsStore();

  const [editingJobId, setEditingJobId] = useState(null);
  const [editingJobName, setEditingJobName] = useState("");

  const renameJob = async (jobId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await supabase.from("jobs").update({ name: trimmed }).eq("id", jobId);
    setJobs(jobs.map(j => j.id === jobId ? { ...j, name: trimmed } : j));
  };

  const deleteJob = async (jobId) => {
    await supabase.from("jobs").delete().eq("id", jobId);
    setJobs(jobs.filter(j => j.id !== jobId));
    if (activeJobId === jobId) setActiveJobId(null);
  };

  return (
    <div>
      <div style={{display: "flex", gap: 8, marginBottom: 18}}>
        <Btn active onClick={() => setShowJobModal(true)}>+ New Job</Btn>
        {activeJobId && <Btn onClick={() => openUpload("mvnx")}>{"\u2B06"} Upload Files</Btn>}
      </div>
      {jobsLoading ? (
        <div style={{display: "flex", justifyContent: "center", padding: 60}}><Spinner size={32}/></div>
      ) : !jobs.length ? (
        <EmptyState icon={"\uD83D\uDDC2"} title="No jobs yet" detail="Create a job to organise files per subject/session."
          action={<Btn active onClick={() => setShowJobModal(true)}>Create First Job</Btn>}/>
      ) : (
        <div style={{display: "grid", gap: 10}}>
          {jobs.map(job => (
            <div key={job.id}
              style={{background: C.card, border: `1px solid ${activeJobId === job.id ? C.accent : C.border}`, borderRadius: 10, padding: 14, cursor: "pointer"}}
              onClick={() => setActiveJobId(job.id)}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                {editingJobId === job.id ? (
                  <input value={editingJobName}
                    onChange={e => setEditingJobName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { renameJob(job.id, editingJobName); setEditingJobId(null); } if (e.key === "Escape") setEditingJobId(null); }}
                    onBlur={() => { renameJob(job.id, editingJobName); setEditingJobId(null); }}
                    onClick={e => e.stopPropagation()} autoFocus
                    style={{background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 6, padding: "4px 10px", color: C.text, fontSize: 14, fontWeight: 700, flex: 1, marginRight: 8}}/>
                ) : (
                  <div style={{flex: 1}}>
                    <div style={{fontSize: 14, fontWeight: 700, color: activeJobId === job.id ? C.accent : C.text, marginBottom: 2}}>
                      {job.name}
                      {activeJobId === job.id && <span style={{fontSize: 11, fontWeight: 400, color: C.muted, marginLeft: 8}}>{"\u25CF"} active</span>}
                    </div>
                    <div style={{fontSize: 11, color: C.muted}}>Created: {job.createdAt}</div>
                  </div>
                )}
                <div style={{display: "flex", gap: 6}}>
                  <Btn small onClick={e => { e.stopPropagation(); setEditingJobId(job.id); setEditingJobName(job.name); }}>{"\u270F"} Rename</Btn>
                  <Btn small danger onClick={e => { e.stopPropagation(); if (confirm(`Delete "${job.name}"?`)) deleteJob(job.id); }}>Delete</Btn>
                </div>
              </div>
              <div style={{display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap"}}>
                {[["MVNX", (job._fileRecords || []).filter(r => r.file_type === "mvnx").length, C.teal],
                  ["LoadSOL", (job._fileRecords || []).filter(r => r.file_type === "loadsol").length, C.sky],
                  ["Force", (job._fileRecords || []).filter(r => r.file_type === "force").length, C.violet]
                ].map(([lbl, cnt, clr]) => (
                  <span key={lbl} style={{fontSize: 11, padding: "3px 8px", borderRadius: 12, background: cnt > 0 ? clr + "20" : "transparent", border: `1px solid ${cnt > 0 ? clr + "60" : C.border}`, color: cnt > 0 ? clr : C.muted}}>{lbl}: {cnt}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
