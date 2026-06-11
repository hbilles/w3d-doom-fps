# Neon Corridors

Neon Corridors is a browser-based Doom-style first-person shooter with a
Blade Runner-inspired neon industrial mood. It is built with TypeScript, Vite,
and Three.js, with gameplay code kept separate from the renderer through a
small `IRenderer` abstraction.

The original design and technical direction live in
[`original-project-plan.md`](original-project-plan.md). This README describes
the current repository and how to run, play, and extend it.

## Current Features

- Doom-like first-person movement with pointer-lock mouse yaw, fast walking,
  running, strafing, wall sliding, and step-up height handling.
- Three.js renderer with textured sector geometry, emissive neon materials,
  bloom, fog, vignette, film grain, chromatic aberration, muzzle flashes, and
  screen shake.
- JSON-authored maps with vertices, linedefs, sectors, things, atmosphere
  settings, lights, doors, keys, pickups, enemies, and barrels.
- Weapons: baton, pistol, shotgun, auto-rifle, and launcher.
- Combat with hitscan weapons, projectile rockets, splash damage, explosive
  barrels, armor absorption, death/respawn flow, and enemy drops.
- Enemies: grunt, enforcer, runner, and heavy, with idle/chase/attack/pain/death
  states, line-of-sight checks, sound alerts, projectile attacks, and basic
  infighting support.
- HUD overlay for health, armor, ammo, weapon name, keys, damage flash, death
  fade, and short gameplay messages.
- Asset-processing scripts for source textures and sprite sheets.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local Vite URL in a browser, usually:

```text
http://localhost:5173/
```

Click the title overlay to start. The game requests pointer lock after the
click so mouse movement can control the camera.

## Scripts

```bash
npm run dev      # Start Vite in development mode
npm run build    # Type-check with tsc, then build with Vite
npm run preview  # Preview the production build locally
```

The project does not currently define a test script.

## Controls

| Action | Control |
| --- | --- |
| Start / resume / restart after death | Click overlay |
| Look | Mouse, horizontal yaw only |
| Move forward / backward | W / S or Up / Down |
| Strafe left / right | A / D or Left / Right |
| Run | Shift |
| Fire | Left mouse or Ctrl |
| Use / activate doors | E or Space |
| Select weapon | 1-5 |
| Cycle weapons | Mouse wheel |
| Pause | Escape, by releasing pointer lock |

## Maps

Maps are loaded from `public/maps/<name>.json`. The default map is `map01`.
You can choose another map with the `map` query parameter:

```text
http://localhost:5173/?map=shooting_range
http://localhost:5173/?map=map02
http://localhost:5173/?map=map03
```

Current maps:

| File | Name | Notes |
| --- | --- | --- |
| `map01.json` | Neon Lobby | Compact first map with basic navigation, lights, one grunt, health, and ammo. |
| `map02.json` | The Descent | Multi-sector layout focused on height changes and atmosphere. |
| `map03.json` | Blade Alley | Rain-enabled angled layout with neon and steam. |
| `shooting_range.json` | Shooting Range | Combat test map with all current enemy classes, weapons, ammo, keys, and barrels. |

## Project Structure

```text
src/
  core/       Game loop, game state, event bus
  renderer/   Three.js renderer, texture/sprite managers, HUD/effects bridge
  world/      Map types, map loader, runtime world helpers
  entities/   Player, enemies, pickups, projectiles, barrels
  systems/    Input, physics, doors, enemy AI
  combat/     Weapon definitions, weapon state machine, hitscan/combat logic
  ui/         2D HUD renderer

public/
  maps/       Runtime map JSON files
  assets/     Processed textures, sprite atlases, and atlas metadata

assets-src/   Raw source textures and sprite sheets
tools/        Asset-processing scripts and atlas configs
```

## Architecture Notes

The main entry point is `src/main.ts`. It creates a `ThreeJSRenderer`, passes it
to `Game`, selects the map from the URL, and wires the title/pause/death overlay
to game state events.

`Game` owns the gameplay loop and coordinates input, physics, doors, weapons,
combat, enemy AI, pickups, projectiles, barrels, HUD state, and respawning. Game
logic depends on the `IRenderer` interface rather than importing Three.js
directly.

`ThreeJSRenderer` turns map data into Three.js geometry, manages world textures,
sprites, lights, atmosphere, post-processing, transient effects, the weapon
viewmodel, and the HUD canvas.

Maps use a Doom-inspired data model:

- `vertices` define the 2D floor plan.
- `linedefs` connect vertices and describe walls, doors, two-sided passages,
  blocking behavior, and optional key requirements.
- `sectors` define floor/ceiling heights, textures, light levels, and specials.
- `things` place the player start, enemies, pickups, lights, barrels, and props.

See `src/world/MapTypes.ts` for the current TypeScript shape.

## Asset Pipeline

Processed runtime assets live in `public/assets`. Raw inputs live in
`assets-src`.

Regenerate environment textures:

```bash
node tools/process-textures.mjs tools/atlas-configs/textures.json
```

Regenerate enemy sprites:

```bash
node tools/process-sheets.mjs tools/atlas-configs/enemies.json
```

Regenerate weapon viewmodel sprites:

```bash
node tools/process-sheets.mjs tools/atlas-configs/viewmodels.json
```

`process-textures.mjs` also rewrites `src/renderer/TextureManifest.ts`, which is
used by the renderer to decide which named map textures should load file-backed
PNG materials and optional emissive maps. Unknown texture names fall back to
procedural materials.

## Implementation Status

`original-project-plan.md` is intentionally broader than the current codebase.
Several core systems are implemented, including movement, sector maps,
renderer abstraction, weapons, enemies, pickups, doors, atmosphere, and the HUD.

Notable planned items that are not currently implemented as full systems:

- Audio and music playback.
- Title/options/difficulty/intermission menus.
- Automap.
- Secret tracking and level progression screens.
- Boss behavior.
- A packaged map editor or validation CLI.

## Development Notes

- The TypeScript configuration is strict and uses bundler-style module
  resolution.
- Runtime map and asset paths are served from `public/` by Vite.
- The game exposes `window.__game` for browser-console inspection and automated
  browser checks.
- If pointer lock is lost, the game pauses and shows the overlay; click to
  resume.
