// config.js — every tunable number and fixed layout fact for
// Skylane Archipelago. One source of truth shared by physics, world,
// missions and HUD. All distances metres, speeds m/s, angles radians.
(function (global) {
  "use strict";

  var C = {};

  // ---- world -------------------------------------------------------------
  C.WORLD_SIZE = 2600;          // terrain plane, centred on (0,0)
  C.SEA_LEVEL = 0;
  C.PEAK_HEIGHT = 155;          // highest terrain, main island
  C.FOG_COLOR = 0xf2c98f;       // warm golden-hour haze
  C.FOG_NEAR = 900;
  C.FOG_FAR = 4200;
  C.SUN_ELEVATION = 0.24;       // low golden-hour sun (~14 deg)
  C.SUN_AZIMUTH = -2.0;         // sun low in the west, ~28 deg north of
                                // due west: the disc itself sits inside
                                // the frame of a westbound approach, so
                                // the golden-hour sun reads as a disc
                                // instead of a glow off-frame, while the
                                // plane stays lit from the front quarter
  C.SUN_COLOR = 0xffd9a3;
  C.SUN_INTENSITY = 1.5;        // stronger key light: deeper modelling
                                // on the airframe and the buildings
  C.HEMI_SKY = 0x9fc4e8;
  C.HEMI_GROUND = 0x8a6b4a;
  C.HEMI_INTENSITY = 0.65;      // a dimmer sky fill lets the sun-side
                                // shadows read, so shapes stop looking flat

  // Islands: [cx, cz, radius, height, seed]. Height falls off smoothly.
  C.ISLANDS = [
    { cx: -380, cz: -260, r: 760, h: 155, seed: 11 },  // Halcyon (main)
    { cx: 780, cz: 560, r: 470, h: 92, seed: 29 },     // North Cay
    { cx: 620, cz: -720, r: 260, h: 48, seed: 47 },    // Gull Rock
    { cx: -980, cz: 620, r: 210, h: 38, seed: 63 },    // Little Halcyon
    { cx: 180, cz: 980, r: 150, h: 22, seed: 81 },     // Turtle Islet
  ];

  // ---- airfields -----------------------------------------------------------
  // Runways are flattened into the terrain. headingDeg: runway direction.
  // clearAlong/clearAcross: the obstacle-free corridor past each runway
  // end (metres). The terrain is carved DOWN to a gentle valley along
  // this corridor, so a runway never ends in a mountainside; low ground
  // (sea, shore) is left alone, never raised.
  C.AIRFIELDS = {
    halcyon: {
      name: "Halcyon Field", code: "HAL",
      x: -40, z: -60, elev: 26, headingDeg: 90,
      length: 430, width: 26, surface: "asphalt",
      clearAlong: 480, clearAcross: 220,
    },
    northCay: {
      name: "North Cay Strip", code: "NCY",
      x: 780, z: 560, elev: 18, headingDeg: 0,
      length: 330, width: 20, surface: "grass",
      clearAlong: 300, clearAcross: 180,
    },
  };

  // Wind: steady sea breeze from the west, so runway 27 is the
  // into-wind runway and the windsock streams east, matching the
  // WIND readout on the HUD. gustKt: the gust band on top of the
  // steady wind — physics.windAt() turns it into a slow, deterministic
  // swell that pushes the plane around and swings the windsock.
  C.WIND = { fromDeg: 270, speedKt: 8, gustKt: 6 };

  // Ground traffic paths at Halcyon Field, relative to the field
  // centre (dx along the runway axis, dz across it): one aircraft
  // taxiing the parallel taxiway, a fuel truck working the apron and
  // a baggage cart shuttling between the terminal and the parked
  // planes. The stepper lives in physics (pure, tested); world.js
  // only moves the meshes.
  C.TRAFFIC = {
    taxi: { dxMin: -150, dxMax: 210, dz: 55, speed: 6, nose: "z-" },
    truck: { dxMin: -155, dxMax: 40, dz: 110, speed: 3, nose: "x+" },
    cart: { dxMin: -68, dxMax: -18, dz: 102, speed: 1.5, nose: "x+" },
  };

  // Where the live traffic stands when a screenshot staging opens:
  // the vehicles are the same moving traffic (same lanes, same
  // stepper), only their start pose is chosen per shot so each one
  // is inside the camera's frame at the moment of the capture. dx
  // is metres east of the field centre; dir is the travel direction.
  // The capture runs on a software rasterizer that advances the
  // traffic on the clamped visual step, so the vehicles barely move
  // between staging and the shot — stage them where they must be
  // seen, not where they would drift to in real time.
  C.TRAFFIC_STAGING = {
    // cover: the taxiing Kestrel holds mid-taxiway, ~65 m ahead of
    // the frozen chase camera, left of the runway — a readable
    // silhouette, not a speck; the truck and cart work the apron
    // in the same frame
    cover: {
      taxi: { dx: 80, dir: -1 },
      truck: { dx: 30, dir: -1 },
      cart: { dx: -18, dir: -1 },
    },
    // landing: the taxiing Kestrel is at the east end of the
    // taxiway, beside the threshold the camera is aimed at
    landing: {
      taxi: { dx: 200, dir: -1 },
      truck: { dx: 0, dir: 1 },
      cart: { dx: -20, dir: 1 },
    },
    // complete: the taxiing Kestrel is alongside the rollout, the
    // truck and cart on the apron to the left of the landed plane
    complete: {
      taxi: { dx: -20, dir: -1 },
      truck: { dx: -20, dir: 1 },
      cart: { dx: -50, dir: 1 },
    },
    // cockpit: the airport is behind the camera; keep the standard
    // opening picture
    cockpit: {
      taxi: { dx: 40, dir: -1 },
      truck: { dx: -155, dir: 1 },
      cart: { dx: -68, dir: 1 },
    },
  };

  // Touchdown dust: a small, short-lived puff of tan dust that
  // settles fast, never a white cloud over the nose. Count, speed
  // and life are all cut back from the old burst, and the colour
  // is dirt, not smoke.
  C.DUST = { count: 12, speed: 3.2, up: 0.25, life: 0.45, color: [0.62, 0.55, 0.42] };

  // In-world label heights above field elevation. Halcyon sits low
  // enough that the label clears the top of the frame in the
  // low chase of the complete shot instead of clipping there.
  C.LABEL_DY = { halcyon: 30, northCay: 36 };

  // No-cloud box around the ring-1 approach leg (the cockpit shot's
  // sightline): a cloud sprite inside it is lifted to the high deck
  // so no white puff ever sits on the nose in the cockpit frame.
  // x/y/z in world metres.
  C.CLOUD_KEEPOUT = { x0: 100, x1: 620, y0: 40, y1: 380, z0: 130, z1: 230 };
  // v6: no tall trees on the ring-1 leg — the ridge trees used to poke
  // across the nose line in the cockpit shot; low scrub stays. Round 4
  // widens the box west to the far ridge and south past the crest,
  // because the two bars that survived round 3 sit on that line
  C.TREE_CORRIDOR = { x0: -150, x1: 580, z0: 90, z1: 280 };

  // Graded apron pad south of Halcyon runway: taxiway, apron,
  // terminal and hangar all sit on ground flattened to field
  // elevation (see physics.terrainHeight).
  C.APRON = { x: -40, z: 19, hw: 210, hl: 69, elev: 26 };

  // Harbor (crate targets): open water on the south shore of Halcyon.
  C.HARBOR = { x: -120, z: 560, targetR: 26 };
  C.HARBOR_TARGETS = [
    { x: -170, z: 590 }, { x: -110, z: 625 }, { x: -55, z: 585 },
  ];

  // Golden Gate Run rings: [x, y, z, radius]. A coastal circuit around
  // Halcyon — over water and low shore, ending east of the field so the
  // final leg is a westbound approach onto runway 27.
  C.RINGS = [
    { x: 150, y: 70, z: 180, r: 16 },
    { x: -40, y: 95, z: 480, r: 16 },
    { x: -420, y: 120, z: 560, r: 15 },
    { x: -850, y: 110, z: 200, r: 15 },
    { x: -900, y: 130, z: -450, r: 16 },
    { x: -450, y: 140, z: -850, r: 15 },
    { x: 150, y: 120, z: -780, r: 16 },
    { x: 330, y: 75, z: -350, r: 16 },
  ];

  // ---- aircraft: Kestrel-9 -------------------------------------------------
  C.PLANE = {
    name: "Kestrel-9",
    stallSpeed: 24,        // m/s — below this the wing stops flying
    maxSpeed: 78,          // m/s level, full throttle (~152 kt)
    cruiseSpeed: 55,
    takeoffSpeed: 28,
    maxThrustAccel: 6.5,   // m/s^2 at full throttle, sea level
    dragK: 0.00105,        // quadratic drag coefficient
    liftAuthority: 1.0,
    rollRate: 1.7,         // rad/s at full aileron
    pitchRate: 0.95,       // rad/s at full elevator
    yawRate: 0.35,         // rad/s rudder
    gearDrag: 0.35,        // extra drag multiplier with gear down
    flapDrag: 0.5,         // extra drag with flaps
    flapLift: 0.18,        // stall speed reduction with flaps
    fuelSeconds: 227,      // full-throttle endurance
    fuelBurnIdle: 0.25,    // burn fraction at idle
    damagePerHardHit: 34,
    crashVSpeed: 9,        // m/s vertical speed that wrecks the plane
    hardVSpeed: 4.5,       // m/s vertical speed that hurts
  };

  // ---- scoring ---------------------------------------------------------------
  C.SCORE = {
    ring: 100,
    crateMax: 150,
    landingMax: 200,
    timeBonusMax: 300,
    parTime: { gate: 150, hop: 240, drop: 210, free: 0, night: 150, emergency: 120, intercept: 300 },
  };

  // ---- combat (v7): nose guns vs enemy drones ------------------------------
  C.COMBAT = {
    gunRange: 520,         // m — tracers reach this far
    gunCooldown: 0.09,     // s between rounds (~11 / s)
    hitRadius: 9,          // m — how close a tracer must pass a drone (matches the 1.5x drone's wingspan)
    bulletSpeed: 260,      // m/s — used to lead a moving drone
    droneHp: 2,            // hits to splash one drone
    droneSpeed: 42,        // m/s cruise on its attack orbit
    maxAlive: 3,           // drones in the air at once
    interceptKills: 5,     // drones to splash in the dogfight mission
    killScore: 150,        // pts per drone splashed
    hitScore: 25,          // pts per tracer hit
    spawnDelay: 2.5,       // s between replacement drones
    lockRange: 800,        // m — HUD lock shows the nearest drone inside this
  };

  // ---- missions ---------------------------------------------------------------
  C.MISSIONS = [
    {
      id: "gate", num: 1, name: "Golden Gate Run",
      brief: "Thread all 8 golden rings over the isles, then bring her home to Halcyon Field. Fast and clean wins the bonus.",
      short: "Fly all 8 golden rings (0/8)",
      short2: "Land at Halcyon Field",
    },
    {
      id: "hop", num: 2, name: "Twin Strip Hop",
      brief: "Depart Halcyon Field, land on the North Cay Strip, then fly back and land home. Two greasers, one rally.",
      short: "Land at North Cay Strip (0/2)",
      short2: "Return and land at Halcyon Field",
    },
    {
      id: "drop", num: 3, name: "Harbor Drop",
      brief: "Three crates, three floating targets in the harbor. Slow to 45 kt, line up over the orange rings and release.",
      short: "Drop crates on the harbor targets (0/3)",
      short2: "Land at Halcyon Field (optional)",
    },
    {
      id: "free", num: 4, name: "Free Flight",
      brief: "No clock, no course. Cruise the golden hour, carve the ridges, and grease a landing when you feel like it.",
      short: "Fly free — enjoy the golden hour",
      short2: "Land anywhere to finish",
    },
    {
      id: "night", num: 5, name: "Night Run — Lights Out",
      brief: "Thread 4 rings in the dark, then follow the runway lights home to Halcyon Field. The PAPI and the edge lights are your only friends.",
      short: "Fly all 4 night rings (0/4)",
      short2: "Land at Halcyon Field, guided by the lights",
      rings: 4, night: true,
    },
    {
      id: "emergency", num: 6, name: "Mayday — Fuel Leak",
      brief: "Fuel is leaking and the gauge is falling fast. Get the Kestrel-9 on the ground — any strip, any field — before the engine quits.",
      short: "Land NOW — fuel leaking",
      short2: "Any safe landing counts",
      fuelStart: 0.35, fuelLeak: 1 / 360,
    },
    {
      id: "intercept", num: 7, name: "Intercept — Dogfight",
      brief: "Enemy drones are raiding the isles. Splash 5 of them, then bring the Kestrel-9 home to Halcyon Field. Hold CLICK or X to fire — the HUD locks the nearest drone.",
      short: "Splash 5 enemy drones (0/5)",
      short2: "Land at Halcyon Field",
      combat: true, kills: 5,
    },
  ];

  // ---- misc -------------------------------------------------------------------
  C.KT_PER_MS = 1.94384;
  C.FT_PER_M = 3.28084;
  C.GRAVITY = 9.81;
  C.MAX_DAMAGE = 100;

  global.SKYLANE_CONFIG = C;
})(typeof window !== "undefined" ? window : globalThis);
