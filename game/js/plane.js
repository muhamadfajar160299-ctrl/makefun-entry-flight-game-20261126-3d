// plane.js — the Kestrel-9, built from primitives: cream fuselage with a
// teal-and-gold livery, bubble canopy, tapered wings, spinning propeller,
// retractable gear, nav lights, wingtip trails and spray/dust hooks.
// Forward is -z in local space (nose points -z, matching heading 0 = north).
(function (global) {
  "use strict";

  // Fuselage skin, 512x512: canvas x runs AROUND the tube, canvas y
  // runs ALONG it (y=0 is the nose, y=512 the tail). The canvas is
  // square because the tube is nearly as long as it is round, so a
  // name drawn along the length can have letters half a metre tall
  // and still fit — the old 1024x256 skin squeezed the same name
  // into letters 15 cm tall, which no chase camera could read. The
  // name sits on the forward fuselage, clear of the tail band.
  // Starboard (canvas x=128) reads tail to nose, port (x=384) nose
  // to tail, so each side reads correctly from outside. Verify from
  // a capture; flip a rotation if a side ever reads backwards.
  function liveryTexture() {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    var g = cv.getContext("2d");
    g.fillStyle = "#f3ead6"; g.fillRect(0, 0, 512, 512);
    g.fillStyle = "#0f6f6a"; g.fillRect(0, 400, 512, 112);
    g.fillStyle = "#e8a91c"; g.fillRect(0, 384, 512, 16);
    // panel stations (rings around the tube) + rivet rows
    g.strokeStyle = "rgba(20,49,61,0.45)"; g.lineWidth = 3;
    for (var px = 64; px < 512; px += 64) {
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, 512); g.stroke();
    }
    g.fillStyle = "rgba(20,49,61,0.5)";
    for (var rx = 32; rx < 512; rx += 32)
      for (var ry = 24; ry < 512; ry += 48) g.fillRect(rx, ry, 3, 3);
    g.fillStyle = "#14313d"; g.font = "bold 66px Arial"; g.textAlign = "center";
    // the name runs along the fuselage on both flanks: the canvas is
    // mirrored by flipY, so the starboard flank needs +90 deg and the
    // port flank -90 deg — a plain rotation the other way leaves the
    // name upside-down, and a flip after it mirrors the letters, so
    // each side gets its own bare rotation (round 3 proved it: the
    // flip left the name reversed with mirrored letters on both flanks)
    g.save(); g.translate(128, 200); g.rotate(Math.PI / 2); g.fillText("KESTREL-9", 0, 22); g.restore();
    g.save(); g.translate(384, 200); g.rotate(-Math.PI / 2); g.fillText("KESTREL-9", 0, 22); g.restore();
    var tex = new THREE.CanvasTexture(cv);
    return tex;
  }

  // Wing skin: cream with rib stations, a gold stripe and rivet rows,
  // so the wing reads as built metal up close instead of a flat slab.
  function wingTexture() {
    var cv = document.createElement("canvas");
    cv.width = 256; cv.height = 128;
    var g = cv.getContext("2d");
    g.fillStyle = "#f3ead6"; g.fillRect(0, 0, 256, 128);
    g.fillStyle = "#e8a91c"; g.fillRect(0, 8, 256, 10);
    g.strokeStyle = "rgba(20,49,61,0.35)"; g.lineWidth = 2;
    for (var x = 32; x < 256; x += 32) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke();
    }
    g.fillStyle = "rgba(20,49,61,0.4)";
    for (var rx = 16; rx < 256; rx += 32)
      for (var ry = 30; ry < 128; ry += 24) g.fillRect(rx, ry, 2, 2);
    g.fillStyle = "rgba(15,111,106,0.16)";
    g.fillRect(0, 100, 256, 28);
    return new THREE.CanvasTexture(cv);
  }

  // Dark livery (combatcomplete end card only): teal fuselage with
  // a cream name and gold stripe, so the parked Kestrel reads as a
  // plane against the pale runway instead of vanishing into it.
  // The cream livery above is the flight livery; this one is only
  // swapped in by the end-card staging, never in flight.
  // v11: the wings stay CREAM in the dark livery — the old dark
  // (teal) wing material made the wings the same shade as the teal
  // fuselage, so they vanished against it; cream wings read against
  // the teal fuselage and the grey runway. Only body/nose/tail swap.
  function liveryTextureDark() {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    var g = cv.getContext("2d");
    g.fillStyle = "#0f6f6a"; g.fillRect(0, 0, 512, 512);
    g.fillStyle = "#14313d"; g.fillRect(0, 400, 512, 112);
    g.fillStyle = "#e8a91c"; g.fillRect(0, 384, 512, 16);
    g.strokeStyle = "rgba(243,234,214,0.4)"; g.lineWidth = 3;
    for (var px = 64; px < 512; px += 64) {
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, 512); g.stroke();
    }
    g.fillStyle = "rgba(243,234,214,0.5)";
    for (var rx = 32; rx < 512; rx += 32)
      for (var ry = 24; ry < 512; ry += 48) g.fillRect(rx, ry, 3, 3);
    g.fillStyle = "#f3ead6"; g.font = "bold 66px Arial"; g.textAlign = "center";
    g.save(); g.translate(128, 200); g.rotate(Math.PI / 2); g.fillText("KESTREL-9", 0, 22); g.restore();
    g.save(); g.translate(384, 200); g.rotate(-Math.PI / 2); g.fillText("KESTREL-9", 0, 22); g.restore();
    return new THREE.CanvasTexture(cv);
  }

  function buildPlane() {
    var group = new THREE.Group();
    // painted metal, not flat plastic: a lower roughness and a
    // higher metalness let the low sun model the airframe instead
    // of washing it out
    var cream = new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.35, metalness: 0.25 });
    var teal = new THREE.MeshStandardMaterial({ color: 0x0f6f6a, roughness: 0.4, metalness: 0.35 });
    var gold = new THREE.MeshStandardMaterial({ color: 0xe8a91c, roughness: 0.3, metalness: 0.8 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.6, metalness: 0.4 });
    var glass = new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.75 });

    // fuselage: main tube + nose + tail cone, with livery texture
    var livTex = liveryTexture();
    var bodyMat = new THREE.MeshStandardMaterial({ map: livTex, roughness: 0.32, metalness: 0.4 });
    // end-card dark livery (swapped in by applyDarkLivery only)
    var darkBodyMat = new THREE.MeshStandardMaterial({ map: liveryTextureDark(), roughness: 0.32, metalness: 0.4 });
    var darkCream = new THREE.MeshStandardMaterial({ color: 0x0f6f6a, roughness: 0.35, metalness: 0.25 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 4.6, 14), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.2;
    body.castShadow = true;
    group.add(body);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), cream);
    nose.scale.set(0.95, 0.78, 1.4);
    nose.position.set(0, -0.08, -2.3);
    nose.castShadow = true;
    group.add(nose);
    var tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 12), cream);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 3.6;
    tail.castShadow = true;
    group.add(tail);

    // canopy bubble
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10), glass);
    canopy.scale.set(0.92, 0.75, 1.5);
    canopy.position.set(0, 0.55, -0.7);
    group.add(canopy);
    // cockpit dash + yoke (seen in cockpit view)
    var dash = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 0.3), dark);
    dash.position.set(0, 0.28, -1.25);
    group.add(dash);
    var yoke = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 16), dark);
    yoke.position.set(0, 0.32, -0.95);
    group.add(yoke);

    // wings: tapered boxes with slight dihedral, teal tips
    var wingTex = wingTexture();
    var wingMat = new THREE.MeshStandardMaterial({ map: wingTex, roughness: 0.4, metalness: 0.3 });
    var wingPanels = [];
    function wing(side) {
      var w = new THREE.Group();
      var panel = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.14, 1.25), wingMat);
      panel.position.x = side * 1.95;
      panel.castShadow = true;
      w.add(panel);
      wingPanels.push(panel);
      var tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 1.1), teal);
      tip.position.x = side * 3.65;
      w.add(tip);
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.145, 0.16), gold);
      stripe.position.set(side * 1.95, 0.005, -0.45);
      w.add(stripe);
      w.position.z = -0.35;
      w.rotation.z = side * -0.06; // dihedral
      return w;
    }
    group.add(wing(-1)); group.add(wing(1));

    // tailplane + fin
    var stab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.8), teal);
    stab.position.set(0, 0.12, 4.3);
    stab.castShadow = true;
    group.add(stab);
    // fin: swept, with a LONG root chord that runs down into the tail
    // cone, so it reads as part of the tail — the old 1.1 x 1.25 m box
    // stood on a tail cone of radius ~0.09 at z = 4.35 and read as a
    // detached green signboard from any side angle (v9/v10), and the
    // "9K" text on its flat face was half that read. The shape is a
    // 2D side profile (u = tail-ward from z = 2.9, v = up) extruded
    // 0.1 m thick; its bottom edge sits at v = 0, inside the cone
    // along the whole 1.65 m root, so the visible fin emerges from
    // the cone instead of floating above it. Plain teal, no text.
    var finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.7, 1.05);
    finShape.lineTo(1.1, 1.25);
    finShape.lineTo(1.45, 1.25);
    finShape.lineTo(1.65, 0);
    finShape.lineTo(0, 0);
    var fin = new THREE.Mesh(
      new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false }), teal);
    // shape u -> plane +z (tail-ward), v -> +y, extrude -> -x:
    // rotation.y = -PI/2 maps local (u, v, w) to (-w, v, u), so the
    // shape origin lands at z = 2.9 and the 0.1 thickness centres on
    // x = 0 with position.x = 0.05
    fin.rotation.y = -Math.PI / 2;
    fin.position.set(0.05, 0, 2.9);
    fin.castShadow = true;
    group.add(fin);

    // propeller: hub + 2 blades + blur disc
    var prop = new THREE.Group();
    var hub = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 10), gold);
    hub.rotation.x = -Math.PI / 2;
    prop.add(hub);
    var bladeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.35, metalness: 0.5 });
    var blades = [];
    for (var b = 0; b < 2; b++) {
      var blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.06), bladeMat);
      blade.rotation.z = b * Math.PI;
      blade.position.y = 0;
      prop.add(blade);
      blades.push(blade);
    }
    var disc = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24),
      new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    prop.add(disc);
    prop.position.z = -2.95;
    group.add(prop);

    // landing gear: nose wheel + 2 mains, retract by rotating up
    var gear = new THREE.Group();
    var legMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.7 });
    var tyreMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    function wheel(x, z, s) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), legMat);
      leg.position.set(x, -0.55, z);
      gear.add(leg);
      var tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * s, 0.26 * s, 0.18, 12), tyreMat);
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(x, -0.9, z);
      tyre.castShadow = true;
      gear.add(tyre);
    }
    wheel(-0.55, -0.5, 1); wheel(0.55, -0.5, 1); wheel(0, -1.9, 0.8);
    group.add(gear);

    // nav lights: red left, green right, white tail strobe
    function navLight(color, x, y, z) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 2.4 }));
      m.position.set(x, y, z);
      group.add(m);
      return m;
    }
    var navL = navLight(0xff2a1a, -3.9, 0.05, -0.35);
    var navR = navLight(0x2aff5a, 3.9, 0.05, -0.35);
    var strobe = navLight(0xffffff, 0, 0.15, 4.75);

    // wingtip trails: two fading line ribbons
    function makeTrail(color) {
      var N = 45;
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(N * 3);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      var mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.28 });
      var line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      return { line: line, pts: [], N: N };
    }
    var trailL = makeTrail(0xffffff);
    var trailR = makeTrail(0xffffff);

    return {
      group: group, prop: prop, disc: disc, gear: gear, blades: blades,
      navL: navL, navR: navR, strobe: strobe,
      trailL: trailL, trailR: trailR,
      parts: { body: body, nose: nose, tail: tail, wings: wingPanels, fin: fin },
      darkMats: { body: darkBodyMat, cream: darkCream, fin: teal },
    };
  }

  // End-card only: swap the cream flight livery for the dark one so
  // the parked Kestrel reads against the pale runway. Called from
  // the combatcomplete staging; no other staging or gameplay path
  // uses it, so the flight shots keep the cream livery.
  // v11: the wings are NOT swapped — they keep the cream flight
  // material, so they read against the teal fuselage and the grey
  // runway instead of vanishing into the teal (the v9/v10 end cards
  // wore teal wings on a teal fuselage). The fin keeps its plain
  // teal (v11 swept fin, no text, root sunk into the tail cone).
  function applyDarkLivery(pl) {
    if (!pl || !pl.parts || !pl.darkMats) return;
    pl.parts.body.material = pl.darkMats.body;
    pl.parts.nose.material = pl.darkMats.cream;
    pl.parts.tail.material = pl.darkMats.cream;
    pl.parts.fin.visible = true;
    pl.parts.fin.material = pl.darkMats.fin;
  }

  function pushTrail(trail, x, y, z) {
    trail.pts.unshift([x, y, z]);
    if (trail.pts.length > trail.N) trail.pts.pop();
    var arr = trail.line.geometry.attributes.position.array;
    for (var i = 0; i < trail.N; i++) {
      var p = trail.pts[Math.min(i, trail.pts.length - 1)] || [x, y, z];
      arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
    }
    trail.line.geometry.attributes.position.needsUpdate = true;
  }

  // Update per frame: prop spin by rpm, gear pose, trails, strobe blink.
  function updatePlane(pl, dt, t, state, speedMs, throttle) {
    var rpm = 0.25 + throttle * 2.2 + speedMs * 0.02;
    pl.prop.rotation.z -= rpm * 22 * dt;
    pl.disc.material.opacity = speedMs > 8 ? Math.min(0.3, throttle * 0.32) : 0;
    // gear: rotate legs up when retracted (simple scale-fade + tuck)
    var target = state.gearDown ? 0 : 1;
    pl.gear.position.y = lerp(pl.gear.position.y, target * 0.85, Math.min(1, dt * 3));
    pl.gear.rotation.x = lerp(pl.gear.rotation.x, target * 1.2, Math.min(1, dt * 3));
    pl.gear.visible = pl.gear.position.y < 0.8;
    // strobe double-blink
    var ph = t % 1.4;
    pl.strobe.material.emissiveIntensity = (ph < 0.08 || (ph > 0.2 && ph < 0.28)) ? 5 : 0.4;
    // trails: only when fast and turning / low over ground
    var show = speedMs > 30;
    pl.trailL.line.visible = show;
    pl.trailR.line.visible = show;
    pl.trailL.line.material.opacity = show ? clamp((speedMs - 30) / 40, 0.06, 0.28) : 0;
    pl.trailR.line.material.opacity = pl.trailL.line.material.opacity;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var api = { buildPlane: buildPlane, updatePlane: updatePlane, pushTrail: pushTrail, applyDarkLivery: applyDarkLivery };
  global.SkylanePlane = api;
})(typeof window !== "undefined" ? window : globalThis);
