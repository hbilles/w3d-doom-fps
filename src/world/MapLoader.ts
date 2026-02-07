import type { MapData } from './MapTypes.ts';

export class MapLoader {
  static async load(mapName: string): Promise<MapData> {
    const response = await fetch(`/maps/${mapName}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load map "${mapName}": ${response.status} ${response.statusText}`);
    }
    const data: unknown = await response.json();
    return MapLoader.validate(data);
  }

  private static validate(data: unknown): MapData {
    const map = data as MapData;

    if (!Array.isArray(map.vertices)) {
      throw new Error('Invalid map: missing vertices array');
    }
    if (!Array.isArray(map.linedefs)) {
      throw new Error('Invalid map: missing linedefs array');
    }
    if (!Array.isArray(map.sectors)) {
      throw new Error('Invalid map: missing sectors array');
    }
    if (!Array.isArray(map.things)) {
      throw new Error('Invalid map: missing things array');
    }

    // Apply defaults for optional top-level fields
    map.ambientLight ??= { r: 0.05, g: 0.05, b: 0.1 };
    map.fogColor ??= { r: 0.02, g: 0.02, b: 0.05 };
    map.fogDensity ??= 0.03;
    map.name ??= 'Unnamed Map';
    map.author ??= 'Unknown';
    map.music ??= '';

    // Ensure linedef flags have defaults
    for (const ld of map.linedefs) {
      ld.flags ??= {};
      ld.frontTexture ??= null;
      ld.backTexture ??= null;
    }

    return map;
  }
}
