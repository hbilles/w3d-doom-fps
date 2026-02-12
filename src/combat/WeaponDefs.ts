// ── Ammo Types ─────────────────────────────────────────────

export const AmmoType = {
  NONE: 'none',
  BULLETS: 'bullets',
  SHELLS: 'shells',
  ROCKETS: 'rockets',
} as const;

export type AmmoType = (typeof AmmoType)[keyof typeof AmmoType];

// ── Weapon IDs ─────────────────────────────────────────────

export const WeaponId = {
  BATON: 1,
  PISTOL: 2,
  SHOTGUN: 3,
  AUTO_RIFLE: 4,
  LAUNCHER: 5,
} as const;

export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];

// ── Weapon State ───────────────────────────────────────────

export const WeaponState = {
  READY: 'ready',
  FIRE: 'fire',
  RECOVERY: 'recovery',
  LOWER: 'lower',
  RAISE: 'raise',
} as const;

export type WeaponState = (typeof WeaponState)[keyof typeof WeaponState];

// ── Weapon Definition ──────────────────────────────────────

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;           // Per-hit damage (or per-pellet for shotgun)
  rateOfFire: number;       // Shots per second
  ammoType: AmmoType;
  ammoCost: number;         // Ammo consumed per shot
  isProjectile: boolean;    // true = launcher, false = hitscan
  isMelee: boolean;
  pellets: number;          // Number of rays (shotgun = 7, others = 1)
  spread: number;           // Spread angle in radians (0 = perfectly accurate)
  range: number;            // Max range in units (Infinity for most, ~2 for melee)
  splashRadius: number;     // Splash damage radius (launcher only)
  splashDamage: number;     // Splash damage amount
  projectileSpeed: number;  // Units/sec (launcher only)
  fireDuration: number;     // Seconds in FIRE state
  recoveryDuration: number; // Seconds in RECOVERY state
  switchDuration: number;   // Seconds for LOWER or RAISE
  screenShake: number;      // Shake intensity on fire
}

// ── Weapon Definitions ─────────────────────────────────────

const SWITCH_DURATION = 0.3;

export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  [WeaponId.BATON]: {
    id: WeaponId.BATON,
    name: 'Baton',
    damage: 15,              // Average of 10-20 (randomized at fire time)
    rateOfFire: 2,
    ammoType: AmmoType.NONE,
    ammoCost: 0,
    isProjectile: false,
    isMelee: true,
    pellets: 1,
    spread: 0,
    range: 2,
    splashRadius: 0,
    splashDamage: 0,
    projectileSpeed: 0,
    fireDuration: 0.08,
    recoveryDuration: 1 / 2 - 0.08,
    switchDuration: SWITCH_DURATION,
    screenShake: 0.3,
  },

  [WeaponId.PISTOL]: {
    id: WeaponId.PISTOL,
    name: 'Pistol',
    damage: 10,
    rateOfFire: 3,
    ammoType: AmmoType.BULLETS,
    ammoCost: 1,
    isProjectile: false,
    isMelee: false,
    pellets: 1,
    spread: 0,
    range: Infinity,
    splashRadius: 0,
    splashDamage: 0,
    projectileSpeed: 0,
    fireDuration: 0.06,
    recoveryDuration: 1 / 3 - 0.06,
    switchDuration: SWITCH_DURATION,
    screenShake: 0.5,
  },

  [WeaponId.SHOTGUN]: {
    id: WeaponId.SHOTGUN,
    name: 'Shotgun',
    damage: 7,               // Per pellet
    rateOfFire: 1.1,
    ammoType: AmmoType.SHELLS,
    ammoCost: 1,
    isProjectile: false,
    isMelee: false,
    pellets: 7,
    spread: 5 * (Math.PI / 180), // 5 degrees
    range: Infinity,
    splashRadius: 0,
    splashDamage: 0,
    projectileSpeed: 0,
    fireDuration: 0.08,
    recoveryDuration: 1 / 1.1 - 0.08,
    switchDuration: SWITCH_DURATION,
    screenShake: 1.2,
  },

  [WeaponId.AUTO_RIFLE]: {
    id: WeaponId.AUTO_RIFLE,
    name: 'Auto-Rifle',
    damage: 8,
    rateOfFire: 8,
    ammoType: AmmoType.BULLETS,
    ammoCost: 1,
    isProjectile: false,
    isMelee: false,
    pellets: 1,
    spread: 2 * (Math.PI / 180), // 2 degrees slight spread
    range: Infinity,
    splashRadius: 0,
    splashDamage: 0,
    projectileSpeed: 0,
    fireDuration: 0.04,
    recoveryDuration: 1 / 8 - 0.04,
    switchDuration: SWITCH_DURATION,
    screenShake: 0.4,
  },

  [WeaponId.LAUNCHER]: {
    id: WeaponId.LAUNCHER,
    name: 'Launcher',
    damage: 80,              // Direct hit
    rateOfFire: 0.8,
    ammoType: AmmoType.ROCKETS,
    ammoCost: 1,
    isProjectile: true,
    isMelee: false,
    pellets: 1,
    spread: 0,
    range: Infinity,
    splashRadius: 3,
    splashDamage: 60,
    projectileSpeed: 20,
    fireDuration: 0.1,
    recoveryDuration: 1 / 0.8 - 0.1,
    switchDuration: SWITCH_DURATION,
    screenShake: 1.5,
  },
};

// ── Ammo Limits ────────────────────────────────────────────

export const AMMO_MAX: Record<AmmoType, number> = {
  [AmmoType.NONE]: 0,
  [AmmoType.BULLETS]: 200,
  [AmmoType.SHELLS]: 50,
  [AmmoType.ROCKETS]: 50,
};

export const AMMO_START: Record<AmmoType, number> = {
  [AmmoType.NONE]: 0,
  [AmmoType.BULLETS]: 50,
  [AmmoType.SHELLS]: 0,
  [AmmoType.ROCKETS]: 0,
};
