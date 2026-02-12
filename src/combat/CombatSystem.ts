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

  init(mapData: MapData, eventBus: EventBus): void {
    this.mapData = mapData;
    this.eventBus = eventBus;
    this.buildWallSegments();
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
    _damage: number,
  ): HitscanResult {
    // Test against walls
    let closestWall: RayHit | null = null;
    for (const seg of this.wallSegments) {
      const hit = rayVsSegment(ox, oz, dirX, dirZ, seg.v1, seg.v2, maxRange);
      if (hit && (!closestWall || hit.distance < closestWall.distance)) {
        closestWall = hit;
      }
    }

    const entityHits: EntityHitInfo[] = [];

    // TODO: Phase 3 — test against enemy entities and barrels here
    // For each entity, check ray-vs-circle and compare distance to closestWall

    if (closestWall) {
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

  // ── Private ──────────────────────────────────────────────

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
