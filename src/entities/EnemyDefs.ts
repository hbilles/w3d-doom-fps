import { ThingType } from '../world/MapTypes.ts';

// ── Enemy Types ────────────────────────────────────────────

export const EnemyType = {
  GRUNT: ThingType.ENEMY_GRUNT,        // 100
  ENFORCER: ThingType.ENEMY_ENFORCER,  // 101
  RUNNER: ThingType.ENEMY_RUNNER,      // 102
  HEAVY: ThingType.ENEMY_HEAVY,        // 103
} as const;

export type EnemyType = (typeof EnemyType)[keyof typeof EnemyType];

// ── AI States ──────────────────────────────────────────────

export const EnemyState = {
  IDLE: 0,
  CHASE: 1,
  ATTACK: 2,
  PAIN: 3,
  DEAD: 4,
} as const;

export type EnemyState = (typeof EnemyState)[keyof typeof EnemyState];

// ── Attack Types ───────────────────────────────────────────

export type AttackType = 'hitscan' | 'melee' | 'projectile';

// ── Enemy Definition ───────────────────────────────────────

export interface EnemyDef {
  type: EnemyType;
  name: string;
  health: number;
  speed: number;          // units/sec
  radius: number;
  attackType: AttackType;
  damage: [number, number]; // [min, max]
  attackRange: number;      // units (Infinity for hitscan)
  attackCooldown: number;   // seconds between attacks
  accuracy: number;         // 0-1 hit chance multiplier for hitscan attacks
  painChance: number;       // 0-1 probability of entering PAIN on hit
  spriteKey: string;
  worldScale: number;
  dropPickup: number | null; // ThingType of pickup to drop on death, or null
}

// ── Definitions ────────────────────────────────────────────

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  [EnemyType.GRUNT]: {
    type: EnemyType.GRUNT,
    name: 'Grunt',
    health: 30,
    speed: 4,
    radius: 0.4,
    attackType: 'hitscan',
    damage: [5, 15],
    attackRange: Infinity,
    attackCooldown: 1.0,
    accuracy: 0.6,
    painChance: 0.8,
    spriteKey: 'enemy_grunt',
    worldScale: 1.4,
    dropPickup: ThingType.AMMO_BULLETS,
  },
  [EnemyType.ENFORCER]: {
    type: EnemyType.ENFORCER,
    name: 'Enforcer',
    health: 80,
    speed: 3,
    radius: 0.5,
    attackType: 'hitscan',
    damage: [10, 20],
    attackRange: Infinity,
    attackCooldown: 1.2,
    accuracy: 0.8,
    painChance: 0.4,
    spriteKey: 'enemy_enforcer',
    worldScale: 1.5,
    dropPickup: ThingType.AMMO_SHELLS,
  },
  [EnemyType.RUNNER]: {
    type: EnemyType.RUNNER,
    name: 'Runner',
    health: 50,
    speed: 8,
    radius: 0.35,
    attackType: 'melee',
    damage: [15, 25],
    attackRange: 2.0,
    attackCooldown: 0.6,
    accuracy: 1.0,
    painChance: 0.6,
    spriteKey: 'enemy_runner',
    worldScale: 1.3,
    dropPickup: ThingType.HEALTH_SMALL,
  },
  [EnemyType.HEAVY]: {
    type: EnemyType.HEAVY,
    name: 'Heavy',
    health: 200,
    speed: 2,
    radius: 0.6,
    attackType: 'projectile',
    damage: [40, 40],
    attackRange: Infinity,
    attackCooldown: 2.0,
    accuracy: 1.0,
    painChance: 0.1,
    spriteKey: 'enemy_heavy',
    worldScale: 1.8,
    dropPickup: ThingType.AMMO_ROCKETS,
  },
};

// ── Animation Specs ────────────────────────────────────────
// All enemy sprite sheets follow the same 12-frame template, so the
// animation timing is shared. Suffixes map to atlas animation aliases
// (e.g. `enemy_grunt_walk`); the empty suffix is the idle frame.

export interface AnimSpec {
  suffix: string;
  fps: number;
  frameCount: number;
  loop: boolean;
}

export const ENEMY_ANIMS: Record<EnemyState, AnimSpec> = {
  [EnemyState.IDLE]: { suffix: '', fps: 1, frameCount: 1, loop: true },
  [EnemyState.CHASE]: { suffix: '_walk', fps: 8, frameCount: 4, loop: true },
  [EnemyState.ATTACK]: { suffix: '_attack', fps: 7, frameCount: 2, loop: false },
  [EnemyState.PAIN]: { suffix: '_pain', fps: 1, frameCount: 1, loop: false },
  [EnemyState.DEAD]: { suffix: '_death', fps: 10, frameCount: 4, loop: false },
};

// ── Helpers ────────────────────────────────────────────────

/** Map a ThingType to an EnemyType, or null if not an enemy. */
export function thingTypeToEnemyType(thingType: number): EnemyType | null {
  switch (thingType) {
    case ThingType.ENEMY_GRUNT: return EnemyType.GRUNT;
    case ThingType.ENEMY_ENFORCER: return EnemyType.ENFORCER;
    case ThingType.ENEMY_RUNNER: return EnemyType.RUNNER;
    case ThingType.ENEMY_HEAVY: return EnemyType.HEAVY;
    default: return null;
  }
}
