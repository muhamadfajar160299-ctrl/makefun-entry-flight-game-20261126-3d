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
  C.SUN_AZIMUTH = -2.6;         // sun low in the west-northwest: ~20 deg
                                // off the ring 3->4 leg, so the plane is
                                // lit from the side instead of backlit
  C.SUN_COLOR = 0xffd9a3;
  C.SUN_INTENSITY = 1.35;
  C.HEMI_SKY = 0x9fc4e8;
  C.HEMI_GROUND = 0x8a6b4a;
  C.HEMI_INTENSITY = 0.75;

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
  // WIND readout on the HUD.
  C.WIND = { fromDeg: 270, speedKt: 8 };

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
    parTime: { gate: 150, hop: 240, drop: 210, free: 0 },
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
  ];

  // ---- misc -------------------------------------------------------------------
  C.KT_PER_MS = 1.94384;
  C.FT_PER_M = 3.28084;
  C.GRAVITY = 9.81;
  C.MAX_DAMAGE = 100;

  global.SKYLANE_CONFIG = C;
})(typeof window !== "undefined" ? window : globalThis);
