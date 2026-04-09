// ── MVNX Parser Web Worker ───────────────────────────────────────────────────
// Runs MVNX XML parsing off the main thread to prevent UI blocking.
// Posts UnifiedKinematicData back to main thread when complete.

// Worker-safe MVNX parser (no DOM dependency, uses DOMParser available in workers)
self.onmessage = function(e) {
  const { xmlStr, id } = e.data;

  try {
    // Repair corrupted MVNX
    let xml = xmlStr;
    const firstClose = xml.indexOf("</mvnx>");
    const lastClose  = xml.lastIndexOf("</mvnx>");
    if (firstClose !== -1 && lastClose !== firstClose) {
      const tail = xml.slice(firstClose + "</mvnx>".length, lastClose + "</mvnx>".length);
      const repaired = tail.replace(/^\s*ype=/, "\n<frame type=");
      const firstFramesClose = xml.lastIndexOf("</frames>", firstClose);
      xml = xml.slice(0, firstFramesClose) + repaired;
    } else if (firstClose !== -1) {
      xml = xml.slice(0, firstClose + "</mvnx>".length);
    }

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const pe = doc.querySelector("parsererror");
    if (pe) {
      self.postMessage({ id, ok: false, error: "XML parse error: " + pe.textContent.slice(0, 300) });
      return;
    }

    const subject = doc.querySelector("subject");
    const frameRate = parseFloat(subject?.getAttribute("frameRate") || "60");

    const segLabels = [];
    doc.querySelectorAll("segments > segment").forEach(s =>
      segLabels.push(s.getAttribute("label"))
    );
    const segIndex = {};
    segLabels.forEach((l, i) => { segIndex[l] = i; });

    const jointLabels = [];
    const bones = [];
    doc.querySelectorAll("joints > joint").forEach(j => {
      jointLabels.push(j.getAttribute("label"));
      const c1 = j.querySelector("connector1")?.textContent?.split("/")?.[0];
      const c2 = j.querySelector("connector2")?.textContent?.split("/")?.[0];
      if (segIndex[c1] !== undefined && segIndex[c2] !== undefined)
        bones.push([segIndex[c1], segIndex[c2]]);
    });

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
        ergoJA:  parse("jointAngleErgo") || parse("jointAngleXZY") || null,
        acc:     parse("acceleration"),
        angVel:  parse("angularVelocity"),
        angAcc:  parse("angularAcceleration"),
        orient:  parse("orientation"),
        sensorFreeAcc: parse("sensorFreeAcceleration") || null,
      });
    });

    const duration = frames.length ? frames[frames.length - 1].time : 0;

    self.postMessage({
      id,
      ok: true,
      frameRate,
      segLabels,
      segIndex,
      jointLabels,
      bones,
      frames,
      duration,
      sourceFormat: 'mvnx',
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
