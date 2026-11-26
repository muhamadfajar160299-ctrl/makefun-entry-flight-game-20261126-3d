// tests/logic.test.js — Node logic tests for Skylane Archipelago.
// Run: node tests/logic.test.js
// Covers: terrain determinism + runway flattening, takeoff 0 -> 60 kt,
// stall behaviour, fuel burn (~227 s full throttle), drag-limited top
// speed, gear/flap effects, ring scoring, crate scoring, landing quality,
// mission completion flows, time bonus.
"use strict";

const C = require("../game/js/config.js").SKYLANE_CONFIG ||
  (function () { require("../game/js/config.js"); return global.SKYLANE_CONFIG; })();
const Phys = require("../game/js/physics.js");
const Missions = require("../game/js/missions.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra !== undefined ? " :: " + extra : "")); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---- terrain ---------------------------------------------------------------
const h1 = Phys.terrainHeight(-380, -260, C);
const h2 = Phys.terrainHeight(-380, -260, C);
check("terrain deterministic", h1 === h2, h1);
check("main island peak ~155m", Phys.terrainHeight(-380, -260, C) > 100, h1.toFixed(1));
const hSea = Phys.terrainHeight(1200, -100, C);
check("sea between islands is water", hSea < 0.5, hSea.toFixed(1));
// runway flattened to its elevation
const hr = Phys.terrainHeight(-40, -60, C);
check("runway area near elev 26", Math.abs(hr - 26) < 6, hr.toFixed(1));
const hr2 = Phys.terrainHeight(-40 + 150, -60, C);
check("runway along strip stays flat", Math.abs(hr2 - 26) < 6, hr2.toFixed(1));
// clear corridor: 100 m past the west threshold the valley floor is
// carved well below the mountain that used to end the runway...
const hClearW = Phys.terrainHeight(-40 - 215 - 100, -60, C);
check("runway west clear zone stays low", hClearW < 60, hClearW.toFixed(1));
// ...while the sea east of the strip is never raised into a causeway
const hClearE = Phys.terrainHeight(-40 + 215 + 165, -60, C);
check("sea east of runway stays sea", hClearE < 10, hClearE.toFixed(1));
// apron pad (v3): the graded taxiway / apron / terminal pad south of
// Halcyon runway sits at field elevation, and the ground just south
// of the pad is left natural
const hApronC = Phys.terrainHeight(-90, 30, C);
check("apron pad centre near field elev", Math.abs(hApronC - 26) < 1, hApronC.toFixed(1));
const hApronW = Phys.terrainHeight(-210, 30, C);
check("apron pad west end near field elev", Math.abs(hApronW - 26) < 1, hApronW.toFixed(1));
const hApronE = Phys.terrainHeight(30, 40, C);
check("apron pad east end near field elev", Math.abs(hApronE - 26) < 1, hApronE.toFixed(1));
const hSouthPad = Phys.terrainHeight(-40, 130, C);
check("ground south of pad stays natural", hSouthPad > 40, hSouthPad.toFixed(1));

// ---- takeoff: 0 -> 60 kt ------------------------------------------------------
function simTakeoff() {
  const s = Phys.makeState(C, { x: -245, y: 26, z: -60, heading: Math.PI / 2 });
  const input = { throttleDelta: 0, pitch: 0, roll: 0, yaw: 0 };
  let t = 0, maxKts = 0, tookOff = false;
  input.throttleSet = 1;
  while (t < 40) {
    input.pitch = s.speed > 28 ? -1 : 0; // rotate at 28 m/s
    const evts = Phys.update(C, s, 1 / 60, input, 0);
    input.throttleSet = null;
    if (evts.some((e) => e.type === "takeoff")) tookOff = true;
    maxKts = Math.max(maxKts, s.speed * C.KT_PER_MS);
    t += 1 / 60;
    if (tookOff && maxKts > 60) break;
  }
  return { s, t, maxKts, tookOff };
}
const tk = simTakeoff();
check("takeoff happens", tk.tookOff, "t=" + tk.t.toFixed(1));
check("takeoff reaches 60 kt", tk.maxKts > 60, tk.maxKts.toFixed(1) + " kt in " + tk.t.toFixed(1) + "s");
check("airborne after takeoff", tk.s.airborne === true);

// ---- stall -------------------------------------------------------------------
(function () {
  const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
  s.onGround = false; s.airborne = true; s.throttle = 0;
  s.vx = 0; s.vy = 0; s.vz = -10; // 10 m/s, below stall 24
  const y0 = s.y;
  for (let i = 0; i < 120; i++) Phys.update(C, s, 1 / 60, { pitch: 0, roll: 0, yaw: 0 }, 0);
  check("below stall: sinks + warns", s.stallWarn === true && s.y < y0, "y " + y0.toFixed(0) + "->" + s.y.toFixed(0));
})();

// ---- fuel: ~227 s at full throttle ----------------------------------------------
(function () {
  const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
  s.onGround = false; s.airborne = true;
  s.vx = 0; s.vy = 0; s.vz = -50;
  let t = 0, emptyAt = -1;
  while (t < 400) {
    const evts = Phys.update(C, s, 0.5, { throttleSet: 1, pitch: 0, roll: 0, yaw: 0 }, 0);
    t += 0.5;
    if (s.fuel <= 0) { emptyAt = t; break; }
    // keep it flying: reset position so it never hits terrain
    if (s.y < 200) { s.y = 300; s.vy = 0; }
    if (s.crashed) break;
  }
  check("fuel empty near 227 s full throttle", emptyAt > 200 && emptyAt < 260, "empty at " + emptyAt + "s");
})();

// ---- top speed drag-limited ------------------------------------------------------
(function () {
  const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
  s.onGround = false; s.airborne = true;
  s.vx = 0; s.vy = 0; s.vz = -50;
  for (let i = 0; i < 60 * 40; i++) {
    Phys.update(C, s, 1 / 60, { throttleSet: 1, pitch: 0, roll: 0, yaw: 0 }, 0);
    if (s.y < 200) { s.y = 300; s.vy = 0; }
    if (s.crashed) break;
  }
  check("level top speed near 78 m/s", s.speed > 65 && s.speed < 85, s.speed.toFixed(1) + " m/s");
})();

// ---- gear adds drag ----------------------------------------------------------------
(function () {
  function run(gearDown) {
    const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
    s.onGround = false; s.airborne = true; s.gearDown = gearDown;
    s.vx = 0; s.vy = 0; s.vz = -50;
    for (let i = 0; i < 60 * 25; i++) {
      Phys.update(C, s, 1 / 60, { throttleSet: 1, pitch: 0, roll: 0, yaw: 0 }, 0);
      if (s.y < 200) { s.y = 300; s.vy = 0; }
    }
    return s.speed;
  }
  const up = run(false), down = run(true);
  check("gear down is slower than gear up", down < up - 2, "up " + up.toFixed(1) + " vs down " + down.toFixed(1));
})();

// ---- landing quality -----------------------------------------------------------------
(function () {
  const s = Phys.makeState(C, { x: -40, y: 26, z: -60, heading: Math.PI / 2 });
  s.roll = 0; s.gearDown = true;
  const q = Phys.landingQuality(C, s, C.AIRFIELDS.halcyon, 1.5);
  check("greased centreline landing scores high", q > 150, "q=" + q);
  const s2 = Phys.makeState(C, { x: -200, y: 26, z: 100, heading: 0 });
  s2.roll = 0.5; s2.gearDown = false;
  const q2 = Phys.landingQuality(C, s2, null, 8);
  check("bad off-field gear-up landing scores low", q2 < 60, "q=" + q2);
})();

// ---- missions: Golden Gate ring flow ----------------------------------------------------
(function () {
  const m = Missions.makeMission(C, "gate");
  Missions.start(C, m);
  const s = Phys.makeState(C, { x: 150, y: 70, z: 180, heading: Math.PI / 2 });
  s.onGround = false; s.airborne = true;
  Missions.update(C, m, 0.1, s, []);
  check("flying through ring 1 scores +100", m.ringsHit === 1 && m.score === 100, "rings=" + m.ringsHit + " score=" + m.score);
  const tgt = Missions.currentTarget(C, m);
  check("next target is ring 2", tgt && tgt.label === "RING 2", tgt && tgt.label);
})();

// ---- missions: crate drop ----------------------------------------------------------------
(function () {
  const m = Missions.makeMission(C, "drop");
  Missions.start(C, m);
  const s = Phys.makeState(C, { x: -170, y: 80, z: 590, heading: 0 });
  s.vx = 0; s.vy = 0; s.vz = 0;
  check("crate drops", Missions.dropCrate(C, m, s) === true);
  for (let i = 0; i < 60 * 20; i++) Missions.update(C, m, 1 / 60, s, []);
  check("dead-centre crate scores max", m.cratesHit === 1 && m.score >= 140, "hits=" + m.cratesHit + " score=" + m.score);
})();

// ---- missions: hop completes on two landings -----------------------------------------------
(function () {
  const m = Missions.makeMission(C, "hop");
  Missions.start(C, m);
  const s = Phys.makeState(C, { x: 780, y: 18, z: 560, heading: 0 });
  Missions.update(C, m, 0.1, s, [{ type: "touchdown", quality: 170, vspeed: 2, field: "NCY" }]);
  check("hop leg 1 counts", m.hopsDone === 1, "hops=" + m.hopsDone);
  Missions.update(C, m, 0.1, s, [{ type: "touchdown", quality: 180, vspeed: 2, field: "HAL" }]);
  check("hop completes after return landing", m.done === true, "done=" + m.done);
  check("hop score includes landing quality", m.score >= 350, "score=" + m.score);
})();

// ---- time bonus ----------------------------------------------------------------------------
(function () {
  const m = Missions.makeMission(C, "gate");
  m.time = 60; // fast
  const fast = Missions.timeBonus(C, m);
  m.time = 400; // slow
  const slow = Missions.timeBonus(C, m);
  check("fast flight earns bigger time bonus", fast > slow && fast > 200, "fast=" + fast + " slow=" + slow);
})();

// ---- staging presets stay consistent (score matches rings) -------------------
// A staged mid-mission state must never show rings banked with a zero
// score: presetProgress pays each ring out at once.
(function () {
  const m = Missions.makeMission(C, "gate");
  Missions.start(C, m);
  Missions.presetProgress(C, m, 3, 95);
  check("preset 3 rings banks 300 pts", m.ringsHit === 3 && m.score === 300 && m.nextRing === 3, "rings=" + m.ringsHit + " score=" + m.score);
  check("preset mission time reads 1:35", m.time === 95, "time=" + m.time);
  const s = Phys.makeState(C, { x: -850, y: 110, z: 200, heading: 0 });
  s.onGround = false; s.airborne = true;
  Missions.update(C, m, 0.1, s, []);
  check("ring 4 after preset scores 400 total", m.ringsHit === 4 && m.score === 400, "rings=" + m.ringsHit + " score=" + m.score);
  const m2 = Missions.makeMission(C, "gate");
  Missions.start(C, m2);
  Missions.presetProgress(C, m2, 8, 185);
  check("preset 8 rings banks 800 pts", m2.ringsHit === 8 && m2.score === 800 && m2.nextRing === 8, "score=" + m2.score);
})();

// ---- v4: wind model ------------------------------------------------------------
(function () {
  const w0 = Phys.windAt(C, 0);
  const w0b = Phys.windAt(C, 0);
  check("windAt deterministic", w0.kt === w0b.kt && w0.x === w0b.x, "kt=" + w0.kt.toFixed(2));
  check("wind speed inside steady +/- gust band", w0.kt >= 2 && w0.kt <= 14, "kt=" + w0.kt.toFixed(2));
  check("westerly blows east (+x)", w0.x > 0, "wx=" + w0.x.toFixed(2));
  const w30 = Phys.windAt(C, 30);
  check("gust swell changes wind over time", Math.abs(w30.kt - w0.kt) > 0.5, "kt 0s=" + w0.kt.toFixed(1) + " 30s=" + w30.kt.toFixed(1));
  function driftKt(speedKt) {
    const C2 = Object.assign({}, C, { WIND: { fromDeg: 270, speedKt: speedKt, gustKt: speedKt > 0 ? 6 : 0 } });
    const s = Phys.makeState(C2, { x: 0, y: 300, z: 0, heading: 0 });
    s.onGround = false; s.airborne = true;
    s.vx = 0; s.vy = 0; s.vz = -50;
    for (let i = 0; i < 600; i++) {
      Phys.update(C2, s, 1 / 60, { throttleSet: 0, pitch: 0, roll: 0, yaw: 0 }, 0);
      if (s.y < 200) { s.y = 300; s.vy = 0; }
    }
    return s.x;
  }
  const windy = driftKt(8), calm = driftKt(0);
  check("wind drifts an airborne plane east", windy - calm > 8, "windy x=" + windy.toFixed(1) + " calm x=" + calm.toFixed(1));
})();

// ---- v4: damage hurts handling ----------------------------------------------------
(function () {
  function rollAfter(damage, secs) {
    const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
    s.onGround = false; s.airborne = true; s.damage = damage;
    s.vx = 0; s.vy = 0; s.vz = -50;
    for (let i = 0; i < 60 * secs; i++) {
      Phys.update(C, s, 1 / 60, { throttleSet: 0.5, pitch: 0, roll: 1, yaw: 0 }, 0);
      if (s.y < 200) { s.y = 300; s.vy = 0; }
    }
    return s.roll;
  }
  const clean = rollAfter(0, 0.5), bent = rollAfter(90, 0.5);
  check("damage 90 rolls slower than damage 0", bent < clean - 0.1, "clean=" + clean.toFixed(2) + " bent=" + bent.toFixed(2));
  const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
  s.onGround = false; s.airborne = true; s.damage = 90;
  s.vx = 0; s.vy = 0; s.vz = -50;
  for (let i = 0; i < 60 * 5; i++) {
    Phys.update(C, s, 1 / 60, { throttleSet: 0.5, pitch: 0, roll: 0, yaw: 0 }, 0);
    if (s.y < 200) { s.y = 300; s.vy = 0; }
  }
  check("bent airframe pulls right hands-off", s.roll > 0.05, "roll=" + s.roll.toFixed(3));
})();

// ---- v4: fuel leak + fuel-low / fuel-empty ------------------------------------------
(function () {
  function burnFor(leak, secs) {
    const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
    s.onGround = false; s.airborne = true; s.fuelLeak = leak;
    s.vx = 0; s.vy = 0; s.vz = -50;
    for (let i = 0; i < secs * 2; i++) {
      Phys.update(C, s, 0.5, { throttleSet: 0, pitch: 0, roll: 0, yaw: 0 }, 0);
      if (s.y < 200) { s.y = 300; s.vy = 0; }
      if (s.crashed) break;
    }
    return s.fuel;
  }
  const leakFuel = burnFor(1 / 360, 60), okFuel = burnFor(0, 60);
  check("fuel leak drains faster than normal burn", leakFuel < 0.8 && okFuel > 0.9, "leak=" + leakFuel.toFixed(2) + " ok=" + okFuel.toFixed(2));
  // fuel-low fires exactly once crossing 15%
  const s = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
  s.onGround = false; s.airborne = true; s.fuel = 0.16;
  s.vx = 0; s.vy = 0; s.vz = -50;
  let lowCount = 0, emptySeen = false;
  for (let i = 0; i < 120; i++) {
    const evts = Phys.update(C, s, 0.5, { throttleSet: 0, pitch: 0, roll: 0, yaw: 0 }, 0);
    if (evts.some((e) => e.type === "fuel-low")) lowCount++;
    if (evts.some((e) => e.type === "fuel-empty")) emptySeen = true;
    if (s.y < 200) { s.y = 300; s.vy = 0; }
  }
  check("fuel-low fires exactly once", lowCount === 1, "count=" + lowCount);
  // fuel-empty kills the throttle
  const s2 = Phys.makeState(C, { x: 0, y: 300, z: 0, heading: 0 });
  s2.onGround = false; s2.airborne = true; s2.fuel = 0.005;
  s2.vx = 0; s2.vy = 0; s2.vz = -50;
  let sawEmpty = false;
  const input = { throttleSet: 1, pitch: 0, roll: 0, yaw: 0 };
  for (let i = 0; i < 120; i++) {
    const evts = Phys.update(C, s2, 1 / 60, input, 0);
    input.throttleSet = null;
    if (evts.some((e) => e.type === "fuel-empty")) sawEmpty = true;
    if (s2.y < 200) { s2.y = 300; s2.vy = 0; }
    if (sawEmpty) break;
  }
  check("fuel-empty event fires and throttle cuts to 0", sawEmpty && s2.throttle === 0, "throttle=" + s2.throttle);
})();

// ---- v4: ground traffic stepper ------------------------------------------------------
(function () {
  const tr = Phys.makeTraffic(C, "taxi", -40 + 40, -1);
  check("taxi lane bounds from config", tr.min === -190 && tr.max === 170, "min=" + tr.min + " max=" + tr.max);
  check("taxi starts westbound", tr.dir === -1 && Math.abs(tr.heading - Math.PI / 2) < 0.01, "heading=" + tr.heading.toFixed(2));
  for (let i = 0; i < 120; i++) Phys.trafficStep(tr, 0.5); // 60 s
  check("taxi turns at the west end and heads back east", tr.dir === 1 && tr.mode === "taxi" && tr.x > -190, "x=" + tr.x.toFixed(0) + " dir=" + tr.dir + " mode=" + tr.mode);
  check("taxi heading faces east after the turn", Math.abs(tr.heading - (-Math.PI / 2)) < 0.01, "heading=" + tr.heading.toFixed(2));
  const truck = Phys.makeTraffic(C, "truck", -40 - 155, 1);
  check("truck nose faces +x eastbound", Math.abs(truck.heading) < 0.01, "heading=" + truck.heading.toFixed(2));
  for (let i = 0; i < 160; i++) Phys.trafficStep(truck, 0.5); // 80 s: east end at 65 s, turned, heading back west
  check("truck reaches its east end and turns around", truck.dir === -1 && truck.x < 0, "x=" + truck.x.toFixed(0) + " dir=" + truck.dir);
})();

// ---- v4: night mission (4 rings, then land HAL) -----------------------------------------
(function () {
  const m = Missions.makeMission(C, "night");
  Missions.start(C, m);
  const s = Phys.makeState(C, { x: 0, y: 100, z: 0, heading: 0 });
  s.onGround = false; s.airborne = true;
  for (let i = 0; i < 4; i++) {
    const r = C.RINGS[i];
    s.x = r.x; s.y = r.y; s.z = r.z;
    Missions.update(C, m, 0.1, s, []);
  }
  check("night run banks 4 rings for 400 pts", m.ringsHit === 4 && m.score === 400, "rings=" + m.ringsHit + " score=" + m.score);
  const tgt = Missions.currentTarget(C, m);
  check("after ring 4 the night target is Halcyon", tgt && tgt.label === "HALCYON FIELD", tgt && tgt.label);
  Missions.update(C, m, 0.1, s, [{ type: "touchdown", quality: 170, vspeed: 2, field: "HAL" }]);
  check("night run completes on the HAL landing", m.done === true, "done=" + m.done);
  check("night score adds landing quality + time bonus", m.score > 570, "score=" + m.score);
})();

// ---- v4: emergency mission (any survivable touchdown counts) ------------------------------
(function () {
  const m = Missions.makeMission(C, "emergency");
  Missions.start(C, m);
  const s = Phys.makeState(C, { x: -40, y: 26, z: -60, heading: Math.PI / 2 });
  Missions.update(C, m, 0.1, s, [{ type: "touchdown", quality: 150, vspeed: 2, field: "HAL" }]);
  check("mayday completes on a survivable touchdown", m.done === true, "done=" + m.done);
  check("mayday score includes landing quality", m.score >= 150, "score=" + m.score);
  const prog = Missions.progressText(C, m);
  check("mayday panel shows the fuel state", /Fuel \d+%/.test(prog.b), prog.b);
})();

// ---- v4: mission roster ----------------------------------------------------------------------
(function () {
  check("six missions incl. night + emergency", C.MISSIONS.length === 6, "n=" + C.MISSIONS.length);
  const night = C.MISSIONS.find((d) => d.id === "night");
  const em = C.MISSIONS.find((d) => d.id === "emergency");
  check("night mission is a 4-ring night run", night && night.rings === 4 && night.night === true);
  check("emergency starts on 35% fuel with a leak", em && em.fuelStart === 0.35 && em.fuelLeak > 0, "fuelStart=" + (em && em.fuelStart));
})();

// ---- crash on ditching -------------------------------------------------------------------------
(function () {
  const s = Phys.makeState(C, { x: 1200, y: 3, z: -100, heading: 0 });
  s.onGround = false; s.airborne = true;
  s.vx = 0; s.vy = -5; s.vz = -20;
  let crashed = false;
  for (let i = 0; i < 120; i++) {
    const evts = Phys.update(C, s, 1 / 60, { pitch: 0, roll: 0, yaw: 0 }, 0);
    if (evts.some((e) => e.type === "crash")) { crashed = true; break; }
  }
  check("ditching in the sea crashes", crashed);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
