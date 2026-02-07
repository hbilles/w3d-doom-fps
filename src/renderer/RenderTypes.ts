// ── Primitives ──────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
}

// ── Camera ──────────────────────────────────────────────────

export interface CameraState {
  position: Vec3;
  yaw: number; // Horizontal rotation only (no pitch — Doom style)
  fov: number;
  height: number; // Eye height
}

// ── Renderables ─────────────────────────────────────────────

export interface RenderableEntity {
  id: string;
  type: 'sprite' | 'decal' | 'particle';
  position: Vec3;
  spriteSheet: string;
  frame: number;
  scale: number;
  billboard: boolean; // Always face camera (true for enemies/pickups)
}

// ── Lighting ────────────────────────────────────────────────

export interface LightState {
  id: string;
  position: Vec3;
  color: Color;
  intensity: number;
  distance: number; // Falloff distance
  flicker?: boolean;
}

// ── Sprites ─────────────────────────────────────────────────

export interface SpriteConfig {
  spriteSheet: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, number[]>;
}

// ── HUD ─────────────────────────────────────────────────────

export interface HUDState {
  health: number;
  maxHealth: number;
  armor: number;
  ammo: number;
  maxAmmo: number;
  weaponName: string;
  keys: { red: boolean; blue: boolean; yellow: boolean };
}
