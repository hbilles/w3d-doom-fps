import type { Vec3 } from '../renderer/RenderTypes.ts';
import type { Player } from './Player.ts';
import { AmmoType, WeaponId } from '../combat/WeaponDefs.ts';
import { ThingType } from '../world/MapTypes.ts';

const PICKUP_RADIUS = 1.0;

export const PickupType = {
  HEALTH_SMALL: 0,
  HEALTH_MEDIUM: 1,
  HEALTH_LARGE: 2,
  AMMO_BULLETS: 3,
  AMMO_SHELLS: 4,
  AMMO_ROCKETS: 5,
  AMMO_BULLETS_BOX: 6,
  WEAPON_SHOTGUN: 7,
  WEAPON_AUTOMATIC: 8,
  WEAPON_LAUNCHER: 9,
  KEY_RED: 10,
  KEY_BLUE: 11,
  KEY_YELLOW: 12,
} as const;

export type PickupType = (typeof PickupType)[keyof typeof PickupType];

interface PickupEffect {
  type: 'health' | 'ammo' | 'weapon' | 'key';
  ammoType?: AmmoType;
  weaponId?: WeaponId;
  keyColor?: 'red' | 'blue' | 'yellow';
  amount: number;
}

const PICKUP_EFFECTS: Record<PickupType, PickupEffect> = {
  [PickupType.HEALTH_SMALL]:   { type: 'health', amount: 10 },
  [PickupType.HEALTH_MEDIUM]:  { type: 'health', amount: 25 },
  [PickupType.HEALTH_LARGE]:   { type: 'health', amount: 50 },
  [PickupType.AMMO_BULLETS]:   { type: 'ammo', ammoType: AmmoType.BULLETS, amount: 10 },
  [PickupType.AMMO_SHELLS]:    { type: 'ammo', ammoType: AmmoType.SHELLS, amount: 4 },
  [PickupType.AMMO_ROCKETS]:   { type: 'ammo', ammoType: AmmoType.ROCKETS, amount: 2 },
  [PickupType.AMMO_BULLETS_BOX]: { type: 'ammo', ammoType: AmmoType.BULLETS, amount: 50 },
  [PickupType.WEAPON_SHOTGUN]:   { type: 'weapon', weaponId: WeaponId.SHOTGUN, ammoType: AmmoType.SHELLS, amount: 8 },
  [PickupType.WEAPON_AUTOMATIC]: { type: 'weapon', weaponId: WeaponId.AUTO_RIFLE, ammoType: AmmoType.BULLETS, amount: 20 },
  [PickupType.WEAPON_LAUNCHER]:  { type: 'weapon', weaponId: WeaponId.LAUNCHER, ammoType: AmmoType.ROCKETS, amount: 5 },
  [PickupType.KEY_RED]:     { type: 'key', keyColor: 'red', amount: 0 },
  [PickupType.KEY_BLUE]:    { type: 'key', keyColor: 'blue', amount: 0 },
  [PickupType.KEY_YELLOW]:  { type: 'key', keyColor: 'yellow', amount: 0 },
};

// ── Pickup display info for sprites ─────────────────────────

export interface PickupDisplayInfo {
  label: string;
  color: string; // CSS color for procedural sprite
}

const PICKUP_DISPLAY: Record<PickupType, PickupDisplayInfo> = {
  [PickupType.HEALTH_SMALL]:   { label: '+', color: '#00ff44' },
  [PickupType.HEALTH_MEDIUM]:  { label: '++', color: '#00ff88' },
  [PickupType.HEALTH_LARGE]:   { label: '+++', color: '#44ffaa' },
  [PickupType.AMMO_BULLETS]:   { label: 'B', color: '#ffcc00' },
  [PickupType.AMMO_SHELLS]:    { label: 'S', color: '#ff8844' },
  [PickupType.AMMO_ROCKETS]:   { label: 'R', color: '#ff4444' },
  [PickupType.AMMO_BULLETS_BOX]: { label: 'BB', color: '#ffdd44' },
  [PickupType.WEAPON_SHOTGUN]:   { label: 'SG', color: '#aa6633' },
  [PickupType.WEAPON_AUTOMATIC]: { label: 'AR', color: '#556677' },
  [PickupType.WEAPON_LAUNCHER]:  { label: 'RL', color: '#447744' },
  [PickupType.KEY_RED]:    { label: 'K', color: '#ff0000' },
  [PickupType.KEY_BLUE]:   { label: 'K', color: '#0088ff' },
  [PickupType.KEY_YELLOW]: { label: 'K', color: '#ffff00' },
};

export class Pickup {
  readonly id: string;
  readonly pickupType: PickupType;
  readonly position: Vec3;
  readonly display: PickupDisplayInfo;
  collected: boolean = false;
  /** Bob animation phase */
  private bobPhase: number;

  private static nextId = 0;

  constructor(pickupType: PickupType, x: number, z: number, floorHeight: number) {
    this.id = `pickup_${Pickup.nextId++}`;
    this.pickupType = pickupType;
    this.position = { x, y: floorHeight + 0.5, z };
    this.display = PICKUP_DISPLAY[pickupType];
    this.bobPhase = Math.random() * Math.PI * 2;
  }

  /**
   * Update bob animation and check for player collection.
   * Returns true if collected this frame.
   */
  update(dt: number, player: Player): boolean {
    if (this.collected) return false;

    // Bob up and down
    this.bobPhase += dt * 3;
    const baseY = this.position.y;
    // We don't actually move Y here since it would drift —
    // the renderer will handle the visual bob via sprite update

    // Check distance to player
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < PICKUP_RADIUS) {
      return this.tryCollect(player);
    }

    // Suppress unused warning
    void baseY;
    void dt;

    return false;
  }

  /** Get the current visual Y offset for bobbing. */
  getBobOffset(): number {
    return Math.sin(this.bobPhase) * 0.15;
  }

  private tryCollect(player: Player): boolean {
    const effect = PICKUP_EFFECTS[this.pickupType];

    switch (effect.type) {
      case 'health': {
        if (player.health >= player.maxHealth) return false;
        player.health = Math.min(player.maxHealth, player.health + effect.amount);
        break;
      }
      case 'ammo': {
        const ammoType = effect.ammoType!;
        if (player.ammo[ammoType] >= player.maxAmmo[ammoType]) return false;
        player.ammo[ammoType] = Math.min(player.maxAmmo[ammoType], player.ammo[ammoType] + effect.amount);
        break;
      }
      case 'weapon': {
        const weaponId = effect.weaponId!;
        player.weapons.add(weaponId);
        // Also give ammo
        if (effect.ammoType && effect.ammoType !== AmmoType.NONE) {
          player.ammo[effect.ammoType] = Math.min(
            player.maxAmmo[effect.ammoType],
            player.ammo[effect.ammoType] + effect.amount,
          );
        }
        break;
      }
      case 'key': {
        const keyColor = effect.keyColor!;
        if (player.keys[keyColor]) return false; // Already have it
        player.keys[keyColor] = true;
        break;
      }
    }

    this.collected = true;
    return true;
  }
}

/**
 * Map a ThingType to a PickupType, or return null if not a pickup thing.
 */
export function thingTypeToPickupType(thingType: number): PickupType | null {
  switch (thingType) {
    case ThingType.HEALTH_SMALL:     return PickupType.HEALTH_SMALL;
    case ThingType.HEALTH_MEDIUM:    return PickupType.HEALTH_MEDIUM;
    case ThingType.HEALTH_LARGE:     return PickupType.HEALTH_LARGE;
    case ThingType.AMMO_BULLETS:     return PickupType.AMMO_BULLETS;
    case ThingType.AMMO_SHELLS:      return PickupType.AMMO_SHELLS;
    case ThingType.AMMO_ROCKETS:     return PickupType.AMMO_ROCKETS;
    case ThingType.AMMO_BULLETS_BOX: return PickupType.AMMO_BULLETS_BOX;
    case ThingType.WEAPON_SHOTGUN:   return PickupType.WEAPON_SHOTGUN;
    case ThingType.WEAPON_AUTOMATIC: return PickupType.WEAPON_AUTOMATIC;
    case ThingType.WEAPON_LAUNCHER:  return PickupType.WEAPON_LAUNCHER;
    case ThingType.KEY_RED:          return PickupType.KEY_RED;
    case ThingType.KEY_BLUE:         return PickupType.KEY_BLUE;
    case ThingType.KEY_YELLOW:       return PickupType.KEY_YELLOW;
    default: return null;
  }
}
