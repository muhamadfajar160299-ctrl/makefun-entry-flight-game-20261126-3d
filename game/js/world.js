// world.js — builds the Halcyon Isles in Three.js: golden-hour sky and sun,
// animated ocean, heightmap terrain with painted biomes, trees, two
// airfields, the harbor with boats, the gold rings, clouds and particles.
// Uses SkylanePhysics.terrainHeight so the mesh and the flight model agree.
(function (global) {
  "use strict";

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function canvasTexture(w, h, draw) {
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    var tex = new THREE.CanvasTexture(cv);
    return tex;
  }

  function softBlobTexture() {
    return canvasTexture(128, 128, function (g) {
      var grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grad.addColorStop(0, "rgba(255,255,255,0.95)");
      grad.addColorStop(0.55, "rgba(255,255,255,0.45)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    });
  }

  // Fine grayscale speckle used as a bump map: gives the ocean a
  // glittering sun path and the terrain a grainy HD surface without
  // any extra geometry or network fetch.
  function noiseBumpTexture(seed, specks, base) {
    return canvasTexture(256, 256, function (g, w, h) {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      var rnd = mulberry32(seed);
      for (var i = 0; i < specks; i++) {
        var v = 96 + ((rnd() * 96) | 0);
        g.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.5)";
        g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 3.2, 0, Math.PI * 2); g.fill();
      }
      for (var j = 0; j < 240; j++) {
        var v2 = 110 + ((rnd() * 60) | 0);
        g.fillStyle = "rgba(" + v2 + "," + v2 + "," + v2 + ",0.35)";
        g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 6, 0, Math.PI * 2); g.fill();
      }
    });
  }

  function cloudTexture() {
    return canvasTexture(256, 128, function (g) {
      g.clearRect(0, 0, 256, 128);
      var puffs = [[70, 80, 52], [120, 66, 64], [175, 82, 54], [100, 92, 46], [150, 96, 44], [205, 92, 34]];
      for (var i = 0; i < puffs.length; i++) {
        var p = puffs[i];
        var grad = g.createRadialGradient(p[0], p[1], 2, p[0], p[1], p[2]);
        grad.addColorStop(0, "rgba(255,250,240,0.55)");
        grad.addColorStop(0.6, "rgba(255,244,228,0.22)");
        grad.addColorStop(1, "rgba(255,244,228,0)");
        g.fillStyle = grad;
        g.beginPath(); g.arc(p[0], p[1], p[2], 0, Math.PI * 2); g.fill();
      }
    });
  }

  // ---- sky -------------------------------------------------------------------
  function buildSky(scene, C, quality) {
    var sunDir = new THREE.Vector3(
      Math.cos(C.SUN_ELEVATION) * Math.sin(C.SUN_AZIMUTH),
      Math.sin(C.SUN_ELEVATION),
      Math.cos(C.SUN_ELEVATION) * Math.cos(C.SUN_AZIMUTH)).normalize();
    var geo = new THREE.SphereGeometry(3600, 28, 18);
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: sunDir } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); " +
        "gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "varying vec3 vDir; uniform vec3 sunDir;" +
        "void main(){ float h = clamp(vDir.y, -0.08, 1.0);" +
        " vec3 zen = vec3(0.22, 0.42, 0.68);" +
        " vec3 mid = vec3(0.55, 0.68, 0.84);" +
        " vec3 hor = vec3(1.00, 0.72, 0.42);" +
        " vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));" +
        " col = mix(col, zen, smoothstep(0.18, 0.75, h));" +
        " float s = max(dot(normalize(vDir), sunDir), 0.0);" +
        " col += vec3(1.0, 0.66, 0.30) * pow(s, 1500.0) * 3.0;" +
        " col += vec3(1.0, 0.58, 0.22) * pow(s, 60.0) * 0.18;" +
        " col += vec3(1.0, 0.55, 0.20) * pow(s, 10.0) * 0.15;" +
        " col = mix(col, vec3(0.36, 0.32, 0.30), smoothstep(-0.02, -0.08, vDir.y));" +
        " gl_FragColor = vec4(col, 1.0); }",
    });
    var sky = new THREE.Mesh(geo, mat);
    scene.add(sky);

    var sun = new THREE.DirectionalLight(C.SUN_COLOR, C.SUN_INTENSITY);
    sun.position.copy(sunDir).multiplyScalar(1800);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality === "low" ? 1024 : 2048, quality === "low" ? 1024 : 2048);
    var sc = sun.shadow.camera;
    sc.left = -950; sc.right = 950; sc.top = 950; sc.bottom = -950;
    sc.near = 200; sc.far = 4200;
    sun.shadow.bias = -0.0006;
    scene.add(sun); scene.add(sun.target);
    scene.add(new THREE.HemisphereLight(C.HEMI_SKY, C.HEMI_GROUND, C.HEMI_INTENSITY));
    scene.fog = new THREE.Fog(C.FOG_COLOR, C.FOG_NEAR, C.FOG_FAR);
    return { sunDir: sunDir };
  }

  // ---- ocean ------------------------------------------------------------------
  function buildOcean(scene, C, quality) {
    var segs = quality === "low" ? 48 : 96;
    var geo = new THREE.PlaneGeometry(4400, 4400, segs, segs);
    geo.rotateX(-Math.PI / 2);
    var bump = noiseBumpTexture(7, 5200, "#808080");
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(56, 56);
    var mat = new THREE.MeshPhongMaterial({
      color: 0x0d4258, specular: 0xffbe78, shininess: 220,
      bumpMap: bump, bumpScale: 0.9,
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0;
    mesh.receiveShadow = true;
    scene.add(mesh);
    var base = geo.attributes.position.array.slice();
    return { mesh: mesh, geo: geo, base: base, bump: bump };
  }

  function updateOcean(o, t, quality) {
    // slow drift of the micro-detail so the sun glitter shimmers
    o.bump.offset.x = (t * 0.008) % 1;
    o.bump.offset.y = (t * 0.005) % 1;
    var pos = o.geo.attributes.position;
    var arr = pos.array, base = o.base;
    for (var i = 0; i < arr.length; i += 3) {
      var x = base[i], z = base[i + 2];
      arr[i + 1] =
        Math.sin(x * 0.021 + t * 0.9) * 0.55 +
        Math.sin(z * 0.017 - t * 0.7) * 0.5 +
        Math.sin((x + z) * 0.008 + t * 0.45) * 0.8;
    }
    pos.needsUpdate = true;
    var every = quality === "low" ? 5 : 2;
    if ((updateOcean.frame = (updateOcean.frame || 0) + 1) % every === 0) o.geo.computeVertexNormals();
  }

  // ---- terrain ------------------------------------------------------------------
  function terrainColor(h, slope, n, patch) {
    // returns [r,g,b] 0..1; patch is smooth 0..1 value noise so grass /
    // meadow / forest blend in patches instead of per-vertex static
    var sand = [0.86, 0.76, 0.54], grass = [0.42, 0.60, 0.30],
      meadow = [0.55, 0.66, 0.34], forest = [0.16, 0.34, 0.18],
      rock = [0.45, 0.40, 0.36], deep = [0.05, 0.23, 0.28],
      shallow = [0.45, 0.62, 0.55];
    var c;
    if (h < -1) c = deep;
    else if (h < 1.2) c = shallow;
    else if (h < 3.5) c = sand;
    else if (h < 26) c = patch > 0.5 ? meadow : grass;
    else if (h < 70) c = patch > 0.62 ? forest : grass;
    else if (h < 118) c = forest;
    else c = rock;
    if (slope > 0.55 && h > 3.5) c = rock;
    var v = 0.92 + n * 0.16 + (patch - 0.5) * 0.1;
    return [c[0] * v, c[1] * v, c[2] * v];
  }

  // Patchwork fields near Halcyon Field: big flat colour blocks (wheat /
  // meadow / pasture / dry grass) so the farmland reads from the air,
  // the way neighbouring entries do it. Colour only — the terrain shape
  // is untouched. Returns null outside the farmland belt.
  function fieldBlockColor(C, x, z, h) {
    var f = C.AIRFIELDS.halcyon;
    var d = Math.hypot(x - f.x, z - f.z);
    if (d > 750 || h < 3.5 || h > 70) return null;
    var bx = Math.floor(x / 120), bz = Math.floor(z / 120);
    var hh = Math.abs(Math.sin(bx * 12.9898 + bz * 78.233) * 43758.5453) % 1;
    if (hh < 0.20) return [0.88, 0.68, 0.26]; // wheat — the tan accent
    if (hh < 0.50) return [0.36, 0.58, 0.24]; // meadow green
    if (hh < 0.75) return [0.14, 0.34, 0.12]; // dark pasture
    return [0.58, 0.72, 0.32]; // light green
  }

  function buildTerrain(scene, C, phys, quality) {
    var size = C.WORLD_SIZE, seg = quality === "low" ? 130 : 200;
    var geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var rnd = mulberry32(99);
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var h = phys.terrainHeight(x, z, C);
      pos.setY(i, h);
      // slope from neighbours
      var hx = phys.terrainHeight(x + 6, z, C) - phys.terrainHeight(x - 6, z, C);
      var hz = phys.terrainHeight(x, z + 6, C) - phys.terrainHeight(x, z - 6, C);
      var slope = Math.sqrt(hx * hx + hz * hz) / 12;
      var patch = phys.vnoise(x * 0.01, z * 0.01, 5) * 0.5 + 0.5;
      var col = terrainColor(h, slope, rnd(), patch);
      var field = fieldBlockColor(C, x, z, h);
      if (field) {
        var fv = 0.92 + rnd() * 0.16 + (patch - 0.5) * 0.1;
        col = [field[0] * fv, field[1] * fv, field[2] * fv];
      }
      colors[i * 3] = col[0]; colors[i * 3 + 1] = col[1]; colors[i * 3 + 2] = col[2];
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    var detail = noiseBumpTexture(31, 9000, "#ededed");
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    detail.repeat.set(170, 170);
    var mat = new THREE.MeshStandardMaterial({ map: detail, vertexColors: true, roughness: 0.95, metalness: 0 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function buildTrees(scene, C, phys) {
    var rnd = mulberry32(4242);
    // Keep the approach/departure corridors clear: nothing may grow
    // inside the flattened valley around a runway, or near the strip.
    function inClearZone(x, z) {
      for (var k in C.AIRFIELDS) {
        var f = C.AIRFIELDS[k];
        if (Math.hypot(x - f.x, z - f.z) < f.length * 0.75) return true;
        var hd = f.headingDeg * Math.PI / 180;
        var lx = Math.sin(hd), lz = -Math.cos(hd);
        var along = Math.abs((x - f.x) * lx + (z - f.z) * lz);
        var across = Math.abs(-(x - f.x) * lz + (z - f.z) * lx);
        if (along < f.length / 2 + (f.clearAlong || 70) + 40 && across < 70) return true;
      }
      return false;
    }
    function goodSpot(x, z) {
      var h = phys.terrainHeight(x, z, C);
      if (h < 9 || h > 112) return -1;
      if (inClearZone(x, z)) return -1;
      return h;
    }
    var spots = []; // [x, h, z, scale, broadleaf?]
    // forest clusters: trees grow in groves, not evenly scattered
    var clusters = 0, tries = 0;
    while (clusters < 14 && tries < 3000) {
      tries++;
      var cx = (rnd() - 0.5) * C.WORLD_SIZE, cz = (rnd() - 0.5) * C.WORLD_SIZE;
      if (goodSpot(cx, cz) < 0) continue;
      clusters++;
      var n = 26 + ((rnd() * 26) | 0);
      for (var j = 0; j < n; j++) {
        var x = cx + (rnd() - 0.5) * 150, z = cz + (rnd() - 0.5) * 150;
        var h = goodSpot(x, z);
        if (h < 0) continue;
        spots.push([x, h, z, 0.7 + rnd() * 1.1, rnd() < 0.35]);
      }
    }
    // scattered singles to fill the gaps
    tries = 0;
    while (spots.length < 720 && tries < 9000) {
      tries++;
      var sx = (rnd() - 0.5) * C.WORLD_SIZE, sz = (rnd() - 0.5) * C.WORLD_SIZE;
      var sh = goodSpot(sx, sz);
      if (sh < 0) continue;
      spots.push([sx, sh, sz, 0.7 + rnd() * 1.1, rnd() < 0.35]);
    }
    var trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 5);
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4128, roughness: 1 });
    var pineGeo = new THREE.ConeGeometry(2.3, 6.5, 6);
    var pineMat = new THREE.MeshStandardMaterial({ color: 0x1e4d24, roughness: 1 });
    var broadGeo = new THREE.SphereGeometry(2.6, 8, 6);
    var broadMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 1 });
    var pines = spots.filter(function (sp) { return !sp[4]; });
    var broads = spots.filter(function (sp) { return sp[4]; });
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    var pineMesh = new THREE.InstancedMesh(pineGeo, pineMat, Math.max(pines.length, 1));
    var broadMesh = new THREE.InstancedMesh(broadGeo, broadMat, Math.max(broads.length, 1));
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    var up = new THREE.Vector3(0, 1, 0);
    function place(mesh, idx, x, y, z, sc, sy) {
      p.set(x, y, z); s.set(sc, sy, sc);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      m.compose(p, q, s); mesh.setMatrixAt(idx, m);
    }
    for (var i = 0; i < spots.length; i++) {
      var sp = spots[i];
      place(trunks, i, sp[0], sp[1] + 1.3 * sp[3], sp[2], sp[3], sp[3]);
    }
    for (var a = 0; a < pines.length; a++) {
      var pa = pines[a];
      place(pineMesh, a, pa[0], pa[1] + 5.2 * pa[3], pa[2], pa[3], pa[3]);
    }
    for (var b = 0; b < broads.length; b++) {
      var ba = broads[b];
      place(broadMesh, b, ba[0], ba[1] + 4.6 * ba[3], ba[2], ba[3], ba[3] * 0.85);
    }
    trunks.castShadow = true; pineMesh.castShadow = true; broadMesh.castShadow = true;
    scene.add(trunks); scene.add(pineMesh); scene.add(broadMesh);
    return spots.length;
  }

  // ---- airfields ------------------------------------------------------------------
  function runwayTexture(codeA, codeB) {
    return canvasTexture(256, 1024, function (g, w, h) {
      g.fillStyle = "#2e3138"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#3a3e46";
      for (var i = 0; i < 40; i++) g.fillRect(0, i * 26, w, 2);
      g.fillStyle = "#f2f2ea";
      for (var y = 60; y < h - 60; y += 86) g.fillRect(w / 2 - 5, y, 10, 44);
      // runway edge lines: solid white stripes down both sides
      g.fillRect(10, 0, 5, h);
      g.fillRect(w - 15, 0, 5, h);
      // aiming-point bars + touchdown-zone pairs, mirrored at both
      // ends so the strip reads from either direction: the aiming
      // bars sit ~130 m past each threshold, the TDZ pair steps on
      // from there toward midfield (kept clear of the numbers)
      for (var e = 0; e < 2; e++) {
        var ay = e === 0 ? h * 0.30 : h * 0.70 - 46;
        g.fillRect(w / 2 - 66, ay, 48, 46);
        g.fillRect(w / 2 + 18, ay, 48, 46);
        var ty = e === 0 ? h * 0.41 : h * 0.59 - 40;
        g.fillRect(w / 2 - 52, ty, 34, 40);
        g.fillRect(w / 2 + 18, ty, 34, 40);
      }
      // threshold bars
      for (var b = 0; b < 4; b++) {
        g.fillRect(24 + b * 56, 26, 34, 12);
        g.fillRect(24 + b * 56, h - 38, 34, 12);
      }
      g.font = "bold 92px Arial"; g.textAlign = "center"; g.fillStyle = "#f2f2ea";
      g.save(); g.translate(w / 2, 190); g.rotate(Math.PI); g.fillText(codeA, 0, 0); g.restore();
      g.fillText(codeB, w / 2, h - 130);
      var tex = null; void tex;
    });
  }

  // Taxiway: dark asphalt with a dashed yellow centreline.
  function taxiwayTexture() {
    return canvasTexture(64, 1024, function (g, w, h) {
      g.fillStyle = "#34373d"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#3c4046";
      for (var i = 0; i < 40; i++) g.fillRect(0, i * 26, w, 2);
      g.fillStyle = "#e8c33a";
      for (var y = 30; y < h - 30; y += 84) g.fillRect(w / 2 - 3, y, 6, 44);
      g.fillStyle = "rgba(232,195,58,0.55)";
      g.fillRect(5, 0, 2, h);
      g.fillRect(w - 7, 0, 2, h);
    });
  }

  // Connector taxiway: asphalt with the holding-short marking
  // (two solid + two dashed yellow bars across the taxiway) near
  // the runway end — canvas top is the runway (north) end.
  function connectorTexture() {
    return canvasTexture(64, 256, function (g, w, h) {
      g.fillStyle = "#34373d"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#e8c33a";
      g.fillRect(w / 2 - 3, 80, 6, h - 80);
      g.fillRect(6, 26, w - 12, 6);
      g.fillRect(6, 38, w - 12, 6);
      for (var x = 6; x < w - 12; x += 18) g.fillRect(x, 52, 10, 6);
      for (var x2 = 6; x2 < w - 12; x2 += 18) g.fillRect(x2, 64, 10, 6);
    });
  }

  // Apron: pale concrete with expansion-joint grid lines.
  function apronTexture() {
    return canvasTexture(256, 128, function (g, w, h) {
      g.fillStyle = "#767c83"; g.fillRect(0, 0, w, h);
      var rnd = mulberry32(55);
      for (var i = 0; i < 500; i++) {
        var v = 100 + ((rnd() * 40) | 0);
        g.fillStyle = "rgba(" + v + "," + v + "," + (v + 4) + ",0.25)";
        g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 4, 2 + rnd() * 4);
      }
      g.fillStyle = "rgba(40,44,48,0.55)";
      for (var gx = 0; gx <= w; gx += 32) g.fillRect(gx, 0, 2, h);
      for (var gy = 0; gy <= h; gy += 32) g.fillRect(0, gy, w, 2);
    });
  }

  // Windsock: orange / white bands along its length.
  function windsockTexture() {
    return canvasTexture(64, 128, function (g, w, h) {
      for (var b = 0; b < 5; b++) {
        g.fillStyle = b % 2 ? "#f2ede2" : "#ff7a1a";
        g.fillRect(0, b * h / 5, w, h / 5 + 1);
      }
    });
  }

  // Simple parked aircraft: fuselage, nose, canopy, wings, tail and
  // a static prop — a fraction of the flyable Kestrel, enough to
  // read as a parked plane from the runway and the air.
  function buildParkedPlane(colorBody, colorTrim) {
    var g = new THREE.Group();
    var bodyMat = new THREE.MeshStandardMaterial({ color: colorBody, roughness: 0.45, metalness: 0.25 });
    var trimMat = new THREE.MeshStandardMaterial({ color: colorTrim, roughness: 0.4, metalness: 0.35 });
    var glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.08, metalness: 0.4 });
    var darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 4.2, 12), bodyMat);
    body.rotation.x = Math.PI / 2; body.position.y = 0.95; body.castShadow = true;
    g.add(body);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), bodyMat);
    nose.scale.set(0.95, 0.8, 1.3); nose.position.set(0, 0.9, -2.2);
    g.add(nose);
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 10), glassMat);
    canopy.scale.set(0.9, 0.7, 1.4); canopy.position.set(0, 1.4, -0.6);
    g.add(canopy);
    var wing = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.12, 1.2), bodyMat);
    wing.position.set(0, 0.95, -0.3); wing.castShadow = true;
    g.add(wing);
    var tipL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 1.1), trimMat);
    tipL.position.set(-3.65, 0.95, -0.3);
    g.add(tipL);
    var tipR = tipL.clone(); tipR.position.x = 3.65;
    g.add(tipR);
    var stab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.7), trimMat);
    stab.position.set(0, 1.05, 1.9);
    g.add(stab);
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 1.0), trimMat);
    fin.position.set(0, 1.5, 1.95);
    g.add(fin);
    var prop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.06), darkMat);
    prop.position.set(0, 0.95, -2.85);
    g.add(prop);
    var legMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.7 });
    var tyreMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    [[-0.5, -0.4], [0.5, -0.4], [0, -1.7]].forEach(function (p) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), legMat);
      leg.position.set(p[0], 0.3, p[1]);
      g.add(leg);
      var tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 10), tyreMat);
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(p[0], 0.24, p[1]);
      g.add(tyre);
    });
    return g;
  }

  function buildAirfield(scene, C, f, codeA, codeB, phys) {
    var group = new THREE.Group();
    var hd = f.headingDeg * Math.PI / 180;
    var tex = runwayTexture(codeA, codeB);
    var strip = new THREE.Mesh(
      new THREE.PlaneGeometry(f.width, f.length),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = -hd;
    strip.position.set(f.x, f.elev + 0.25, f.z);
    strip.receiveShadow = true;
    group.add(strip);
    // edge lights
    var lightGeo = new THREE.SphereGeometry(0.55, 8, 6);
    var lightMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc23d, emissiveIntensity: 1.4 });
    var lx = Math.sin(hd), lz = -Math.cos(hd);
    for (var d = -f.length / 2 + 12; d <= f.length / 2 - 8; d += 42) {
      for (var side = -1; side <= 1; side += 2) {
        var dot = new THREE.Mesh(lightGeo, lightMat);
        dot.position.set(f.x + lx * d - lz * side * (f.width / 2 + 2), f.elev + 0.8, f.z + lz * d + lx * side * (f.width / 2 + 2));
        group.add(dot);
      }
    }
    // ---- Halcyon airport complex: PAPI, taxiway, apron, terminal -----
    if (f.code === "HAL") {
      var blobTex = softBlobTexture();
      // PAPI: four light units in a row perpendicular to the runway,
      // beside the touchdown zone on the north side — two white
      // (near the runway) + two red (far): the on-glidepath picture,
      // so the approach reads as a real airport. Each unit sits on
      // its own sampled ground height and carries a glow sprite so
      // the row reads from 300 m out.
      for (var pi = 0; pi < 4; pi++) {
        var pz = f.z - (f.width / 2 + 9 + pi * 9);
        var px = f.x + 55;
        var py = phys ? phys.terrainHeight(px, pz, C) : f.elev;
        var isWhite = pi < 2;
        var lensCol = isWhite ? 0xfff2cc : 0xff2a1a;
        var housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.0),
          new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.4 }));
        housing.position.set(px, py + 0.55, pz);
        housing.castShadow = true;
        group.add(housing);
        var lens = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8),
          new THREE.MeshStandardMaterial({ color: lensCol, emissive: lensCol, emissiveIntensity: 2.4 }));
        lens.position.set(px + 0.8, py + 0.6, pz);
        group.add(lens);
        var papiGlow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: blobTex, color: lensCol, transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        papiGlow.scale.set(5, 5, 1);
        papiGlow.position.set(px + 0.9, py + 0.6, pz);
        group.add(papiGlow);
      }
      // taxiway: parallel strip south of the runway, yellow centreline
      var twTex = taxiwayTexture();
      var taxi = new THREE.Mesh(new THREE.PlaneGeometry(10, 380),
        new THREE.MeshStandardMaterial({ map: twTex, roughness: 0.9 }));
      taxi.rotation.x = -Math.PI / 2;
      taxi.rotation.z = -hd;
      taxi.position.set(f.x + 10, f.elev + 0.2, f.z + 55);
      taxi.receiveShadow = true;
      group.add(taxi);
      // connector back to the runway, holding-short bars at the
      // runway end so the exit reads as a real taxiway
      var connTex = connectorTexture();
      var conn = new THREE.Mesh(new THREE.PlaneGeometry(10, 46),
        new THREE.MeshStandardMaterial({ map: connTex, roughness: 0.9 }));
      conn.rotation.x = -Math.PI / 2;
      conn.position.set(f.x + 150, f.elev + 0.2, f.z + 34);
      conn.receiveShadow = true;
      group.add(conn);
      // apron: concrete slab south of the taxiway
      var apTex = apronTexture();
      var apron = new THREE.Mesh(new THREE.PlaneGeometry(240, 60),
        new THREE.MeshStandardMaterial({ map: apTex, roughness: 0.95 }));
      apron.rotation.x = -Math.PI / 2;
      apron.position.set(f.x - 50, f.elev + 0.15, f.z + 90);
      apron.receiveShadow = true;
      group.add(apron);
      // terminal: pale block with a warm glass front, teal fascia
      // and a side annex, at the west end of the apron so it reads
      // from the approach and from the rollout
      var termMat = new THREE.MeshStandardMaterial({ color: 0xdfe5e8, roughness: 0.7 });
      var termBody = new THREE.Mesh(new THREE.BoxGeometry(60, 11, 16), termMat);
      termBody.position.set(f.x - 70, f.elev + 5.5, f.z + 138);
      termBody.castShadow = true;
      group.add(termBody);
      var termGlass = new THREE.Mesh(new THREE.BoxGeometry(58, 3, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffd9a3, emissive: 0xffb84d, emissiveIntensity: 0.7, roughness: 0.2 }));
      termGlass.position.set(f.x - 70, f.elev + 4.5, f.z + 129.8);
      group.add(termGlass);
      var termFascia = new THREE.Mesh(new THREE.BoxGeometry(60, 1.2, 16.4),
        new THREE.MeshStandardMaterial({ color: 0x0f6f6a, roughness: 0.5 }));
      termFascia.position.set(f.x - 70, f.elev + 10.2, f.z + 138);
      group.add(termFascia);
      var annex = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 12), termMat);
      annex.position.set(f.x - 32, f.elev + 3.5, f.z + 140);
      annex.castShadow = true;
      group.add(annex);
      // jet bridge: terminal front to the parked plane's door
      var bridge = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 22),
        new THREE.MeshStandardMaterial({ color: 0xcfd8de, roughness: 0.6, metalness: 0.2 }));
      bridge.position.set(f.x - 70, f.elev + 4.2, f.z + 119);
      bridge.castShadow = true;
      group.add(bridge);
      var bridgeLeg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x8a9298, roughness: 0.7 }));
      bridgeLeg.position.set(f.x - 70, f.elev + 1.5, f.z + 109);
      group.add(bridgeLeg);
      // parked aircraft on the apron (two, different liveries)
      var parkedA = buildParkedPlane(0xf3ead6, 0x0f6f6a);
      parkedA.position.set(f.x - 70, f.elev, f.z + 102);
      parkedA.rotation.y = Math.PI; // nose toward the terminal
      group.add(parkedA);
      var parkedB = buildParkedPlane(0xf2ede2, 0xc23a2e);
      parkedB.position.set(f.x - 15, f.elev, f.z + 95);
      parkedB.rotation.y = -Math.PI / 2; // nose east
      group.add(parkedB);
      // ground equipment: fuel truck by plane A, baggage cart by
      // plane B, and cones marking the parking spots
      var truck = new THREE.Group();
      var truckTank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.2, 12),
        new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.35, metalness: 0.5 }));
      truckTank.rotation.z = Math.PI / 2;
      truckTank.position.y = 1.1;
      truck.add(truckTank);
      var truckCab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 1.7),
        new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 }));
      truckCab.position.set(2.3, 0.95, 0);
      truck.add(truckCab);
      var wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
      [[-1.2, 0.85], [1.2, 0.85], [-1.2, -0.85], [2.3, -0.85]].forEach(function (w) {
        var wh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10), wheelMat);
        wh.rotation.x = Math.PI / 2;
        wh.position.set(w[0], 0.34, w[1]);
        truck.add(wh);
      });
      truck.position.set(f.x - 55, f.elev, f.z + 110);
      truck.rotation.y = 0.4;
      truck.castShadow = true;
      group.add(truck);
      var cart = new THREE.Group();
      var cartBed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x0f6f6a, roughness: 0.7 }));
      cartBed.position.y = 0.55;
      cart.add(cartBed);
      var bag1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.9),
        new THREE.MeshStandardMaterial({ color: 0xb98a4a, roughness: 0.9 }));
      bag1.position.set(-0.5, 1.05, 0);
      cart.add(bag1);
      var bag2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x2e6f8e, roughness: 0.9 }));
      bag2.position.set(0.45, 1.0, 0.1);
      cart.add(bag2);
      [[-0.8, 0.55], [0.8, 0.55], [-0.8, -0.55], [0.8, -0.55]].forEach(function (w) {
        var wh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 8), wheelMat);
        wh.rotation.x = Math.PI / 2;
        wh.position.set(w[0], 0.22, w[1]);
        cart.add(wh);
      });
      cart.position.set(f.x - 8, f.elev, f.z + 102);
      cart.rotation.y = -0.5;
      group.add(cart);
      var coneMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.8 });
      [[-78, 94], [-62, 94], [-78, 110], [-62, 110]].forEach(function (cp) {
        var cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 8), coneMat);
        cone.position.set(f.x + cp[0], f.elev + 0.35, f.z + cp[1]);
        group.add(cone);
      });
    }
    // windsock: striped orange/white, streams downwind — its
    // direction is computed from C.WIND, the same wind the HUD
    // shows, so the sock and the readout can never disagree
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6 }));
    pole.position.set(f.x + lz * (f.width / 2 + 12), f.elev + 4, f.z - lx * (f.width / 2 + 12));
    pole.castShadow = true;
    group.add(pole);
    var windTo = ((C.WIND.fromDeg + 180) % 360) * Math.PI / 180;
    var wdx = Math.sin(windTo), wdz = -Math.cos(windTo);
    var sock = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.6, 10, 1, true),
      new THREE.MeshStandardMaterial({ map: windsockTexture(), roughness: 0.8, side: THREE.DoubleSide }));
    sock.rotation.z = -Math.PI / 2 - 0.22; // apex downwind, slight droop
    var sockGroup = new THREE.Group();
    sockGroup.position.set(pole.position.x + wdx * 2.3, f.elev + 7.4, pole.position.z + wdz * 2.3);
    sockGroup.rotation.y = Math.atan2(-wdz, wdx);
    sockGroup.add(sock);
    group.add(sockGroup);
    // hangar + tower for Halcyon only
    if (f.code === "HAL") {
      // hangar fronts onto the apron, west end, with a dark door
      // panel on its north face so it reads as a hangar, not a box
      var hangar = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 16),
        new THREE.MeshStandardMaterial({ color: 0xcfd8de, roughness: 0.7, metalness: 0.25 }));
      hangar.position.set(f.x - 140, f.elev + 4.5, f.z + 92);
      hangar.rotation.y = hd;
      hangar.castShadow = true;
      group.add(hangar);
      var hangarDoor = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.3 }));
      hangarDoor.position.set(f.x - 140, f.elev + 3.5, f.z + 80.8);
      group.add(hangarDoor);
      var tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 14, 8),
        new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 }));
      tower.position.set(f.x + lz * 40, f.elev + 7, f.z - lx * 40);
      tower.castShadow = true;
      group.add(tower);
      var cab = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 7),
        new THREE.MeshStandardMaterial({ color: 0x274b63, roughness: 0.25, metalness: 0.4 }));
      cab.position.set(tower.position.x, f.elev + 15.4, tower.position.z);
      group.add(cab);
      // control-tower read: red band, lit cab windows, antenna + beacon,
      // so the tower reads as a tower and never as a blank monolith
      var band = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.6, 1.6, 8),
        new THREE.MeshStandardMaterial({ color: 0xc23a2e, roughness: 0.8 }));
      band.position.set(tower.position.x, f.elev + 12.6, tower.position.z);
      group.add(band);
      // white band under the red one + a base building, so the tower
      // reads as a tower from the ground as well as from the air
      var bandW = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.65, 1.6, 8),
        new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.8 }));
      bandW.position.set(tower.position.x, f.elev + 10.8, tower.position.z);
      group.add(bandW);
      var towerBase = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 7),
        new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.8 }));
      towerBase.position.set(tower.position.x, f.elev + 1.5, tower.position.z);
      towerBase.castShadow = true;
      group.add(towerBase);
      var cabGlass = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.4, 7.2),
        new THREE.MeshStandardMaterial({ color: 0xffd9a3, emissive: 0xffb84d, emissiveIntensity: 0.9, roughness: 0.2 }));
      cabGlass.position.set(tower.position.x, f.elev + 15.8, tower.position.z);
      group.add(cabGlass);
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5, 5),
        new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.6 }));
      mast.position.set(tower.position.x, f.elev + 19.4, tower.position.z);
      group.add(mast);
      var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2.5 }));
      beacon.position.set(tower.position.x, f.elev + 22, tower.position.z);
      group.add(beacon);
    }
    scene.add(group);
    return { group: group, sock: sock };
  }

  // ---- harbor ------------------------------------------------------------------
  function buildHarbor(scene, C) {
    var group = new THREE.Group();
    var H = C.HARBOR;
    // pier
    var pier = new THREE.Mesh(new THREE.BoxGeometry(46, 1.6, 7),
      new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 1 }));
    pier.position.set(H.x - 30, 1.2, H.z - 46);
    pier.rotation.y = 0.5;
    pier.castShadow = true;
    group.add(pier);
    // boats
    var boats = [];
    var rnd = mulberry32(777);
    for (var i = 0; i < 3; i++) {
      var boat = new THREE.Group();
      var hull = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 3.4),
        new THREE.MeshStandardMaterial({ color: [0xe8e4da, 0x2e6f8e, 0xc25e3a][i], roughness: 0.55 }));
      hull.castShadow = true;
      boat.add(hull);
      var cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2, 2.6),
        new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.6 }));
      cabin.position.set(-0.6, 2, 0);
      boat.add(cabin);
      var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5, 5),
        new THREE.MeshStandardMaterial({ color: 0x8a7a5a }));
      mast.position.set(1.6, 3.4, 0);
      boat.add(mast);
      boat.position.set(H.x - 26 + i * 22, 0.6, H.z - 12 + rnd() * 14);
      boat.rotation.y = 0.4 + rnd() * 0.8;
      group.add(boat);
      boats.push({ g: boat, phase: rnd() * 6.28, baseY: 0.6 });
      // wake: fading white plane behind the boat
      var wakeTex = canvasTexture(64, 128, function (g) {
        var grad = g.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, "rgba(255,255,255,0.55)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad; g.fillRect(0, 0, 64, 128);
      });
      var wake = new THREE.Mesh(new THREE.PlaneGeometry(5, 16),
        new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0.5, depthWrite: false }));
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(boat.position.x - 8, 0.35, boat.position.z);
      wake.rotation.z = boat.rotation.y;
      group.add(wake);
    }
    // drop target rings (floating)
    var targets = [];
    var blob = softBlobTexture();
    for (var j = 0; j < C.HARBOR_TARGETS.length; j++) {
      var t = C.HARBOR_TARGETS[j];
      var ring = new THREE.Mesh(new THREE.TorusGeometry(C.HARBOR.targetR * 0.55, 1.1, 8, 36),
        new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x903a00, emissiveIntensity: 0.5, roughness: 0.5 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(t.x, 0.7, t.z);
      group.add(ring);
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: blob, color: 0xff9540, transparent: true, opacity: 0.25, depthWrite: false }));
      glow.scale.set(34, 34, 1);
      glow.position.set(t.x, 1.2, t.z);
      group.add(glow);
      targets.push({ ring: ring, glow: glow });
    }
    // buoys
    for (var b = 0; b < 6; b++) {
      var buoy = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff5340, roughness: 0.6 }));
      var ang = b * 1.05;
      buoy.position.set(H.x + Math.cos(ang) * 62, 0.5, H.z + Math.sin(ang) * 52);
      group.add(buoy);
    }
    scene.add(group);
    return { group: group, boats: boats, targets: targets };
  }

  // ---- gold rings ------------------------------------------------------------------
  function buildRings(scene, C) {
    var blob = softBlobTexture();
    var rings = [];
    for (var i = 0; i < C.RINGS.length; i++) {
      var r = C.RINGS[i];
      var g = new THREE.Group();
      var torus = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.7, 14, 48),
        new THREE.MeshStandardMaterial({
          color: 0xffc94d, metalness: 0.85, roughness: 0.3,
          emissive: 0xcf8f00, emissiveIntensity: 1.5,
        }));
      torus.castShadow = true;
      g.add(torus);
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: blob, color: 0xffc94d, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.set(r.r * 1.7, r.r * 1.7, 1);
      g.add(glow);
      g.position.set(r.x, r.y, r.z);
      // face the incoming course: look at the previous point (or the start)
      var prev = i === 0 ? C.AIRFIELDS.halcyon : C.RINGS[i - 1];
      g.lookAt(prev.x, prev.y, prev.z);
      scene.add(g);
      rings.push({ group: g, torus: torus, glow: glow, passed: false, baseOp: 0.2 });
    }
    return rings;
  }

  // ---- clouds ------------------------------------------------------------------
  function buildClouds(scene) {
    var tex = cloudTexture();
    var clouds = [];
    var rnd = mulberry32(31337);
    for (var i = 0; i < 36; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xfff0dd, transparent: true, opacity: 0.2 + rnd() * 0.2, depthWrite: false }));
      var s = 100 + rnd() * 160;
      sp.scale.set(s, s * 0.5, 1);
      sp.position.set((rnd() - 0.5) * 3800, 280 + rnd() * 160, (rnd() - 0.5) * 3800);
      scene.add(sp);
      clouds.push({ sp: sp, v: 1.2 + rnd() * 2.2 });
    }
    return clouds;
  }

  // ---- lighthouse on Gull Rock ---------------------------------------------------
  function buildLighthouse(scene, C, phys) {
    var isle = C.ISLANDS[2];
    var h = phys.terrainHeight(isle.cx, isle.cz, C);
    var g = new THREE.Group();
    var tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 16, 10),
      new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.8 }));
    tower.position.y = 8; tower.castShadow = true;
    g.add(tower);
    var band = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 3, 10),
      new THREE.MeshStandardMaterial({ color: 0xc23a2e, roughness: 0.8 }));
    band.position.y = 10;
    g.add(band);
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffdf6a, emissiveIntensity: 2 }));
    lamp.position.y = 17;
    g.add(lamp);
    g.position.set(isle.cx, h, isle.cz);
    scene.add(g);
    return lamp;
  }

  // ---- particles (bursts: ring pops, landing dust, spray) -------------------------
  function makeParticles(scene) {
    var MAX = 700;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(MAX * 3);
    var col = new Float32Array(MAX * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // soft round sparks (not hard squares): a burst must read as golden
    // glitter, never as a white blob hiding the plane
    var mat = new THREE.PointsMaterial({
      size: 1.1, map: softBlobTexture(), vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    var parts = [];
    for (var i = 0; i < MAX; i++) parts.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
    var cursor = 0;
    return {
      burst: function (x, y, z, n, color, speed, up) {
        for (var k = 0; k < n; k++) {
          var p = parts[cursor]; cursor = (cursor + 1) % MAX;
          p.life = 0.7 + Math.random() * 0.7;
          p.x = x; p.y = y; p.z = z;
          var a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI;
          p.vx = Math.cos(a) * Math.cos(e) * speed * (0.4 + Math.random() * 0.8);
          p.vz = Math.sin(a) * Math.cos(e) * speed * (0.4 + Math.random() * 0.8);
          p.vy = (Math.sin(e) + (up || 0.4)) * speed * (0.4 + Math.random() * 0.8);
          p.r = color[0]; p.g = color[1]; p.b = color[2];
        }
      },
      update: function (dt) {
        for (var i = 0; i < MAX; i++) {
          var p = parts[i];
          if (p.life > 0) {
            p.life -= dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            p.vy -= 6 * dt;
            if (p.life <= 0) p.y = -999;
          }
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      },
    };
  }

  // ---- in-world labels ---------------------------------------------------
  // Text sprites for the places that matter: both airfields and the
  // charted isles. They always face the camera and fade out up close
  // (game.js fades them by distance), so they read from the air without
  // ever covering the plane.
  function makeLabelSprite(text) {
    var cv = document.createElement("canvas");
    cv.width = 512; cv.height = 96;
    var g = cv.getContext("2d");
    g.clearRect(0, 0, 512, 96);
    g.font = "bold 52px Arial";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 10; g.strokeStyle = "rgba(8, 20, 34, 0.85)";
    g.strokeText(text, 256, 48);
    g.fillStyle = "rgba(255, 244, 220, 0.95)";
    g.fillText(text, 256, 48);
    var tex = new THREE.CanvasTexture(cv);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false }));
    sp.scale.set(46, 8.6, 1);
    return sp;
  }

  function buildLabels(scene, C, phys) {
    var labels = [];
    function add(text, x, y, z) {
      var sp = makeLabelSprite(text);
      sp.position.set(x, y, z);
      scene.add(sp);
      labels.push(sp);
    }
    var hal = C.AIRFIELDS.halcyon, ncy = C.AIRFIELDS.northCay;
    add("HALCYON FIELD", hal.x, hal.elev + 42, hal.z);
    add("NORTH CAY STRIP", ncy.x, ncy.elev + 36, ncy.z);
    var isles = [
      ["GULL ROCK", 620, -720],
      ["LITTLE HALCYON", -980, 620],
      ["TURTLE ISLET", 180, 980],
    ];
    for (var i = 0; i < isles.length; i++) {
      var is = isles[i];
      add(is[0], is[1], phys.terrainHeight(is[1], is[2], C) + 48, is[2]);
    }
    return labels;
  }

  // ---- build all ------------------------------------------------------------------
  function build(scene, C, phys, quality) {
    quality = quality || "high";
    var sky = buildSky(scene, C, quality);
    var ocean = buildOcean(scene, C, quality);
    buildTerrain(scene, C, phys, quality);
    var treeCount = buildTrees(scene, C, phys);
    var hal = buildAirfield(scene, C, C.AIRFIELDS.halcyon, "27", "09", phys);
    var ncy = buildAirfield(scene, C, C.AIRFIELDS.northCay, "36", "18", phys);
    var harbor = buildHarbor(scene, C);
    var rings = buildRings(scene, C);
    var clouds = buildClouds(scene);
    var lamp = buildLighthouse(scene, C, phys);
    var particles = makeParticles(scene);
    var labels = buildLabels(scene, C, phys);
    return {
      sky: sky, ocean: ocean, rings: rings, clouds: clouds,
      harbor: harbor, lamp: lamp, particles: particles, labels: labels,
      windsocks: [hal.sock, ncy.sock], treeCount: treeCount,
    };
  }

  function update(w, dt, t, quality) {
    updateOcean(w.ocean, t, quality);
    for (var i = 0; i < w.clouds.length; i++) {
      var c = w.clouds[i];
      c.sp.position.x += c.v * dt;
      if (c.sp.position.x > 2000) c.sp.position.x = -2000;
    }
    for (var j = 0; j < w.rings.length; j++) {
      var r = w.rings[j];
      if (!r.passed) {
        var pulse = 1 + Math.sin(t * 2.4 + j) * 0.06;
        r.group.scale.set(pulse, pulse, pulse);
        r.glow.material.opacity = r.baseOp + Math.sin(t * 2.4 + j) * 0.08;
      }
    }
    for (var b = 0; b < w.harbor.boats.length; b++) {
      var bo = w.harbor.boats[b];
      bo.g.position.y = bo.baseY + Math.sin(t * 0.8 + bo.phase) * 0.25;
      bo.g.rotation.z = Math.sin(t * 0.6 + bo.phase) * 0.02;
    }
    w.lamp.material.emissiveIntensity = 1.6 + Math.sin(t * 2.2) * 1.1;
    w.particles.update(dt);
  }

  var api = { build: build, update: update };
  global.SkylaneWorld = api;
})(typeof window !== "undefined" ? window : globalThis);
