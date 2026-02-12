import type { Vec3 } from '../renderer/RenderTypes.ts';
import type { WeaponDef } from '../combat/WeaponDefs.ts';

const MAX_LIFETIME = 5; // seconds

export interface ProjectileConfig {
  x: number;
  z: number;
  yaw: number;
  floorHeight: number;
  weaponDef: WeaponDef;
  ownerId: string;
}

export class Projectile {
  readonly id: string;
  readonly ownerId: string;
  position: Vec3;
  velocity: Vec3;
  readonly damage: number;
  readonly splashRadius: number;
  readonly splashDamage: number;
  readonly speed: number;
  private lifetime: number = 0;
  alive: boolean = true;

  private static nextId = 0;

  constructor(config: ProjectileConfig) {
    this.id = `proj_${Projectile.nextId++}`;
    this.ownerId = config.ownerId;
    this.damage = config.weaponDef.damage;
    this.splashRadius = config.weaponDef.splashRadius;
    this.splashDamage = config.weaponDef.splashDamage;
    this.speed = config.weaponDef.projectileSpeed;

    // Spawn at player eye level
    const eyeHeight = config.floorHeight + 1.2; // Slightly below eye level
    this.position = { x: config.x, y: eyeHeight, z: config.z };

    // Direction from yaw
    const dirX = -Math.sin(config.yaw);
    const dirZ = -Math.cos(config.yaw);
    this.velocity = {
      x: dirX * this.speed,
      y: 0,
      z: dirZ * this.speed,
    };
  }

  /**
   * Advance the projectile. Returns the movement vector for collision testing.
   */
  update(dt: number): { dx: number; dz: number } {
    this.lifetime += dt;
    if (this.lifetime >= MAX_LIFETIME) {
      this.alive = false;
      return { dx: 0, dz: 0 };
    }

    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;

    this.position.x += dx;
    this.position.z += dz;

    return { dx, dz };
  }

  kill(): void {
    this.alive = false;
  }
}
