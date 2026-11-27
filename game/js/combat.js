// combat.js — enemy drones, nose guns, tracers, explosions and the
// intercept dogfight. Pure logic (no THREE, no DOM at load time), so
// the whole fight model is Node-testable via require; the low-poly
// drone / tracer / explosion meshes attach lazily through
// attachVisuals(THREE, scene) and render() once per frame.
// The guns only ever fire where the player aims: a tracer that
// crosses a drone scores a hit, two hits splash it, and every kill
// pays into the mission score.
(function (global) {
  "use strict";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist3(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z));
  }

  // Forward unit vector of the player's aircraft from heading/pitch.
  function forwardOf(s) {
    var cp = Math.cos(s.pitch || 0);
    return {
      x: Math.sin(s.heading) * cp,
      y: Math.sin(s.pitch || 0),
      z: -Math.cos(s.heading) * cp,
    };
  }

  function makeCombat(C, opts) {
    opts = opts || {};
    var cb = C.COMBAT || {};
    return {
      missionId: opts.missionId || "intercept",
      killsNeeded: opts.killsNeeded || cb.interceptKills || 5,
      maxAlive: opts.maxAlive || cb.maxAlive || 3,
      spawn: opts.spawn !== undefined ? opts.spawn : true,
      endless: opts.missionId === "free",
      enemies: [], tracers: [], booms: [],
      kills: 0, hits: 0, shots: 0,
      score: 0, pendingScore: 0,
      spawnT: 0, cooldown: 0, time: 0,
      autoFire: false, lock: null, lockDist: 0,
      nextId: 1, events: [], viz: null, fx: null, terrainH: null,
    };
  }

  function aliveEnemies(cb) {
    var out = [];
    for (var i = 0; i < cb.enemies.length; i++) if (!cb.enemies[i].dead) out.push(cb.enemies[i]);
    return out;
  }

  // Nearest live drone to the player (or null).
  function nearestEnemy(cb, s) {
    var best = null, bd = Infinity;
    for (var i = 0; i < cb.enemies.length; i++) {
      var e = cb.enemies[i];
      if (e.dead) continue;
      var d = dist3(s, e);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function lockDistance(cb, s) {
    var e = nearestEnemy(cb, s);
    return e ? dist3(s, e) : 0;
  }

  // opts.hold pins a drone in place (screenshot staging only): a
  // staged drone must still be where the camera looks when the
  // frame freezes, not 100 m down its orbit
  function spawnEnemy(C, cb, s, pos, opts) {
    var cfg = C.COMBAT || {};
    var e;
    if (pos) {
      e = { x: pos.x, y: pos.y, z: pos.z };
    } else {
      // open on a ring around the player, 500-800 m out, near its height
      var a = Math.random() * Math.PI * 2;
      var r = 500 + Math.random() * 300;
      e = {
        x: s.x + Math.cos(a) * r,
        y: clamp(s.y + (Math.random() - 0.5) * 120, 45, 280),
        z: s.z + Math.sin(a) * r,
      };
    }
    var drone = {
      id: cb.nextId++, x: e.x, y: e.y, z: e.z,
      vx: 0, vy: 0, vz: 0,
      hp: (opts && opts.hp) || cfg.droneHp || 2,
      maxHp: (opts && opts.hp) || cfg.droneHp || 2,
      speed: cfg.droneSpeed || 42,
      phase: Math.random() * Math.PI * 2,
      dir: Math.random() < 0.5 ? -1 : 1,
      orbitR: 200 + Math.random() * 90,
      t: 0, hitFlash: 0, smokeT: 0,
      hold: !!(opts && opts.hold),
      dead: false, mesh: null,
    };
    cb.enemies.push(drone);
    return drone;
  }

  function accuracy(cb) {
    return cb.shots > 0 ? cb.hits / cb.shots : 0;
  }

  // Place one drone at an exact spot (staging): s is unused, the
  // position is absolute. Held drones hover where they are put.
  function placeEnemy(C, cb, pos, opts) {
    return spawnEnemy(C, cb, null, pos, opts);
  }

  // Stage a finished dogfight (screenshot preset): the kills are
  // banked with their honest points, so the end card reads like a
  // real 5-kill sortie instead of a teleport with a zero score.
  function presetKills(C, cb, kills, hits, shots) {
    var cfg = C.COMBAT || {};
    cb.kills = kills; cb.hits = hits; cb.shots = shots;
    cb.score = kills * (cfg.killScore || 150) + hits * (cfg.hitScore || 25);
    cb.pendingScore = 0;
    return cb;
  }

  function pushBoom(C, cb, x, y, z) {
    var shards = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.random() * Math.PI * 2;
      shards.push({
        x: 0, y: 0, z: 0,
        vx: Math.cos(a) * (6 + Math.random() * 10),
        vy: 2 + Math.random() * 8,
        vz: Math.sin(a) * (6 + Math.random() * 10),
        rx: Math.random() * 6, rz: Math.random() * 6,
      });
    }
    cb.booms.push({ x: x, y: y, z: z, life: 2.0, maxLife: 2.0, shards: shards, viz: null });
    if (cb.booms.length > 4) cb.booms.shift();
    if (cb.fx) { cb.fx("boom", x, y, z); }
  }

  function destroyEnemy(C, cb, e) {
    if (e.dead) return;
    e.dead = true;
    cb.kills++;
    var cfg = C.COMBAT || {};
    var pts = cfg.killScore || 150;
    cb.score += pts; cb.pendingScore += pts;
    pushBoom(C, cb, e.x, e.y, e.z);
    cb.events.push({ type: "kill", id: e.id, kills: cb.kills, score: cb.score });
    for (var i = 0; i < cb.enemies.length; i++) {
      if (cb.enemies[i] === e) { cb.enemies.splice(i, 1); break; }
    }
  }

  // One trigger pull: a tracer from the nose along the aim line; the
  // nearest drone the line passes within hitRadius of takes the hit.
  function fireGun(C, cb, s) {
    var cfg = C.COMBAT || {};
    if (cb.cooldown > 0 || s.onGround) return false;
    cb.cooldown = cfg.gunCooldown || 0.09;
    cb.shots++;
    var fwd = forwardOf(s);
    var ox = s.x + fwd.x * 3.2, oy = s.y + fwd.y * 3.2 - 0.1, oz = s.z + fwd.z * 3.2;
    var dir = fwd;
    var range = cfg.gunRange || 520;
    var lock = cb.lock;
    if (lock && !lock.dead) {
      var dx = lock.x - ox, dy = lock.y - oy, dz = lock.z - oz;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var cosA = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dl;
      // 35-degree aim cone (cos 0.819): the guns track the locked
      // drone while the nose is still swinging onto it, so the
      // tracers visibly converge on the target instead of spraying
      // past it whenever the autopilot — or the player — is mid-turn
      if (cosA > 0.819 && dl < range) {
        // lead the target: aim where it will be when the rounds arrive
        var lead = dl / (cfg.bulletSpeed || 260);
        var tx = lock.x + lock.vx * lead, ty = lock.y + lock.vy * lead, tz = lock.z + lock.vz * lead;
        var ax = tx - ox, ay = ty - oy, az = tz - oz;
        var al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        dir = { x: ax / al, y: ay / al, z: az / al };
      }
    }
    // ray-sphere: closest approach of each live drone to the aim line
    var hit = null, hitT = Infinity, hitR = cfg.hitRadius || 7;
    for (var i = 0; i < cb.enemies.length; i++) {
      var e = cb.enemies[i];
      if (e.dead) continue;
      var ex = e.x - ox, ey = e.y - oy, ez = e.z - oz;
      var t = ex * dir.x + ey * dir.y + ez * dir.z;
      if (t < 0 || t > range) continue;
      var px = ex - dir.x * t, py = ey - dir.y * t, pz = ez - dir.z * t;
      var perp = Math.sqrt(px * px + py * py + pz * pz);
      if (perp < hitR && t < hitT) { hit = e; hitT = t; }
    }
    var endX = ox + dir.x * range, endY = oy + dir.y * range, endZ = oz + dir.z * range;
    if (hit) {
      endX = ox + dir.x * hitT; endY = oy + dir.y * hitT; endZ = oz + dir.z * hitT;
      hit.hp--; hit.hitFlash = 1;
      cb.hits++;
      var hpts = cfg.hitScore || 25;
      cb.score += hpts; cb.pendingScore += hpts;
      cb.events.push({ type: "hit", id: hit.id, hp: hit.hp, score: cb.score });
      if (hit.hp <= 0) destroyEnemy(C, cb, hit);
    }
    cb.tracers.push({
      x1: ox, y1: oy, z1: oz, x2: endX, y2: endY, z2: endZ,
      life: 0.3, maxLife: 0.3, viz: null,
    });
    if (cb.tracers.length > 20) cb.tracers.shift();
    return true;
  }

  // Advance the fight one tick: lock, spawn, steer, guns, lifetimes.
  function update(C, cb, dt, s, firing) {
    var cfg = C.COMBAT || {};
    cb.time += dt;
    if (cb.cooldown > 0) cb.cooldown -= dt;
    // lock = nearest live drone inside lock range
    var lk = nearestEnemy(cb, s);
    if (lk && dist3(s, lk) <= (cfg.lockRange || 800)) {
      cb.lock = lk; cb.lockDist = dist3(s, lk);
    } else { cb.lock = null; cb.lockDist = 0; }
    // spawning: keep the pressure on while the intercept is unfinished,
    // or endlessly in free flight; anywhere else the staging places
    // the drones and the fight runs with what it has
    if (cb.spawn) {
      var want = cb.endless
        ? cb.maxAlive
        : (cb.kills < cb.killsNeeded ? cb.maxAlive : 0);
      if (cb.enemies.length < want) {
        cb.spawnT -= dt;
        if (cb.spawnT <= 0) { cb.spawnT = cfg.spawnDelay || 2.5; spawnEnemy(C, cb, s); }
      }
    }
    // steering: each drone orbits the player on a weaving circuit,
    // closing in, breaking off, coming around again
    for (var i = 0; i < cb.enemies.length; i++) {
      var e = cb.enemies[i];
      e.t += dt;
      if (e.hitFlash > 0) e.hitFlash -= dt * 3;
      if (e.hold) {
        // staged drone: hover where it was put, so the gunsight,
        // the lock and the camera all still agree at the freeze
        e.vx = 0; e.vy = 0; e.vz = 0;
      } else {
      var ang = e.phase + e.t * 0.22 * e.dir;
      var ty = clamp(s.y + 55 * Math.sin(e.t * 0.4 + e.phase), 45, 280);
      var tx = s.x + Math.cos(ang) * e.orbitR;
      var tz = s.z + Math.sin(ang) * e.orbitR;
      var dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var wantVx = dx / dl * e.speed, wantVy = dy / dl * e.speed, wantVz = dz / dl * e.speed;
      var k = 1 - Math.exp(-dt * 0.8);
      e.vx += (wantVx - e.vx) * k;
      e.vy += (wantVy - e.vy) * k;
      e.vz += (wantVz - e.vz) * k;
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
      var floor = cb.terrainH ? cb.terrainH(e.x, e.z) + 20 : 30;
      if (e.y < floor) e.y = floor;
      if (e.y > 300) e.y = 300;
      }
      // a smoking, damaged drone trails dark puffs
      if (e.hp < e.maxHp) {
        e.smokeT -= dt;
        if (e.smokeT <= 0) { e.smokeT = 0.18; if (cb.fx) cb.fx("smoke", e.x, e.y, e.z); }
      }
    }
    if (firing) fireGun(C, cb, s);
    // lifetimes: tracers die fast, explosions bloom then fade, shards fall
    for (var j = cb.tracers.length - 1; j >= 0; j--) {
      cb.tracers[j].life -= dt;
      if (cb.tracers[j].life <= 0) cb.tracers.splice(j, 1);
    }
    for (var b = cb.booms.length - 1; b >= 0; b--) {
      var boom = cb.booms[b];
      boom.life -= dt;
      for (var q = 0; q < boom.shards.length; q++) {
        var sh = boom.shards[q];
        sh.vy -= 9.8 * 0.6 * dt;
        sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.z += sh.vz * dt;
        sh.rx += dt * 5; sh.rz += dt * 4;
      }
      if (boom.life <= 0) cb.booms.splice(b, 1);
    }
  }

  // ---- visuals (browser only; no-ops in Node) ---------------------------
  function attachVisuals(cb, THREE, scene) {
    if (!THREE || !scene) return null;
    var dark = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.4 });
    var red = new THREE.MeshStandardMaterial({ color: 0xc22a2a, roughness: 0.5, metalness: 0.3, emissive: 0x400a0a });
    var glow = new THREE.MeshBasicMaterial({ color: 0xff2a22 });
    var viz = {
      THREE: THREE, scene: scene,
      bodyGeo: new THREE.ConeGeometry(0.55, 3.6, 8),
      wingGeo: new THREE.BoxGeometry(6.4, 0.14, 1.25),
      tailGeo: new THREE.BoxGeometry(2.4, 0.12, 0.9),
      finGeo: new THREE.BoxGeometry(0.12, 1.1, 0.9),
      lightGeo: new THREE.SphereGeometry(0.24, 8, 6),
      shardGeo: new THREE.BoxGeometry(0.7, 0.12, 0.5),
      flashGeo: new THREE.SphereGeometry(1, 14, 10),
      smokeGeo: new THREE.SphereGeometry(1, 10, 8),
      tracerGeo: new THREE.BoxGeometry(0.22, 0.22, 1),
      dark: dark, red: red, glow: glow,
      tracerMat: new THREE.MeshBasicMaterial({
        color: 0xff9a1a, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      flashMat: new THREE.MeshBasicMaterial({
        color: 0xff7a1a, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      smokeMat: new THREE.MeshStandardMaterial({
        color: 0x141414, roughness: 1, transparent: true, opacity: 0.45,
      }),
      tracerPool: [], boomPool: [],
    };
    cb.viz = viz;
    return viz;
  }

  function buildDroneMesh(cb) {
    var v = cb.viz, T = v.THREE;
    var g = new T.Group();
    g.scale.setScalar(1.5); // drones read at 150-300 m: bigger than life
    var body = new T.Mesh(v.bodyGeo, v.dark);
    body.rotation.x = -Math.PI / 2; // cone tip forward (-z)
    body.castShadow = true;
    g.add(body);
    var wing = new T.Mesh(v.wingGeo, v.red);
    wing.position.set(0, 0.05, 0.3);
    g.add(wing);
    var tail = new T.Mesh(v.tailGeo, v.dark);
    tail.position.set(0, 0.08, 1.55);
    g.add(tail);
    var fin = new T.Mesh(v.finGeo, v.red);
    fin.position.set(0, 0.5, 1.55);
    g.add(fin);
    var lightL = new T.Mesh(v.lightGeo, v.glow);
    lightL.position.set(-3.2, 0.05, 0.3);
    g.add(lightL);
    var lightR = new T.Mesh(v.lightGeo, v.glow);
    lightR.position.set(3.2, 0.05, 0.3);
    g.add(lightR);
    // remember each part's own material: the hit flash swaps the dark
    // airframe to glowing orange for a beat, then must swap it back —
    // the nav lights already glow, so they keep theirs
    g.traverse(function (m) { if (m.isMesh) m.userData.baseMat = m.material; });
    return g;
  }

  function buildBoomViz(cb) {
    var v = cb.viz, T = v.THREE;
    var g = new T.Group();
    var flash = new T.Mesh(v.flashGeo, v.flashMat.clone());
    g.add(flash);
    var smokes = [];
    for (var i = 0; i < 4; i++) {
      var sm = new T.Mesh(v.smokeGeo, v.smokeMat.clone());
      var a = (i / 4) * Math.PI * 2;
      sm.position.set(Math.cos(a) * 3, (i % 2 ? 1.5 : -0.5), Math.sin(a) * 3);
      g.add(sm);
      smokes.push(sm);
    }
    var shards = [];
    for (var j = 0; j < 6; j++) {
      var sh = new T.Mesh(v.shardGeo, v.dark);
      g.add(sh);
      shards.push(sh);
    }
    v.scene.add(g);
    return { group: g, flash: flash, smokes: smokes, shards: shards };
  }

  // Sync meshes with the fight state once per rendered frame. Frozen
  // while paused, so a staged explosion + tracers hold their pose.
  function render(cb, dt) {
    var v = cb.viz;
    if (!v) return;
    var T = v.THREE;
    for (var i = 0; i < cb.enemies.length; i++) {
      var e = cb.enemies[i];
      if (!e.mesh) { e.mesh = buildDroneMesh(cb); v.scene.add(e.mesh); }
      e.mesh.position.set(e.x, e.y, e.z);
      e.mesh.rotation.y = Math.atan2(e.vx, -e.vz);
      e.mesh.rotation.z = clamp(-e.vy * 0.02, -0.4, 0.4);
      // hit flash: the whole airframe blinks orange for a beat, then
      // each part returns to the material it was built with
      var flash = e.hitFlash > 0;
      e.mesh.traverse(function (m) {
        if (m.isMesh && m.userData.baseMat === v.dark) m.material = flash ? v.glow : v.dark;
      });
    }
    // tracers: one SHORT travelling dash per live shot, not a
    // full-length beam — a beam from the muzzle to a 400 m target
    // reads as a white laser bar across the whole frame, while a
    // 20 m dash racing down the aim line reads as gunfire
    var ti = 0;
    for (var j = 0; j < cb.tracers.length; j++) {
      var tr = cb.tracers[j];
      if (!tr.viz) {
        if (ti < v.tracerPool.length) tr.viz = v.tracerPool[ti];
        else { tr.viz = new T.Mesh(v.tracerGeo, v.tracerMat); v.scene.add(tr.viz); v.tracerPool.push(tr.viz); }
      }
      ti++;
      var dx = tr.x2 - tr.x1, dy = tr.y2 - tr.y1, dz = tr.z2 - tr.z1;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var nx = dx / len, ny = dy / len, nz = dz / len;
      var travelled = (1 - tr.life / tr.maxLife) * len;
      var dash = Math.min(20, len - travelled);
      if (dash < 1) dash = 1;
      var mx = tr.x1 + nx * (travelled + dash / 2);
      var my = tr.y1 + ny * (travelled + dash / 2);
      var mz = tr.z1 + nz * (travelled + dash / 2);
      tr.viz.position.set(mx, my, mz);
      tr.viz.scale.set(1, 1, dash);
      tr.viz.lookAt(tr.x2, tr.y2, tr.z2);
      tr.viz.material.opacity = 0.95 * (tr.life / tr.maxLife);
      tr.viz.visible = true;
    }
    for (var k = ti; k < v.tracerPool.length; k++) v.tracerPool[k].visible = false;
    // explosions: a bright core that blooms, smoke that billows,
    // shards that tumble away from the blast
    var bi = 0;
    for (var b = 0; b < cb.booms.length; b++) {
      var boom = cb.booms[b];
      if (!boom.viz) {
        if (bi < v.boomPool.length) boom.viz = v.boomPool[bi];
        else { boom.viz = buildBoomViz(cb); v.boomPool.push(boom.viz); }
      }
      bi++;
      var age = 1 - boom.life / boom.maxLife;
      boom.viz.group.position.set(boom.x, boom.y, boom.z);
      boom.viz.group.visible = true;
      // a hot core, not a balloon: small, deep orange, gone fast —
      // the fire-coloured particle burst carries the rest of the blast
      boom.viz.flash.scale.setScalar(2 + age * 5);
      boom.viz.flash.material.opacity = Math.max(0, 0.9 - age * 1.3);
      for (var s2 = 0; s2 < boom.viz.smokes.length; s2++) {
        var sm = boom.viz.smokes[s2];
        sm.scale.setScalar(1.0 + age * 2.5);
        sm.material.opacity = Math.max(0, 0.45 - age * 0.35);
      }
      for (var q = 0; q < boom.viz.shards.length; q++) {
        var shm = boom.viz.shards[q], shd = boom.shards[q];
        shm.position.set(shd.x, shd.y, shd.z);
        shm.rotation.set(shd.rx, 0, shd.rz);
        shm.visible = age < 0.9;
      }
    }
    for (var b2 = bi; b2 < v.boomPool.length; b2++) v.boomPool[b2].group.visible = false;
  }

  function clearVisuals(cb) {
    var v = cb.viz;
    if (!v) return;
    for (var i = 0; i < cb.enemies.length; i++) {
      if (cb.enemies[i].mesh) v.scene.remove(cb.enemies[i].mesh);
    }
    for (var j = 0; j < v.tracerPool.length; j++) v.scene.remove(v.tracerPool[j]);
    for (var k = 0; k < v.boomPool.length; k++) v.scene.remove(v.boomPool[k].group);
    cb.viz = null;
  }

  var api = {
    makeCombat: makeCombat, spawnEnemy: spawnEnemy, placeEnemy: placeEnemy,
    nearestEnemy: nearestEnemy, lockDistance: lockDistance,
    fireGun: fireGun, destroyEnemy: destroyEnemy, update: update,
    accuracy: accuracy, presetKills: presetKills,
    attachVisuals: attachVisuals, render: render, clearVisuals: clearVisuals,
    forwardOf: forwardOf, aliveEnemies: aliveEnemies,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SkylaneCombat = api;
})(typeof window !== "undefined" ? window : globalThis);
