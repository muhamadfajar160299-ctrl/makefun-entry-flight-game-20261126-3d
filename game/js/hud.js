// hud.js — drives every HUD readout from physics + mission state:
// speed, altitude, compass tape, target bearing/distance, mission panel,
// fuel/damage bars, score/timer, attitude indicator, messages.
(function (global) {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function pad3(n) {
    n = Math.round(n) % 360; if (n < 0) n += 360;
    return (n < 10 ? "00" : n < 100 ? "0" : "") + n;
  }
  function fmtDist(m) {
    return m >= 1000 ? (m / 1000).toFixed(1) + " KM" : Math.round(m) + " M";
  }
  // One short objective line for the headline under the compass, in the
  // style the neighbouring entries use ("Thread the rings — 8 to go").
  // Never a paragraph: the mission panel on the left keeps the detail.
  function objectiveLine(C, m, target, s) {
    if (!m) return "";
    var dist = target ? Math.hypot(target.x - s.x, target.z - s.z) : 0;
    if (m.id === "gate") {
      if (m.nextRing < C.RINGS.length)
        return "THREAD THE RINGS — " + (C.RINGS.length - m.ringsHit) + " TO GO";
      return "LAND AT HALCYON FIELD — " + fmtDist(dist);
    }
    if (m.id === "night") {
      if (m.nextRing < (m.def.rings || 4))
        return "NIGHT RINGS — " + ((m.def.rings || 4) - m.ringsHit) + " TO GO · FOLLOW THE LIGHTS";
      return "LAND AT HALCYON FIELD — " + fmtDist(dist);
    }
    if (m.id === "emergency") {
      return "MAYDAY — LAND NOW · FUEL " + Math.round(s.fuel * 100) + "%";
    }
    if (m.id === "hop") {
      var where = m.hopsDone === 0 ? "NORTH CAY STRIP" : "HALCYON FIELD";
      return "LAND AT " + where + " — " + fmtDist(dist);
    }
    if (m.id === "drop") {
      if (m.cratesDropped < 3)
        return "DROP CRATE " + (m.cratesDropped + 1) + " OF 3 — HARBOR TARGET";
      return "LAND AT HALCYON FIELD — " + fmtDist(dist);
    }
    if (m.id === "intercept") {
      var need = m.def.kills || 5;
      var k = m.combat ? m.combat.kills : 0;
      if (k < need) return "SPLASH THE DRONES — " + (need - k) + " TO GO · HOLD CLICK / X TO FIRE";
      return "DRONES DOWN — LAND AT HALCYON FIELD — " + fmtDist(dist);
    }
    return "FREE FLIGHT — ENJOY THE GOLDEN HOUR";
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function buildTape() {
    var inner = $("tape-inner");
    if (!inner || inner.children.length) return;
    // one span per 15 degrees across 720 degrees of tape (wraps twice)
    for (var d = -360; d <= 360; d += 15) {
      var sp = document.createElement("span");
      var deg = ((d % 360) + 360) % 360;
      var card = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" }[deg];
      sp.textContent = card || String(deg);
      if (card) sp.className = "card";
      inner.appendChild(sp);
    }
  }

  function makeHud(C) {
    buildTape();
    // wind readout under the objective: same wind the windsock
    // streams in, straight from the config
    var windEl = $("hud-wind");
    if (windEl && C.WIND) windEl.textContent = "WIND " + C.WIND.fromDeg + "° · " + C.WIND.speedKt + " KT";
    var tapeInner = $("tape-inner");
    var att = $("att-canvas");
    var attCtx = att ? att.getContext("2d") : null;
    var lastMsg = "";

    function drawAttitude(roll, pitch) {
      if (!attCtx) return;
      var w = att.width, h = att.height, cx = w / 2, cy = h / 2, R = w / 2 - 4;
      var g = attCtx;
      g.save();
      g.clearRect(0, 0, w, h);
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
      g.translate(cx, cy);
      g.rotate(-roll);
      var py = clamp(pitch, -0.6, 0.6) * R * 1.6;
      g.translate(0, py);
      g.fillStyle = "#3f8fd2"; g.fillRect(-R - 4, -R - 4 - py, w + 8, R + 4 + py);
      g.fillStyle = "#7a5230"; g.fillRect(-R - 4, 0, w + 8, R + 4);
      g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-R, 0); g.lineTo(R, 0); g.stroke();
      g.restore();
      // fixed wings marker
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = "#ffd76a"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-34, 0); g.lineTo(-12, 0); g.moveTo(12, 0); g.lineTo(34, 0); g.stroke();
      g.fillStyle = "#ffd76a";
      g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    function update(s, mission, target, dt, combat) {
      var C2 = C;
      var kts = s.speed * C2.KT_PER_MS;
      $("hud-kts").textContent = Math.round(kts);
      $("hud-thr").textContent = "THR " + Math.round(s.throttle * 100) + "%";
      $("thr-fill").style.width = (s.throttle * 100) + "%";
      $("hud-flap").textContent = s.flaps ? " · FLAP " + s.flaps : "";
      var ft = s.y * C2.FT_PER_M;
      $("hud-ft").textContent = Math.round(ft);
      $("hud-agl").textContent = Math.round(Math.max(0, s.agl) * C2.FT_PER_M);
      var vs = s.verticalSpeed * C2.FT_PER_M * 60;
      $("hud-vs").textContent = (vs >= 0 ? "+" : "") + Math.round(vs);
      var hdgDeg = ((s.heading * 180 / Math.PI) % 360 + 360) % 360;
      $("hud-hdg").textContent = pad3(hdgDeg) + "°";
      // compass tape: 60px per 15 deg; centre the current heading
      if (tapeInner) {
        var pxPerDeg = 60 / 15;
        var offset = 360 * pxPerDeg + hdgDeg * pxPerDeg;
        tapeInner.style.transform = "translateX(" + (-offset + 210 - 30) + "px)";
      }
      // target readout
      if (target) {
        var dx = target.x - s.x, dz = target.z - s.z;
        var dist = Math.hypot(dx, dz);
        var bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
        var rel = ((bearing - hdgDeg + 540) % 360) - 180;
        var arrow = rel < -45 ? "◀" : rel > 45 ? "▶" : "▲";
        $("hud-target-label").textContent = arrow + " " + target.label;
        $("hud-target-dist").textContent = (dist >= 1000 ? (dist / 1000).toFixed(1) + " KM" : Math.round(dist) + " M");
      } else {
        $("hud-target-label").textContent = "FREE FLIGHT";
        $("hud-target-dist").textContent = "";
      }
      // target lock: nearest enemy drone with its distance, red and
      // loud — the thing a still screenshot must show is happening
      var lockEl = $("hud-lock");
      if (lockEl) {
        if (combat && combat.lock) {
          lockEl.textContent = "◉ LOCK — DRONE " + fmtDist(combat.lockDist);
          lockEl.classList.remove("hidden");
        } else lockEl.classList.add("hidden");
      }
      // objective headline under the compass
      var objEl = $("hud-objective");
      if (objEl && mission) objEl.textContent = objectiveLine(C2, mission, target, s);
      // wind readout: live speed (steady + gust swell) from the same
      // wind model the windsock, the clouds and the drift use
      var windLive = $("hud-wind");
      if (windLive && s.windKt !== undefined) {
        var gusting = s.windKt > C2.WIND.speedKt + 2 ? " · GUSTING" : "";
        windLive.textContent = "WIND " + C2.WIND.fromDeg + "° · " + Math.round(s.windKt) + " KT" + gusting;
      }
      // mission panel
      if (mission) {
        $("hud-mission-name").textContent = mission.def.num + ". " + mission.def.name;
        var prog = SkylaneMissions.progressText(C2, mission);
        var oa = $("hud-obj-a"), ob = $("hud-obj-b");
        oa.textContent = prog.a; ob.textContent = prog.b;
        oa.parentElement.classList.toggle("done", !!prog.doneA);
        ob.parentElement.classList.toggle("done", !!prog.doneB);
        $("hud-dot-a").textContent = prog.doneA ? "●" : "○";
        $("hud-dot-b").textContent = prog.doneB ? "●" : "○";
        $("hud-score").textContent = mission.score;
        $("hud-time").textContent = fmtTime(mission.time);
      }
      // fuel / damage
      $("fuel-fill").style.width = (s.fuel * 100) + "%";
      $("fuel-fill").style.background = s.fuel < 0.2
        ? "linear-gradient(90deg,#ff9d45,#ff5340)" : "linear-gradient(90deg,#7be495,#3ecf6e)";
      $("fuel-pct").textContent = Math.round(s.fuel * 100) + "%";
      $("dmg-fill").style.width = s.damage + "%";
      var gearEl = $("hud-gear");
      gearEl.textContent = s.gearDown ? "GEAR DOWN" : "GEAR UP";
      gearEl.style.color = s.gearDown ? "#7be495" : "#ffb066";
      // message
      var msgEl = $("hud-message");
      if (mission && mission.messageT > 0 && mission.message) {
        if (mission.message !== lastMsg) { msgEl.textContent = mission.message; lastMsg = mission.message; }
        msgEl.style.display = "";
      } else msgEl.style.display = "none";
      // stall warning
      $("hud-stall").classList.toggle("hidden", !s.stallWarn);
      // low-fuel warning: on whenever the gauge is under 15% and the
      // sortie is still live — the Mayday lives here
      var fw = $("hud-fuelwarn");
      if (fw) fw.classList.toggle("hidden", !(s.fuel < 0.15 && mission && !mission.done));
      // attitude
      drawAttitude(s.roll, s.pitch);
      // cockpit gauges
      $("cg-rpm").textContent = Math.round(900 + s.throttle * 1700 + s.speed * 4);
      $("cg-kts").textContent = Math.round(kts);
      $("cg-alt").textContent = Math.round(ft);
      $("cg-hdg").textContent = pad3(hdgDeg);
      $("cg-fuel").textContent = Math.round(s.fuel * 100) + "%";
    }

    return { update: update };
  }

  global.SkylaneHud = { makeHud: makeHud, fmtTime: fmtTime };
})(typeof window !== "undefined" ? window : globalThis);
