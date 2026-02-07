import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { TextureManager } from './TextureManager.ts';
import type { IRenderer } from './IRenderer.ts';
import type {
  CameraState,
  Color,
  HUDState,
  LightState,
  RenderableEntity,
  SpriteConfig,
  Vec3,
} from './RenderTypes.ts';
import type { MapData, LineDef } from '../world/MapTypes.ts';
import { ThingType } from '../world/MapTypes.ts';

// ── Neon colors for light things ─────────────────────────────
const NEON_COLORS: number[] = [0x00ccff, 0xff8800, 0xff0066, 0x00ff88, 0x0066ff];

interface FlickerLight {
  light: THREE.PointLight;
  baseIntensity: number;
  phase: number;
}

export class ThreeJSRenderer implements IRenderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private pointLights: Map<string, THREE.PointLight> = new Map();
  private mapGroup: THREE.Group | null = null;
  private textureManager: TextureManager = new TextureManager();
  private flickerLights: FlickerLight[] = [];
  private playerLight!: THREE.PointLight; // Subtle headlamp that follows the player

  async init(canvas: HTMLCanvasElement): Promise<void> {
    // ── WebGL Renderer ───────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.8;

    // ── Scene & Camera ───────────────────────────────────────
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      90,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    this.camera.rotation.order = 'YXZ';

    // ── Post-processing ──────────────────────────────────────
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,  // strength
      0.5,  // radius
      0.3,  // threshold — lower so neon surfaces glow more
    );
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());

    // Player headlamp — warm white light that follows the camera,
    // ensures you can always see nearby geometry
    this.playerLight = new THREE.PointLight(0xeeddcc, 2.5, 18);
    this.scene.add(this.playerLight);
  }

  dispose(): void {
    this.textureManager.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ── Per-frame ──────────────────────────────────────────────

  beginFrame(): void {
    // Animate flickering lights
    const time = performance.now() / 1000;
    for (const fl of this.flickerLights) {
      // Combine two sine waves at different frequencies for irregular flicker
      const wave =
        0.5 +
        0.3 * Math.sin(time * 8.7 + fl.phase) +
        0.2 * Math.sin(time * 13.3 + fl.phase * 2.1);
      fl.light.intensity = fl.baseIntensity * Math.max(0.1, wave);
    }
  }

  render(
    camera: CameraState,
    _renderables: RenderableEntity[],
    _lights: LightState[],
  ): void {
    this.camera.position.set(camera.position.x, camera.height, camera.position.z);
    this.camera.rotation.set(0, camera.yaw, 0);
    this.camera.fov = camera.fov;
    this.camera.updateProjectionMatrix();

    // Move player headlamp to camera position
    this.playerLight.position.copy(this.camera.position);

    this.composer.render();
  }

  endFrame(): void {
    // No-op
  }

  // ── World geometry ─────────────────────────────────────────

  loadMap(mapData: MapData): void {
    this.unloadMap();
    this.mapGroup = new THREE.Group();
    this.flickerLights = [];

    // Build wall geometry from linedefs
    for (const linedef of mapData.linedefs) {
      this.buildWallsFromLinedef(linedef, mapData);
    }

    // Build floor/ceiling geometry from sectors
    for (const sector of mapData.sectors) {
      this.buildSectorSurfaces(sector.id, mapData);
    }

    // Place lights from things
    let lightIdx = 0;
    for (const thing of mapData.things) {
      if (thing.type === ThingType.LIGHT_NEON || thing.type === ThingType.LIGHT_FLICKER) {
        const color = NEON_COLORS[lightIdx % NEON_COLORS.length];
        const baseIntensity = thing.type === ThingType.LIGHT_NEON ? 8 : 6;

        // Determine the floor height at the light's position
        const floorH = this.getFloorHeightAt(thing.position[0], thing.position[1], mapData);
        const lightY = floorH + 2.5; // Mid-height — illuminates walls and floor

        // Emissive marker (glowing sphere)
        const geo = new THREE.SphereGeometry(0.12, 8, 8);
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 4,
        });
        const marker = new THREE.Mesh(geo, mat);
        marker.position.set(thing.position[0], lightY, thing.position[1]);
        this.mapGroup.add(marker);

        // Point light — generous range to fill rooms
        const light = new THREE.PointLight(color, baseIntensity, 20);
        light.position.set(thing.position[0], lightY, thing.position[1]);
        this.mapGroup.add(light);

        // Track flickering lights for animation
        if (thing.type === ThingType.LIGHT_FLICKER) {
          this.flickerLights.push({
            light,
            baseIntensity,
            phase: Math.random() * Math.PI * 2,
          });
        }

        lightIdx++;
      }
    }

    // Hemisphere light — sky (blue-grey) + ground (dark indigo) fill
    const hemiLight = new THREE.HemisphereLight(0x8888aa, 0x333355, 0.8);
    this.mapGroup.add(hemiLight);

    // Ambient for baseline visibility everywhere
    this.mapGroup.add(new THREE.AmbientLight(0x9999bb, 0.35));

    // Fog — use map density but cap it to prevent over-darkening
    const fogDensity = Math.min(mapData.fogDensity, 0.03);
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(mapData.fogColor.r, mapData.fogColor.g, mapData.fogColor.b),
      fogDensity,
    );

    this.scene.add(this.mapGroup);
  }

  unloadMap(): void {
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      // Dispose geometries and materials in the group
      this.mapGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
        if (obj instanceof THREE.Light) {
          obj.dispose();
        }
      });
      this.mapGroup = null;
    }
  }

  // ── Dynamic entities (stubs) ───────────────────────────────

  addSprite(_id: string, _config: SpriteConfig): void {}
  updateSprite(_id: string, _position: Vec3, _frame: number): void {}
  removeSprite(_id: string): void {}

  // ── Effects ────────────────────────────────────────────────

  setAmbientLight(color: Color, intensity: number): void {
    const existing = this.scene.children.filter((c) => c instanceof THREE.AmbientLight);
    existing.forEach((c) => this.scene.remove(c));
    this.scene.add(new THREE.AmbientLight(new THREE.Color(color.r, color.g, color.b), intensity));
  }

  addPointLight(id: string, position: Vec3, color: Color, intensity: number, distance: number): void {
    this.removePointLight(id);
    const light = new THREE.PointLight(new THREE.Color(color.r, color.g, color.b), intensity, distance);
    light.position.set(position.x, position.y, position.z);
    this.scene.add(light);
    this.pointLights.set(id, light);
  }

  removePointLight(id: string): void {
    const light = this.pointLights.get(id);
    if (light) {
      this.scene.remove(light);
      light.dispose();
      this.pointLights.delete(id);
    }
  }

  setFog(color: Color, _near: number, far: number): void {
    this.scene.fog = new THREE.FogExp2(new THREE.Color(color.r, color.g, color.b), 1 / far);
  }

  screenShake(_intensity: number, _duration: number): void {}

  drawHUD(_hudState: HUDState): void {}

  // ── Resize ─────────────────────────────────────────────────

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  // ══════════════════════════════════════════════════════════
  //  PRIVATE — Geometry builders
  // ══════════════════════════════════════════════════════════

  /** Build wall quads for a single linedef. */
  private buildWallsFromLinedef(linedef: LineDef, mapData: MapData): void {
    if (linedef.frontSector === null && linedef.backSector === null) return;

    const v1 = mapData.vertices[linedef.v1];
    const v2 = mapData.vertices[linedef.v2];

    const frontSector =
      linedef.frontSector !== null
        ? mapData.sectors.find((s) => s.id === linedef.frontSector)
        : null;
    const backSector =
      linedef.backSector !== null
        ? mapData.sectors.find((s) => s.id === linedef.backSector)
        : null;

    if (frontSector && !backSector) {
      // Single-sided wall: full height
      const tex = linedef.frontTexture?.middle ?? 'wall_concrete';
      this.createWallQuad(v1, v2, frontSector.floorHeight, frontSector.ceilingHeight, tex);
    } else if (frontSector && backSector) {
      // Two-sided linedef — potential upper, lower, and middle walls

      // Lower wall (front floor lower than back floor)
      if (frontSector.floorHeight < backSector.floorHeight) {
        const tex = linedef.frontTexture?.lower ?? linedef.frontTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, frontSector.floorHeight, backSector.floorHeight, tex);
      }
      if (backSector.floorHeight < frontSector.floorHeight) {
        const tex = linedef.backTexture?.lower ?? linedef.backTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, backSector.floorHeight, frontSector.floorHeight, tex);
      }

      // Upper wall (front ceiling higher than back ceiling)
      if (frontSector.ceilingHeight > backSector.ceilingHeight) {
        const tex = linedef.frontTexture?.upper ?? linedef.frontTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, backSector.ceilingHeight, frontSector.ceilingHeight, tex);
      }
      if (backSector.ceilingHeight > frontSector.ceilingHeight) {
        const tex = linedef.backTexture?.upper ?? linedef.backTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, frontSector.ceilingHeight, backSector.ceilingHeight, tex);
      }

      // Middle texture on two-sided linedefs (e.g., doors, railings)
      if (linedef.frontTexture?.middle) {
        const bottom = Math.max(frontSector.floorHeight, backSector.floorHeight);
        const top = Math.min(frontSector.ceilingHeight, backSector.ceilingHeight);
        if (top > bottom) {
          this.createWallQuad(v1, v2, bottom, top, linedef.frontTexture.middle);
        }
      }
    } else if (!frontSector && backSector) {
      // Back-only linedef: render from back sector's perspective
      const tex = linedef.backTexture?.middle ?? 'wall_concrete';
      this.createWallQuad(v1, v2, backSector.floorHeight, backSector.ceilingHeight, tex);
    }
  }

  /** Create a single wall quad between two map vertices at given heights. */
  private createWallQuad(
    v1: [number, number],
    v2: [number, number],
    bottom: number,
    top: number,
    textureName: string,
  ): void {
    if (top <= bottom) return;

    const dx = v2[0] - v1[0];
    const dz = v2[1] - v1[1];
    const wallLength = Math.sqrt(dx * dx + dz * dz);
    if (wallLength < 0.001) return;

    const wallHeight = top - bottom;

    // Vertex positions: bottom-left, bottom-right, top-right, top-left
    const positions = new Float32Array([
      v1[0], bottom, v1[1],
      v2[0], bottom, v2[1],
      v2[0], top, v2[1],
      v1[0], top, v1[1],
    ]);

    const indices = [0, 1, 2, 0, 2, 3];

    // Normal — perpendicular to the wall on the right side of v1→v2
    const nx = dz / wallLength;
    const nz = -dx / wallLength;
    const normals = new Float32Array([
      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,
    ]);

    // UVs — tile based on world dimensions
    const uRepeat = wallLength / 4;
    const vRepeat = wallHeight / 4;
    const uvs = new Float32Array([
      0, 0,
      uRepeat, 0,
      uRepeat, vRepeat,
      0, vRepeat,
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const material = this.textureManager.getMaterial(textureName);
    const mesh = new THREE.Mesh(geo, material);
    this.mapGroup!.add(mesh);
  }

  /** Build floor and ceiling meshes for a sector. */
  private buildSectorSurfaces(sectorId: number, mapData: MapData): void {
    const sector = mapData.sectors.find((s) => s.id === sectorId);
    if (!sector) return;

    const polygon = this.buildSectorPolygon(sectorId, mapData);
    if (polygon.length < 3) return;

    // Floor
    this.createHorizontalSurface(polygon, sector.floorHeight, sector.floorTexture, true);
    // Ceiling
    this.createHorizontalSurface(polygon, sector.ceilingHeight, sector.ceilingTexture, false);
  }

  /** Extract the polygon (array of [x, z] points) for a sector from its linedefs. */
  private buildSectorPolygon(sectorId: number, mapData: MapData): [number, number][] {
    // Collect unique vertex indices for this sector
    const vertexIndices = new Set<number>();
    for (const ld of mapData.linedefs) {
      if (ld.frontSector === sectorId || ld.backSector === sectorId) {
        vertexIndices.add(ld.v1);
        vertexIndices.add(ld.v2);
      }
    }

    if (vertexIndices.size < 3) return [];

    const points = [...vertexIndices].map((idx) => mapData.vertices[idx]);

    // Sort by angle from centroid to form a valid polygon
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cz = points.reduce((s, p) => s + p[1], 0) / points.length;

    points.sort((a, b) => {
      return Math.atan2(a[1] - cz, a[0] - cx) - Math.atan2(b[1] - cz, b[0] - cx);
    });

    return points;
  }

  /** Create a floor or ceiling mesh from a polygon at a given height. */
  private createHorizontalSurface(
    polygon: [number, number][],
    height: number,
    textureName: string,
    isFloor: boolean,
  ): void {
    // Use THREE.Shape for triangulation (operates in XY, we map x→x, z→y)
    const shape = new THREE.Shape();
    shape.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i][0], polygon[i][1]);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);

    // ShapeGeometry lies in XY plane. Rotate so it lies in XZ plane.
    // rotateX(-PI/2): (x, y, z) → (x, z, -y)
    // Since our shape's y = map z, after rotation: 3D.z = -map.z (inverted).
    // Fix: rotate X by +PI/2 for floor (face up), -PI/2 for ceiling (face down).
    if (isFloor) {
      // Rotate so face points +Y (up)
      geo.rotateX(-Math.PI / 2);
      // Fix Z inversion by scaling
      geo.scale(1, 1, -1);
    } else {
      // Ceiling: face points -Y (down)
      geo.rotateX(Math.PI / 2);
      geo.scale(1, 1, -1);
    }

    // Recompute UVs based on world XZ position (tiled every 4 units)
    const posAttr = geo.getAttribute('position');
    const uvAttr = geo.getAttribute('uv');
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      uvAttr.setXY(i, x / 4, z / 4);
    }
    uvAttr.needsUpdate = true;

    const material = this.textureManager.getMaterial(textureName);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = height;
    this.mapGroup!.add(mesh);
  }

  /** Determine floor height at a world position (for placing light things). */
  private getFloorHeightAt(x: number, z: number, mapData: MapData): number {
    // Simple: find sector containing this point via centroid distance (good enough for light placement)
    let closestSector = mapData.sectors[0];
    let closestDist = Infinity;

    for (const sector of mapData.sectors) {
      const polygon = this.buildSectorPolygon(sector.id, mapData);
      if (polygon.length < 3) continue;
      const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
      const cz = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
      const dist = (x - cx) ** 2 + (z - cz) ** 2;
      if (dist < closestDist) {
        closestDist = dist;
        closestSector = sector;
      }
    }

    return closestSector.floorHeight;
  }
}
