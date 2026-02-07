import type {
  CameraState,
  Color,
  HUDState,
  LightState,
  RenderableEntity,
  SpriteConfig,
  Vec3,
} from './RenderTypes.ts';
import type { MapData } from '../world/MapTypes.ts';

export interface IRenderer {
  // Lifecycle
  init(canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;

  // Per-frame
  beginFrame(): void;
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

  // HUD (2D overlay)
  drawHUD(hudState: HUDState): void;

  // Resize handling
  resize(width: number, height: number): void;
}
