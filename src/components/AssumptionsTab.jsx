// ── Assumptions & Limitations Tab ────────────────────────────────────────────

import { C } from '../utils/constants.js';

const Section = ({ title, color, items }) => (
  <div style={{marginBottom: 18}}>
    <div style={{fontSize: 13, fontWeight: 700, color: color || C.accent, marginBottom: 8,
      borderBottom: `2px solid ${color || C.accent}40`, paddingBottom: 4}}>{title}</div>
    <ul style={{margin: 0, paddingLeft: 20, fontSize: 12, color: C.text, lineHeight: 1.8}}>
      {items.map((item, i) => <li key={i} style={{marginBottom: 4}}>{item}</li>)}
    </ul>
  </div>
);

export default function AssumptionsTab() {
  return (
    <div style={{maxWidth: 900}}>
      <div style={{fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4}}>
        Assumptions & Limitations
      </div>
      <div style={{fontSize: 12, color: C.muted, marginBottom: 22}}>
        This document lists every assumption made in the calculations, data handling, and visualization,
        along with known limitations of the current implementation.
      </div>

      <Section title="Body Segment Parameters" color={C.teal} items={[
        "All segment mass fractions, centre-of-mass (CoM) positions, and radii of gyration are taken from Winter (2009) Table 4.1 — adult male cadaveric data.",
        "Segments are modelled as rigid bodies with fixed mass distribution ratios relative to total body mass.",
        "Segment lengths are estimated from the mean of the first 10 frames of XSENS position data (proximal-to-distal joint distance).",
        "If fewer than 10 frames are available, all available frames are used for segment length estimation.",
        "Body mass is user-entered and assumed constant throughout the recording. No body composition model is applied.",
        "Radii of gyration are taken about the CoM (not proximal or distal endpoints). The moment of inertia for each segment is I = m·(k·L)², where k is the normalised radius of gyration and L is the segment length.",
        "The pelvis segment's CoM is referenced from Pelvis to L5 with a proximal ratio of 0.895 (Winter, 2009).",
        "Hand, toe, and shoulder segments use approximate Winter parameters; these segments have very small mass fractions (< 1% body mass each) so parameter errors have minimal effect on L5/S1 and shoulder moments.",
      ]} />

      <Section title="Inverse Dynamics — Newton-Euler Formulation" color={C.sky} items={[
        "Quasi-dynamic Newton-Euler formulation: computes joint reaction forces and moments frame-by-frame.",
        "Legs are solved bottom-up: GRF is applied at the estimated CoP (Davidson et al. 2025) or toe position, propagated through foot \u2192 shank \u2192 thigh.",
        "L5/S1 moment is computed from pelvis equilibrium with both hip reaction forces and pelvis inertial terms.",
        "Arms are solved top-down: external hand force is applied at the hand segment centre of mass (50.6% of hand length from wrist, per Winter 2009).",
        "Shoulder moments include full inertial terms (ΣF = m·a_com, ΣM = I·α + ω×(I·ω)) for hand, forearm, and upper arm.",
        "Gravity is assumed constant at g = [0, 0, −9.81] m/s² in the XSENS global frame (Z-up).",
        "Joint friction and ligament forces are neglected — all inter-segment loads are transmitted through a single force/moment couple at each joint centre.",
        "Soft tissue artefact (STA) in the XSENS motion capture is not corrected for. XSENS uses sensor fusion (IMU + biomechanical model) which reduces but does not eliminate STA.",
        "Joint centres are assumed to be at the proximal endpoint of each segment as defined by XSENS MVN.",
        "Only ~200 frames are computed (evenly strided) to keep UI responsive. Full-resolution computation is not performed.",
      ]} />

      <Section title="Ground Reaction Force (GRF) — LoadSOL" color={C.amber} items={[
        "LoadSOL insole data provides total vertical GRF per foot only — no shear forces (anterior-posterior, medio-lateral).",
        "If no LoadSOL file is paired, L5/S1 bottom-up moments will be zero (no GRF input to the leg chain).",
        "LoadSOL time synchronisation with XSENS is based on the area1 trigger channel — a spike > 5 N in the trigger column is used to detect the XSENS sync blip.",
        "LoadSOL data is assumed to be tab-separated with columns: time (col 0), left compartments (cols 1–3: heel, medial forefoot, lateral forefoot), left total (col 4), right compartments (cols 6–8), right total (col 9), and trigger channels (cols 11–12).",
        "LoadSOL sampling rate (typically 200 Hz) is interpolated linearly to match XSENS frame times. No anti-aliasing filter is applied during interpolation.",
      ]} />

      <Section title="Centre of Pressure (CoP) — Davidson et al. (2025)" color={C.emerald} items={[
        "CoP is estimated from 3-compartment LoadSOL insole forces using the weighted algorithm from Davidson et al. (2025).",
        "Anterior-posterior CoP (Eq 1): CoP_AP = P_T\u00B7F_T/(F_T+F_H+\u03B5) + P_H\u00B7F_H/(F_T+F_H+\u03B5), where F_T = medial + lateral forefoot, F_H = heel, \u03B5 = 5 N.",
        "Medio-lateral CoP (Eq 2): CoP_ML = P_M\u00B7F_M/(F_M+F_L+\u03B5) + P_L\u00B7F_L/(F_M+F_L+\u03B5), where F_M = medial forefoot, F_L = lateral forefoot.",
        "Boundary positions are clamped to 20\u201380% of foot length (A-P) and foot width (M-L), matching Davidson et al. marker placement constraints.",
        "Foot length is estimated from the XSENS foot-to-toe segment distance. Foot width is estimated as 38% of foot length (population average).",
        "The A-P foot axis is the heel\u2192toe direction from XSENS segment positions. The M-L axis is perpendicular to this in the floor plane (Z-up).",
        "When 3-compartment data is not available (single-sensor insoles or missing columns), GRF falls back to application at the toe segment position.",
        "GRF is applied as a purely vertical force at the estimated CoP position. Shear forces are still not modelled.",
        "The \u03B5 = 5 N threshold prevents numerical instability when the foot is unloaded, but means CoP estimates during swing phase are not meaningful.",
      ]} />

      <Section title="External Force Application" color={C.violet} items={[
        "Hand forces from WiDACS are applied along the forearm-to-hand direction ('auto' mode) or a user-specified global direction.",
        "The force application point is at the hand segment\u2019s centre of mass: 50.6% of estimated hand length (~5 cm) from the wrist, along the forearm\u2192hand direction. Actual grip point varies with task.",
        "Hand length is estimated from the XSENS model (wrist-to-distal reference) or defaults to 10 cm if no distal segment is available.",
        "Bilateral forces are split 50/50 between left and right hands. No asymmetry model is applied.",
        "Force magnitude is linearly interpolated from the WiDACS trial-averaged force-time profile.",
        "Multiple WiDACS trials per event are averaged arithmetically (mean force at each normalised time point).",
        "Force events can be time-normalised to a user-defined duration using linear time warping. This assumes the force profile shape scales linearly with time.",
        "Plateau extension inserts a constant-force segment at a user-specified time point. The force is held constant at the value at that time point.",
      ]} />

      <Section title="Low-Pass Filtering & CoM Acceleration" color={C.emerald} items={[
        "Default mode (XSENS Raw): raw XSENS segment positions are used for display and CoM acceleration is computed via central finite difference. Window size \u2248 100 ms (fps/10 frames in each direction).",
        "XSENS MVN pre-filters segment positions using its own proprietary Kalman filter + biomechanical model. The central-difference acceleration inherits any artefacts or smoothing from XSENS processing.",
        "Butterworth LPF mode: a 4th-order zero-lag (forward-backward) Butterworth low-pass filter is applied to ALL segment positions and joint angles before display and computation. This smooths the skeleton, joint angle charts, and CoM acceleration simultaneously.",
        "Butterworth cutoff frequency defaults to 6 Hz (adjustable 2\u201315 Hz via slider). This attenuates high-frequency noise and jitter that is not physiological human movement. Lower cutoffs produce smoother but potentially over-smoothed data.",
        "The Butterworth filter uses reflected edge padding (30 samples) to reduce start/end transients, but edge effects may still be present in the first/last ~50 ms.",
        "Bilinear transform (Tustin\u2019s method) is used for analogue-to-digital filter coefficient mapping.",
        "When Butterworth mode is active, inverse dynamics also uses the filtered positions for CoM acceleration (double central-difference of filtered positions), replacing the separate Butterworth acceleration path.",
      ]} />

      <Section title="Kinematics & Joint Angles" color={C.orange} items={[
        "Joint angles are taken directly from the MVNX 'jointAngle' field (ZXY Euler decomposition): index 0 = Z = Lateral Bend / Abduction, index 1 = X = Axial Rotation / Internal-External, index 2 = Y = Flexion/Extension.",
        "No independent joint angle recalculation is performed — the XSENS MVN biomechanical model's output is used directly.",
        "Angular velocity and angular acceleration are taken from XSENS 'angularVelocity' and 'angularAcceleration' fields when available. If not available, they default to zero.",
        "Euler angle decomposition is susceptible to gimbal lock near ±90° in the middle axis (X). This primarily affects shoulder and hip joints in extreme positions.",
        "No coordinate system transformation is applied — all angles are in the XSENS MVN global frame convention (Z-up, X-forward, Y-left).",
      ]} />

      <Section title="Cycle Analysis" color={C.rose} items={[
        "Cycle overlay time-normalises all trials to 0–100% using linear interpolation to 100 points.",
        "The first joint angle component (ZXY index 0 = Lateral Bend / Abduction) is used for cycle overlay and correlation, not Flex/Ext.",
        "Mean and standard deviation envelopes are computed point-by-point across all cycles.",
        "Pearson correlation coefficients (r) are computed between all pairs of time-normalised traces.",
        "All cycles must be from the same joint and same Euler component for valid comparison. Cross-joint or cross-plane comparisons are not prevented by the UI.",
      ]} />

      <Section title="Data Handling" color={C.pink} items={[
        "Only MVNX XML files are supported for kinematic data. Files are parsed using the browser\u2019s DOMParser. A repair mechanism handles corrupted MVNX files with duplicated closing tags.",
        "Gzip-compressed files (.mvnx.gz) are automatically decompressed using the browser\u2019s DecompressionStream API.",
        "All force data (LoadSOL and WiDACS) is linearly interpolated to the kinematic frame times. No higher-order interpolation or resampling is used.",
        "Chart data is decimated using min-max (Ramer-type) decimation to ~200 points for responsive rendering. This preserves peaks but may visually alias mid-range features.",
      ]} />

      <Section title="Skeleton Visualisation" color={C.sky} items={[
        "The skeleton is a 2D orthographic projection of 3D segment positions onto the selected view plane (front: Y-Z, side: X-Z, top: Y-X).",
        "No perspective correction is applied \u2014 the projection is purely orthographic with auto-scaling to fit the SVG viewport.",
        "Bone connections use the standard XSENS 23-segment body model topology.",
        "Hand/palm segments are projected as dashed lines extending ~10 cm from the wrist along the forearm\u2192hand direction. XSENS tracks hand position at the wrist \u2014 the palm extension is estimated from forearm direction.",
        "Force arrows originate from the projected palm tip (not the wrist joint) with length proportional to force magnitude relative to peak force.",
        "When Butterworth LPF mode is active, the displayed skeleton uses filtered positions, resulting in smoother motion playback.",
        "The reference pose shown when no MVNX is loaded is a static T-pose at approximate anthropometric proportions.",
      ]} />

      <div style={{fontSize: 16, fontWeight: 700, color: C.red, marginTop: 28, marginBottom: 8,
        borderBottom: `2px solid ${C.red}40`, paddingBottom: 4}}>Known Limitations</div>

      <Section title="Measurement & Input Limitations" color={C.red} items={[
        "LoadSOL provides only vertical GRF — no shear forces are available, so horizontal force components at the foot are not modelled.",
        "CoP estimation (Davidson et al. 2025) uses only 3 force compartments — accuracy is lower than force-plate CoP, particularly during rapid weight transfers and single-leg stance.",
        "CoP M-L estimation uses an assumed foot width (38% of foot length). Individual foot anthropometry is not measured.",
        "When 3-compartment data is unavailable, GRF is applied at the toe position — this introduces moment arm errors especially during heel-strike and mid-stance.",
        "XSENS IMU-based motion capture has inherent drift, magnetic interference susceptibility, and soft tissue artefact limitations compared to optical motion capture.",
        "No EMG or muscle force data is incorporated. Joint moments represent net external moments, not individual muscle contributions.",
        "Body segment parameters from Winter (2009) are population averages from cadaveric studies. Individual variation in body composition is not accounted for.",
      ]} />

      <Section title="Computational Limitations" color={C.red} items={[
        "The quasi-dynamic formulation does not solve the full equations of motion simultaneously — it is a frame-by-frame sequential computation, which can accumulate errors along the kinematic chain.",
        "Only ~200 frames (evenly strided) are used for inverse dynamics computation to maintain UI responsiveness. This means temporal resolution is reduced for long recordings.",
        "The Butterworth cutoff frequency (default 6 Hz, adjustable 2\u201315 Hz) may over-smooth rapid movements or under-smooth slow movements depending on the task.",
        "No residual analysis (Winter, 2009) is performed to optimally select the Butterworth cutoff frequency \u2014 the user must select an appropriate cutoff for their task.",
        "Segment inertial properties use a simplified 1D radius-of-gyration model (single scalar I), not a full 3×3 inertia tensor.",
        "The central-difference acceleration method has a ~100 ms window, which may smear high-frequency acceleration peaks.",
      ]} />

      <Section title="Software & UI Limitations" color={C.red} items={[
        "All computation runs in the browser (client-side JavaScript). Very large files (> 50k frames) may cause performance issues or memory pressure.",
        "The single-bundle build (~830 kB) may have slow initial load times on mobile or low-bandwidth connections.",
        "Settings are saved per-job to Supabase. If the database schema is not up-to-date, settings save will fail (SQL migration instructions are shown).",
        "No undo/redo functionality for force event editing or joint panel configuration.",
        "The correlation matrix in the Cycles tab grows as O(n²) with number of cycles and may become visually cluttered with many files.",
      ]} />

      <div style={{marginTop: 24, padding: "14px 18px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.muted}}>
        <div style={{fontWeight: 600, marginBottom: 4}}>References</div>
        <div>Winter, D.A. (2009). <i>Biomechanics and Motor Control of Human Movement</i>, 4th ed. Wiley. — Table 4.1 for body segment parameters.</div>
        <div style={{marginTop: 4}}>Davidson, B. et al. (2025). <i>Centre of pressure estimation from instrumented insoles: a weighted algorithm for 3-compartment LoadSOL sensors.</i> — Equations 1 & 2 for A-P and M-L CoP estimation.</div>
        <div style={{marginTop: 4}}>XSENS MVN User Manual — segment model, joint angle conventions, sensor fusion algorithm.</div>
      </div>
    </div>
  );
}
