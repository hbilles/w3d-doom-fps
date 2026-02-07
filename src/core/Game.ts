import type { IRenderer } from '../renderer/IRenderer.ts';
import { EventBus } from './EventBus.ts';
import { GameState } from './GameState.ts';
import { InputSystem } from '../systems/InputSystem.ts';
import { PhysicsSystem } from '../systems/PhysicsSystem.ts';
import { Player } from '../entities/Player.ts';
import { MapLoader } from '../world/MapLoader.ts';
import { World } from '../world/World.ts';

export class Game {
  private renderer: IRenderer;
  private eventBus: EventBus;
  private inputSystem: InputSystem;
  private physicsSystem: PhysicsSystem;
  private player: Player | null = null;
  private world: World | null = null;
  private state: GameState = GameState.MENU;
  private lastTime: number = 0;
  private animationFrameId: number = 0;

  constructor(renderer: IRenderer) {
    this.renderer = renderer;
    this.eventBus = new EventBus();
    this.inputSystem = new InputSystem();
    this.physicsSystem = new PhysicsSystem();
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  async init(canvas: HTMLCanvasElement, mapName: string): Promise<void> {
    await this.renderer.init(canvas);
    this.inputSystem.init(canvas);

    // Load map
    const mapData = await MapLoader.load(mapName);
    this.world = new World(mapData);
    this.renderer.loadMap(mapData);
    this.physicsSystem.init(mapData);

    // Spawn player at map start
    const start = this.world.getPlayerStart();
    this.player = new Player(start.x, start.z, start.angle);

    // Set initial floor height
    const sector = this.physicsSystem.findSectorAt(start.x, start.z);
    if (sector) {
      this.player.floorHeight = sector.floorHeight;
      this.player.sectorFloorHeight = sector.floorHeight;
    }

    // Handle resize
    window.addEventListener('resize', () => {
      this.renderer.resize(window.innerWidth, window.innerHeight);
    });

    // Handle pointer lock changes (pause/resume)
    document.addEventListener('pointerlockchange', () => {
      if (this.inputSystem.isPointerLocked()) {
        if (this.state === GameState.PAUSED) {
          this.state = GameState.PLAYING;
          this.lastTime = performance.now(); // Reset dt to avoid jump
          this.eventBus.emit('game.resumed', null);
        }
      } else {
        if (this.state === GameState.PLAYING) {
          this.state = GameState.PAUSED;
          this.eventBus.emit('game.paused', null);
        }
      }
    });
  }

  start(): void {
    this.state = GameState.PLAYING;
    this.lastTime = performance.now();
    this.inputSystem.requestPointerLock();
    this.loop(this.lastTime);
  }

  requestPointerLock(): void {
    this.inputSystem.requestPointerLock();
  }

  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
  }

  // ── Game Loop ──────────────────────────────────────────────

  private loop = (time: number): void => {
    this.animationFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    if (this.state !== GameState.PLAYING) {
      // Still render the scene while paused (for flickering lights, etc.)
      this.renderFrame();
      return;
    }

    this.update(dt);
    this.renderFrame();
  };

  private update(dt: number): void {
    if (!this.player || !this.world) return;

    // Save old position before player movement
    const oldX = this.player.position.x;
    const oldZ = this.player.position.z;

    // Player computes movement from input (moves freely, no collision)
    this.player.update(dt, this.inputSystem);

    // Physics resolves collision and determines floor height.
    // Use the actual (non-lerped) sector floor height for step-up checks,
    // so consecutive steps don't fail due to visual lerp lag.
    const result = this.physicsSystem.resolveMovement(
      oldX,
      oldZ,
      this.player.position.x,
      this.player.position.z,
      this.player.sectorFloorHeight,
    );

    this.player.position.x = result.x;
    this.player.position.z = result.z;

    // Update the true sector floor height immediately
    this.player.sectorFloorHeight = result.floorHeight;

    // Lerp the visual floor height for smooth camera transitions
    const lerpFactor = Math.min(1, dt * 15);
    this.player.floorHeight +=
      (result.floorHeight - this.player.floorHeight) * lerpFactor;
  }

  private renderFrame(): void {
    if (!this.player) return;

    this.renderer.beginFrame();
    this.renderer.render(this.player.getCameraState(), [], []);
    this.renderer.endFrame();
  }
}
