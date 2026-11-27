// game.js — main loop, input, cameras, states and staging.
// Wires physics + missions + world + plane + audio + HUD together.
// Staging (?staging=cover|cockpit|landing|complete) puts the live game in
// a screenshot-ready state; window.__skylane exposes the live state.
(function (global) {
  "use strict";

  var C = global.SKYLANE_CONFIG;
  var Phys = global.SkylanePhysics;
  var Missions = global.SkylaneMissions;
  var Combat = global.SkylaneCombat;

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function startPose() {
    var f = C.AIRFIELDS.halcyon;
    return { x: f.x - 205, y: f.elev, z: f.z, heading: f.headingDeg * Math.PI / 180 };
  }

  function makeGame() {
    var canvas = $("scene");
    // ?hq=1 forces full quality (screenshot capture): software
    // rasterizers normally get a lighter load so the game still runs,
    // but a still capture can afford the slow frames.
    var forceHQ = false;
    try { forceHQ = new URLSearchParams(window.location.search).get("hq") === "1"; } catch (e) { forceHQ = false; }
    // Adaptive quality: software rasterizers (SwiftShader/llvmpipe) get a
    // lighter load so the game still runs; real GPUs get full quality.
    var softwareGL = false;
    try {
      var probe = document.createElement("canvas").getContext("webgl");
      var dbg = probe && probe.getExtension("WEBGL_debug_renderer_info");
      var rend = dbg && probe.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      softwareGL = !!rend && /swiftshader|llvmpipe|software|basic render/i.test(rend);
      if (probe) { var lose = probe.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); }
    } catch (e) { softwareGL = false; }
    var renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: forceHQ || !softwareGL });
    } catch (e) {
      $("nogl").classList.remove("hidden");
      $("menu").classList.add("hidden");
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, forceHQ ? 2 : (softwareGL ? 1 : 1.5)));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(62, 1, 0.5, 8000);
    var world = SkylaneWorld.build(scene, C, Phys, forceHQ ? "high" : (softwareGL ? "low" : "high"));
    var quality = forceHQ ? "high" : (softwareGL ? "low" : "high");
    var planeObj = SkylanePlane.buildPlane();
    scene.add(planeObj.group);
    scene.add(planeObj.trailL.line);
    scene.add(planeObj.trailR.line);
    var audio = SkylaneAudio.makeAudio();
    var hud = SkylaneHud.makeHud(C);

    var game = {
      state: "menu", mission: null, camMode: "chase",
      time: 0, staging: null, autopilot: false,
      lookYaw: 0, lookPitch: 0, pointerLocked: false,
      combat: null, combatPreFrozen: false, combatScripted: false,
      combatKillAt: 1.2, combatFreezeAt: 1.9,
    };
    var s = null; // physics state
    var input = { throttleDelta: 0, throttleSet: null, pitch: 0, roll: 0, yaw: 0, gearToggle: false, flapToggle: false, brake: false, firing: false };
    var keys = {};
    var mouseFire = false; // hold the mouse button to fire the guns
    var crates = []; // {mesh, chute}
    var camPos = new THREE.Vector3(0, 40, 40);
    var camLook = new THREE.Vector3(0, 30, 0);
    var lastStallBeep = 0;

    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    resize();

    // ---- menu ---------------------------------------------------------------
    var selMission = "gate";
    function buildMenu() {
      var list = $("mission-list");
      list.innerHTML = "";
      C.MISSIONS.forEach(function (m) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mission-row" + (m.id === selMission ? " sel" : "");
        b.innerHTML = '<span class="m-num">' + m.num + '</span><span><span class="m-name">' +
          m.name + '</span><br><span class="m-brief">' + m.brief + "</span></span>";
        b.addEventListener("click", function () { selMission = m.id; audio.ensure(); audio.click(); startMission(m.id); });
        list.appendChild(b);
      });
    }
    buildMenu();

    function resetPlane(pose) {
      s = Phys.makeState(C, pose || startPose());
      s.throttle = 0;
      planeObj.group.position.set(s.x, s.y, s.z);
      planeObj.group.rotation.set(0, 0, 0);
      planeObj.trailL.pts.length = 0;
      planeObj.trailR.pts.length = 0;
      clearCrates();
    }

    function startMission(id) {
      resetPlane();
      game.mission = Missions.makeMission(C, id);
      // mission-specific aircraft state: the Mayday starts on a
      // leaking tank, the Night Run starts in the dark
      var def = game.mission.def;
      if (def.fuelStart !== undefined) s.fuel = def.fuelStart;
      if (def.fuelLeak) s.fuelLeak = def.fuelLeak;
      if (def.night) {
        SkylaneWorld.setNight(world, true);
        renderer.toneMappingExposure = 0.85;
      } else {
        SkylaneWorld.setNight(world, false);
        renderer.toneMappingExposure = 1.12;
      }
      // every sortie starts with the same traffic picture
      SkylaneWorld.resetTraffic(world);
      Missions.start(C, game.mission);
      // v7 combat: the intercept is a dogfight from the off, free
      // flight carries optional targets, and the combat stagings
      // force a fight onto any sortie for the screenshots
      if (game.combat && Combat) { Combat.clearVisuals(game.combat); game.combat = null; }
      game.combatPreFrozen = false; game.combatScripted = false;
      var combatOn = def.combat || id === "free" ||
        game.staging === "combat" || game.staging === "coast" || game.staging === "ringcombat";
      if (combatOn && Combat) {
        game.combat = Combat.makeCombat(C, {
          missionId: id, killsNeeded: def.kills || C.COMBAT.interceptKills,
          spawn: !!def.combat || id === "free",
        });
        game.combat.terrainH = function (x, z) { return Phys.terrainHeight(x, z, C); };
        game.combat.fx = function (kind, x, y, z) {
          if (kind === "boom") {
            world.particles.burst(x, y, z, 40, [1.0, 0.6, 0.15], 14, 0.6);
            world.particles.burst(x, y, z, 24, [0.25, 0.22, 0.2], 6, 0.5);
          } else if (kind === "smoke") {
            world.particles.burst(x, y, z, 2, [0.25, 0.23, 0.22], 2, 0.4);
          }
        };
        Combat.attachVisuals(game.combat, THREE, scene);
        game.mission.combat = game.combat;
        if (id === "intercept") {
          for (var ci = 0; ci < 3; ci++) Combat.spawnEnemy(C, game.combat, s);
        }
      }
      game.state = "flying";
      game.camMode = "chase";
      game.lookYaw = 0; game.lookPitch = 0;
      $("menu").classList.add("hidden");
      $("endcard").classList.add("hidden");
      $("pause").classList.add("hidden");
      $("hud").classList.remove("hidden");
      $("hud-mission").classList.remove("hidden");
      $("cockpit-frame").classList.add("hidden");
      audio.ensure();
    }

    function quitToMenu() {
      game.state = "menu";
      game.mission = null;
      game.autopilot = false;
      if (game.combat && Combat) { Combat.clearVisuals(game.combat); game.combat = null; }
      SkylaneWorld.setNight(world, false);
      renderer.toneMappingExposure = 1.12;
      $("hud").classList.add("hidden");
      $("pause").classList.add("hidden");
      $("endcard").classList.add("hidden");
      $("cockpit-frame").classList.add("hidden");
      $("menu").classList.remove("hidden");
      buildMenu();
    }

    function showEnd(title, detail, lines, score) {
      game.state = title.indexOf("CRASH") === 0 ? "crashed" : "complete";
      // ANGLE FIX (v5): the end card docks to the left now, so the
      // mission checklist (top-left) is hidden while the card is up —
      // otherwise the two panels overlap. Restored in startMission.
      $("hud-mission").classList.add("hidden");
      $("end-title").textContent = title;
      $("end-detail").textContent = detail;
      $("end-score").textContent = "SCORE " + score;
      $("end-lines").innerHTML = lines.map(function (l) { return "<div>" + l + "</div>"; }).join("");
      $("endcard").classList.remove("hidden");
    }

    function endMissionComplete() {
      var m = game.mission;
      // stand the fight down first: clear the lock and stop the guns /
      // spawner, and hide the lock element outright — the HUD is never
      // redrawn once the state flips to complete, so a stale LOCK
      // would sit on the end card forever (v7 complete shot)
      if (game.combat && Combat) Combat.standDown(game.combat);
      var lockEl = $("hud-lock");
      if (lockEl) lockEl.classList.add("hidden");
      // level the plane on its gear for the end card: belt and braces
      // next to the physics touchdown levelling, so the final chase
      // frame (same frame, below) renders it wings-level
      s.pitch = 0; s.roll = 0;
      // the second line only names the goals this mission actually
      // has: a ring rally never dropped a crate, so "Crates on
      // target 0/3" must not appear there
      var goalLine;
      if (m.id === "drop") goalLine = "Crates on target " + m.cratesHit + " / 3";
      else if (m.id === "hop") goalLine = "Landings " + m.landings.length + " / 2";
      else if (m.id === "free") goalLine = "Landings " + m.landings.length;
      else if (m.id === "night") goalLine = "Night rings " + m.ringsHit + " / 4";
      else if (m.id === "emergency") goalLine = "Emergency landing — survived on " + Math.round(m.fuelPct * 100) + "% fuel";
      else if (m.id === "intercept") goalLine = "Drones destroyed " + (game.combat ? game.combat.kills : 0) + " / " + (m.def.kills || 5);
      else goalLine = "Rings " + m.ringsHit + " / 8";
      var lines = [
        "Mission time " + SkylaneHud.fmtTime(m.time),
        goalLine,
        "Landings " + m.landings.length + " (best quality " +
          (m.landings.length ? Math.max.apply(null, m.landings.map(function (l) { return l.quality; })) : 0) + ")",
      ];
      // v7: the end card shows the dogfight, not just the landing —
      // drones down, accuracy, and the combat points inside the score
      if (game.combat && (game.combat.kills > 0 || game.combat.shots > 0)) {
        lines.push("Combat: " + game.combat.kills + " drones down · accuracy " +
          Math.round(Combat.accuracy(game.combat) * 100) + "% (" +
          game.combat.hits + " hits / " + game.combat.shots + " shots)");
        lines.push("Combat bonus +" + game.combat.score + " pts");
      }
      showEnd("MISSION COMPLETE", m.def.name + " — flown clean in the golden hour.", lines, m.score);
      audio.good();
    }

    function endCrashed(reason) {
      showEnd("CRASHED — " + reason.toUpperCase(),
        "The Kestrel-9 is done for this sortie. Press R to fly again.",
        ["Score kept: " + game.mission.score, "Damage 100% — airframe lost"], game.mission.score);
      audio.bad();
    }

    // ---- crates ---------------------------------------------------------------
    function clearCrates() {
      for (var i = 0; i < crates.length; i++) scene.remove(crates[i].mesh);
      crates.length = 0;
    }
    function syncCrates(m) {
      while (crates.length < m.crates.length) {
        var g = new THREE.Group();
        var box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3),
          new THREE.MeshStandardMaterial({ color: 0xb98a4a, roughness: 0.9 }));
        box.castShadow = true;
        g.add(box);
        var chute = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.1, 10, 1, true),
          new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.8, side: THREE.DoubleSide }));
        chute.position.y = 1.7;
        g.add(chute);
        scene.add(g);
        crates.push({ mesh: g });
      }
      for (var i = 0; i < m.crates.length; i++) {
        crates[i].mesh.position.set(m.crates[i].x, m.crates[i].y, m.crates[i].z);
      }
      while (crates.length > m.crates.length) scene.remove(crates.pop().mesh);
    }

    // ---- input ---------------------------------------------------------------
    window.addEventListener("keydown", function (e) {
      if (e.repeat) return;
      keys[e.code] = true;
      audio.ensure();
      if (game.state === "menu") {
        if (e.code === "Digit1") startMission("gate");
        else if (e.code === "Digit2") startMission("hop");
        else if (e.code === "Digit3") startMission("drop");
        else if (e.code === "Digit4") startMission("free");
        else if (e.code === "Digit5") startMission("night");
        else if (e.code === "Digit6") startMission("emergency");
        else if (e.code === "Digit7") startMission("intercept");
        else if (e.code === "Enter") startMission(selMission);
        return;
      }
      if (e.code === "KeyP" || e.code === "Escape") {
        if (game.state === "flying") {
          game.state = "paused";
          $("pause").classList.remove("hidden");
        } else if (game.state === "paused") {
          game.state = "flying";
          $("pause").classList.add("hidden");
        }
        return;
      }
      if (e.code === "KeyR" && (game.state === "flying" || game.state === "complete" || game.state === "crashed")) {
        startMission(game.mission.id);
        return;
      }
      if (game.state !== "flying") return;
      if (e.code === "KeyG") input.gearToggle = true;
      if (e.code === "KeyF") input.flapToggle = true;
      if (e.code === "KeyC") {
        game.camMode = game.camMode === "chase" ? "cockpit" : "chase";
        game.lookYaw = 0; game.lookPitch = 0;
        $("cockpit-frame").classList.toggle("hidden", game.camMode !== "cockpit");
      }
      if (e.code === "KeyM") audio.toggleMute();
      if (e.code === "Space") {
        e.preventDefault();
        if (game.mission && Missions.dropCrate(C, game.mission, s)) audio.click();
      }
    });
    window.addEventListener("keyup", function (e) { keys[e.code] = false; });
    $("btn-resume").addEventListener("click", function () {
      game.state = "flying"; $("pause").classList.add("hidden");
    });
    $("btn-quit").addEventListener("click", quitToMenu);
    $("btn-again").addEventListener("click", function () { startMission(game.mission.id); });
    $("btn-menu").addEventListener("click", quitToMenu);

    // mouse: hold the button to fire the guns (v7 combat)
    canvas.addEventListener("mousedown", function () { mouseFire = true; });
    window.addEventListener("mouseup", function () { mouseFire = false; });
    // mouse: click canvas for pointer lock (look + steer assist)
    canvas.addEventListener("click", function () {
      if (game.state !== "flying") return;
      audio.ensure();
      if (!game.pointerLocked && canvas.requestPointerLock) canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", function () {
      game.pointerLocked = document.pointerLockElement === canvas;
      if (!game.pointerLocked) { game.lookYaw = 0; game.lookPitch = 0; }
    });
    document.addEventListener("mousemove", function (e) {
      if (!game.pointerLocked || game.state !== "flying") return;
      game.lookYaw = clamp(game.lookYaw - e.movementX * 0.0022, -1.1, 1.1);
      game.lookPitch = clamp(game.lookPitch - e.movementY * 0.0016, -0.45, 0.5);
    });

    function readKeys() {
      input.throttleDelta = 0;
      if (keys.KeyW) input.throttleDelta = 0.55;
      if (keys.KeyS) input.throttleDelta = -0.55;
      input.pitch = (keys.ArrowUp ? -1 : 0) + (keys.ArrowDown ? 1 : 0);
      input.roll = (keys.ArrowRight ? 1 : 0) + (keys.ArrowLeft ? -1 : 0);
      input.yaw = (keys.KeyD ? 1 : 0) + (keys.KeyA ? -1 : 0);
      input.brake = !!keys.KeyB;
      input.firing = !!keys.KeyX || mouseFire;
      // mouse steer assist while pointer-locked: look yaw nudges the roll
      if (game.pointerLocked) input.roll += clamp(game.lookYaw * 0.55, -0.6, 0.6);
      input.roll = clamp(input.roll, -1, 1);
    }

    // ---- autopilot (staging only): fly toward the current target ---------------
    function autopilotInput(dt) {
      var m = game.mission;
      var tgt = m ? Missions.currentTarget(C, m) : null;
      // v7: while the dogfight is still on, the autopilot chases the
      // LOCKED drone (nearest), not the first in the list — otherwise
      // the nose steers one way while the guns track another, and
      // every staged round goes into empty sky
      if (game.combat && game.combat.lock && m && m.id === "intercept" &&
          game.combat.kills < game.combat.killsNeeded) {
        var lk = game.combat.lock;
        tgt = { x: lk.x, y: lk.y, z: lk.z, label: "DRONE", kind: "drone", r: 10 };
      }
      input.throttleSet = 0.82;
      input.firing = !!(game.combat && game.combat.autoFire);
      input.gearToggle = false; input.flapToggle = false;
      if (!tgt) { input.pitch = 0; input.roll = 0; input.yaw = 0; return; }
      var dx = tgt.x - s.x, dz = tgt.z - s.z, dy = tgt.y - s.y;
      var wantHdg = Math.atan2(dx, -dz);
      var err = ((wantHdg - s.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      var wantRoll = clamp(err * 1.1, -0.6, 0.6);
      input.roll = clamp((wantRoll - s.roll) * 2.2, -1, 1);
      var wantPitch = clamp(dy * 0.012, -0.25, 0.3);
      input.pitch = clamp((s.pitch - wantPitch) * 3, -1, 1);
      input.yaw = clamp(err * 0.4, -0.5, 0.5);
      // slow down + gear down when the target is a landing strip
      // (any staging / mission); otherwise clean the gear up after takeoff
      var dist = Math.hypot(dx, dz);
      if (tgt.kind === "land") {
        input.throttleSet = dist < 260 ? 0.25 : 0.6;
        if (dist < 200 && !s.gearDown) input.gearToggle = true;
      } else if (s.airborne && s.speed > 35 && s.gearDown) {
        input.gearToggle = true; // clean up after takeoff
      }
    }

    // ---- staging ---------------------------------------------------------------
    // Dim rings already banked by a staging preset, so the world agrees
    // with the mission panel (a staged 8/8 must not show 8 glowing rings).
    function markRingsPassed(n) {
      for (var i = 0; i < n && i < world.rings.length; i++) {
        var r = world.rings[i];
        r.passed = true;
        r.glow.material.opacity = 0.12;
        r.torus.material.emissiveIntensity = 0.7;
      }
    }

    function applyStaging() {
      var q = new URLSearchParams(window.location.search);
      var staging = q.get("staging");
      var missionId = q.get("mission") || "gate";
      if (q.get("cam") === "cockpit") game.camMode = "cockpit";
      if (!staging) return;
      game.staging = staging;
      startMission(missionId);
      // the live traffic opens on its per-shot poses, so each
      // screenshot meets the taxiing plane, the truck and the cart
      // where its camera can actually see them
      if (SkylaneWorld.stageTraffic) SkylaneWorld.stageTraffic(world, staging);
      var f = C.AIRFIELDS.halcyon;
      if (staging === "cover") {
        // PEAK MOMENT, not a title screen: low final approach onto
        // runway 27 at golden hour, gear down, flaps out, the whole
        // rally already behind the plane — 8 rings banked (800 pts)
        // after ~3:05 of flying, so the shot reads as the end of a
        // real rally. The frame holds the runway ahead, the PAPI row
        // on the right, the terminal and the taxiing Kestrel on the
        // left, and the tower beyond. Freeze just past the threshold.
        Missions.presetProgress(C, game.mission, 8, 185);
        markRingsPassed(8);
        game.mission.messageT = 0;
        resetPlane({ x: f.x + 300, y: f.elev + 30, z: f.z + 6, heading: -Math.PI / 2 });
        s.onGround = false; s.airborne = true;
        s.vx = -34; s.vy = -1.5; s.vz = 0;
        s.throttle = 0.4;
        s.gearDown = true; s.flaps = 2;
        game.autopilot = true;
        game.camMode = "chase";
        // snap the chase camera in behind the plane at once
        camPos.set(f.x + 313, f.elev + 33, f.z - 2);
        camLook.set(f.x + 280, f.elev + 32, f.z + 6);
      } else if (staging === "cockpit") {
        // Level cruise over open water east of ring 1, at the ring's own
        // altitude, heading straight at it: no dive, no bank, and only
        // sea in the near foreground. The old pose dived -1500 FPM
        // toward the ring and banked over the shoreline, which dragged
        // the beach shelf and the cowling into the frame.
        // ANGLE FIX (v6): nudged 20 m west and 20 m north of the old
        // pose, so the dark pine cluster on the ridge no longer sits
        // right on the nose line. Second nudge (v6 round 2): further
        // south and west still — the ridge pines kept lining up with
        // the nose from the first pose, so the sightline now passes
        // south of the cluster and ring 1 sits ahead-left instead
        resetPlane({ x: 500, y: 76, z: 120, heading: -Math.PI / 2 });
        s.onGround = false; s.airborne = true;
        s.vx = -45; s.vy = 0; s.vz = 0;
        s.throttle = 0.8;
        game.autopilot = true;
        game.camMode = "cockpit";
        $("cockpit-frame").classList.remove("hidden");
        game.mission.message = "Ring 1 ahead — thread it, then keep the rally going.";
        game.mission.messageT = 4;
      } else if (staging === "landing") {
        // final approach from the east, westbound onto runway 27.
        // All 8 rings banked on the way here (800 pts) after ~3:05 of
        // flying — the shot must read as the end of a real rally, not a
        // teleport with a zero score.
        // ANGLE FIX (v6): start closer in (540 m east, 54 m up) and
        // capture at ~400 m out with a narrower FOV (updateCamera),
        // so the runway reads a third bigger in the frame. The v4
        // attempt to capture closer (<220 m) timed out because the
        // Kestrel sinks onto the runway before 220 m — 400 m stays
        // well clear of the touchdown point, so the plane is made
        // bigger with camera + FOV + staging instead.
        Missions.presetProgress(C, game.mission, 8, 185);
        markRingsPassed(8);
        game.mission.messageT = 0;
        resetPlane({ x: f.x + 540, y: f.elev + 54, z: f.z + 12, heading: -Math.PI / 2 });
        s.onGround = false; s.airborne = true;
        s.vx = -34; s.vy = -1.5; s.vz = 0;
        s.throttle = 0.35;
        s.gearDown = true; s.flaps = 2;
        game.autopilot = true;
        game.camMode = "chase";
      } else if (staging === "complete") {
        // same honest preset as landing: 8 rings banked (800 pts),
        // ~3:10 on the clock; the autopilot landing then adds the time
        // bonus + landing quality on top, so the end card reads like a
        // real 8-ring rally instead of 7 seconds of flying.
        Missions.presetProgress(C, game.mission, 8, 190);
        markRingsPassed(8);
        game.mission.messageT = 0;
        resetPlane({ x: f.x + 320, y: f.elev + 40, z: f.z, heading: -Math.PI / 2 });
        s.onGround = false; s.airborne = true;
        s.vx = -32; s.vy = -1.2; s.vz = 0;
        s.throttle = 0.3;
        s.gearDown = true; s.flaps = 2;
        game.autopilot = true;
        game.camMode = "chase";
      } else if (staging === "combat" || staging === "coast" || staging === "ringcombat") {
        // v7 DOGFIGHT: level cruise with the guns already hot, drones
        // placed where the chase camera can see them, one splashed on
        // cue — the freeze in the frame loop catches the explosion
        // mid-bloom with tracers still in the air. Offsets are
        // [ahead, up, right] in metres from the plane's nose line.
        var cPose, cOffs;
        if (staging === "combat") {
          // peak moment over the open water east of ring 1: sea below,
          // the isles ahead, three drones in the gunsight
          cPose = { x: 520, y: 95, z: 140, heading: -Math.PI / 2 };
          cOffs = [[130, 8, 0], [230, 30, 70], [190, -5, -90], [280, 45, -40], [320, 10, 110]];
          game.combatKillAt = 1.3; game.combatFreezeAt = 2.0;
        } else if (staging === "coast") {
          // over the south coast: sea to the left, the harbor shore
          // and the main island rising to the right
          cPose = { x: 150, y: 110, z: 640, heading: -Math.PI / 2 };
          cOffs = [[140, 5, -40], [260, 35, 80], [200, -10, -110], [300, 50, -30], [340, 15, 90]];
          game.combatKillAt = 1.3; game.combatFreezeAt = 2.0;
        } else {
          // ring run with a fight on: the gate rally, drones on the
          // ring-1 leg, the lock lit and tracers out. Drones sit
          // further ahead than the v7 offsets (nearest 190 m, not
          // 150): the plane closes ~70 m before the freeze, and a
          // kill at 150 m ended up ~55 m from the lens, its flash +
          // smoke + ghost mesh filling a whole corner as a giant blob.
          // Freeze is earlier too (1.6 s, not 2.0), so the scripted
          // kill is caught mid-bloom while still far downrange
          cPose = { x: 500, y: 76, z: 120, heading: -Math.PI / 2 };
          cOffs = [[190, 12, 30], [280, 25, -60], [240, 5, 90], [320, 40, -20]];
          game.combatKillAt = 1.3; game.combatFreezeAt = 1.6;
        }
        resetPlane(cPose);
        s.onGround = false; s.airborne = true;
        s.vx = -45; s.vy = 0; s.vz = 0;
        s.throttle = 0.8;
        game.autopilot = true;
        game.camMode = "chase";
        game.mission.messageT = 0;
        if (game.combat && Combat) {
          // drop the random openers: the staged drones sit exactly
          // where the camera looks, ahead of the nose
          for (var ci2 = 0; ci2 < game.combat.enemies.length; ci2++) {
            if (game.combat.enemies[ci2].mesh) scene.remove(game.combat.enemies[ci2].mesh);
          }
          game.combat.enemies.length = 0;
          game.combat.autoFire = false; // opens at t = 1.0, in the frame loop
          // no random replacements in a staged frame: the fight is
          // exactly the drones placed above, so the nav target and
          // the lock never point at a drone 700 m off-camera
          game.combat.spawn = false;
          var fwdX = Math.sin(cPose.heading), fwdZ = -Math.cos(cPose.heading);
          var rgtX = Math.cos(cPose.heading), rgtZ = Math.sin(cPose.heading);
          for (var di = 0; di < cOffs.length; di++) {
            var o = cOffs[di];
            Combat.placeEnemy(C, game.combat, {
              x: cPose.x + fwdX * o[0] + rgtX * o[2],
              y: cPose.y + o[1],
              z: cPose.z + fwdZ * o[0] + rgtZ * o[2],
            }, { hold: true, hp: 6 });
          }
          // snap the chase camera in behind the plane at once (the
          // cover staging does the same): at SwiftShader frame rates
          // the lerp needs frames the 1.45 s freeze does not give it
          camPos.set(cPose.x - fwdX * 15 + rgtX * 9, cPose.y + 4.2, cPose.z - fwdZ * 15 + rgtZ * 9);
          camLook.set(cPose.x + fwdX * 14, cPose.y + 1.2, cPose.z + fwdZ * 14);
        }
      } else if (staging === "combatcomplete") {
        // v7 end card: an honest 5-kill preset (5 x 150 + 12 hits x 25
        // = 1050 pts, 60% accuracy) after ~3:05 of flying; the
        // autopilot landing then adds the time bonus + landing
        // quality, so the card reads like a real dogfight sortie
        if (game.combat && Combat) {
          Combat.presetKills(C, game.combat, 5, 12, 20);
          game.mission.score = game.combat.score;
        }
        game.mission.time = 185;
        game.mission.messageT = 0;
        // v9: dark end-card livery — the cream flight livery
        // vanishes against the pale runway, so the parked Kestrel
        // wears teal for the end card only (other stagings keep
        // the cream livery).
        if (SkylanePlane.applyDarkLivery) SkylanePlane.applyDarkLivery(planeObj);
        resetPlane({ x: f.x + 320, y: f.elev + 40, z: f.z, heading: -Math.PI / 2 });
        s.onGround = false; s.airborne = true;
        s.vx = -32; s.vy = -1.2; s.vz = 0;
        s.throttle = 0.3;
        s.gearDown = true; s.flaps = 2;
        game.autopilot = true;
        game.camMode = "chase";
      }
      planeObj.group.position.set(s.x, s.y, s.z);
    }

    // ---- cameras ---------------------------------------------------------------
    var tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpU = new THREE.Vector3();
    function updateCamera(dt, rawDt) {
      // Camera smoothing must keep up with the plane even when the frame
      // rate collapses (software rendering): the physics advances up to
      // 0.5 s of game per rendered frame, so lerping on the clamped
      // visual step (0.06 s) leaves the look target behind the camera
      // and the plane falls out of view. Use the real frame time here.
      var ldt = Math.min(rawDt || dt, 0.25);
      var e = new THREE.Euler(s.pitch, -s.heading, -s.roll, "YXZ");
      var quat = new THREE.Quaternion().setFromEuler(e);
      planeObj.group.quaternion.copy(quat);
      planeObj.group.position.set(s.x, s.y, s.z);
      tmpF.set(Math.sin(s.heading) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.heading) * Math.cos(s.pitch));
      tmpU.set(0, 1, 0);
      if (game.camMode === "cockpit") {
        if (game.staging === "cockpit") {
          // ANGLE FIX (v5): the in-cockpit camera showed no aircraft at
          // all — just a vista. Pull back to a close chase from
          // behind-above so the nose, wings and livery read in frame,
          // while the gauge strip + canopy vignette still sell the
          // cockpit shot. Blades stay hidden and the prop disc capped
          // (frame loop) so the v2 glitch cannot return. First pass at
          // 8 m was too tight (plane ~55% of the frame, tail fin
          // crowding the left edge) — 11 m puts it at ~a third, like
          // the landing shot, with the sea and the ring ahead in view.
          tmpV.set(2.0, 2.8, 11).applyQuaternion(quat).add(planeObj.group.position);
          camera.position.copy(tmpV);
          tmpV.copy(planeObj.group.position).addScaledVector(tmpF, 26);
          tmpV.y -= 1.0;
          camera.lookAt(tmpV);
          camera.fov = lerp(camera.fov, 58, ldt * 4);
        } else {
          tmpV.set(0, 1.25, -1.35).applyQuaternion(quat).add(planeObj.group.position);
          camera.position.copy(tmpV);
          tmpV.copy(tmpF).multiplyScalar(30).add(camera.position);
          camera.lookAt(tmpV);
          camera.fov = lerp(camera.fov, 66, ldt * 4);
        }
      } else {
        // chase: behind and above, roll damped, look offset for mouse look.
        // The cover staging keeps the camera glued and pulled back so the
        // plane reads big AND the ring it just threaded still frames it
        // (a tight chase loses the ring the moment the plane passes it).
        var tight = game.staging === "cover";
        // ANGLE FIX (v6): landing + complete get a closer chase of their
        // own — the old 12 m chase left the plane ~10% of the frame over
        // a sea of grass. Back 8.5 m + a 46 deg FOV puts the Kestrel at
        // ~a third of the frame with the runway and the airport ahead,
        // and the look target reaches further down the strip so the
        // runway fills the frame instead of the grass below the plane.
        // Cover moves closer too (17 -> 13.5 m) with more side offset so
        // the 3/4 view shows the nose and livery, not just the tail.
        var landTight = game.staging === "landing" || game.staging === "complete";
        // v8: the combat-complete end card needs its own angle — the
        // tight rear chase puts the tail fin ("9K") huge in the
        // foreground and the pale plane vanishes against the bright
        // strip. A three-quarter rear-side view shows the fuselage
        // flank + livery against grass/hills instead.
        // v7 combat chase: pulled back with a side offset, a true
        // three-quarter rear view — the guns, the tracers and the
        // drones ahead all read in the frame instead of the tail.
        // Ring-run staging sits a touch tighter (the v7 frame left the
        // plane small at the left edge behind its own explosion)
        var combatView = !!game.combat;
        var ringTight = game.staging === "ringcombat";
        // v9: Larisha looked at the v8 frame and the plane is NOT
        // visible ("Kaga keliatan") — she is right: the rear-side
        // angle foreshortens the fuselage to a pale blob on pale
        // runway, and the fin reads as a separate "9K" signboard.
        // Go pure side profile from the SOUTH side (side -14): the
        // full flank + KESTREL-9 name + fin at the tail end read as
        // one aircraft, the cream fuselage sits against the dark
        // north grass and hills instead of the bright strip, and
        // the terminal/taxiway stay behind the camera. Back 2.5 /
        // up 1.6 / FOV 38 puts the Kestrel at ~40% of the frame.
        var completeView = game.staging === "combatcomplete";
        var back = tight ? 13.5 : (landTight ? 8.5 : (completeView ? 2.5 : (combatView ? (ringTight ? 13 : 15) : 11 + s.speed * 0.04))),
          up = tight ? 3.2 : (landTight ? 2.2 : (completeView ? 1.0 : (combatView ? (ringTight ? 3.8 : 4.2) : 3.2 + s.speed * 0.008)));
        // ANGLE FIX (v6): a wider side offset (12 m, not 8) puts the
        // chase at a true three-quarter rear angle, so the fuselage
        // flank — and the KESTREL-9 name running along it — reads
        // instead of the tail alone
        var side = tight ? 12 : (landTight ? 2.5 : (completeView ? -14 : (combatView ? (ringTight ? 7 : 9) : 0)));
        var q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch * 0.4, -s.heading, -s.roll * 0.45, "YXZ"));
        tmpV.set(side, up, back).applyQuaternion(q2).add(planeObj.group.position);
        var k = 1 - Math.exp(-ldt * (tight ? 22 : 8));
        camPos.lerp(tmpV, k);
        camera.position.copy(camPos);
        // cover: aim at the plane itself so it stays centred even while
        // the autopilot pitches up for the next ring; normal chase looks
        // 14 m ahead down the flight path
        if (tight) {
          tmpV.copy(planeObj.group.position).addScaledVector(tmpF, 20);
          tmpV.y += 2.0;
        } else if (completeView) {
          // aim at the plane itself with a little strip ahead so the
          // Kestrel stays centred and the runway reads behind it
          tmpV.copy(planeObj.group.position).addScaledVector(tmpF, 4);
          tmpV.y += 1.0;
        } else if (landTight) {
          // look further ahead and a touch higher so the runway and the
          // airport fill the frame instead of the grass below the plane
          tmpV.copy(planeObj.group.position).addScaledVector(tmpF, 22);
          tmpV.y += 2.0;
        } else {
          tmpV.copy(planeObj.group.position).addScaledVector(tmpF, 14);
          tmpV.y += 1.2;
        }
        // mouse look: swing the look target sideways/up
        var right = new THREE.Vector3().crossVectors(tmpF, tmpU).normalize();
        tmpV.addScaledVector(right, game.lookYaw * 26);
        tmpV.y += game.lookPitch * 14;
        var k2 = 1 - Math.exp(-ldt * 7);
        camLook.lerp(tmpV, k2);
        camera.lookAt(camLook);
        var wantFov = landTight ? 46 : (completeView ? 36 : 62 + clamp((s.speed - 30) / 50, 0, 1) * 16);
        camera.fov = lerp(camera.fov, wantFov, ldt * 3);
      }
      camera.updateProjectionMatrix();
    }

    // ---- main loop ---------------------------------------------------------------
    var last = performance.now();
    var acc = 0;
    var sprayTimer = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      // Wall-clock frame time (unclamped): physics catches up in fixed
      // 120 Hz substeps so the game stays real-time even at low fps.
      // Visual interpolation uses a clamped step so the camera never jumps.
      var rawDt = (now - last) / 1000 || 0.016;
      if (rawDt > 1) rawDt = 1;
      // v7: the first headless frame's rAF timestamp can sit ~1 s
      // BEFORE performance.now(), so rawDt goes negative — and the
      // camera lerp factor 1-exp(-ldt*8) then goes hugely negative
      // and flings the camera millions of metres out (the v6 cover
      // hid it with a snap; a 1.45 s combat freeze never recovers)
      if (rawDt < 0) rawDt = 0;
      last = now;
      var visDt = Math.min(rawDt, 0.06);
      game.time += rawDt;
      SkylaneWorld.update(world, visDt, game.time, quality);
      // in-world labels fade out up close so the plane never flies
      // through a giant wall of text; they read from the air, not from
      // on top of the sign. Once the end card is up they go away
      // entirely: the 46 m HALCYON FIELD sprite still reads as a pale
      // watermark across the sky even at 0.12 opacity (v7 complete shot)
      if (world.labels) {
        for (var li = 0; li < world.labels.length; li++) {
          var lb = world.labels[li];
          var ld = lb.position.distanceTo(camera.position);
          lb.material.opacity = (game.state === "complete" || game.state === "crashed")
            ? 0 : clamp((ld - 80) / 150, 0, 0.9);
        }
      }
      if (game.state === "flying" && s) {
        // fixed-step physics (120 Hz substeps) with catch-up: on a slow
        // machine the game stays real-time (choppy) instead of slow-motion
        acc += rawDt;
        if (acc > 0.5) acc = 0.5; // never spiral: drop time beyond half a second
        var step = 1 / 120, n = 0;
        while (acc >= step && n < 60) {
          if (game.autopilot) autopilotInput(step); else readKeys();
          var evts = Phys.update(C, s, step, input, 0);
          input.gearToggle = false; input.flapToggle = false;
          handleEvents(evts);
          if (game.mission && !game.mission.done) {
            Missions.update(C, game.mission, step, s, evts);
            consumeMissionEvents();
          }
          if (game.combat && game.mission && !game.mission.done) {
            Combat.update(C, game.combat, step, s, input.firing);
            consumeCombatEvents();
          }
          if (game.mission && game.mission.done && game.state === "flying") endMissionComplete();
          acc -= step; n++;
          if (s.crashed) break;
        }
        if (n >= 60) acc = 0;
        // Cover staging: freeze just past the threshold on final
        // (low over runway 27, gear down, PAPI + terminal + taxiing
        // traffic in frame) so the shot is the peak moment of the
        // rally — 8 rings banked, SCORE 800. The agl bound is only an
        // upper sanity check: the plane is sinking fast on final, so
        // no lower bound — it must freeze before touchdown, and the
        // clock fallback covers a dragged approach.
        if (game.staging === "cover" && !game.coverPreFrozen && game.mission &&
          ((s.x < 105 && s.agl < 60) || game.mission.time > 215)) {
          game.coverPreFrozen = true;
          game.state = "paused";
        }
        // v7 combat staging: splash the nearest drone on cue, then
        // freeze while its explosion is mid-bloom and the tracers are
        // still in the air — the paused frame holds the peak moment
        if (game.combat && (game.staging === "combat" || game.staging === "coast" || game.staging === "ringcombat")) {
          // guns open at t = 0.5, a full frame before the scripted
          // kill: the tracers are still in the air at the freeze,
          // and staged drones carry 6 hp so the guns cannot clear
          // the sky before the frame is taken
          if (!game.combat.autoFire && game.mission.time > 0.5) game.combat.autoFire = true;
          if (!game.combatScripted && game.mission.time > game.combatKillAt) {
            game.combatScripted = true;
            var ne = Combat.nearestEnemy(game.combat, s);
            if (ne) Combat.destroyEnemy(C, game.combat, ne);
          }
          if (!game.combatPreFrozen && game.mission.time > game.combatFreezeAt) {
            game.combatPreFrozen = true;
            game.state = "paused";
          }
        }
        syncCrates(game.mission);
        // spray when skimming the sea
        sprayTimer -= visDt;
        var overSea = Phys.terrainHeight(s.x, s.z, C) < 0.5;
        if (overSea && s.agl < 7 && s.speed > 32 && sprayTimer <= 0) {
          sprayTimer = 0.09;
          world.particles.burst(s.x, 0.8, s.z, 6, [0.85, 0.95, 1.0], 7, 0.9);
        }
        // speed overlay
        $("speedfx").style.opacity = s.speed > 55 ? String(clamp((s.speed - 55) / 45, 0, 0.85)) : "0";
        // audio + stall beep
        audio.setFlight(s.throttle, s.speed, !s.onGround);
        if (s.stallWarn && game.time - lastStallBeep > 0.9) { lastStallBeep = game.time; audio.stall(); }
        // plane visuals
        SkylanePlane.updatePlane(planeObj, visDt, game.time, s, s.speed, s.throttle);
        // cockpit view: the solid prop blades read as black bars across
        // the sky this close to the camera (frozen mid-spin at low fps),
        // so hide them and keep only the faint blur disc
        var inCockpit = game.camMode === "cockpit";
        for (var bi = 0; bi < planeObj.blades.length; bi++) planeObj.blades[bi].visible = !inCockpit;
        if (inCockpit) planeObj.disc.material.opacity = Math.min(planeObj.disc.material.opacity, 0.12);
        // wingtip trail anchors (world space)
        var q = planeObj.group.quaternion;
        var lw = new THREE.Vector3(-3.9, 0.05, -0.35).applyQuaternion(q).add(planeObj.group.position);
        var rw = new THREE.Vector3(3.9, 0.05, -0.35).applyQuaternion(q).add(planeObj.group.position);
        SkylanePlane.pushTrail(planeObj.trailL, lw.x, lw.y, lw.z);
        SkylanePlane.pushTrail(planeObj.trailR, rw.x, rw.y, rw.z);
        if (game.combat) Combat.render(game.combat, visDt);
        updateCamera(visDt, rawDt);
        var tgt = game.mission ? Missions.currentTarget(C, game.mission) : null;
        hud.update(s, game.mission, tgt, visDt, game.combat);
      } else if (game.state === "menu") {
        // slow cinematic orbit over the isles behind the menu
        var t = game.time * 0.045;
        camera.position.set(Math.sin(t) * 900, 260 + Math.sin(t * 0.7) * 40, Math.cos(t) * 900);
        camera.lookAt(-100, 40, -100);
        camera.fov = 58;
        camera.updateProjectionMatrix();
        planeObj.group.position.set(-380, 26, -260);
        planeObj.group.rotation.set(0, Math.PI / 2, 0);
      }
      renderer.render(scene, camera);
    }

    function handleEvents(evts) {
      for (var i = 0; i < evts.length; i++) {
        var e = evts[i];
        if (e.type === "touchdown") {
          audio.thud(clamp(e.vspeed / 9, 0.1, 1));
          // touchdown dust from the config: a small tan puff that
          // dies fast, so the end card never finds a white cloud
          // sitting on the nose
          var dust = C.DUST || { count: 12, speed: 3.2, up: 0.25, life: 0.45, color: [0.62, 0.55, 0.42] };
          world.particles.burst(s.x, s.y + 0.5, s.z, dust.count, dust.color, dust.speed, dust.up, dust.life);
        } else if (e.type === "gear-up-landing") {
          audio.thud(1);
          world.particles.burst(s.x, s.y + 0.5, s.z, 30, [1.0, 0.6, 0.2], 8, 0.5);
        } else if (e.type === "crash") {
          world.particles.burst(s.x, s.y + 1, s.z, 90, [1.0, 0.55, 0.15], 16, 0.7);
          endCrashed(e.reason);
        } else if (e.type === "takeoff") {
          audio.good();
        }
      }
    }

    function consumeMissionEvents() {
      var m = game.mission;
      while (m.events.length) {
        var e = m.events.shift();
        if (e.type === "ring") {
          var r = world.rings[e.n - 1];
          if (r) {
            r.passed = true;
            r.glow.material.opacity = 0.12;
            r.torus.material.emissiveIntensity = 0.7; // dimmed but still gold
            world.particles.burst(r.group.position.x, r.group.position.y, r.group.position.z, 36, [0.95, 0.72, 0.2], 15, 0.4);
          }
          audio.ring();
        } else if (e.type === "crate-hit") {
          audio.good();
        } else if (e.type === "mission-failed") {
          // crash already handled via physics events
        }
      }
    }

    function consumeCombatEvents() {
      var m = game.mission, cb = game.combat;
      while (cb.events.length) {
        var e = cb.events.shift();
        if (e.type === "hit") {
          audio.click();
        } else if (e.type === "kill") {
          audio.good();
          m.message = "DRONE DOWN! " + cb.kills + " / " + (m.def.kills || C.COMBAT.interceptKills) +
            " — +" + C.COMBAT.killScore + " pts";
          m.messageT = 4;
        }
      }
      if (cb.pendingScore) { m.score += cb.pendingScore; cb.pendingScore = 0; }
    }

    // expose live state for testing / screenshots
    global.__skylane = {
      game: game,
      renderer: renderer,
      scene: scene,
      camera: camera,
      world: world,
      quality: quality,
      get state() { return s; },
      get mission() { return game.mission; },
      startMission: startMission,
      quitToMenu: quitToMenu,
      version: "skylane-3d-1",
    };

    applyStaging();
    if (!game.mission && game.state === "menu") {
      resetPlane();
    }
    requestAnimationFrame(frame);
    return game;
  }

  // boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", makeGame);
  } else {
    makeGame();
  }
})(typeof window !== "undefined" ? window : globalThis);
