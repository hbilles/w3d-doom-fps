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
  /** Sprite key (frame name or animation alias) in loaded atlas metadata. */
  spriteSheet: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, number[]>;
  worldScale?: number;
  /**
   * Brightness multiplier (0-1). Sprites are unlit; values below 1 keep
   * non-emissive sprites (enemies) seated in the dark scene instead of
   * rendering full-bright. Glowing pickups should stay at 1.
   */
  brightness?: number;
}

// ── Weapon Viewmodel ────────────────────────────────────────

export interface WeaponViewmodelState {
  weaponId: number;
  state: string;        // 'ready' | 'fire' | 'recovery' | 'lower' | 'raise'
  offset: number;       // 0 = fully up, 1 = fully down (for switching animation)
  isFiring: boolean;    // True during the fire frame
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
  message?: string;      // Temporary message ("You need the red key")
  messageTimer?: number; // Remaining display time
  damageFlash?: number;  // 0..1 — red flash when player takes damage
  deathFade?: number;    // 0..1 — deepening red fade while dying
}
