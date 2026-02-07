import type { Color } from '../renderer/RenderTypes.ts';

// ── Map Data ────────────────────────────────────────────────

export interface MapData {
  name: string;
  author: string;
  music: string;
  ambientLight: Color;
  fogColor: Color;
  fogDensity: number;
  vertices: [number, number][];
  linedefs: LineDef[];
  sectors: Sector[];
  things: Thing[];
}

// ── Line Definitions ────────────────────────────────────────

export interface LineDef {
  v1: number; // Start vertex index
  v2: number; // End vertex index
  frontSector: number | null;
  backSector: number | null;
  frontTexture: TextureDef | null;
  backTexture: TextureDef | null;
  flags: LineFlags;
}

export interface TextureDef {
  upper?: string | null;
  middle?: string | null;
  lower?: string | null;
}

export interface LineFlags {
  impassable?: boolean;
  blockMonsters?: boolean;
  twoSided?: boolean;
  secret?: boolean;
  door?: boolean;
  doorKeyRequired?: 'red' | 'blue' | 'yellow';
  triggerAction?: string;
}

// ── Sectors ─────────────────────────────────────────────────

export interface Sector {
  id: number;
  floorHeight: number;
  ceilingHeight: number;
  floorTexture: string;
  ceilingTexture: string;
  lightLevel: number; // 0.0 to 1.0
  special: SectorSpecial | null;
}

export type SectorSpecial = 'damage_low' | 'damage_high' | 'secret' | 'light_blink';

// ── Things ──────────────────────────────────────────────────

export interface Thing {
  type: ThingType;
  position: [number, number]; // x, z
  angle: number; // Facing direction in degrees
  flags: ThingFlags;
}

export interface ThingFlags {
  easy?: boolean;
  medium?: boolean;
  hard?: boolean;
  ambush?: boolean;
}

export const ThingType = {
  // Player
  PLAYER_START: 1,

  // Enemies
  ENEMY_GRUNT: 100,
  ENEMY_ENFORCER: 101,
  ENEMY_RUNNER: 102,
  ENEMY_HEAVY: 103,
  ENEMY_BOSS: 104,

  // Weapons
  WEAPON_SHOTGUN: 200,
  WEAPON_AUTOMATIC: 201,
  WEAPON_LAUNCHER: 202,

  // Ammo
  AMMO_BULLETS: 300,
  AMMO_SHELLS: 301,
  AMMO_ROCKETS: 302,
  AMMO_BULLETS_BOX: 303,

  // Health & Armor
  HEALTH_SMALL: 400,
  HEALTH_MEDIUM: 401,
  HEALTH_LARGE: 402,
  ARMOR_GREEN: 410,
  ARMOR_BLUE: 411,

  // Keys
  KEY_RED: 500,
  KEY_BLUE: 501,
  KEY_YELLOW: 502,

  // Decorative
  LIGHT_NEON: 600,
  LIGHT_FLICKER: 601,
  BARREL_EXPLOSIVE: 602,
  PROP_TERMINAL: 603,
  PROP_HOLOGRAM: 604,
} as const;

export type ThingType = (typeof ThingType)[keyof typeof ThingType];
