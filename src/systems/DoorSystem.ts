import type { MapData, LineDef, Sector } from '../world/MapTypes.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { Player } from '../entities/Player.ts';
import type { IRenderer } from '../renderer/IRenderer.ts';

const DOOR_OPEN_SPEED = 1 / 0.5;   // Full open in 0.5s
const DOOR_CLOSE_SPEED = 1 / 0.5;  // Full close in 0.5s
const DOOR_STAY_OPEN = 4.0;        // Seconds before auto-close
const USE_DISTANCE = 2.0;          // Max distance to activate

const DoorState = {
  CLOSED: 0,
  OPENING: 1,
  OPEN: 2,
  CLOSING: 3,
} as const;

type DoorState = (typeof DoorState)[keyof typeof DoorState];

interface Door {
  sectorId: number;
  sector: Sector;
  linedefs: LineDef[];
  state: DoorState;
  progress: number;         // 0 = closed, 1 = open
  openTimer: number;        // Countdown while open
  closedCeiling: number;    // Original ceiling height (closed position)
  openCeiling: number;      // Target ceiling height (fully open)
  keyRequired: 'red' | 'blue' | 'yellow' | null;
}

/**
 * Manages door sectors: open on Use key, auto-close after timer.
 * Doors are identified by linedefs with `flags.door = true`.
 */
export class DoorSystem {
  private doors: Map<number, Door> = new Map();
  private mapData: MapData | null = null;
  private eventBus: EventBus | null = null;
  private renderer: IRenderer | null = null;

  init(mapData: MapData, eventBus: EventBus, renderer: IRenderer): void {
    this.mapData = mapData;
    this.eventBus = eventBus;
    this.renderer = renderer;
    this.doors.clear();

    this.discoverDoors();
  }

  private discoverDoors(): void {
    if (!this.mapData) return;

    // Find all linedefs flagged as doors and group by the sector they control
    const doorSectors = new Map<number, { linedefs: LineDef[]; keyRequired: 'red' | 'blue' | 'yellow' | null }>();

    for (const ld of this.mapData.linedefs) {
      if (!ld.flags?.door) continue;

      // The door sector is typically the back sector of the door linedef
      const doorSectorId = ld.backSector ?? ld.frontSector;
      if (doorSectorId === null) continue;

      if (!doorSectors.has(doorSectorId)) {
        doorSectors.set(doorSectorId, { linedefs: [], keyRequired: ld.flags.doorKeyRequired ?? null });
      }
      doorSectors.get(doorSectorId)!.linedefs.push(ld);
    }

    // Create door entries
    for (const [sectorId, info] of doorSectors) {
      const sector = this.mapData.sectors.find((s) => s.id === sectorId);
      if (!sector) continue;

      // Door starts closed: ceiling = floor height (or close to it)
      // The "open" height is the current ceiling height defined in the map
      // We start the ceiling AT the floor height (closed) and raise it to the map ceiling
      const closedCeiling = sector.floorHeight;
      const openCeiling = sector.ceilingHeight;

      // Start closed
      sector.ceilingHeight = closedCeiling;

      this.doors.set(sectorId, {
        sectorId,
        sector,
        linedefs: info.linedefs,
        state: DoorState.CLOSED,
        progress: 0,
        openTimer: 0,
        closedCeiling,
        openCeiling,
        keyRequired: info.keyRequired,
      });
    }
  }

  update(dt: number, player: Player): void {
    for (const door of this.doors.values()) {
      switch (door.state) {
        case DoorState.OPENING:
          door.progress = Math.min(1, door.progress + DOOR_OPEN_SPEED * dt);
          this.updateDoorCeiling(door);
          if (door.progress >= 1) {
            door.state = DoorState.OPEN;
            door.openTimer = DOOR_STAY_OPEN;
            this.eventBus?.emit('door.opened', { sectorId: door.sectorId });
          }
          break;

        case DoorState.OPEN:
          door.openTimer -= dt;
          if (door.openTimer <= 0) {
            // Check if player is in the door sector before closing
            if (this.isEntityInSector(player.position.x, player.position.z, door.sectorId)) {
              door.openTimer = 0.5; // Retry in 0.5s
            } else {
              door.state = DoorState.CLOSING;
            }
          }
          break;

        case DoorState.CLOSING:
          door.progress = Math.max(0, door.progress - DOOR_CLOSE_SPEED * dt);
          this.updateDoorCeiling(door);
          if (door.progress <= 0) {
            door.state = DoorState.CLOSED;
            this.eventBus?.emit('door.closed', { sectorId: door.sectorId });
          }
          // Block closing if player enters
          if (this.isEntityInSector(player.position.x, player.position.z, door.sectorId)) {
            door.state = DoorState.OPENING;
          }
          break;

        case DoorState.CLOSED:
          // Nothing to do
          break;
      }
    }
  }

  /**
   * Try to activate a door near the player. Called when Use key is pressed.
   * Checks ALL two-sided linedefs of the door sector so the player can
   * activate the door from either side of the corridor.
   */
  tryActivate(player: Player): void {
    if (!this.mapData) return;

    const px = player.position.x;
    const pz = player.position.z;

    for (const door of this.doors.values()) {
      let nearDoor = false;

      // Check proximity to any two-sided linedef that borders this door sector
      for (const ld of this.mapData.linedefs) {
        if (ld.frontSector !== door.sectorId && ld.backSector !== door.sectorId) continue;
        // Only two-sided linedefs (openings to adjacent sectors)
        if (ld.frontSector === null || ld.backSector === null) continue;

        const v1 = this.mapData.vertices[ld.v1];
        const v2 = this.mapData.vertices[ld.v2];

        const dist = pointToSegmentDist(px, pz, v1, v2);
        if (dist > USE_DISTANCE) continue;

        // Check if facing the door (dot product of player forward and direction to linedef midpoint)
        const midX = (v1[0] + v2[0]) / 2;
        const midZ = (v1[1] + v2[1]) / 2;
        const toDoorX = midX - px;
        const toDoorZ = midZ - pz;
        const forwardX = -Math.sin(player.yaw);
        const forwardZ = -Math.cos(player.yaw);
        const dot = toDoorX * forwardX + toDoorZ * forwardZ;
        if (dot < 0) continue; // Not facing the door

        nearDoor = true;
        break;
      }

      if (!nearDoor) continue;

      // Check key requirement
      if (door.keyRequired) {
        if (!player.keys[door.keyRequired]) {
          this.eventBus?.emit('door.locked', {
            sectorId: door.sectorId,
            keyRequired: door.keyRequired,
          });
          return;
        }
      }

      // Activate the door
      if (door.state === DoorState.CLOSED) {
        door.state = DoorState.OPENING;
      } else if (door.state === DoorState.OPEN) {
        // Re-pressing use on an open door starts closing it
        door.state = DoorState.CLOSING;
      }

      return; // Only activate one door per press
    }
  }

  isDoorSector(sectorId: number): boolean {
    return this.doors.has(sectorId);
  }

  getDoorProgress(sectorId: number): number {
    return this.doors.get(sectorId)?.progress ?? 0;
  }

  private updateDoorCeiling(door: Door): void {
    const newCeiling = door.closedCeiling + (door.openCeiling - door.closedCeiling) * door.progress;
    door.sector.ceilingHeight = newCeiling;
    this.renderer?.updateSectorCeiling(door.sectorId, newCeiling);
  }

  private isEntityInSector(x: number, z: number, sectorId: number): boolean {
    if (!this.mapData) return false;

    // Simple: check if point is within the bounding polygon of the sector
    const polygon = this.buildSectorPolygon(sectorId);
    return polygon.length >= 3 && pointInPolygon(x, z, polygon);
  }

  private buildSectorPolygon(sectorId: number): [number, number][] {
    if (!this.mapData) return [];
    const vertexIndices = new Set<number>();
    for (const ld of this.mapData.linedefs) {
      if (ld.frontSector === sectorId || ld.backSector === sectorId) {
        vertexIndices.add(ld.v1);
        vertexIndices.add(ld.v2);
      }
    }
    if (vertexIndices.size < 3) return [];
    const points = [...vertexIndices].map((idx) => this.mapData!.vertices[idx] as [number, number]);
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cz = points.reduce((s, p) => s + p[1], 0) / points.length;
    points.sort((a, b) => Math.atan2(a[1] - cz, a[0] - cx) - Math.atan2(b[1] - cz, b[0] - cx));
    return points;
  }
}

// ── Geometry Utilities ──────────────────────────────────────

function pointToSegmentDist(
  px: number,
  pz: number,
  v1: [number, number],
  v2: [number, number],
): number {
  const dx = v2[0] - v1[0];
  const dz = v2[1] - v1[1];
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.0001) {
    const d2 = (px - v1[0]) ** 2 + (pz - v1[1]) ** 2;
    return Math.sqrt(d2);
  }
  let t = ((px - v1[0]) * dx + (pz - v1[1]) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = v1[0] + t * dx;
  const closestZ = v1[1] + t * dz;
  return Math.sqrt((px - closestX) ** 2 + (pz - closestZ) ** 2);
}

function pointInPolygon(x: number, z: number, polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], zi = polygon[i][1];
    const xj = polygon[j][0], zj = polygon[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
