// ── MVNX XML → UnifiedKinematicData Adapter ─────────────────────────────────
// Parses MVNX XML and normalizes into the UnifiedKinematicData interface.
// Handles corrupted MVNX files with mid-stream closing blocks.

/**
 * Parse MVNX XML string into UnifiedKinematicData.
 * @param {string} xmlStr - Raw MVNX XML content
 * @returns {object} - UnifiedKinematicData (with ok:true) or {ok:false, error}
 */
export function parseMVNX(xmlStr) {
  try {
    // Repair corrupted MVNX: some exports have a spurious </frames>...</mvnx>
    // block injected mid-stream, splitting frame data into two halves.
    const firstClose = xmlStr.indexOf("</mvnx>");
    const lastClose  = xmlStr.lastIndexOf("</mvnx>");
    if (firstClose !== -1 && lastClose !== firstClose) {
      const tail = xmlStr.slice(firstClose + "</mvnx>".length, lastClose + "</mvnx>".length);
      const repaired = tail.replace(/^\s*ype=/, "\n<frame type=");
      const firstFramesClose = xmlStr.lastIndexOf("</frames>", firstClose);
      xmlStr = xmlStr.slice(0, firstFramesClose) + repaired;
    } else if (firstClose !== -1) {
      xmlStr = xmlStr.slice(0, firstClose + "</mvnx>".length);
    }

    const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
    const pe = doc.querySelector("parsererror");
    if (pe) return { ok: false, error: "XML parse error: " + pe.textContent.slice(0, 300) };

    const subject = doc.querySelector("subject");
    const frameRate = parseFloat(subject?.getAttribute("frameRate") || "60");

    // Segment labels
    const segLabels = [];
    doc.querySelectorAll("segments > segment").forEach(s =>
      segLabels.push(s.getAttribute("label"))
    );
    const segIndex = Object.fromEntries(segLabels.map((l, i) => [l, i]));

    // Joint labels and bone connectivity
    const jointLabels = [];
    const bones = [];
    doc.querySelectorAll("joints > joint").forEach(j => {
      jointLabels.push(j.getAttribute("label"));
      const c1 = j.querySelector("connector1")?.textContent?.split("/")?.[0];
      const c2 = j.querySelector("connector2")?.textContent?.split("/")?.[0];
      if (segIndex[c1] !== undefined && segIndex[c2] !== undefined)
        bones.push([segIndex[c1], segIndex[c2]]);
    });

    // Parse frames
    const frames = [];
    doc.querySelectorAll("frames > frame").forEach(f => {
      if (f.getAttribute("type") !== "normal") return;
      const ms = parseInt(f.getAttribute("time") || "0");

      const parse = sel => {
        const t = f.querySelector(sel)?.textContent?.trim() || "";
        return t ? t.split(/\s+/).map(Number) : [];
      };

      frames.push({
        time:    ms / 1000,
        pos:     parse("position"),
        ja:      parse("jointAngle"),
        // Ergonomic Joint Angles ZXY — preferred for clinical interpretation
        ergoJA:  parse("jointAngleErgo") || parse("jointAngleXZY") || null,
        acc:     parse("acceleration"),
        angVel:  parse("angularVelocity"),
        angAcc:  parse("angularAcceleration"),
        orient:  parse("orientation"),
        sensorFreeAcc: parse("sensorFreeAcceleration") || null,
      });
    });

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
      sourceFormat: 'mvnx',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
