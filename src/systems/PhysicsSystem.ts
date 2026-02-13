import type { MapData, LineDef, Sector } from '../world/MapTypes.ts';
import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_HEIGHT } from '../entities/Player.ts';

export interface MovementResult {
  x: number;
  z: number;
  floorHeight: number;
}

export interface CircleObstacle {
  x: number;
  z: number;
  radius: number;
}

/**
 * Handles player collision detection against linedefs with wall sliding,
 * step-up logic, and sector height tracking.
 */
export class PhysicsSystem {
  /** Cached sector polygons for point-in-polygon tests. */
  private sectorPolygons: Map<number, [number, number][]> = new Map();
  private mapData: MapData | null = null;

  init(mapData: MapData): void {
    this.mapData = mapData;
    this.sectorPolygons.clear();

    for (const sector of mapData.sectors) {
      const polygon = this.buildSectorPolygon(sector.id, mapData);
      this.sectorPolygons.set(sector.id, polygon);
    }
  }

  /**
   * Resolve the player's desired movement against world geometry.
   * Returns the final position and the floor height at that position.
   */
  resolveMovement(
    _oldX: number,
    _oldZ: number,
    desiredX: number,
    desiredZ: number,
    currentFloorHeight: number,
    circleObstacles: CircleObstacle[] = [],
  ): MovementResult {
    if (!this.mapData) {
      return { x: desiredX, z: desiredZ, floorHeight: currentFloorHeight };
    }

    let newX = desiredX;
    let newZ = desiredZ;

    // Iterative collision resolution (up to 3 passes for corner cases)
    for (let iteration = 0; iteration < 3; iteration++) {
      let pushed = false;

      for (const ld of this.mapData.linedefs) {
        if (!this.isBlocking(ld, currentFloorHeight)) continue;

        const v1 = this.mapData.vertices[ld.v1];
        const v2 = this.mapData.vertices[ld.v2];

        const result = circleVsSegment(newX, newZ, PLAYER_RADIUS, v1, v2);
        if (result.overlaps) {
          newX += result.pushX;
          newZ += result.pushZ;
          pushed = true;
        }
      }

      // Dynamic circle obstacles (e.g. barrels) block movement too.
      for (const obstacle of circleObstacles) {
        const combinedRadius = PLAYER_RADIUS + obstacle.radius;
        const result = circleVsCircle(
          newX,
          newZ,
          combinedRadius,
          obstacle.x,
          obstacle.z,
        );
        if (result.overlaps) {
          newX += result.pushX;
          newZ += result.pushZ;
          pushed = true;
        }
      }

      if (!pushed) break;
    }

    // Determine floor height at the resolved position
    const sector = this.findSectorAt(newX, newZ);
    const floorHeight = sector ? sector.floorHeight : currentFloorHeight;

    return { x: newX, z: newZ, floorHeight };
  }

  /** Find which sector contains the given world position. */
  findSectorAt(x: number, z: number): Sector | null {
    if (!this.mapData) return null;

    for (const sector of this.mapData.sectors) {
      const polygon = this.sectorPolygons.get(sector.id);
      if (polygon && polygon.length >= 3 && pointInPolygon(x, z, polygon)) {
        return sector;
      }
    }

    // Fallback: find closest sector by centroid distance
    let closestSector: Sector | null = null;
    let closestDist = Infinity;

    for (const sector of this.mapData.sectors) {
      const polygon = this.sectorPolygons.get(sector.id);
      if (!polygon || polygon.length < 3) continue;

      const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
      const cz = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
      const dist = (x - cx) ** 2 + (z - cz) ** 2;

      if (dist < closestDist) {
        closestDist = dist;
        closestSector = sector;
      }
    }

    return closestSector;
  }

  // ── Private helpers ────────────────────────────────────────

  /** Determine if a linedef should block player movement. */
  private isBlocking(ld: LineDef, currentFloorHeight: number): boolean {
    // Single-sided linedefs always block
    if (ld.frontSector === null || ld.backSector === null) {
      return true;
    }

    // Explicitly flagged as impassable
    if (ld.flags?.impassable) {
      return true;
    }

    if (!this.mapData) return true;

    const frontSector = this.mapData.sectors.find((s) => s.id === ld.frontSector);
    const backSector = this.mapData.sectors.find((s) => s.id === ld.backSector);
    if (!frontSector || !backSector) return true;

    // Step-up check: can the player step up to the higher floor?
    // Small epsilon tolerance for floating-point edge cases
    const maxFloor = Math.max(frontSector.floorHeight, backSector.floorHeight);
    if (maxFloor - currentFloorHeight > STEP_HEIGHT + 0.01) {
      return true;
    }

    // Ceiling gap check: is there enough headroom?
    const minCeiling = Math.min(frontSector.ceilingHeight, backSector.ceilingHeight);
    if (minCeiling - maxFloor < PLAYER_HEIGHT) {
      return true;
    }

    return false;
  }

  /** Build a sector polygon by collecting vertices and sorting by angle from centroid. */
  private buildSectorPolygon(
    sectorId: number,
    mapData: MapData,
  ): [number, number][] {
    const vertexIndices = new Set<number>();

    for (const ld of mapData.linedefs) {
      if (ld.frontSector === sectorId || ld.backSector === sectorId) {
        vertexIndices.add(ld.v1);
        vertexIndices.add(ld.v2);
      }
    }

    if (vertexIndices.size < 3) return [];

    const points = [...vertexIndices].map(
      (idx) => mapData.vertices[idx] as [number, number],
    );

    // Sort by angle from centroid
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cz = points.reduce((s, p) => s + p[1], 0) / points.length;

    points.sort(
      (a, b) =>
        Math.atan2(a[1] - cz, a[0] - cx) - Math.atan2(b[1] - cz, b[0] - cx),
    );

    return points;
  }
}

/** Test player circle center against a fixed obstacle circle center. */
function circleVsCircle(
  cx: number,
  cz: number,
  combinedRadius: number,
  ox: number,
  oz: number,
): { overlaps: boolean; pushX: number; pushZ: number } {
  const dx = cx - ox;
  const dz = cz - oz;
  const distSq = dx * dx + dz * dz;

  if (distSq >= combinedRadius * combinedRadius) {
    return { overlaps: false, pushX: 0, pushZ: 0 };
  }

  // Degenerate case: centers overlap exactly.
  if (distSq < 0.0001) {
    return { overlaps: true, pushX: combinedRadius, pushZ: 0 };
  }

  const dist = Math.sqrt(distSq);
  const overlap = combinedRadius - dist;
  const nx = dx / dist;
  const nz = dz / dist;

  return {
    overlaps: true,
    pushX: nx * overlap,
    pushZ: nz * overlap,
  };
}

// ── Geometry utilities ─────────────────────────────────────────

/** Test circle (cx, cz, radius) against line segment (v1→v2). */
function circleVsSegment(
  cx: number,
  cz: number,
  r: number,
  v1: [number, number],
  v2: [number, number],
): { overlaps: boolean; pushX: number; pushZ: number } {
  const dx = v2[0] - v1[0];
  const dz = v2[1] - v1[1];
  const lenSq = dx * dx + dz * dz;

  if (lenSq < 0.0001) {
    return { overlaps: false, pushX: 0, pushZ: 0 };
  }

  // Project circle center onto the segment to find the closest point
  let t = ((cx - v1[0]) * dx + (cz - v1[1]) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = v1[0] + t * dx;
  const closestZ = v1[1] + t * dz;

  const distX = cx - closestX;
  const distZ = cz - closestZ;
  const distSq = distX * distX + distZ * distZ;

  if (distSq >= r * r) {
    return { overlaps: false, pushX: 0, pushZ: 0 };
  }

  // Player center is exactly on the line — use the wall normal instead
  if (distSq < 0.0001) {
    const len = Math.sqrt(lenSq);
    // Normal perpendicular to segment (right-hand side of v1→v2)
    const nx = dz / len;
    const nz = -dx / len;
    return { overlaps: true, pushX: nx * r, pushZ: nz * r };
  }

  const dist = Math.sqrt(distSq);
  const overlap = r - dist;
  const nx = distX / dist;
  const nz = distZ / dist;

  return {
    overlaps: true,
    pushX: nx * overlap,
    pushZ: nz * overlap,
  };
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(
  x: number,
  z: number,
  polygon: [number, number][],
): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0],
      zi = polygon[i][1];
    const xj = polygon[j][0],
      zj = polygon[j][1];

    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}
