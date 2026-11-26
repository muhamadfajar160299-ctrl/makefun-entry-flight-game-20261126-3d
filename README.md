# Skylane Archipelago — Island Air Rally

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/muhamadfajar160299-ctrl/makefun-entry-flight-game-20261126-3d/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/muhamadfajar160299-ctrl/makefun-entry-flight-game-20261126-3d/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A realistic 3D flight game (Three.js / WebGL) over the Halcyon Isles: fly the
sport plane **Kestrel-9** through golden rings, hop between two island
airfields, drop supply crates on the harbor, or just cruise the golden hour.

Entry for the make.fun competition
[Make the best flight game](https://make.fun/bounty/best-flight-game-20261126-0057).

## Play

Open `game/index.html` from any static HTTP server (or run `node serve.ts`
and visit http://localhost:8080). Desktop Chrome, keyboard + mouse, no
network requests, no build step.

- **Throttle:** W / S (or Up / Down) — **Pitch:** Arrow Up / Down —
  **Roll:** Arrow Left / Right — **Yaw:** A / D — **Gear:** G —
  **Flaps:** F — **Camera:** C (chase / cockpit) — **Pause:** P or Esc —
  **Drop crate:** Space (Harbor Drop) — **Mouse:** look / steer assist.
- **Missions (menu):** 1 Golden Gate Run (8 gold rings, then land at Halcyon
  Field) · 2 Twin Strip Hop (strip A → strip B → strip A) · 3 Harbor Drop
  (3 crates on the harbor targets) · 4 Free Flight.
- **Physics:** stall 24 m/s, drag, gear and flap effects, ~227 s of fuel at
  full throttle, damage on hard hits, landing-quality score plus time bonus.
- **HUD:** speed (KT), altitude (FT + AGL), heading + compass tape, distance
  and bearing to the next ring/target, mission progress, fuel and damage
  bars, score, timer, attitude indicator, mission messages.
- **Sound:** synthesized WebAudio — engine, wind, ring chime, touchdown.

## Layout

- `game/` — the game itself: `index.html`, `css/style.css`, `js/*.js`
  (config, physics, world, plane, audio, HUD, missions, main loop) and
  `vendor/three.min.js` (Three.js r128, vendored, MIT).
- `screenshots/` — 4 screenshots taken from the running game.
- `main.ts` — copies `game/` + `screenshots/` to `/output` and writes
  `/output/dossier.json` with `buildDossier` from `vendor/makefun-game.ts`.
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.

## License

MIT — see [LICENSE](LICENSE).
