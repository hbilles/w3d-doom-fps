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
import type { MapData } from '../world/MapTypes.ts';

export interface IRenderer {
  // Lifecycle
  init(canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;

  // Per-frame
  beginFrame(dt: number): void;
  render(
    camera: CameraState,
    renderables: RenderableEntity[],
    lights: LightState[],
  ): void;
  endFrame(): void;

  // World geometry
  loadMap(mapData: MapData): void;
  unloadMap(): void;

  // Dynamic entities
  addSprite(id: string, config: SpriteConfig): void;
  updateSprite(id: string, position: Vec3, frame: number): void;
  /** Switch a sprite to a different frame/animation key within the same atlas. */
  setSpriteAnimation(id: string, spriteKey: string): void;
  removeSprite(id: string): void;

  // Effects
  setAmbientLight(color: Color, intensity: number): void;
  addPointLight(
    id: string,
    position: Vec3,
    color: Color,
    intensity: number,
    distance: number,
  ): void;
  removePointLight(id: string): void;
  setFog(color: Color, near: number, far: number): void;
  screenShake(intensity: number, duration: number): void;
  muzzleFlash(): void;
  spawnImpactFx(position: Vec3, normal?: Vec3): void;
  spawnExplosionFx(position: Vec3, scale?: number, normal?: Vec3): void;
  spawnPickupFx(position: Vec3): void;
  spawnDoorFx(position: Vec3): void;

  // Weapon viewmodel (2D overlay)
  drawWeaponViewmodel(state: WeaponViewmodelState): void;

  // HUD (2D overlay)
  drawHUD(hudState: HUDState): void;

  // Dynamic world updates
  updateSectorCeiling(sectorId: number, newHeight: number): void;

  // Resize handling
  resize(width: number, height: number): void;
}
