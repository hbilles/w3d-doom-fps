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
    map.atmosphere ??= {};
    map.atmosphere.rain ??= false;
    map.atmosphere.rainDensity ??= 0.45;
    map.atmosphere.rainSpeed ??= 11;
    map.atmosphere.rainRipples ??= true;
    map.atmosphere.rainRippleDensity ??= 0.5;
    map.atmosphere.steam ??= true;
    map.atmosphere.steamDensity ??= 0.4;
    map.atmosphere.steamVents ??= [];
    map.atmosphere.vignette ??= 0.26;
    map.atmosphere.grain ??= 0.035;
    map.atmosphere.chromaticAberration ??= 0.0016;
    map.atmosphere.bloomStrength ??= 0.75;

    // Ensure linedef flags have defaults
    for (const ld of map.linedefs) {
      ld.flags ??= {};
      ld.frontTexture ??= null;
      ld.backTexture ??= null;
    }

    return map;
  }
}
