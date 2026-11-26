// missions.js — mission state machines and scoring for the four sorties.
// Pure logic (no THREE, no DOM): the game feeds it physics events and
// positions; it returns progress, score events and completion.
// Node-testable via require.
(function (global) {
  "use strict";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist3(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z));
  }

  function makeMission(C, id) {
    var def = null;
    for (var i = 0; i < C.MISSIONS.length; i++) if (C.MISSIONS[i].id === id) def = C.MISSIONS[i];
    if (!def) def = C.MISSIONS[0];
    return {
      id: def.id, def: def, started: false, done: false,
      time: 0, score: 0, ringsHit: 0, cratesHit: 0, cratesDropped: 0,
      landings: [], hopsDone: 0, nextRing: 0,
      crates: [], // falling crates {x,y,z,vx,vy,vz}
      message: "", messageT: 0, events: [],
    };
  }

  function start(C, m) {
    m.started = true; m.time = 0; m.score = 0;
    m.message = m.def.brief; m.messageT = 7;
    m.events.push({ type: "mission-start", id: m.id });
    return m;
  }

  // Current navigation target: {x,y,z,label,kind} or null.
  function currentTarget(C, m) {
    if (m.id === "gate") {
      if (m.nextRing < C.RINGS.length) {
        var r = C.RINGS[m.nextRing];
        return { x: r.x, y: r.y, z: r.z, label: "RING " + (m.nextRing + 1), kind: "ring", r: r.r };
      }
      var f = C.AIRFIELDS.halcyon;
      return { x: f.x, y: f.elev + 2, z: f.z, label: "HALCYON FIELD", kind: "land", r: 60 };
    }
    if (m.id === "hop") {
      var want = m.hopsDone === 0 ? C.AIRFIELDS.northCay : C.AIRFIELDS.halcyon;
      return { x: want.x, y: want.elev + 2, z: want.z, label: want.code + " — LAND", kind: "land", r: 60 };
    }
    if (m.id === "drop") {
      if (m.cratesDropped < 3) {
        var t = C.HARBOR_TARGETS[m.cratesDropped];
        return { x: t.x, y: 2, z: t.z, label: "DROP TARGET " + (m.cratesDropped + 1), kind: "drop", r: C.HARBOR.targetR };
      }
      var h = C.AIRFIELDS.halcyon;
      return { x: h.x, y: h.elev + 2, z: h.z, label: "HALCYON FIELD", kind: "land", r: 60 };
    }
    return null; // free flight: no target
  }

  function say(m, text, secs) { m.message = text; m.messageT = secs || 5; }

  function timeBonus(C, m) {
    var par = C.SCORE.parTime[m.id] || 0;
    if (!par) return 0;
    var frac = clamp(1 - Math.max(0, m.time - par * 0.55) / par, 0, 1);
    return Math.round(C.SCORE.timeBonusMax * frac);
  }

  function finish(C, m, landingQuality) {
    if (m.done) return;
    m.done = true;
    var bonus = timeBonus(C, m);
    m.score += bonus + (landingQuality || 0);
    m.events.push({ type: "mission-complete", score: m.score, timeBonus: bonus, landing: landingQuality || 0, time: m.time });
    say(m, "MISSION COMPLETE — " + m.def.name + "  ·  Score " + m.score, 999);
  }

  // Advance mission logic one tick. s = physics state, evts = physics events.
  function update(C, m, dt, s, evts) {
    if (!m.started || m.done) return;
    m.time += dt;
    if (m.messageT > 0) m.messageT -= dt;

    // --- ring passes (Golden Gate) -------------------------------------------
    if (m.id === "gate" && m.nextRing < C.RINGS.length) {
      var r = C.RINGS[m.nextRing];
      var d = dist3(s, r);
      if (d < r.r + 2.5) {
        m.ringsHit++; m.nextRing++;
        m.score += C.SCORE.ring;
        m.events.push({ type: "ring", n: m.ringsHit, score: m.score });
        if (m.nextRing >= C.RINGS.length) say(m, "All 8 rings! Now land at Halcyon Field.", 6);
        else say(m, "Ring " + m.ringsHit + " of 8 — +" + C.SCORE.ring + " pts", 3);
      }
    }

    // --- falling crates (Harbor Drop) -----------------------------------------
    for (var i = m.crates.length - 1; i >= 0; i--) {
      var c = m.crates[i];
      c.vy -= C.GRAVITY * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      if (c.y <= 0.5) {
        var t = C.HARBOR_TARGETS[c.target];
        var miss = Math.hypot(c.x - t.x, c.z - t.z);
        var pts = miss <= C.HARBOR.targetR
          ? Math.round(C.SCORE.crateMax * (1 - miss / (C.HARBOR.targetR * 1.6)))
          : 0;
        if (pts > 0) {
          m.cratesHit++; m.score += pts;
          m.events.push({ type: "crate-hit", n: m.cratesHit, pts: pts, miss: Math.round(miss) });
          say(m, "Crate on target! +" + pts + " pts (" + m.cratesHit + "/3)", 4);
        } else {
          m.events.push({ type: "crate-miss", miss: Math.round(miss) });
          say(m, "Crate missed the target by " + Math.round(miss) + " m", 4);
        }
        m.crates.splice(i, 1);
      }
    }

    // --- physics events ---------------------------------------------------------
    for (var j = 0; j < evts.length; j++) {
      var e = evts[j];
      if (e.type === "touchdown") {
        m.landings.push({ quality: e.quality, field: e.field });
        if (m.id === "gate") {
          if (m.nextRing >= C.RINGS.length && e.field === "HAL") finish(C, m, e.quality);
          else say(m, "Landed — but the rings come first. Take off and keep flying!", 5);
        } else if (m.id === "hop") {
          var want = m.hopsDone === 0 ? "NCY" : "HAL";
          if (e.field === want) {
            m.hopsDone++;
            m.score += e.quality;
            m.events.push({ type: "hop-landing", n: m.hopsDone, quality: e.quality, score: m.score });
            if (m.hopsDone >= 2) finish(C, m, 0);
            else say(m, "Greaser at North Cay! +" + e.quality + " pts — now fly home.", 5);
          } else say(m, "Wrong strip — the rally needs " + want + ".", 5);
        } else if (m.id === "drop") {
          if (m.cratesDropped >= 3) finish(C, m, e.quality);
          else say(m, "Landed early — " + (3 - m.cratesDropped) + " crates still to drop.", 5);
        } else if (m.id === "free") {
          m.score += e.quality;
          finish(C, m, 0);
        }
      } else if (e.type === "crash") {
        m.events.push({ type: "mission-failed", reason: e.reason });
        say(m, "Crashed — " + e.reason + ". Press R to fly again.", 999);
      } else if (e.type === "gear-up-landing") {
        m.events.push({ type: "gear-up-landing", quality: e.quality });
        say(m, "Gear-up landing! The belly took a beating.", 5);
      }
    }
  }

  // Drop a crate from the plane (Harbor Drop). Returns true if dropped.
  function dropCrate(C, m, s) {
    if (m.id !== "drop" || m.cratesDropped >= 3 || m.done) return false;
    m.cratesDropped++;
    m.crates.push({
      x: s.x, y: s.y - 1.5, z: s.z,
      vx: s.vx, vy: s.vy, vz: s.vz, target: m.cratesDropped - 1,
    });
    m.events.push({ type: "crate-dropped", n: m.cratesDropped });
    say(m, "Crate " + m.cratesDropped + " away — watch the harbor!", 3);
    return true;
  }

  function progressText(C, m) {
    if (m.id === "gate") return { a: "Fly all 8 golden rings (" + m.ringsHit + "/8)", b: "Land at Halcyon Field", doneA: m.ringsHit >= 8, doneB: m.done };
    if (m.id === "hop") return { a: "Land at North Cay Strip (" + Math.min(m.hopsDone, 1) + "/1)", b: "Return and land at Halcyon Field", doneA: m.hopsDone >= 1, doneB: m.done };
    if (m.id === "drop") return { a: "Drop crates on the harbor targets (" + m.cratesHit + "/3)", b: "Land at Halcyon Field (optional)", doneA: m.cratesHit >= 3, doneB: m.done };
    return { a: "Fly free — enjoy the golden hour", b: "Land anywhere to finish", doneA: false, doneB: m.done };
  }

  var api = {
    makeMission: makeMission, start: start, update: update,
    currentTarget: currentTarget, dropCrate: dropCrate,
    progressText: progressText, timeBonus: timeBonus,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SkylaneMissions = api;
})(typeof window !== "undefined" ? window : globalThis);
