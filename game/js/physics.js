// physics.js — flight model for the Kestrel-9. Pure math, no THREE,
// so Node can require it for logic tests. State is a plain object;
// update(dt, input, groundHeight) advances it and returns events.
//
// Conventions: x east, z south, y up. heading 0 = north (-z), grows
// clockwise. pitch + = nose up, roll + = right wing down.
// input: { throttle: -1..1 delta or null, pitch: -1..1, roll: -1..1,
//          yaw: -1..1, gearToggle, flapToggle, brake } — throttle is a
//          target 0..1 set by keys, pitch/roll/yaw are deflections.
(function (global) {
  "use strict";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Deterministic value noise for terrain. Shared with world.js through
  // the same constants; physics only needs ground height at (x, z).
  function hash2(ix, iz, seed) {
    var n = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967295) * 2 - 1;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, z, seed) {
    var ix = Math.floor(x), iz = Math.floor(z);
    var fx = x - ix, fz = z - iz;
    var a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
    var c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
    var u = smooth(fx), v = smooth(fz);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  // Terrain height. Must match world.js exactly (same formula).
  function terrainHeight(x, z, C) {
    var h = -6; // seabed
    for (var i = 0; i < C.ISLANDS.length; i++) {
      var isl = C.ISLANDS[i];
      var dx = (x - isl.cx) / isl.r, dz = (z - isl.cz) / isl.r;
      var d2 = dx * dx + dz * dz;
      if (d2 < 1.6) {
        var fall = Math.max(0, 1 - d2);
        var bump = Math.pow(fall, 1.6) * isl.h;
        var n = vnoise(x * 0.012 + isl.seed, z * 0.012, isl.seed) * 0.5 + 0.5;
        var ridge = vnoise(x * 0.045, z * 0.045, isl.seed + 7) * 0.5 + 0.5;
        bump *= 0.72 + 0.28 * n + 0.22 * ridge * fall;
        h = Math.max(h, bump - 2 + n * 3);
      }
    }
    // Flatten ground near runways so the strip is landable: fully flat
    // across the strip itself. Past each runway end, carve a clear
    // corridor DOWN to a gentle valley (fade over clearAlong metres
    // along the axis, clearAcross across it) so the runway never ends
    // in a mountainside. Low ground is never raised: the carve only
    // lowers terrain that stands above the runway, so the sea and the
    // shore stay where they are and no causeway is built into the water.
    for (var k in C.AIRFIELDS) {
      var f = C.AIRFIELDS[k];
      var hd = f.headingDeg * Math.PI / 180;
      var lx = Math.sin(hd), lz = -Math.cos(hd); // runway axis (heading 0 = north = -z)
      var rx = x - f.x, rz = z - f.z;
      var along = rx * lx + rz * lz;
      var across = -rx * lz + rz * lx;
      var aL = Math.abs(along), aW = Math.abs(across);
      if (aL <= f.length / 2 && aW <= f.width / 2) { h = f.elev; continue; }
      var fadeL = f.clearAlong || 70, fadeW = f.clearAcross || 70;
      // Along the axis the corridor stays FULLY flat for the first 75% of
      // the clear zone, then fades to natural ground over the last 25%:
      // a runway end must read as a flat plain running on, not as a slope
      // that starts climbing right past the threshold.
      var beyond = aL - f.length / 2;
      var tL = beyond <= 0 ? 1 : smooth(clamp((fadeL - beyond) / (fadeL * 0.25), 0, 1));
      var tW = aW <= f.width / 2 ? 1 : smooth(clamp(1 - (aW - f.width / 2) / fadeW, 0, 1));
      var flat = lerp(h, f.elev, tL * tW);
      h = Math.min(h, flat);
    }
    // Graded apron pad south of Halcyon Field: the taxiway, apron,
    // terminal and hangar sit on ground flattened to field
    // elevation, with a 25 m fade back to natural terrain so no
    // cliff edge appears at the pad boundary.
    var ap = C.APRON;
    if (ap) {
      var adx = Math.abs(x - ap.x), adz = Math.abs(z - ap.z);
      var fade = 25;
      var tx = 1 - smooth(clamp((adx - ap.hw) / fade, 0, 1));
      var tz = 1 - smooth(clamp((adz - ap.hl) / fade, 0, 1));
      var at = tx * tz;
      if (at > 0) h = lerp(h, ap.elev, at);
    }
    return h;
  }

  // Wind at sim-time t: steady sea breeze plus a slow deterministic
  // gust swell (two sines, so the same flight always meets the same
  // weather). Returns the wind vector in m/s (x east, z south), the
  // live speed in knots for the HUD, and the signed gust factor
  // -1..1 that swings the windsock and hurries the clouds.
  function windAt(C, t) {
    var base = C.WIND.speedKt * 0.514444;
    var gustAmp = (C.WIND.gustKt || 0) * 0.514444;
    var gust = Math.sin(t * 0.11) * 0.6 + Math.sin(t * 0.043 + 1.7) * 0.4;
    var speed = Math.max(0.5, base + gust * gustAmp);
    var from = (C.WIND.fromDeg + Math.sin(t * 0.05) * 4) * Math.PI / 180;
    var to = from + Math.PI; // wind blows TOWARD from+180
    return {
      x: Math.sin(to) * speed, z: -Math.cos(to) * speed,
      kt: speed / 0.514444, gust: gust,
    };
  }

  // Ground-traffic stepper (pure math, no THREE): a vehicle shuttles
  // along its lane, pauses, turns around and comes back. tr fields:
  // x, dir (+1/-1), mode ("taxi"|"pause"|"turn"), turnT, pauseT,
  // speed, min, max, heading, prevHeading, nose ("z-" for aircraft
  // whose nose is -z, "x+" for trucks whose nose is +x).
  function trafficStep(tr, dt) {
    function headingFor(dir, nose) {
      if (nose === "x+") return dir > 0 ? 0 : Math.PI;
      return dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    function angLerp(a, b, t) {
      var d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      return a + d * t;
    }
    if (tr.mode === "pause") {
      tr.pauseT -= dt;
      if (tr.pauseT <= 0) { tr.mode = "turn"; tr.turnT = 0; tr.prevHeading = tr.heading; tr.dir *= -1; }
    } else if (tr.mode === "turn") {
      tr.turnT += dt;
      var k = Math.min(1, tr.turnT / 1.2);
      tr.heading = angLerp(tr.prevHeading, headingFor(tr.dir, tr.nose), k);
      if (k >= 1) tr.mode = "taxi";
    } else {
      tr.x += tr.dir * tr.speed * dt;
      tr.heading = headingFor(tr.dir, tr.nose);
      if (tr.dir > 0 && tr.x >= tr.max) { tr.x = tr.max; tr.mode = "pause"; tr.pauseT = 2.5; }
      if (tr.dir < 0 && tr.x <= tr.min) { tr.x = tr.min; tr.mode = "pause"; tr.pauseT = 2.5; }
    }
    return tr;
  }

  function makeTraffic(C, key, startX, startDir) {
    var p = C.TRAFFIC[key];
    var f = C.AIRFIELDS.halcyon;
    var tr = {
      x: startX !== undefined ? startX : f.x + p.dxMin,
      dir: startDir || 1, mode: "taxi", turnT: 0, pauseT: 0,
      speed: p.speed, min: f.x + p.dxMin, max: f.x + p.dxMax,
      z: f.z + p.dz, nose: p.nose, heading: 0, prevHeading: 0,
    };
    tr.heading = tr.dir > 0
      ? (p.nose === "x+" ? 0 : -Math.PI / 2)
      : (p.nose === "x+" ? Math.PI : Math.PI / 2);
    tr.prevHeading = tr.heading;
    return tr;
  }

  // True when a point sits inside the no-cloud box around the ring-1
  // approach leg (the cockpit shot's sightline). Pure and tested.
  function inKeepout(C, x, y, z) {
    var k = C.CLOUD_KEEPOUT;
    if (!k) return false;
    return x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1 && z >= k.z0 && z <= k.z1;
  }

  // True when a ground point sits in the no-tall-tree corridor along
  // the ring-1 leg (the cockpit shot's sightline). Pure and tested.
  function inTreeCorridor(C, x, z) {
    var k = C.TREE_CORRIDOR;
    if (!k) return false;
    return x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1;
  }

  // Start pose for one live traffic vehicle under a screenshot
  // staging: the vehicle's lane comes from C.TRAFFIC, its staged
  // offset and direction from C.TRAFFIC_STAGING. Returns null when
  // the staging (or the vehicle) has no staged pose, so the caller
  // falls back to the standard opening picture.
  function stagingTrafficPose(C, staging, key) {
    var table = C.TRAFFIC_STAGING && C.TRAFFIC_STAGING[staging];
    if (!table || !table[key]) return null;
    var lane = C.TRAFFIC[key];
    if (!lane) return null;
    var f = C.AIRFIELDS.halcyon;
    var dx = table[key].dx;
    // clamp into the lane so a staged pose can never start a vehicle
    // outside the road it drives on
    var lo = Math.min(lane.dxMin, lane.dxMax), hi = Math.max(lane.dxMin, lane.dxMax);
    dx = clamp(dx, lo, hi);
    return { x: f.x + dx, dir: table[key].dir || 1 };
  }

  function makeState(C, start) {
    return {
      x: start.x, y: start.y, z: start.z,
      vx: 0, vy: 0, vz: 0,
      heading: start.heading, pitch: 0, roll: 0,
      speed: 0, throttle: 0, gearDown: true, flaps: 0,
      fuel: 1, fuelLeak: 0, damage: 0, onGround: true, airborne: false,
      stallWarn: false, crashed: false, crashReason: "",
      verticalSpeed: 0, agl: 0, time: 0, windKt: C.WIND.speedKt,
    };
  }

  // One physics step. events: array of {type, ...} pushed by the step.
  function update(C, s, dt, input, groundH) {
    var events = [];
    var P = C.PLANE;
    if (s.crashed) return events;
    s.time += dt;
    var wind = windAt(C, s.time);
    s.windKt = wind.kt;

    // --- controls ---------------------------------------------------------
    if (input.throttleDelta) s.throttle = clamp(s.throttle + input.throttleDelta * dt, 0, 1);
    if (input.throttleSet !== undefined && input.throttleSet !== null) s.throttle = clamp(input.throttleSet, 0, 1);
    if (input.gearToggle) { s.gearDown = !s.gearDown; events.push({ type: s.gearDown ? "gear-down" : "gear-up" }); }
    if (input.flapToggle) { s.flaps = (s.flaps + 1) % 3; events.push({ type: "flaps", flaps: s.flaps }); }

    var stallSpeed = P.stallSpeed * (1 - P.flapLift * (s.flaps / 2));
    var speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    s.speed = speed;

    // --- fuel ---------------------------------------------------------------
    // A leak (Mayday mission) drains on top of the normal burn, so the
    // gauge falls visibly faster than the throttle alone would explain.
    var burn = (P.fuelBurnIdle + (1 - P.fuelBurnIdle) * s.throttle) / P.fuelSeconds;
    s.fuel = Math.max(0, s.fuel - (burn + (s.fuelLeak || 0)) * dt);
    if (s.fuel < 0.15 && !s._fuelLowNoted) { s._fuelLowNoted = true; events.push({ type: "fuel-low" }); }
    if (s.fuel <= 0 && s.throttle > 0) { s.throttle = 0; events.push({ type: "fuel-empty" }); }

    // --- damage handling ------------------------------------------------------
    // A bent airframe flies worse: control authority fades as damage
    // climbs, and past 50% the plane pulls gently to the right, so a
    // hard landing is felt for the rest of the sortie, not just read.
    var dmgFactor = 1 - s.damage / 250;
    var dmgPull = s.damage >= 50 ? 0.04 * (s.damage / 100) : 0;

    var speedFactor = clamp(speed / 40, 0.25, 1); // control authority
    var flying = !s.onGround && speed > stallSpeed * 0.55;

    if (s.onGround) {
      // --- ground roll ------------------------------------------------------
      var groundNow = terrainHeight(s.x, s.z, C);
      var hd = s.heading;
      var fx = Math.sin(hd), fz = -Math.cos(hd);
      var fwdSpeed = s.vx * fx + s.vz * fz;
      var thrust = (s.fuel > 0 ? s.throttle * P.maxThrustAccel : 0);
      var drag = P.dragK * fwdSpeed * Math.abs(fwdSpeed) * (s.gearDown ? 1 + P.gearDrag : 1);
      var brake = input.brake ? 6 : 0;
      var accel = thrust - drag - brake - (fwdSpeed > 0.5 ? 0.35 : 0); // rolling friction
      fwdSpeed = Math.max(0, fwdSpeed + accel * dt);
      // gentle steering on the ground
      s.heading += (input.yaw || 0) * P.yawRate * 1.6 * dt * clamp(fwdSpeed / 12, 0, 1);
      var nfx = Math.sin(s.heading), nfz = -Math.cos(s.heading);
      s.vx = nfx * fwdSpeed; s.vz = nfz * fwdSpeed; s.vy = 0;
      s.y = groundNow;
      s.pitch = 0; s.roll *= Math.max(0, 1 - 6 * dt);
      if (fwdSpeed > P.takeoffSpeed && (input.pitch || 0) < -0.25) {
        s.onGround = false; s.airborne = true; s.pitch = 0.12;
        s.y = groundNow + 0.4; // small hop so the contact check cannot re-trigger
        events.push({ type: "takeoff", speed: fwdSpeed });
      }
    } else {
      // --- flight -----------------------------------------------------------
      var authority = flying ? speedFactor : speedFactor * 0.45;
      authority *= dmgFactor;
      s.roll += (input.roll || 0) * P.rollRate * authority * dt;
      s.roll += dmgPull * dt; // bent airframe pulls right
      s.roll = clamp(s.roll, -1.35, 1.35);
      // roll stability: wings level themselves slowly without input
      if (!(input.roll)) s.roll *= Math.max(0, 1 - 0.25 * dt);
      s.pitch += -(input.pitch || 0) * P.pitchRate * authority * dt;
      s.pitch = clamp(s.pitch, -0.6, 0.6);
      // coordinated turn: bank turns the nose (bank right -> turn right)
      s.heading += Math.sin(s.roll) * (C.GRAVITY / Math.max(speed, 12)) * 0.55 * dt;
      s.heading += (input.yaw || 0) * P.yawRate * authority * 0.5 * dt;

      // nose direction
      var cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      var ch = Math.cos(s.heading), sh = Math.sin(s.heading);
      // forward vector from heading/pitch/roll (roll rotates lift, not nose)
      var nx = sh * cp, ny = sp, nz = -ch * cp;

      var thrustAcc = (s.fuel > 0 ? s.throttle * P.maxThrustAccel : 0);
      // drag grows with speed and with gear/flaps
      var dragMult = 1 + (s.gearDown ? P.gearDrag : 0) + (s.flaps > 0 ? P.flapDrag * (s.flaps / 2) : 0);
      var dragAcc = P.dragK * dragMult * speed * speed;

      // velocity steers toward the nose when the wing flies; below stall
      // the plane mushes and sinks.
      var align = flying ? clamp(1.6 * dt, 0, 1) : clamp(0.35 * dt, 0, 1);
      s.vx = lerp(s.vx, nx * speed, align);
      s.vy = lerp(s.vy, ny * speed, align);
      s.vz = lerp(s.vz, nz * speed, align);

      // apply thrust along nose, drag opposite velocity, gravity down
      var inv = speed > 0.01 ? 1 / speed : 0;
      s.vx += (nx * thrustAcc - s.vx * inv * dragAcc) * dt;
      s.vy += (ny * thrustAcc - s.vy * inv * dragAcc - C.GRAVITY * (flying ? 0.12 : 0.85)) * dt;
      s.vz += (nz * thrustAcc - s.vz * inv * dragAcc) * dt;

      // stall: heavy sink + nose drop + warning
      var stalled = speed < stallSpeed;
      s.stallWarn = stalled;
      if (stalled) {
        s.vy -= C.GRAVITY * 0.55 * dt;
        s.pitch = lerp(s.pitch, -0.18, clamp(1.5 * dt, 0, 1));
        if (!s._stallNoted) { events.push({ type: "stall" }); s._stallNoted = true; }
      } else s._stallNoted = false;

      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      // wind: the air mass itself moves, so the plane drifts with it
      // (a headwind on final slows the groundspeed; a gust shoves the
      // wing). Position-only: the airspeed the wing feels is unchanged.
      s.x += wind.x * dt * 0.35; s.z += wind.z * dt * 0.35;
      s.roll += (Math.sin(s.time * 1.7) + Math.sin(s.time * 0.83 + 1.3)) * 0.012 * (0.5 + Math.abs(wind.gust)) * dt;
      s.verticalSpeed = s.vy;
    }

    // --- ground / water contact ----------------------------------------------
    var g = terrainHeight(s.x, s.z, C);
    s.agl = s.y - g;
    if (s.y <= g + 0.02 && !s.onGround && s.vy <= 0.5) {
      // touchdown (or crash into terrain/water); climbing away never counts
      var vs = -s.vy;
      var overWater = g < 0.5;
      var nearField = nearestField(C, s.x, s.z);
      if (overWater) {
        s.crashed = true; s.crashReason = "ditched in the sea";
        events.push({ type: "crash", reason: s.crashReason });
      } else if (vs > P.crashVSpeed || (Math.abs(s.roll) > 0.55 && vs > 3)) {
        s.crashed = true; s.crashReason = "hard impact";
        events.push({ type: "crash", reason: s.crashReason, vspeed: vs });
      } else {
        var gearOk = s.gearDown;
        var quality = landingQuality(C, s, nearField, vs);
        if (!gearOk) {
          s.damage = Math.min(C.MAX_DAMAGE, s.damage + P.damagePerHardHit);
          events.push({ type: "gear-up-landing", quality: Math.round(quality * 0.3), vspeed: vs });
        } else {
          events.push({ type: "touchdown", quality: quality, vspeed: vs, field: nearField ? nearField.code : null });
        }
        if (vs > P.hardVSpeed) {
          s.damage = Math.min(C.MAX_DAMAGE, s.damage + P.damagePerHardHit * 0.5);
          events.push({ type: "hard-landing", vspeed: vs });
        }
        if (s.damage >= C.MAX_DAMAGE) {
          s.crashed = true; s.crashReason = "airframe gave out";
          events.push({ type: "crash", reason: s.crashReason });
        }
        s.onGround = true; s.airborne = false;
        s.y = g; s.vy = 0;
        s.pitch = 0; s.roll *= 0.4;
        // keep rolling speed along heading
        var fsp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
        var fhx = Math.sin(s.heading), fhz = -Math.cos(s.heading);
        s.vx = fhx * fsp; s.vz = fhz * fsp;
      }
    }
    if (s.onGround && s.y < g) s.y = g;
    return events;
  }

  function nearestField(C, x, z) {
    var best = null, bestD = 1e9;
    for (var k in C.AIRFIELDS) {
      var f = C.AIRFIELDS[k];
      var d = Math.hypot(x - f.x, z - f.z);
      if (d < bestD) { bestD = d; best = f; }
    }
    return bestD < 900 ? best : null;
  }

  // Landing quality 0..200. Runway, centreline, alignment, sink rate, gear.
  function landingQuality(C, s, field, vs) {
    var q = 200;
    q -= clamp(vs, 0, 9) * 16;                    // sink rate
    q -= Math.abs(s.roll) * 90;                   // wings level
    if (field) {
      var hd = field.headingDeg * Math.PI / 180;
      var want = field.headingDeg; // degrees, 0 = north
      var dh = Math.abs(((s.heading * 180 / Math.PI - want + 540) % 360) - 180);
      dh = Math.min(dh, 180 - dh);
      q -= dh * 1.1;                              // alignment
      var lx = Math.sin(hd), lz = -Math.cos(hd);
      var across = Math.abs(-(s.x - field.x) * lz + (s.z - field.z) * lx);
      q -= across * 2.2;                          // centreline
      var along = Math.abs((s.x - field.x) * lx + (s.z - field.z) * lz);
      if (along > field.length / 2) q -= 60;      // off the strip
      else q += 10;
    } else q -= 70;                               // off-airport
    if (!s.gearDown) q *= 0.3;
    return Math.max(0, Math.round(q));
  }

  var api = {
    clamp: clamp, lerp: lerp, terrainHeight: terrainHeight, vnoise: vnoise,
    makeState: makeState, update: update, windAt: windAt,
    trafficStep: trafficStep, makeTraffic: makeTraffic,
    stagingTrafficPose: stagingTrafficPose, inKeepout: inKeepout,
    inTreeCorridor: inTreeCorridor,
    landingQuality: landingQuality, nearestField: nearestField,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SkylanePhysics = api;
})(typeof window !== "undefined" ? window : globalThis);
