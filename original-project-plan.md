# Neon Corridors — Game Design & Technical Specification

> A Doom-style first-person shooter with Blade Runner (1982) aesthetics, built in TypeScript with Three.js and designed for progressive, phase-based development.

---

## Table of Contents

1. [Vision & Aesthetic](#1-vision--aesthetic)
2. [Architecture Overview](#2-architecture-overview)
3. [Renderer Abstraction Layer](#3-renderer-abstraction-layer)
4. [Map System & Data Format](#4-map-system--data-format)
5. [Player Mechanics](#5-player-mechanics)
6. [Weapon System](#6-weapon-system)
7. [Enemy System](#7-enemy-system)
8. [Game Systems](#8-game-systems)
9. [UI / HUD](#9-ui--hud)
10. [Audio](#10-audio)
11. [Asset Pipeline](#11-asset-pipeline)
12. [Build Phases](#12-build-phases)
13. [Tech Stack & Tooling](#13-tech-stack--tooling)
14. [Appendix: Sample Map JSON](#appendix-a-sample-map-json)

---

## 1. Vision & Aesthetic

### Core Concept

A browser-based FPS that plays like Doom (1993) but looks like the world of Blade Runner (1982). The player navigates dark, rain-soaked corridors and neon-lit interiors, fighting replicant-inspired enemies through atmospheric, moody levels.

### Visual Direction

- **Color palette**: Deep blues, blacks, warm amber/orange neon, cyan accents, occasional red. High contrast between dark environments and bright light sources.
- **Lighting**: Heavy use of colored point lights (neon signs, holographic displays, flickering fluorescents). Dark ambient with pools of vivid light.
- **Textures**: Industrial concrete, wet metal grating, Japanese signage, holographic advertisements, exposed pipes and wiring, rain-streaked glass.
- **Atmosphere**: Fog/haze in corridors, volumetric light shafts where possible, particle effects for rain and steam.

### Gameplay Feel

- Fast, fluid movement (Doom-speed, not modern military shooter pace)
- No vertical aiming (autoaim on vertical axis, like Doom)
- Satisfying, punchy weapons with screen shake and muzzle flash
- Exploration rewarded with secrets and resources
- Escalating difficulty through enemy composition rather than bullet-sponge scaling

---

## 2. Architecture Overview

### High-Level Structure

```
src/
├── core/
│   ├── Game.ts              # Main game loop, state machine
│   ├── GameState.ts          # Enum: MENU, PLAYING, PAUSED, DEAD, LEVEL_COMPLETE
│   └── EventBus.ts           # Pub/sub for decoupled communication
├── renderer/
│   ├── IRenderer.ts          # Renderer interface (abstraction layer)
│   ├── ThreeJSRenderer.ts    # Three.js implementation
│   └── RenderTypes.ts        # Shared types (RenderableEntity, Light, etc.)
├── world/
│   ├── MapLoader.ts          # Parses JSON map format
│   ├── World.ts              # Runtime world state (walls, sectors, entities)
│   └── BSP.ts                # Optional: spatial partitioning for collision/visibility
├── entities/
│   ├── Player.ts             # Player state, input handling, physics
│   ├── Enemy.ts              # Base enemy class
│   ├── EnemyTypes.ts         # Specific enemy definitions
│   ├── Projectile.ts         # Projectile entities
│   └── Pickup.ts             # Items, ammo, health, keys
├── systems/
│   ├── InputSystem.ts        # Keyboard + mouse input abstraction
│   ├── PhysicsSystem.ts      # Movement, collision detection, triggers
│   ├── CombatSystem.ts       # Damage calculation, hitscan, projectiles
│   ├── AISystem.ts           # Enemy behavior, pathfinding
│   └── AudioSystem.ts        # Sound effect and music playback
├── ui/
│   ├── HUD.ts                # In-game overlay (health, ammo, face, keys)
│   ├── Menu.ts               # Title screen, pause menu
│   └── Intermission.ts       # Level complete screen
├── assets/
│   ├── textures/             # Wall, floor, ceiling, sprite textures
│   ├── sprites/              # Enemy and weapon sprite sheets
│   ├── sounds/               # SFX files
│   └── music/                # Background music tracks
└── maps/
    ├── map01.json            # Level data files
    ├── map02.json
    └── map03.json
```

### Design Principles

- **Game logic never imports Three.js.** All rendering goes through `IRenderer`.
- **Entity-component-ish**: Not a full ECS, but entities are data objects and systems operate on them. Keep it simple — this isn't a general-purpose engine.
- **Event-driven communication**: Use `EventBus` for cross-system events (enemy died, door opened, player took damage) to avoid tight coupling.
- **Frame-rate independent**: All movement and timers use delta time.

---

## 3. Renderer Abstraction Layer

This is the most architecturally important piece. The goal: be able to swap Three.js for a raycaster, WebGPU, or anything else without touching game logic.

### IRenderer Interface

```typescript
interface IRenderer {
  // Lifecycle
  init(canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;

  // Per-frame
  beginFrame(): void;
  render(camera: CameraState, renderables: RenderableEntity[], lights: LightState[]): void;
  endFrame(): void;

  // World geometry
  loadMap(mapData: MapData): void;
  unloadMap(): void;

  // Dynamic entities
  addSprite(id: string, config: SpriteConfig): void;
  updateSprite(id: string, position: Vec3, frame: number): void;
  removeSprite(id: string): void;

  // Effects
  setAmbientLight(color: Color, intensity: number): void;
  addPointLight(id: string, position: Vec3, color: Color, intensity: number, distance: number): void;
  removePointLight(id: string): void;
  setFog(color: Color, near: number, far: number): void;
  screenShake(intensity: number, duration: number): void;

  // HUD (2D overlay)
  drawHUD(hudState: HUDState): void;

  // Resize handling
  resize(width: number, height: number): void;
}
```

### Key Types

```typescript
interface CameraState {
  position: Vec3;
  yaw: number;      // Horizontal rotation only (no pitch — Doom style)
  fov: number;
  height: number;   // Eye height (for crouching if ever added)
}

interface RenderableEntity {
  id: string;
  type: 'sprite' | 'decal' | 'particle';
  position: Vec3;
  spriteSheet: string;
  frame: number;
  scale: number;
  billboard: boolean;  // Always face camera (true for enemies/pickups)
}

interface LightState {
  id: string;
  position: Vec3;
  color: Color;
  intensity: number;
  distance: number;   // Falloff distance
  flicker?: boolean;
}

interface Vec3 { x: number; y: number; z: number; }
interface Color { r: number; g: number; b: number; }
```

### Three.js Implementation Notes

- Use `THREE.Mesh` with `BoxGeometry` or custom geometry for walls/floors/ceilings
- Enemies and pickups as `THREE.Sprite` or billboard quads
- `THREE.PointLight` for neon/colored lighting
- `THREE.FogExp2` for atmospheric haze
- Post-processing with `EffectComposer`: bloom (for neon glow), film grain, optional CRT scanlines
- Raycaster for mouse picking / hitscan visualization

---

## 4. Map System & Data Format

### Map JSON Schema

Maps are defined in JSON for easy authoring by both humans and LLMs. The format supports non-orthogonal geometry (Doom-style sectors).

```typescript
interface MapData {
  name: string;
  author: string;
  music: string;                     // Music track filename
  ambientLight: Color;
  fogColor: Color;
  fogDensity: number;

  // Vertices define the 2D floor plan (x, z coordinates)
  vertices: [number, number][];      // Array of [x, z] pairs

  // Linedefs connect vertices and optionally reference sectors on each side
  linedefs: LineDef[];

  // Sectors define floor/ceiling heights and textures for enclosed areas
  sectors: Sector[];

  // Things are entities placed in the world
  things: Thing[];
}

interface LineDef {
  v1: number;                        // Start vertex index
  v2: number;                        // End vertex index
  frontSector: number | null;        // Sector on front side
  backSector: number | null;         // Sector on back side (null = solid wall)
  frontTexture: TextureDef | null;   // Upper/middle/lower textures
  backTexture: TextureDef | null;
  flags: LineFlags;                  // Solid, door, secret, etc.
}

interface TextureDef {
  upper: string | null;              // Texture name
  middle: string | null;
  lower: string | null;
}

interface Sector {
  id: number;
  floorHeight: number;
  ceilingHeight: number;
  floorTexture: string;
  ceilingTexture: string;
  lightLevel: number;                // 0.0 to 1.0
  special: SectorSpecial | null;     // Damage floor, secret, etc.
}

interface Thing {
  type: ThingType;                   // PLAYER_START, ENEMY_GRUNT, HEALTH_PACK, etc.
  position: [number, number];        // x, z
  angle: number;                     // Facing direction in degrees
  flags: ThingFlags;                 // Difficulty flags, ambush flag
}

enum ThingType {
  // Player
  PLAYER_START = 1,

  // Enemies
  ENEMY_GRUNT = 100,                 // Basic ranged enemy
  ENEMY_ENFORCER = 101,              // Tougher ranged enemy, more HP
  ENEMY_RUNNER = 102,                // Fast melee enemy
  ENEMY_HEAVY = 103,                 // Slow, high damage, lots of HP
  ENEMY_BOSS = 104,                  // Boss enemy

  // Weapons
  WEAPON_SHOTGUN = 200,
  WEAPON_AUTOMATIC = 201,
  WEAPON_LAUNCHER = 202,

  // Ammo
  AMMO_BULLETS = 300,
  AMMO_SHELLS = 301,
  AMMO_ROCKETS = 302,
  AMMO_BULLETS_BOX = 303,

  // Health & Armor
  HEALTH_SMALL = 400,                // +10 HP
  HEALTH_MEDIUM = 401,               // +25 HP
  HEALTH_LARGE = 402,                // +50 HP
  ARMOR_GREEN = 410,                 // +100 armor, 1/3 absorption
  ARMOR_BLUE = 411,                  // +200 armor, 1/2 absorption

  // Keys
  KEY_RED = 500,
  KEY_BLUE = 501,
  KEY_YELLOW = 502,

  // Decorative
  LIGHT_NEON = 600,                  // Neon light source
  LIGHT_FLICKER = 601,               // Flickering light
  BARREL_EXPLOSIVE = 602,
  PROP_TERMINAL = 603,               // Computer terminal (decorative)
  PROP_HOLOGRAM = 604,               // Holographic display
}

interface LineFlags {
  impassable: boolean;               // Blocks player/enemy movement
  blockMonsters: boolean;
  twoSided: boolean;                 // Sector on both sides
  secret: boolean;                   // Push-wall secret
  door: boolean;                     // Opens when activated
  doorKeyRequired?: 'red' | 'blue' | 'yellow';
  triggerAction?: string;            // Event to fire when crossed/activated
}
```

### Level Design Guidelines for LLM Map Generation

When generating maps, follow these principles:

1. **Start simple**: First maps should be small (10-20 rooms) with clear progression paths.
2. **Loop architecture**: Good levels have loops — the player should be able to circle back to earlier areas. Avoid pure linear corridors.
3. **Height variation**: Use sectors at different floor heights to create stairs, raised platforms, and sunken areas.
4. **Lighting contrast**: Alternate between dark corridors and brightly lit rooms. Use neon lights as wayfinding.
5. **Combat arenas**: Open rooms for major fights, tight corridors for tense encounters.
6. **Resource pacing**: Place health and ammo before and after major combat encounters, not during.
7. **One secret per map minimum**: Hidden push-walls or hard-to-reach areas with bonus items.
8. **Key-and-door gating**: Use colored keys to gate progression. The key should be visible or findable before the corresponding door.
9. **Blade Runner atmosphere**: Include decorative neon signs, holographic displays, computer terminals, and rain effects in outdoor-adjacent sectors.

---

## 5. Player Mechanics

### Movement

| Property | Value | Notes |
|----------|-------|-------|
| Walk speed | 8 units/sec | Slightly faster than Doom's walk |
| Run speed | 14 units/sec | Hold Shift to run |
| Strafe speed | 8 units/sec | Same as walk |
| Turn speed (keyboard) | 180°/sec | Mouse overrides this |
| Mouse sensitivity | Configurable | Default: 0.002 rad/pixel |
| Player radius | 0.5 units | Collision cylinder |
| Player height | 1.8 units | Eye height at 1.6 |
| Step height | 0.4 units | Max step-up without jumping |

### Controls

| Action | Primary | Secondary |
|--------|---------|-----------|
| Move forward | W | ↑ |
| Move backward | S | ↓ |
| Strafe left | A | |
| Strafe right | D | |
| Turn left | | ← |
| Turn right | | → |
| Run | Shift | |
| Fire | Left Mouse | Ctrl |
| Use/Activate | E | Space |
| Weapon 1-5 | 1-5 | |
| Next weapon | Scroll Up | |
| Prev weapon | Scroll Down | |
| Pause | Escape | |
| Automap | Tab | |

### Collision Detection

- Player is a vertical cylinder (radius 0.5, height 1.8 units)
- Slide along walls on collision (project velocity along wall normal)
- Step up geometry ≤ 0.4 units automatically
- Cannot pass through linedefs flagged `impassable` or single-sided linedefs
- Can cross two-sided linedefs if ceiling gap ≥ player height and floor step ≤ step height

---

## 6. Weapon System

All weapons are hitscan except the launcher. No reloading mechanic (Doom-style).

### Weapons Table

| # | Weapon | Damage | Rate of Fire | Ammo Type | Ammo/Shot | Notes |
|---|--------|--------|--------------|-----------|-----------|-------|
| 1 | Baton | 10-20 | 2/sec | None | — | Melee, random damage range |
| 2 | Pistol | 10 | 3/sec | Bullets | 1 | Starting weapon, perfectly accurate |
| 3 | Shotgun | 7×7 | 1.1/sec | Shells | 1 | 7 pellets in spread pattern, 7 dmg each |
| 4 | Auto-Rifle | 8 | 8/sec | Bullets | 1 | Slight spread, full-auto |
| 5 | Launcher | 80 direct + 60 splash | 0.8/sec | Rockets | 1 | Projectile, 3 unit splash radius. Self-damage. |

### Weapon State Machine

Each weapon cycles through states with fixed frame durations:

```
READY → FIRE → (hitscan/projectile created) → RECOVERY → READY
```

- **READY**: Weapon bobbing idle. Can fire.
- **FIRE**: Muzzle flash frame. Damage applied (hitscan) or projectile spawned.
- **RECOVERY**: Weapon lowering/pumping animation. Cannot fire.
- Weapon switching: READY → LOWER → RAISE → READY (0.3s each)

### Ammo Limits

| Ammo Type | Starting | Max |
|-----------|----------|-----|
| Bullets | 50 | 200 |
| Shells | 0 | 50 |
| Rockets | 0 | 50 |

---

## 7. Enemy System

### Enemy Types

| Type | HP | Speed | Attack | Damage | Range | Behavior |
|------|-----|-------|--------|--------|-------|----------|
| Grunt | 30 | 4 u/s | Hitscan | 5-15 | ∞ | Patrol → Chase → Attack |
| Enforcer | 80 | 3 u/s | Hitscan | 10-20 | ∞ | Patrol → Chase → Attack (more accurate) |
| Runner | 50 | 8 u/s | Melee | 15-25 | 2u | Patrol → Sprint to player → Slash |
| Heavy | 200 | 2 u/s | Projectile | 40 splash | ∞ | Patrol → Chase → Fire slow projectile |
| Boss | 1000 | 3 u/s | Mixed | Varies | ∞ | Multiple attack patterns, spawns minions |

### AI State Machine (Doom-style)

```
IDLE → (see/hear player) → CHASE → (in range) → ATTACK → (cooldown) → CHASE
  ↑                                    |
  └──── (lost player for 5s) ──────────┘

Pain state: Any state → PAIN (interrupts current action, 0.2s stun) → return to CHASE
Death: Any state → DEATH (play death animation, become non-solid, drop item)
```

### AI Details

- **Line of sight**: Raycast from enemy to player. Blocked by solid linedefs and closed doors.
- **Sound propagation**: When the player fires, enemies within a radius (configurable per-weapon, typically 30 units) enter CHASE state even without line of sight. Sound blocked by closed doors.
- **Infighting**: If an enemy is hit by another enemy's projectile, it retaliates against the attacker (Doom behavior).
- **Pain chance**: Each enemy type has a probability of entering PAIN state when hit (Grunt: 80%, Enforcer: 40%, Heavy: 10%, Runner: 60%, Boss: 5%).
- **Pathfinding**: Simple: walk toward player, slide along walls. No A* needed — Doom didn't use it. Enemies can open doors.
- **Ambush flag**: Things placed with the ambush flag don't respond to sound, only line of sight. Use for surprise encounters.

---

## 8. Game Systems

### Health & Armor

- Player starts with 100 HP, 0 Armor
- Max HP: 100 (200 with special pickups)
- Armor absorbs a percentage of damage:
  - Green armor: absorbs 1/3 of damage (up to 100 points)
  - Blue armor: absorbs 1/2 of damage (up to 200 points)
- Damage calculation: `actualDamage = incomingDamage × (1 - armorAbsorption)`, remainder deducted from armor points

### Doors

- Activated by pressing Use (E) on a door linedef while within 2 units
- Door opens upward over 0.5s (ceiling of door sector rises)
- Stays open for 4s, then closes over 0.5s
- Blocked from closing if player/enemy is in the sector
- Locked doors require matching key color. Display "You need the [color] key" message if missing.

### Secrets

- Linedefs flagged `secret` are push-walls: pressing Use slides the wall backward, revealing a hidden area
- Track secrets found vs total (display on intermission screen)

### Level Progression

- Each level has an exit switch/linedef
- Touching/activating it ends the level, triggers intermission screen
- Intermission shows: time, kills (x/total), items (x/total), secrets (x/total)
- Then load next map

### Difficulty Levels

- **Easy**: Fewer enemies (skip things with `hard_only` flag), double ammo pickups
- **Normal**: Standard enemy and item placement
- **Hard**: All enemies placed, enemies do 1.5x damage

---

## 9. UI / HUD

### In-Game HUD (Doom-style status bar)

```
┌─────────────────────────────────────────────────────┐
│                   GAME VIEWPORT                      │
│                                                      │
│                                                      │
│                                                      │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│  AMMO    │  HEALTH  │  FACE    │  ARMOR   │  KEYS   │
│  [120]   │  [100%]  │  [😐]   │  [45%]   │ [R][B]  │
├──────────┴──────────┴──────────┴──────────┴─────────┤
│  ARMS: [1] [2] [3] [4] [5]     CURRENT AMMO TYPE   │
└─────────────────────────────────────────────────────┘
```

- **Face**: Animated face showing player status. Looks left/right when hit from that direction. Gets progressively bloodier as health drops. Grins when picking up a new weapon. Evil grin when finding a secret.
- **Ammo counter**: Large numeric display of current weapon's ammo
- **Health/Armor**: Percentage displays
- **Keys**: Show collected key icons
- **Arms**: Weapon slot numbers, highlighted for owned weapons

### Menus

- **Title Screen**: Game logo, "New Game", "Options", animated Blade Runner-esque cityscape background
- **Difficulty Select**: Easy / Normal / Hard
- **Pause Menu**: Resume, Options, Quit to Title
- **Options**: Mouse sensitivity, volume sliders, toggle screen effects
- **Death Screen**: Red flash, "You are dead" text, "Restart Level" / "Quit"

### Automap

- Toggle with Tab
- Top-down wireframe view of discovered geometry
- Player position and direction shown as arrow
- Color-coded lines: white (walls), yellow (height changes), red (locked doors), green (discovered secrets)

---

## 10. Audio

### Sound Effects (priorities)

| Sound | Trigger | Notes |
|-------|---------|-------|
| Pistol fire | Weapon fire | Sharp, punchy |
| Shotgun fire | Weapon fire | Deep boom |
| Auto-rifle fire | Weapon fire | Rapid staccato |
| Launcher fire | Weapon fire | Whoosh |
| Explosion | Rocket impact | Boom + debris |
| Door open/close | Door activation | Mechanical sliding |
| Enemy sight | Enemy enters CHASE | Distinct per enemy type |
| Enemy pain | Enemy enters PAIN | |
| Enemy death | Enemy dies | |
| Enemy attack | Enemy fires/slashes | |
| Player pain | Player takes damage | Grunt/oof |
| Player death | Player dies | |
| Pickup item | Collect health/ammo/key | Satisfying chime |
| Pickup weapon | Collect new weapon | More dramatic chime |
| Secret found | Push-wall activated | Distinctive sound |
| Switch activated | Use on switch | Click |
| No key | Use on locked door | Buzz/denial sound |

### Music

- Background music per level (looping)
- Synthwave / Vangelis-inspired ambient tracks for Blade Runner feel
- Different track for boss levels
- Intermission screen has its own short track
- Title screen has a moody ambient piece

### Audio Implementation

- Use Web Audio API through `AudioSystem`
- No spatial audio required — simple distance-based volume attenuation
- Music and SFX have independent volume controls
- Preload all sounds for current level during map load

---

## 11. Asset Pipeline

### Texture Format

- PNG files, power-of-2 dimensions recommended (64×64, 128×128, 256×256)
- Wall textures: 128×128 or 256×256
- Floor/ceiling: 64×64 (tiled)
- Sprite sheets: variable size, metadata in JSON

### Sprite Sheet Format

```typescript
interface SpriteSheetMeta {
  image: string;           // Filename
  frameWidth: number;
  frameHeight: number;
  animations: {
    [name: string]: {      // "walk", "attack", "pain", "death", "idle"
      frames: number[];    // Frame indices
      fps: number;
      loop: boolean;
    }
  };
}
```

### Asset Manifest

Each level references its required assets. Assets are loaded at level start.

```typescript
interface AssetManifest {
  textures: { [name: string]: string };    // name → path
  sprites: { [name: string]: SpriteSheetMeta };
  sounds: { [name: string]: string };
  music: string;
}
```

### Customization

The asset pipeline is designed so that reskinning the game requires only:
1. Replacing PNG files in `assets/textures/` and `assets/sprites/`
2. Updating sprite sheet metadata JSON if frame counts change
3. No code changes required

---

## 12. Build Phases

### Phase 1 — Foundation & Movement (Milestone: "Walking Simulator")

**Goal**: A player can walk through a 3D level with textured walls, floors, and ceilings. The renderer abstraction is proven.

**Tasks**:
1. Project scaffolding (Vite + TypeScript + Three.js)
2. Define `IRenderer` interface and `RenderTypes`
3. Implement `ThreeJSRenderer` — load a simple box room with textured walls, floor, ceiling
4. Implement `InputSystem` — capture keyboard and mouse (pointer lock)
5. Implement `Player.ts` — position, yaw rotation, WASD movement, mouse look (yaw only)
6. Implement `PhysicsSystem` — wall collision detection with wall sliding
7. Implement `MapLoader` — parse JSON map format, generate geometry
8. Create 3 test maps:
   - **Map 1**: Simple rectangular rooms connected by corridors (tests basic navigation)
   - **Map 2**: Height variation — stairs, raised platforms, sunken areas (tests step-up and multi-height sectors)
   - **Map 3**: Non-orthogonal geometry — angled walls, irregular room shapes
9. Basic colored lighting (place neon point lights in maps)
10. Fog/haze
11. Game loop with delta time

**Deliverable**: Player can walk and look around three textured levels with colored lighting and fog. Collision works. No enemies, no weapons, no HUD.

---

### Phase 2 — Weapons & Interaction (Milestone: "Shooting Range")

**Goal**: The player has weapons and can interact with the world. Doors open, pickups can be collected, weapons fire.

**Tasks**:
1. Implement weapon state machine (ready/fire/recovery)
2. Implement pistol (hitscan raycast on fire, hit detection against walls)
3. Add weapon viewmodel rendering (2D sprite overlay on screen — the weapon graphic at bottom of viewport)
4. Muzzle flash effect (point light flash + sprite)
5. Screen shake on fire
6. Add shotgun (spread hitscan)
7. Add auto-rifle (rapid fire hitscan)
8. Add launcher (projectile entity, splash damage on impact)
9. Add melee weapon (short-range hitscan)
10. Weapon switching (number keys, scroll wheel)
11. Implement door system (use key to open, auto-close timer)
12. Implement pickup entities (ammo, health — walk over to collect)
13. Basic ammo/health tracking on player
14. Add destructible barrels (take damage, explode when destroyed)
15. Create shooting range test map with targets, all weapon pickups, doors, explosive barrels

**Deliverable**: Player can switch weapons, shoot targets/barrels, open doors, collect pickups. Weapons feel satisfying with effects and screen shake.

---

### Phase 3 — Enemies & Combat (Milestone: "It's a Game")

**Goal**: Enemies populate the world with Doom-style AI. The core gameplay loop works.

**Tasks**:
1. Implement base enemy entity (position, HP, state machine, sprite rendering)
2. Billboard sprite rendering for enemies (always face camera)
3. Implement IDLE state (stand or patrol between waypoints)
4. Implement line-of-sight check (raycast enemy → player)
5. Implement CHASE state (move toward player, wall sliding)
6. Implement ATTACK state (hitscan enemies fire at player)
7. Implement PAIN state (stun animation, pain chance)
8. Implement DEATH state (death animation, become non-solid, drop items)
9. Sound propagation (gunfire alerts nearby enemies)
10. Implement Grunt enemy type
11. Implement Runner enemy type (melee, fast)
12. Implement Enforcer enemy type (tougher ranged)
13. Implement Heavy enemy type (projectile attacks)
14. Infighting (enemies hit by other enemies' projectiles retaliate)
15. Enemy projectile entities (for Heavy enemy)
16. Ambush flag behavior
17. Create combat test map featuring all enemy types in varied encounters

**Deliverable**: Full combat loop — enemies patrol, detect player, chase, attack, take damage, die. Multiple enemy types with distinct behaviors. Infighting works.

---

### Phase 4 — Game Loop & Polish (Milestone: "Shippable v1")

**Goal**: Complete game experience from title screen to level completion. Blade Runner aesthetic fully realized.

**Tasks**:
1. Implement `GameState` state machine (MENU → PLAYING → PAUSED → DEAD → LEVEL_COMPLETE → MENU)
2. Title screen with menu
3. Difficulty selection (adjusts enemy count and damage)
4. HUD implementation (Doom-style status bar with face, ammo, health, armor, keys)
5. HUD face animation (damage direction, health states, weapon pickup grin, secret grin)
6. Armor system (pickup, damage absorption)
7. Key and locked door system (red, blue, yellow)
8. Secret push-walls
9. Level exit trigger → intermission screen (kills/items/secrets/time)
10. Level transitions (load next map on intermission dismiss)
11. Death screen and restart
12. Automap (Tab toggle, wireframe top-down view)
13. Sound effects — all weapon sounds, enemy sounds, UI sounds
14. Music system — per-level background tracks
15. Post-processing: bloom (neon glow), film grain, optional CRT scanlines
16. Rain particle effect for outdoor-adjacent areas
17. Pause menu
18. Options menu (sensitivity, volume)
19. Create 3 full game levels with Blade Runner aesthetic:
    - **Level 1**: Rainy streets and a neon-lit bar (introductory, mostly Grunts and Runners)
    - **Level 2**: Corporate tower interior — offices, server rooms, elevators (Enforcers and Heavies introduced)
    - **Level 3**: Underground replicant facility — industrial, dark, boss fight at end
20. Balancing pass (health/ammo placement, enemy counts, difficulty curve)

**Deliverable**: Complete, playable game with 3 levels, full HUD, menus, audio, and polished Blade Runner visuals.

---

### Phase 5 — Level Editor (Future)

**Goal**: Visual browser-based level editor that reads/writes the same JSON map format.

**Planned Features**:
- 2D top-down editing canvas
- Draw vertices, connect with linedefs, define sectors
- Set sector properties (heights, textures, light)
- Set linedef properties (textures, flags, door/secret)
- Place things (enemies, items, lights, decorations)
- Drag-and-drop from a thing palette
- Real-time 3D preview (reuse the game renderer)
- Export/import JSON
- Undo/redo
- Grid snap with configurable grid size

---

## 13. Tech Stack & Tooling

| Tool | Purpose |
|------|---------|
| TypeScript | Primary language |
| Vite | Build tool / dev server / HMR |
| Three.js | 3D rendering (behind abstraction) |
| Web Audio API | Sound and music |
| HTML5 Canvas | HUD overlay (2D drawing on top of WebGL) |
| ESLint + Prettier | Code quality |
| Vitest | Unit testing (collision, damage calc, AI states) |

### Browser Requirements

- Chrome, Firefox, Safari, Edge (all modern versions)
- WebGL 2.0 required
- Pointer Lock API required (for mouse look)

### Dev Server

- `npm run dev` starts Vite dev server with HMR
- `npm run build` produces optimized production bundle
- Maps loadable via URL parameter: `?map=map02` for quick testing

---

## Appendix A: Sample Map JSON

A minimal test map showing a two-room level connected by a door.

```json
{
  "name": "Test Map 01",
  "author": "LLM Generated",
  "music": "ambient_rain.ogg",
  "ambientLight": { "r": 0.05, "g": 0.05, "b": 0.1 },
  "fogColor": { "r": 0.02, "g": 0.02, "b": 0.05 },
  "fogDensity": 0.03,

  "vertices": [
    [0, 0],
    [8, 0],
    [8, 8],
    [0, 8],
    [3, 8],
    [5, 8],
    [3, 10],
    [5, 10],
    [0, 10],
    [8, 10],
    [8, 18],
    [0, 18]
  ],

  "sectors": [
    {
      "id": 0,
      "floorHeight": 0,
      "ceilingHeight": 4,
      "floorTexture": "floor_metal_grate",
      "ceilingTexture": "ceiling_pipes",
      "lightLevel": 0.4,
      "special": null
    },
    {
      "id": 1,
      "floorHeight": 0,
      "ceilingHeight": 4,
      "floorTexture": "floor_concrete_wet",
      "ceilingTexture": "ceiling_industrial",
      "lightLevel": 0.2,
      "special": null
    },
    {
      "id": 2,
      "floorHeight": 0,
      "ceilingHeight": 4,
      "floorTexture": "floor_metal_grate",
      "ceilingTexture": "ceiling_pipes",
      "lightLevel": 0.3,
      "special": null
    }
  ],

  "linedefs": [
    { "v1": 0, "v2": 1, "frontSector": 0, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 1, "v2": 2, "frontSector": 0, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 0, "v2": 3, "frontSector": 0, "backSector": null, "frontTexture": { "middle": "wall_neon_blue" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 3, "v2": 4, "frontSector": 0, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 5, "v2": 2, "frontSector": 0, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 4, "v2": 5, "frontSector": 0, "backSector": 1, "frontTexture": { "middle": "door_metal" }, "backTexture": { "middle": "door_metal" }, "flags": { "twoSided": true, "door": true } },
    { "v1": 4, "v2": 6, "frontSector": 1, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 5, "v2": 7, "frontSector": 1, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 6, "v2": 8, "frontSector": 2, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 7, "v2": 9, "frontSector": 2, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 8, "v2": 11, "frontSector": 2, "backSector": null, "frontTexture": { "middle": "wall_neon_pink" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 9, "v2": 10, "frontSector": 2, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 11, "v2": 10, "frontSector": 2, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 6, "v2": 7, "frontSector": 1, "backSector": 2, "frontTexture": null, "backTexture": null, "flags": { "twoSided": true } },
    { "v1": 8, "v2": 6, "frontSector": 2, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } },
    { "v1": 7, "v2": 9, "frontSector": 2, "backSector": null, "frontTexture": { "middle": "wall_concrete" }, "backTexture": null, "flags": { "impassable": true } }
  ],

  "things": [
    { "type": 1, "position": [4, 4], "angle": 0, "flags": {} },
    { "type": 100, "position": [4, 14], "angle": 180, "flags": {} },
    { "type": 400, "position": [2, 12], "angle": 0, "flags": {} },
    { "type": 300, "position": [6, 12], "angle": 0, "flags": {} },
    { "type": 600, "position": [0.5, 4], "angle": 0, "flags": {} },
    { "type": 600, "position": [4, 17], "angle": 0, "flags": {} }
  ]
}
```

---

## Appendix B: Naming Conventions

| Concept | Convention | Example |
|---------|-----------|---------|
| Files | PascalCase.ts | `ThreeJSRenderer.ts` |
| Interfaces | PascalCase, I-prefix for abstractions | `IRenderer`, `MapData` |
| Classes | PascalCase | `Player`, `AudioSystem` |
| Functions | camelCase | `loadMap()`, `calculateDamage()` |
| Constants | UPPER_SNAKE | `MAX_HEALTH`, `PLAYER_SPEED` |
| Map JSON keys | camelCase | `floorHeight`, `frontSector` |
| Texture names | snake_case | `wall_neon_blue`, `floor_metal_grate` |
| Event names | dot.separated | `enemy.died`, `player.damage`, `door.opened` |

---

*This spec is intended to be fed to an LLM (Claude Opus 4.6) phase-by-phase in Cursor IDE. Each phase should be completed and tested before moving to the next. The renderer abstraction layer should be established in Phase 1 and respected throughout all subsequent phases.*

