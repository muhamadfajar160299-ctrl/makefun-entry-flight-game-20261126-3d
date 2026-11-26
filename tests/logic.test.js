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
