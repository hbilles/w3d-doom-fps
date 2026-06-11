import type { MapData } from '../world/MapTypes.ts';
import type { EventBus } from '../core/EventBus.ts';
import { rayVsSegment, type RayHit } from './HitscanRay.ts';
import { type WeaponDef, WeaponId } from './WeaponDefs.ts';

// ── Hit result returned to callers ─────────────────────────

export interface HitscanResult {
  hit: boolean;
  wallHit: RayHit | null;
  // Future: entityHits for enemies/barrels
  entityHits: EntityHitInfo[];
}

export interface EntityHitInfo {
  entityId: string;
  entityType: 'enemy' | 'barrel';
  distance: number;
  damage: number;
}

// ── Hittable entity interface ────────────────────────────

export interface HittableEntity {
  id: string;
  position: { x: number; z: number };
  radius: number;
  alive: boolean;
}

// ── Splash damage request ──────────────────────────────────

export interface SplashRequest {
  x: number;
  z: number;
  radius: number;
  damage: number;
  sourceId?: string; // Who fired it (for self-damage)
}

/**
 * Handles hitscan raycasting against world geometry and entities.
 * Game logic calls fireHitscan() when a weapon fires; this system
 * determines what was hit and emits events.
 */
export class CombatSystem {
  private mapData: MapData | null = null;
  private wallSegments: Array<{ v1: [number, number]; v2: [number, number] }> = [];
  private eventBus: EventBus | null = null;
  private enemies: HittableEntity[] = [];
  private barrels: HittableEntity[] = [];

  init(mapData: MapData, eventBus: EventBus): void {
    this.mapData = mapData;
    this.eventBus = eventBus;
    this.buildWallSegments();
  }

  /**
   * Register entity lists for hitscan testing. Call once per frame
   * before any weapon firing occurs.
   */
  setEntities(enemies: HittableEntity[], barrels: HittableEntity[]): void {
    this.enemies = enemies;
    this.barrels = barrels;
  }

  /**
   * Fire a single hitscan ray from origin in the given direction.
   */
  fireHitscan(
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    maxRange: number,
    damage: number,
  ): HitscanResult {
    // Test against walls
    let closestWall: RayHit | null = null;
    for (const seg of this.wallSegments) {
      const hit = rayVsSegment(ox, oz, dirX, dirZ, seg.v1, seg.v2, maxRange);
      if (hit && (!closestWall || hit.distance < closestWall.distance)) {
        closestWall = hit;
      }
    }

    const maxDist = closestWall ? closestWall.distance : maxRange;
    const entityHits: EntityHitInfo[] = [];

    // Test against enemies
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const hitDist = this.rayVsCircle(
        ox, oz, dirX, dirZ, enemy.position.x, enemy.position.z, enemy.radius, maxDist,
      );
      if (hitDist !== null) {
        entityHits.push({
          entityId: enemy.id,
          entityType: 'enemy',
          distance: hitDist,
          damage,
        });
      }
    }

    // Test against barrels
    for (const barrel of this.barrels) {
      if (!barrel.alive) continue;
      const hitDist = this.rayVsCircle(
        ox, oz, dirX, dirZ, barrel.position.x, barrel.position.z, barrel.radius, maxDist,
      );
      if (hitDist !== null) {
        entityHits.push({
          entityId: barrel.id,
          entityType: 'barrel',
          distance: hitDist,
          damage,
        });
      }
    }

    // Sort by distance (closest first) so caller can process in order
    entityHits.sort((a, b) => a.distance - b.distance);

    // Only emit wall hit if no entity was hit closer
    const closestEntityDist = entityHits.length > 0 ? entityHits[0].distance : Infinity;
    if (closestWall && closestWall.distance < closestEntityDist) {
      this.eventBus?.emit('combat.wallHit', {
        x: closestWall.x,
        z: closestWall.z,
        normalX: closestWall.normalX,
        normalZ: closestWall.normalZ,
      });
    }

    return {
      hit: closestWall !== null || entityHits.length > 0,
      wallHit: closestWall,
      entityHits,
    };
  }

  /**
   * Fire a weapon: handles single-ray, spread (shotgun), and melee.
   * Returns all hit results.
   */
  fireWeapon(
    weapon: WeaponDef,
    ox: number,
    oz: number,
    yaw: number,
  ): HitscanResult[] {
    const results: HitscanResult[] = [];

    if (weapon.isProjectile) {
      // Projectiles are handled by Game.ts spawning a Projectile entity
      return results;
    }

    const baseDirX = -Math.sin(yaw);
    const baseDirZ = -Math.cos(yaw);

    for (let i = 0; i < weapon.pellets; i++) {
      // Apply spread
      let dirX = baseDirX;
      let dirZ = baseDirZ;

      if (weapon.spread > 0) {
        const spreadAngle = (Math.random() - 0.5) * weapon.spread;
        const cos = Math.cos(spreadAngle);
        const sin = Math.sin(spreadAngle);
        dirX = baseDirX * cos - baseDirZ * sin;
        dirZ = baseDirX * sin + baseDirZ * cos;
      }

      // Compute damage (melee baton has random range 10-20)
      let damage = weapon.damage;
      if (weapon.id === WeaponId.BATON) {
        damage = 10 + Math.random() * 10;
      }

      const result = this.fireHitscan(
        ox, oz,
        dirX, dirZ,
        weapon.range,
        damage,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Apply splash damage at a world position.
   * Tests distance to player and all damageable entities.
   */
  applySplashDamage(request: SplashRequest): void {
    this.eventBus?.emit('combat.splash', request);
  }

  /**
   * Raycast from a point to find wall distance (used for projectile collision).
   */
  raycastWalls(
    ox: number,
    oz: number,
    dx: number,
    dz: number,
    maxDist: number,
  ): RayHit | null {
    let closest: RayHit | null = null;
    for (const seg of this.wallSegments) {
      const hit = rayVsSegment(ox, oz, dx, dz, seg.v1, seg.v2, maxDist);
      if (hit && (!closest || hit.distance < closest.distance)) {
        closest = hit;
      }
    }
    return closest;
  }

  /** Get the cached wall segments for LOS checks by other systems. */
  getWallSegments(): Array<{ v1: [number, number]; v2: [number, number] }> {
    return this.wallSegments;
  }

  // ── Private ──────────────────────────────────────────────

  /**
   * Test a 2D ray against a circle. Returns the distance to the closest
   * intersection point, or null if no hit within maxDist.
   */
  private rayVsCircle(
    ox: number, oz: number,
    dx: number, dz: number,
    cx: number, cz: number,
    radius: number,
    maxDist: number,
  ): number | null {
    // Normalize direction
    const dirLen = Math.sqrt(dx * dx + dz * dz);
    if (dirLen < 0.0001) return null;
    const ndx = dx / dirLen;
    const ndz = dz / dirLen;

    // Vector from ray origin to circle center
    const ocx = cx - ox;
    const ocz = cz - oz;

    // Project onto ray direction
    const tca = ocx * ndx + ocz * ndz;

    // Circle is behind ray
    if (tca < -radius) return null;

    // Perpendicular distance squared from circle center to ray
    const d2 = (ocx * ocx + ocz * ocz) - tca * tca;
    const r2 = radius * radius;

    if (d2 > r2) return null; // Ray misses the circle

    // Distance from closest approach to intersection point
    const thc = Math.sqrt(r2 - d2);

    // Nearest intersection
    let t = tca - thc;
    if (t < 0) t = tca + thc; // Inside the circle, use far intersection
    if (t < 0) return null; // Both behind ray

    if (t > maxDist) return null;

    return t;
  }

  private buildWallSegments(): void {
    if (!this.mapData) return;
    this.wallSegments = [];

    for (const ld of this.mapData.linedefs) {
      // All single-sided linedefs are solid walls for hitscan.
      // Two-sided linedefs with impassable flag also block.
      // For simplicity, test against ALL linedefs that have at least one sector.
      if (ld.frontSector === null && ld.backSector === null) continue;

      const isSingleSided = ld.frontSector === null || ld.backSector === null;
      const isImpassable = ld.flags?.impassable === true;

      if (isSingleSided || isImpassable) {
        this.wallSegments.push({
          v1: this.mapData.vertices[ld.v1],
          v2: this.mapData.vertices[ld.v2],
        });
      }
    }
  }
}
