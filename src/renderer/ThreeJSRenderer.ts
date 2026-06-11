import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { TextureManager } from './TextureManager.ts';
import { SpriteAtlasManager } from './SpriteAtlasManager.ts';
import { TransientFxSystem } from './TransientFxSystem.ts';
import { AtmosphereSystem } from './AtmosphereSystem.ts';
import type { IRenderer } from './IRenderer.ts';
import type {
  CameraState,
  Color,
  HUDState,
  LightState,
  RenderableEntity,
  SpriteConfig,
  Vec3,
  WeaponViewmodelState,
} from './RenderTypes.ts';
import type { MapData, LineDef, Sector } from '../world/MapTypes.ts';
import { ThingType } from '../world/MapTypes.ts';
import { HUD } from '../ui/HUD.ts';

// ── Neon colors for light things ─────────────────────────────
const NEON_COLORS: number[] = [0x00ccff, 0xff8800, 0xff0066, 0x00ff88, 0x0066ff];

interface FlickerLight {
  light: THREE.PointLight;
  baseIntensity: number;
  phase: number;
}

interface SpriteInstance {
  sprite: THREE.Sprite;
  texture: THREE.Texture;
  spriteKey: string;
  frameCount: number;
}

// ── Weapon viewmodel colors (procedural until real sprites exist) ──
const WEAPON_COLORS: Record<number, string> = {
  1: '#888888', // Baton - grey
  2: '#cccccc', // Pistol - silver
  3: '#aa6633', // Shotgun - brown
  4: '#556677', // Auto-Rifle - gunmetal
  5: '#447744', // Launcher - olive
};

const WEAPON_SHAPES: Record<number, string> = {
  1: 'baton',
  2: 'pistol',
  3: 'shotgun',
  4: 'rifle',
  5: 'launcher',
};

interface ViewmodelTuning {
  scale: number;
  xOffsetPx: number;
  yOffsetPx: number;
  bobX: number;
  bobY: number;
  bobSpeed: number;
  fireKickY: number;
  fireJitterX: number;
  recoverySettleY: number;
}

const VIEWMODEL_TUNING: Record<number, ViewmodelTuning> = {
  // Baton: more sway and slightly right-biased hand position.
  1: {
    scale: 1.02,
    xOffsetPx: 20,
    yOffsetPx: -16,
    bobX: 1.4,
    bobY: 4.8,
    bobSpeed: 8.0,
    fireKickY: 10,
    fireJitterX: 2.2,
    recoverySettleY: 4.2,
  },
  // Pistol: centered, moderate recoil.
  2: {
    scale: 1.08,
    xOffsetPx: 0,
    yOffsetPx: -24,
    bobX: 0.8,
    bobY: 3.2,
    bobSpeed: 7.2,
    fireKickY: 18,
    fireJitterX: 1.4,
    recoverySettleY: 6.5,
  },
  // Shotgun: heavier stance and larger kick.
  3: {
    scale: 1.22,
    xOffsetPx: 0,
    yOffsetPx: -28,
    bobX: 0.5,
    bobY: 2.0,
    bobSpeed: 5.8,
    fireKickY: 28,
    fireJitterX: 2.0,
    recoverySettleY: 9.0,
  },
  // Auto-rifle: frequent fire with controlled kick.
  4: {
    scale: 1.16,
    xOffsetPx: 10,
    yOffsetPx: -24,
    bobX: 0.9,
    bobY: 2.8,
    bobSpeed: 8.4,
    fireKickY: 12,
    fireJitterX: 2.4,
    recoverySettleY: 5.0,
  },
  // Launcher: largest footprint and strongest recoil.
  5: {
    scale: 1.24,
    xOffsetPx: 6,
    yOffsetPx: -22,
    bobX: 0.4,
    bobY: 1.7,
    bobSpeed: 5.0,
    fireKickY: 34,
    fireJitterX: 2.8,
    recoverySettleY: 11.0,
  },
};

const DEFAULT_VIEWMODEL_TUNING: ViewmodelTuning = {
  scale: 1.0,
  xOffsetPx: 0,
  yOffsetPx: -20,
  bobX: 0.8,
  bobY: 2.8,
  bobSpeed: 7.0,
  fireKickY: 16,
  fireJitterX: 1.5,
  recoverySettleY: 6.0,
};

const NEON_MOOD_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignette: { value: 0.26 },
    grain: { value: 0.035 },
    chroma: { value: 0.0016 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float vignette;
    uniform float grain;
    uniform float chroma;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered);
      vec2 dir = dist > 0.0001 ? normalize(centered) : vec2(0.0);

      vec2 rUv = vUv + dir * chroma * dist;
      vec2 bUv = vUv - dir * chroma * dist;

      float r = texture2D(tDiffuse, rUv).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, bUv).b;
      vec3 color = vec3(r, g, b);

      float vig = smoothstep(0.2, 1.0, dist);
      color *= 1.0 - vig * vignette;

      float n = rand(vUv * vec2(1280.0, 720.0) + time * 41.37) - 0.5;
      color += n * grain;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class ThreeJSRenderer implements IRenderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private moodPass!: ShaderPass;
  private moodTime: number = 0;
  private frameDt: number = 0;
  private pointLights: Map<string, THREE.PointLight> = new Map();
  private mapGroup: THREE.Group | null = null;
  private textureManager: TextureManager = new TextureManager();
  private spriteAtlasManager: SpriteAtlasManager = new SpriteAtlasManager();
  private transientFxSystem: TransientFxSystem | null = null;
  private atmosphereSystem: AtmosphereSystem | null = null;
  private flickerLights: FlickerLight[] = [];
  private playerLight!: THREE.PointLight;

  // ── Screen shake state ────────────────────────────────────
  private shakeIntensity: number = 0;
  private shakeDuration: number = 0;
  private shakeRemaining: number = 0;
  private shakeOffsetX: number = 0;
  private shakeOffsetY: number = 0;

  // ── Muzzle flash state ────────────────────────────────────
  private muzzleFlashLight: THREE.PointLight | null = null;
  private muzzleFlashTimer: number = 0;
  private static readonly MUZZLE_FLASH_DURATION = 0.06;

  // ── HUD canvas ────────────────────────────────────────────
  private hudCanvas: HTMLCanvasElement | null = null;
  private hudCtx: CanvasRenderingContext2D | null = null;

  // ── Sprites ───────────────────────────────────────────────
  private sprites: Map<string, SpriteInstance> = new Map();

  // ── HUD renderer ─────────────────────────────────────────
  private hud: HUD | null = null;

  // ── Sector meshes for dynamic updates (doors) ─────────────
  /** Ceiling meshes indexed by sector ID — updated when doors open/close. */
  private sectorCeilingMeshes: Map<number, THREE.Mesh> = new Map();
  /** Upper/middle wall meshes for two-sided linedefs adjacent to a sector. */
  private sectorWallMeshes: Map<number, THREE.Mesh[]> = new Map();
  private currentMapData: MapData | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    // ── WebGL Renderer ───────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.8;

    // ── Scene & Camera ───────────────────────────────────────
    this.scene = new THREE.Scene();
    this.transientFxSystem = new TransientFxSystem(this.scene);
    this.atmosphereSystem = new AtmosphereSystem(this.scene);

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

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,  // strength
      0.5,  // radius
      0.55, // threshold — only true emissives (neon, flashes) should bloom
    );
    this.composer.addPass(this.bloomPass);

    this.moodPass = new ShaderPass(NEON_MOOD_SHADER);
    this.composer.addPass(this.moodPass);
    this.composer.addPass(new OutputPass());

    // Player headlamp
    this.playerLight = new THREE.PointLight(0xeeddcc, 2.5, 18);
    this.scene.add(this.playerLight);

    // Muzzle flash light (starts disabled)
    this.muzzleFlashLight = new THREE.PointLight(0xffaa44, 0, 15);
    this.scene.add(this.muzzleFlashLight);

    // ── HUD overlay canvas ───────────────────────────────────
    this.initHudCanvas();

    // Load authored sprites. If unavailable, entity rendering falls back
    // to procedural placeholders so gameplay remains functional.
    try {
      await this.spriteAtlasManager.loadDefaultAtlases();
    } catch (err) {
      console.warn('Sprite atlas preload failed; using fallback sprites.', err);
    }
  }

  private initHudCanvas(): void {
    // Look for existing HUD canvas or create one
    let hudCanvas = document.getElementById('hud-canvas') as HTMLCanvasElement | null;
    if (!hudCanvas) {
      hudCanvas = document.createElement('canvas');
      hudCanvas.id = 'hud-canvas';
      hudCanvas.style.position = 'absolute';
      hudCanvas.style.top = '0';
      hudCanvas.style.left = '0';
      hudCanvas.style.width = '100%';
      hudCanvas.style.height = '100%';
      hudCanvas.style.pointerEvents = 'none';
      hudCanvas.style.zIndex = '5';
      document.body.appendChild(hudCanvas);
    }
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
    this.hudCanvas = hudCanvas;
    this.hudCtx = hudCanvas.getContext('2d')!;
    this.hud = new HUD(this.hudCtx, hudCanvas.width, hudCanvas.height);
  }

  dispose(): void {
    this.transientFxSystem?.dispose();
    this.transientFxSystem = null;
    this.atmosphereSystem?.dispose();
    this.atmosphereSystem = null;

    // Remove/destroy live dynamic sprites first.
    for (const id of [...this.sprites.keys()]) {
      this.removeSprite(id);
    }

    this.textureManager.dispose();
    this.spriteAtlasManager.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.hudCanvas) {
      this.hudCanvas.remove();
      this.hudCanvas = null;
      this.hudCtx = null;
    }
  }

  // ── Per-frame ──────────────────────────────────────────────

  beginFrame(dt: number): void {
    this.frameDt = dt;
    this.moodTime += dt;

    // Animate flickering lights
    const time = performance.now() / 1000;
    for (const fl of this.flickerLights) {
      const wave =
        0.5 +
        0.3 * Math.sin(time * 8.7 + fl.phase) +
        0.2 * Math.sin(time * 13.3 + fl.phase * 2.1);
      fl.light.intensity = fl.baseIntensity * Math.max(0.1, wave);
    }

    // Update screen shake
    if (this.shakeRemaining > 0) {
      this.shakeRemaining -= dt;
      const factor = Math.max(0, this.shakeRemaining / this.shakeDuration);
      const currentIntensity = this.shakeIntensity * factor;
      this.shakeOffsetX = (Math.random() - 0.5) * 2 * currentIntensity;
      this.shakeOffsetY = (Math.random() - 0.5) * 2 * currentIntensity;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }

    // Update muzzle flash
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlashLight!.intensity = 0;
      }
    }

    this.transientFxSystem?.update(dt);
    if (this.moodPass) {
      this.moodPass.uniforms.time.value = this.moodTime;
    }
  }

  render(
    camera: CameraState,
    _renderables: RenderableEntity[],
    _lights: LightState[],
  ): void {
    // Apply camera position with screen shake offset
    this.camera.position.set(
      camera.position.x + this.shakeOffsetX,
      camera.height + this.shakeOffsetY,
      camera.position.z,
    );
    this.camera.rotation.set(0, camera.yaw, 0);
    this.camera.fov = camera.fov;
    this.camera.updateProjectionMatrix();

    // Move player headlamp to camera position
    this.playerLight.position.copy(this.camera.position);

    // Move muzzle flash light to camera position
    if (this.muzzleFlashLight && this.muzzleFlashTimer > 0) {
      this.muzzleFlashLight.position.copy(this.camera.position);
    }

    this.atmosphereSystem?.update(this.frameDt, {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    });

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
    this.currentMapData = mapData;
    this.sectorCeilingMeshes.clear();
    this.sectorWallMeshes.clear();

    // Identify door sectors — the actual door corridor, not the adjacent rooms.
    // Matches DoorSystem logic: the door sector is backSector ?? frontSector.
    const doorSectorIds = new Set<number>();
    for (const ld of mapData.linedefs) {
      if (ld.flags?.door) {
        const doorSectorId = ld.backSector ?? ld.frontSector;
        if (doorSectorId !== null) doorSectorIds.add(doorSectorId);
      }
    }

    // Build wall geometry from linedefs
    // For two-sided linedefs adjacent to door sectors, store the meshes separately
    for (const linedef of mapData.linedefs) {
      const touchesDoor =
        (linedef.frontSector !== null && doorSectorIds.has(linedef.frontSector)) ||
        (linedef.backSector !== null && doorSectorIds.has(linedef.backSector));

      if (touchesDoor && linedef.frontSector !== null && linedef.backSector !== null) {
        // Two-sided linedef adjacent to a door — build walls and track them
        this.buildDoorAdjacentWalls(linedef, mapData, doorSectorIds);
      } else {
        this.buildWallsFromLinedef(linedef, mapData);
      }
    }

    // Build floor/ceiling geometry from sectors
    for (const sector of mapData.sectors) {
      if (doorSectorIds.has(sector.id)) {
        // Door sector — track ceiling mesh separately for dynamic updates
        this.buildDoorSectorSurfaces(sector.id, mapData);
      } else {
        this.buildSectorSurfaces(sector.id, mapData);
      }
    }

    // Place lights from things
    let lightIdx = 0;
    const steamVents: Vec3[] = [];
    for (const thing of mapData.things) {
      if (thing.type === ThingType.LIGHT_NEON || thing.type === ThingType.LIGHT_FLICKER) {
        const color = NEON_COLORS[lightIdx % NEON_COLORS.length];
        const baseIntensity = thing.type === ThingType.LIGHT_NEON ? 8 : 6;

        const floorH = this.getFloorHeightAt(thing.position[0], thing.position[1], mapData);
        const lightY = floorH + 2.5;

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

        // Emissive neon panel accent near the light source to strengthen signage look.
        this.createNeonPanel(
          thing.position[0],
          lightY - 0.15,
          thing.position[1],
          color,
          lightIdx,
        );

        // Point light
        const light = new THREE.PointLight(color, baseIntensity, 20);
        light.position.set(thing.position[0], lightY, thing.position[1]);
        this.mapGroup.add(light);

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

    for (const vent of mapData.atmosphere?.steamVents ?? []) {
      const floorH = this.getFloorHeightAt(vent[0], vent[1], mapData);
      steamVents.push({
        x: vent[0],
        y: floorH + 0.08,
        z: vent[1],
      });
    }

    // Hemisphere light
    const hemiLight = new THREE.HemisphereLight(0x8888aa, 0x333355, 0.8);
    this.mapGroup.add(hemiLight);

    // Ambient
    this.mapGroup.add(new THREE.AmbientLight(0x9999bb, 0.35));

    // Fog
    const fogDensity = Math.min(mapData.fogDensity, 0.03);
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(mapData.fogColor.r, mapData.fogColor.g, mapData.fogColor.b),
      fogDensity,
    );

    this.applyAtmospherePostSettings(mapData);
    this.atmosphereSystem?.configure({
      rainEnabled: mapData.atmosphere?.rain ?? false,
      rainDensity: mapData.atmosphere?.rainDensity ?? 0.45,
      rainSpeed: mapData.atmosphere?.rainSpeed ?? 11,
      rainRipplesEnabled: mapData.atmosphere?.rainRipples ?? true,
      rainRippleDensity: mapData.atmosphere?.rainRippleDensity ?? 0.5,
      steamEnabled: mapData.atmosphere?.steam ?? true,
      steamDensity: mapData.atmosphere?.steamDensity ?? 0.4,
      steamVents,
    });

    this.scene.add(this.mapGroup);
  }

  unloadMap(): void {
    this.transientFxSystem?.clear();
    this.atmosphereSystem?.clear();

    for (const id of [...this.sprites.keys()]) {
      this.removeSprite(id);
    }

    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      this.mapGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            for (const mat of obj.material) {
              mat.dispose();
            }
          } else {
            obj.material.dispose();
          }
        }
        if (obj instanceof THREE.Light) {
          obj.dispose();
        }
      });
      this.mapGroup = null;
    }
    this.currentMapData = null;
    this.sectorCeilingMeshes.clear();
    this.sectorWallMeshes.clear();
  }

  // ── Dynamic entities ─────────────────────────────────────

  addSprite(id: string, config: SpriteConfig): void {
    // Remove previous instance if this ID is being reused.
    this.removeSprite(id);

    const atlasSprite = this.spriteAtlasManager.createSpriteMaterial(config.spriteSheet);

    let sprite: THREE.Sprite;
    let texture: THREE.Texture;
    let frameCount = 1;
    let frameWidth = config.frameWidth;
    let frameHeight = config.frameHeight;

    if (atlasSprite) {
      sprite = new THREE.Sprite(atlasSprite.material);
      texture = atlasSprite.texture;
      frameCount = atlasSprite.frameCount;
      frameWidth = atlasSprite.frameWidth;
      frameHeight = atlasSprite.frameHeight;
    } else {
      const fallbackTexture = this.createFallbackSpriteTexture(
        config.spriteSheet,
        config.frameWidth || 64,
        config.frameHeight || 64,
      );
      const material = new THREE.SpriteMaterial({
        map: fallbackTexture,
        transparent: true,
      });
      sprite = new THREE.Sprite(material);
      texture = fallbackTexture;
    }

    const brightness = config.brightness ?? 1;
    if (brightness < 1) {
      sprite.material.color.setScalar(brightness);
    }

    const aspect = frameHeight / Math.max(1, frameWidth);
    const baseScale = config.worldScale ?? 1;
    sprite.scale.set(baseScale, baseScale * aspect, 1);
    this.scene.add(sprite);
    this.sprites.set(id, {
      sprite,
      texture,
      spriteKey: config.spriteSheet,
      frameCount,
    });
  }

  updateSprite(id: string, position: Vec3, frame: number): void {
    const entry = this.sprites.get(id);
    if (entry) {
      entry.sprite.position.set(position.x, position.y, position.z);
      if (entry.frameCount > 1 || this.spriteAtlasManager.hasSprite(entry.spriteKey)) {
        this.spriteAtlasManager.applyFrame(entry.texture, entry.spriteKey, frame);
      }
    }
  }

  setSpriteAnimation(id: string, spriteKey: string): void {
    const entry = this.sprites.get(id);
    if (!entry || entry.spriteKey === spriteKey) return;
    if (!this.spriteAtlasManager.hasSprite(spriteKey)) return;

    entry.spriteKey = spriteKey;
    entry.frameCount = this.spriteAtlasManager.getFrameCount(spriteKey);
    this.spriteAtlasManager.applyFrame(entry.texture, spriteKey, 0);
  }

  removeSprite(id: string): void {
    const entry = this.sprites.get(id);
    if (entry) {
      this.scene.remove(entry.sprite);
      entry.sprite.material.dispose();
      entry.texture.dispose();
      this.sprites.delete(id);
    }
  }

  private createFallbackSpriteTexture(
    spriteKey: string,
    width: number,
    height: number,
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Stable pseudo-random color derived from key name.
    let hash = 0;
    for (let i = 0; i < spriteKey.length; i++) {
      hash = (hash * 31 + spriteKey.charCodeAt(i)) & 0xffffff;
    }
    const r = 80 + ((hash >> 16) & 0x7f);
    const g = 80 + ((hash >> 8) & 0x7f);
    const b = 80 + (hash & 0x7f);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(6, 6, width - 12, height - 12);
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, width - 12, height - 12);

    const label = spriteKey
      .split('_')
      .map((chunk) => chunk[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();
    ctx.fillStyle = '#101018';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
  }

  // ── Effects ──────────────────────────────────────────────

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

  private applyAtmospherePostSettings(mapData: MapData): void {
    const atmosphere = mapData.atmosphere ?? {};

    if (this.bloomPass) {
      this.bloomPass.strength = THREE.MathUtils.clamp(atmosphere.bloomStrength ?? 0.75, 0.2, 1.6);
    }
    if (this.moodPass) {
      this.moodPass.uniforms.vignette.value = THREE.MathUtils.clamp(atmosphere.vignette ?? 0.26, 0, 0.8);
      this.moodPass.uniforms.grain.value = THREE.MathUtils.clamp(atmosphere.grain ?? 0.035, 0, 0.25);
      this.moodPass.uniforms.chroma.value = THREE.MathUtils.clamp(atmosphere.chromaticAberration ?? 0.0016, 0, 0.006);
    }
  }

  screenShake(intensity: number, duration: number): void {
    // Stack shakes: use the stronger of existing and new
    if (intensity > this.shakeIntensity * (this.shakeRemaining / this.shakeDuration || 0)) {
      this.shakeIntensity = intensity;
      this.shakeDuration = duration;
      this.shakeRemaining = duration;
    }
  }

  muzzleFlash(): void {
    if (this.muzzleFlashLight) {
      this.muzzleFlashLight.intensity = 25;
      this.muzzleFlashLight.color.setHex(0xffaa44);
      this.muzzleFlashTimer = ThreeJSRenderer.MUZZLE_FLASH_DURATION;
    }
  }

  spawnImpactFx(position: Vec3, normal?: Vec3): void {
    this.transientFxSystem?.spawnImpact(position, normal);
  }

  spawnExplosionFx(position: Vec3, scale: number = 1, normal?: Vec3): void {
    this.transientFxSystem?.spawnExplosion(position, scale, normal);
  }

  spawnPickupFx(position: Vec3): void {
    this.transientFxSystem?.spawnPickup(position);
  }

  spawnDoorFx(position: Vec3): void {
    this.transientFxSystem?.spawnDoorPulse(position);
  }

  // ── Weapon Viewmodel ─────────────────────────────────────

  drawWeaponViewmodel(state: WeaponViewmodelState): void {
    if (!this.hudCtx || !this.hudCanvas) return;

    const ctx = this.hudCtx;
    const w = this.hudCanvas.width;
    const h = this.hudCanvas.height;

    // Clear the entire HUD canvas (weapon + HUD draw in same frame)
    ctx.clearRect(0, 0, w, h);

    const tuning = VIEWMODEL_TUNING[state.weaponId] ?? DEFAULT_VIEWMODEL_TUNING;

    // Weapon position: centered at bottom with per-weapon scale/anchor tuning.
    const baseWeaponW = Math.min(320, w * 0.34);
    const baseWeaponH = Math.min(320, h * 0.5);
    const weaponW = baseWeaponW * tuning.scale;
    const weaponH = baseWeaponH * tuning.scale;
    const baseX = (w - weaponW) / 2 + tuning.xOffsetPx;
    const baseY = h - weaponH + tuning.yOffsetPx;

    // Slide offset for weapon switching
    const slideOffset = state.offset * weaponH * 1.2;

    const time = performance.now() / 1000;
    let bobX = 0;
    let bobY = 0;
    if (state.state === 'ready') {
      bobX =
        Math.cos(time * tuning.bobSpeed * 0.5) * tuning.bobX;
      bobY =
        Math.sin(time * tuning.bobSpeed) * tuning.bobY +
        Math.sin(time * tuning.bobSpeed * 0.65) * tuning.bobY * 0.35;
    }

    let recoilX = 0;
    let recoilY = 0;
    if (state.isFiring) {
      recoilX = (Math.random() - 0.5) * 2 * tuning.fireJitterX;
      recoilY = -tuning.fireKickY;
    } else if (state.state === 'recovery') {
      recoilY = -tuning.recoverySettleY;
    }

    const finalX = baseX + bobX + recoilX;
    const finalY = baseY + slideOffset + bobY + recoilY;

    const color = WEAPON_COLORS[state.weaponId] || '#cccccc';
    const shape = WEAPON_SHAPES[state.weaponId] || 'pistol';
    const spriteKey = this.getViewmodelSpriteKey(state);

    ctx.save();
    const drewAtlas = this.spriteAtlasManager.drawFrameToCanvas(
      ctx,
      spriteKey,
      0,
      finalX,
      finalY,
      weaponW,
      weaponH,
    );

    // Fallback path (procedural) if atlas is unavailable.
    if (!drewAtlas) {
      this.drawWeaponShape(ctx, finalX, finalY, weaponW, weaponH, color, shape);
    }

    // Muzzle flash overlay
    if (state.isFiring && !drewAtlas) {
      this.drawMuzzleFlashSprite(ctx, finalX + weaponW / 2, finalY - 10);
    }

    ctx.restore();
  }

  private getViewmodelSpriteKey(state: WeaponViewmodelState): string {
    const weaponNameById: Record<number, string> = {
      1: 'baton',
      2: 'pistol',
      3: 'shotgun',
      4: 'auto_rifle',
      5: 'launcher',
    };

    const weaponName = weaponNameById[state.weaponId] ?? 'pistol';

    let phase = state.state;
    if (state.isFiring) {
      phase = 'fire';
    } else if (phase === 'lower' || phase === 'raise') {
      phase = 'ready';
    } else if (phase !== 'ready' && phase !== 'recovery') {
      phase = 'ready';
    }

    return `viewmodel_${weaponName}_${phase}`;
  }

  private drawWeaponShape(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    shape: string,
  ): void {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2;

    switch (shape) {
      case 'baton':
        // Vertical bar (baton/club)
        ctx.fillRect(x + w * 0.4, y + h * 0.1, w * 0.2, h * 0.85);
        ctx.strokeRect(x + w * 0.4, y + h * 0.1, w * 0.2, h * 0.85);
        // Handle grip
        ctx.fillStyle = '#554433';
        ctx.fillRect(x + w * 0.35, y + h * 0.7, w * 0.3, h * 0.25);
        break;

      case 'pistol':
        // Barrel
        ctx.fillRect(x + w * 0.3, y + h * 0.15, w * 0.4, h * 0.2);
        ctx.strokeRect(x + w * 0.3, y + h * 0.15, w * 0.4, h * 0.2);
        // Body
        ctx.fillRect(x + w * 0.25, y + h * 0.35, w * 0.5, h * 0.25);
        ctx.strokeRect(x + w * 0.25, y + h * 0.35, w * 0.5, h * 0.25);
        // Grip
        ctx.fillStyle = '#554433';
        ctx.fillRect(x + w * 0.35, y + h * 0.6, w * 0.3, h * 0.35);
        break;

      case 'shotgun':
        // Long barrel
        ctx.fillRect(x + w * 0.2, y + h * 0.05, w * 0.15, h * 0.55);
        ctx.strokeRect(x + w * 0.2, y + h * 0.05, w * 0.15, h * 0.55);
        // Second barrel
        ctx.fillRect(x + w * 0.38, y + h * 0.05, w * 0.15, h * 0.55);
        ctx.strokeRect(x + w * 0.38, y + h * 0.05, w * 0.15, h * 0.55);
        // Body/receiver
        ctx.fillRect(x + w * 0.15, y + h * 0.55, w * 0.45, h * 0.15);
        // Stock
        ctx.fillStyle = '#554433';
        ctx.fillRect(x + w * 0.25, y + h * 0.7, w * 0.25, h * 0.28);
        break;

      case 'rifle':
        // Barrel
        ctx.fillRect(x + w * 0.35, y + h * 0.05, w * 0.12, h * 0.45);
        ctx.strokeRect(x + w * 0.35, y + h * 0.05, w * 0.12, h * 0.45);
        // Body
        ctx.fillRect(x + w * 0.2, y + h * 0.4, w * 0.5, h * 0.18);
        ctx.strokeRect(x + w * 0.2, y + h * 0.4, w * 0.5, h * 0.18);
        // Magazine
        ctx.fillStyle = '#333333';
        ctx.fillRect(x + w * 0.38, y + h * 0.58, w * 0.12, h * 0.15);
        // Grip
        ctx.fillStyle = '#554433';
        ctx.fillRect(x + w * 0.32, y + h * 0.65, w * 0.2, h * 0.3);
        break;

      case 'launcher':
        // Wide tube
        ctx.fillRect(x + w * 0.2, y + h * 0.1, w * 0.4, h * 0.5);
        ctx.strokeRect(x + w * 0.2, y + h * 0.1, w * 0.4, h * 0.5);
        // Opening
        ctx.fillStyle = '#222222';
        ctx.fillRect(x + w * 0.25, y + h * 0.1, w * 0.3, h * 0.1);
        // Grip
        ctx.fillStyle = '#554433';
        ctx.fillRect(x + w * 0.32, y + h * 0.6, w * 0.2, h * 0.35);
        // Sight
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(x + w * 0.38, y + h * 0.05, w * 0.06, h * 0.08);
        break;
    }
  }

  private drawMuzzleFlashSprite(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
  ): void {
    const radius = 30 + Math.random() * 15;

    // Outer glow
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, 'rgba(255, 200, 80, 0.9)');
    gradient.addColorStop(0.3, 'rgba(255, 150, 30, 0.6)');
    gradient.addColorStop(0.7, 'rgba(255, 100, 0, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 80, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Bright core
    ctx.fillStyle = 'rgba(255, 255, 200, 0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── HUD ──────────────────────────────────────────────────

  drawHUD(hudState: HUDState): void {
    if (!this.hud || !this.hudCanvas) return;
    this.hud.draw(hudState);
  }

  // ── Dynamic world updates ────────────────────────────────

  updateSectorCeiling(sectorId: number, newHeight: number): void {
    // Update ceiling mesh Y position
    const ceilingMesh = this.sectorCeilingMeshes.get(sectorId);
    if (ceilingMesh) {
      ceilingMesh.position.y = newHeight;
    }

    // Rebuild upper/middle wall meshes for linedefs adjacent to this sector
    const wallMeshes = this.sectorWallMeshes.get(sectorId);
    if (wallMeshes && this.currentMapData) {
      // Remove old wall meshes
      for (const mesh of wallMeshes) {
        this.mapGroup?.remove(mesh);
        mesh.geometry.dispose();
      }
      wallMeshes.length = 0;

      // Rebuild with current sector heights
      for (const ld of this.currentMapData.linedefs) {
        if (ld.frontSector !== sectorId && ld.backSector !== sectorId) continue;
        if (ld.frontSector === null || ld.backSector === null) continue;

        const frontSector = this.currentMapData.sectors.find((s: Sector) => s.id === ld.frontSector);
        const backSector = this.currentMapData.sectors.find((s: Sector) => s.id === ld.backSector);
        if (!frontSector || !backSector) continue;

        const v1 = this.currentMapData.vertices[ld.v1];
        const v2 = this.currentMapData.vertices[ld.v2];

        // Upper wall: front ceiling higher than back ceiling
        if (frontSector.ceilingHeight > backSector.ceilingHeight) {
          const tex = ld.frontTexture?.upper ?? ld.frontTexture?.middle ?? 'wall_concrete';
          const mesh = this.createWallQuadReturn(v1, v2, backSector.ceilingHeight, frontSector.ceilingHeight, tex);
          if (mesh) {
            this.mapGroup?.add(mesh);
            wallMeshes.push(mesh);
          }
        }
        if (backSector.ceilingHeight > frontSector.ceilingHeight) {
          const tex = ld.backTexture?.upper ?? ld.backTexture?.middle ?? 'wall_concrete';
          const mesh = this.createWallQuadReturn(v1, v2, frontSector.ceilingHeight, backSector.ceilingHeight, tex);
          if (mesh) {
            this.mapGroup?.add(mesh);
            wallMeshes.push(mesh);
          }
        }

        // Middle texture on non-door two-sided linedefs (e.g. grates, railings)
        // Door linedefs don't get a middle texture — the door visual is the
        // upper wall that shrinks as the ceiling rises (Doom-style).
        if (ld.frontTexture?.middle && !ld.flags?.door) {
          const bottom = Math.max(frontSector.floorHeight, backSector.floorHeight);
          const top = Math.min(frontSector.ceilingHeight, backSector.ceilingHeight);
          if (top > bottom) {
            const mesh = this.createWallQuadReturn(v1, v2, bottom, top, ld.frontTexture.middle);
            if (mesh) {
              this.mapGroup?.add(mesh);
              wallMeshes.push(mesh);
            }
          }
        }
      }
    }
  }

  // ── Resize ───────────────────────────────────────────────

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);

    // Resize HUD canvas
    if (this.hudCanvas) {
      this.hudCanvas.width = width;
      this.hudCanvas.height = height;
    }
    if (this.hud) {
      this.hud.resize(width, height);
    }
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
      const tex = linedef.frontTexture?.middle ?? 'wall_concrete';
      this.createWallQuad(v1, v2, frontSector.floorHeight, frontSector.ceilingHeight, tex);
    } else if (frontSector && backSector) {
      // Lower wall
      if (frontSector.floorHeight < backSector.floorHeight) {
        const tex = linedef.frontTexture?.lower ?? linedef.frontTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, frontSector.floorHeight, backSector.floorHeight, tex);
      }
      if (backSector.floorHeight < frontSector.floorHeight) {
        const tex = linedef.backTexture?.lower ?? linedef.backTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, backSector.floorHeight, frontSector.floorHeight, tex);
      }

      // Upper wall
      if (frontSector.ceilingHeight > backSector.ceilingHeight) {
        const tex = linedef.frontTexture?.upper ?? linedef.frontTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, backSector.ceilingHeight, frontSector.ceilingHeight, tex);
      }
      if (backSector.ceilingHeight > frontSector.ceilingHeight) {
        const tex = linedef.backTexture?.upper ?? linedef.backTexture?.middle ?? null;
        if (tex) this.createWallQuad(v1, v2, frontSector.ceilingHeight, backSector.ceilingHeight, tex);
      }

      // Middle texture on two-sided linedefs
      if (linedef.frontTexture?.middle) {
        const bottom = Math.max(frontSector.floorHeight, backSector.floorHeight);
        const top = Math.min(frontSector.ceilingHeight, backSector.ceilingHeight);
        if (top > bottom) {
          this.createWallQuad(v1, v2, bottom, top, linedef.frontTexture.middle);
        }
      }
    } else if (!frontSector && backSector) {
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

    const positions = new Float32Array([
      v1[0], bottom, v1[1],
      v2[0], bottom, v2[1],
      v2[0], top, v2[1],
      v1[0], top, v1[1],
    ]);

    const indices = [0, 1, 2, 0, 2, 3];

    const nx = dz / wallLength;
    const nz = -dx / wallLength;
    const normals = new Float32Array([
      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,
    ]);

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

  /** Create a wall quad and return the mesh (for door system dynamic updates). */
  private createWallQuadReturn(
    v1: [number, number],
    v2: [number, number],
    bottom: number,
    top: number,
    textureName: string,
  ): THREE.Mesh | null {
    if (top <= bottom) return null;

    const dx = v2[0] - v1[0];
    const dz = v2[1] - v1[1];
    const wallLength = Math.sqrt(dx * dx + dz * dz);
    if (wallLength < 0.001) return null;

    const wallHeight = top - bottom;

    const positions = new Float32Array([
      v1[0], bottom, v1[1],
      v2[0], bottom, v2[1],
      v2[0], top, v2[1],
      v1[0], top, v1[1],
    ]);

    const indices = [0, 1, 2, 0, 2, 3];

    const nx = dz / wallLength;
    const nz = -dx / wallLength;
    const normals = new Float32Array([
      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,
      nx, 0, nz,
    ]);

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
    return new THREE.Mesh(geo, material);
  }

  /** Build floor and ceiling meshes for a sector. */
  private buildSectorSurfaces(sectorId: number, mapData: MapData): void {
    const sector = mapData.sectors.find((s) => s.id === sectorId);
    if (!sector) return;

    const polygon = this.buildSectorPolygon(sectorId, mapData);
    if (polygon.length < 3) return;

    this.createHorizontalSurface(polygon, sector.floorHeight, sector.floorTexture, true);
    this.createHorizontalSurface(polygon, sector.ceilingHeight, sector.ceilingTexture, false);
  }

  /**
   * Build sector surfaces for a door sector, storing the ceiling mesh
   * separately so it can be repositioned when the door opens/closes.
   */
  private buildDoorSectorSurfaces(sectorId: number, mapData: MapData): void {
    const sector = mapData.sectors.find((s) => s.id === sectorId);
    if (!sector) return;

    const polygon = this.buildSectorPolygon(sectorId, mapData);
    if (polygon.length < 3) return;

    // Floor — static, added to mapGroup normally
    this.createHorizontalSurface(polygon, sector.floorHeight, sector.floorTexture, true);

    // Ceiling — tracked separately for dynamic Y updates
    const ceilingMesh = this.createHorizontalSurfaceReturn(polygon, sector.ceilingHeight, sector.ceilingTexture, false);
    if (ceilingMesh) {
      this.mapGroup!.add(ceilingMesh);
      this.sectorCeilingMeshes.set(sectorId, ceilingMesh);
    }

    // Initialize the wall mesh array for this sector (if not already populated by buildDoorAdjacentWalls)
    if (!this.sectorWallMeshes.has(sectorId)) {
      this.sectorWallMeshes.set(sectorId, []);
    }
  }

  /**
   * Build walls for a two-sided linedef adjacent to a door sector.
   * Upper walls and middle (door face) textures are stored in sectorWallMeshes
   * for dynamic rebuilding when the door ceiling changes.
   */
  private buildDoorAdjacentWalls(linedef: LineDef, mapData: MapData, doorSectorIds: Set<number>): void {
    const v1 = mapData.vertices[linedef.v1];
    const v2 = mapData.vertices[linedef.v2];

    const frontSector = linedef.frontSector !== null
      ? mapData.sectors.find((s) => s.id === linedef.frontSector) : null;
    const backSector = linedef.backSector !== null
      ? mapData.sectors.find((s) => s.id === linedef.backSector) : null;
    if (!frontSector || !backSector) return;

    // Determine which sector is the door sector (prefer backSector, matching DoorSystem)
    const doorSectorId = doorSectorIds.has(backSector.id) ? backSector.id : frontSector.id;

    // Ensure the wall mesh array exists
    if (!this.sectorWallMeshes.has(doorSectorId)) {
      this.sectorWallMeshes.set(doorSectorId, []);
    }
    const wallMeshes = this.sectorWallMeshes.get(doorSectorId)!;

    // Lower walls (static — floor height doesn't change for doors)
    if (frontSector.floorHeight < backSector.floorHeight) {
      const tex = linedef.frontTexture?.lower ?? linedef.frontTexture?.middle ?? null;
      if (tex) this.createWallQuad(v1, v2, frontSector.floorHeight, backSector.floorHeight, tex);
    }
    if (backSector.floorHeight < frontSector.floorHeight) {
      const tex = linedef.backTexture?.lower ?? linedef.backTexture?.middle ?? null;
      if (tex) this.createWallQuad(v1, v2, backSector.floorHeight, frontSector.floorHeight, tex);
    }

    // Upper walls (dynamic — tracked for rebuild when ceiling changes)
    if (frontSector.ceilingHeight > backSector.ceilingHeight) {
      const tex = linedef.frontTexture?.upper ?? linedef.frontTexture?.middle ?? 'wall_concrete';
      const mesh = this.createWallQuadReturn(v1, v2, backSector.ceilingHeight, frontSector.ceilingHeight, tex);
      if (mesh) {
        this.mapGroup!.add(mesh);
        wallMeshes.push(mesh);
      }
    }
    if (backSector.ceilingHeight > frontSector.ceilingHeight) {
      const tex = linedef.backTexture?.upper ?? linedef.backTexture?.middle ?? 'wall_concrete';
      const mesh = this.createWallQuadReturn(v1, v2, frontSector.ceilingHeight, backSector.ceilingHeight, tex);
      if (mesh) {
        this.mapGroup!.add(mesh);
        wallMeshes.push(mesh);
      }
    }

    // Middle texture on non-door two-sided linedefs (grates, railings).
    // Door linedefs skip this — the door visual is the upper wall.
    if (linedef.frontTexture?.middle && !linedef.flags?.door) {
      const bottom = Math.max(frontSector.floorHeight, backSector.floorHeight);
      const top = Math.min(frontSector.ceilingHeight, backSector.ceilingHeight);
      if (top > bottom) {
        const mesh = this.createWallQuadReturn(v1, v2, bottom, top, linedef.frontTexture.middle);
        if (mesh) {
          this.mapGroup!.add(mesh);
          wallMeshes.push(mesh);
        }
      }
    }
  }

  /** Extract the polygon (array of [x, z] points) for a sector from its linedefs. */
  private buildSectorPolygon(sectorId: number, mapData: MapData): [number, number][] {
    const vertexIndices = new Set<number>();
    for (const ld of mapData.linedefs) {
      if (ld.frontSector === sectorId || ld.backSector === sectorId) {
        vertexIndices.add(ld.v1);
        vertexIndices.add(ld.v2);
      }
    }

    if (vertexIndices.size < 3) return [];

    const points = [...vertexIndices].map((idx) => mapData.vertices[idx]);

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
    const shape = new THREE.Shape();
    shape.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i][0], polygon[i][1]);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);

    if (isFloor) {
      geo.rotateX(-Math.PI / 2);
      geo.scale(1, 1, -1);
    } else {
      geo.rotateX(Math.PI / 2);
      geo.scale(1, 1, -1);
    }

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

  /** Same as createHorizontalSurface but returns the mesh instead of adding to mapGroup. */
  private createHorizontalSurfaceReturn(
    polygon: [number, number][],
    height: number,
    textureName: string,
    isFloor: boolean,
  ): THREE.Mesh | null {
    if (polygon.length < 3) return null;

    const shape = new THREE.Shape();
    shape.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i][0], polygon[i][1]);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);

    if (isFloor) {
      geo.rotateX(-Math.PI / 2);
      geo.scale(1, 1, -1);
    } else {
      geo.rotateX(Math.PI / 2);
      geo.scale(1, 1, -1);
    }

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
    return mesh;
  }

  private createNeonPanel(x: number, y: number, z: number, color: number, idx: number): void {
    if (!this.mapGroup) return;

    const width = 1.05 + (idx % 3) * 0.15;
    const height = 0.24 + (idx % 2) * 0.05;

    const panelGeo = new THREE.PlaneGeometry(width, height);
    const panelMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(x, y, z);
    panel.rotation.y = ((idx * 0.9) % Math.PI) - Math.PI * 0.5;
    this.mapGroup.add(panel);

    const coreGeo = new THREE.PlaneGeometry(width * 0.65, height * 0.28);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(x, y, z + 0.01);
    core.rotation.y = panel.rotation.y;
    this.mapGroup.add(core);
  }

  /** Determine floor height at a world position (for placing light things). */
  private getFloorHeightAt(x: number, z: number, mapData: MapData): number {
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
