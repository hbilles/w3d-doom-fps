import type { CameraState, Vec3 } from '../renderer/RenderTypes.ts';
import type { InputSystem } from '../systems/InputSystem.ts';
import {
  AmmoType,
  WeaponId,
  AMMO_START,
  AMMO_MAX,
} from '../combat/WeaponDefs.ts';

const WALK_SPEED = 8;
const RUN_SPEED = 14;
const MOUSE_SENSITIVITY = 0.002;
const EYE_HEIGHT = 1.6;

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.5;
export const STEP_HEIGHT = 0.4;
export const MAX_HEALTH = 100;

export class Player {
  position: Vec3;
  yaw: number;
  /** Visual floor height (lerped for smooth camera). */
  floorHeight: number = 0;
  /** Actual sector floor height (non-lerped, used for physics). */
  sectorFloorHeight: number = 0;

  // ── Inventory ────────────────────────────────────────────
  health: number = MAX_HEALTH;
  maxHealth: number = MAX_HEALTH;
  armor: number = 0;
  armorType: 'green' | 'blue' | 'none' = 'none';

  ammo: Record<AmmoType, number> = {
    [AmmoType.NONE]: 0,
    [AmmoType.BULLETS]: AMMO_START[AmmoType.BULLETS],
    [AmmoType.SHELLS]: AMMO_START[AmmoType.SHELLS],
    [AmmoType.ROCKETS]: AMMO_START[AmmoType.ROCKETS],
  };

  maxAmmo: Record<AmmoType, number> = {
    [AmmoType.NONE]: 0,
    [AmmoType.BULLETS]: AMMO_MAX[AmmoType.BULLETS],
    [AmmoType.SHELLS]: AMMO_MAX[AmmoType.SHELLS],
    [AmmoType.ROCKETS]: AMMO_MAX[AmmoType.ROCKETS],
  };

  /** Set of weapon IDs the player owns. */
  weapons: Set<WeaponId> = new Set([WeaponId.BATON, WeaponId.PISTOL]);

  /** Key cards collected. */
  keys: { red: boolean; blue: boolean; yellow: boolean } = {
    red: false,
    blue: false,
    yellow: false,
  };

  constructor(x: number, z: number, yaw: number) {
    this.position = { x, y: 0, z };
    this.yaw = yaw;
  }

  update(dt: number, input: InputSystem): void {
    // ── Mouse look (yaw only — Doom style) ───────────────────
    const mouse = input.consumeMouseDelta();
    this.yaw -= mouse.dx * MOUSE_SENSITIVITY;

    // ── Movement input ───────────────────────────────────────
    let forwardInput = 0;
    let rightInput = 0;

    if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) forwardInput += 1;
    if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) forwardInput -= 1;
    if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) rightInput += 1;
    if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) rightInput -= 1;

    // Normalize diagonal movement
    const length = Math.sqrt(forwardInput * forwardInput + rightInput * rightInput);
    if (length > 0) {
      forwardInput /= length;
      rightInput /= length;
    }

    // Run or walk
    const speed =
      input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight')
        ? RUN_SPEED
        : WALK_SPEED;

    // ── Transform to world space ─────────────────────────────
    // With camera.rotation.y = yaw (Three.js Y-up, rotation order YXZ):
    //   Forward = (-sin(yaw), 0, -cos(yaw))
    //   Right   = ( cos(yaw), 0, -sin(yaw))
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    const vx = forwardInput * -sinY + rightInput * cosY;
    const vz = forwardInput * -cosY + rightInput * -sinY;

    // ── Apply velocity ───────────────────────────────────────
    this.position.x += vx * speed * dt;
    this.position.z += vz * speed * dt;
    this.position.y = this.floorHeight;
  }

  getCameraState(): CameraState {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      yaw: this.yaw,
      fov: 90,
      height: this.floorHeight + EYE_HEIGHT,
    };
  }
}
