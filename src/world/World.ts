import type { MapData, Sector, LineDef } from './MapTypes.ts';
import { ThingType } from './MapTypes.ts';

export class World {
  private mapData: MapData;

  constructor(mapData: MapData) {
    this.mapData = mapData;
  }

  getMapData(): MapData {
    return this.mapData;
  }

  getPlayerStart(): { x: number; z: number; angle: number } {
    const start = this.mapData.things.find(
      (t) => t.type === ThingType.PLAYER_START,
    );
    if (!start) {
      console.warn('No PLAYER_START in map — using default position (0, 0)');
      return { x: 0, z: 0, angle: 0 };
    }
    return {
      x: start.position[0],
      z: start.position[1],
      angle: (start.angle * Math.PI) / 180,
    };
  }

  getSectors(): Sector[] {
    return this.mapData.sectors;
  }

  getLinedefs(): LineDef[] {
    return this.mapData.linedefs;
  }

  getVertices(): [number, number][] {
    return this.mapData.vertices;
  }
}
