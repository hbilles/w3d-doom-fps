import type { Vec3 } from '../renderer/RenderTypes.ts';

const BARREL_HEALTH = 20;
const BARREL_RADIUS = 0.5;
const EXPLOSION_RADIUS = 3;
const EXPLOSION_DAMAGE = 80;

export class Barrel {
  readonly id: string;
  readonly position: Vec3;
  readonly radius: number = BARREL_RADIUS;
  health: number = BARREL_HEALTH;
  alive: boolean = true;
  exploded: boolean = false;

  private static nextId = 0;

  constructor(x: number, z: number, floorHeight: number) {
    this.id = `barrel_${Barrel.nextId++}`;
    this.position = { x, y: floorHeight + 0.6, z };
  }

  /**
   * Apply damage to this barrel. Returns true if the barrel just died.
   */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;

    this.health -= amount;
    if (this.health <= 0) {
      this.alive = false;
      this.exploded = true;
      return true;
    }
    return false;
  }

  /**
   * Get explosion parameters when the barrel explodes.
   */
  getExplosion(): { x: number; z: number; radius: number; damage: number } {
    return {
      x: this.position.x,
      z: this.position.z,
      radius: EXPLOSION_RADIUS,
      damage: EXPLOSION_DAMAGE,
    };
  }

  /**
   * Check if a point is within this barrel's collision radius.
   */
  containsPoint(x: number, z: number): boolean {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    return dx * dx + dz * dz < this.radius * this.radius;
  }

  /**
   * Get distance from a world point to this barrel's center.
   */
  distanceTo(x: number, z: number): number {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
