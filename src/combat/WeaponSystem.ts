import type { EventBus } from '../core/EventBus.ts';
import type { InputSystem } from '../systems/InputSystem.ts';
import type { Player } from '../entities/Player.ts';
import {
  WeaponState,
  WeaponId,
  AmmoType,
  WEAPON_DEFS,
  type WeaponDef,
} from './WeaponDefs.ts';

/**
 * Manages the weapon state machine:
 *   READY -> FIRE -> RECOVERY -> READY
 *   READY -> LOWER -> RAISE -> READY  (weapon switching)
 *
 * Emits events:
 *   weapon.fire     { weaponDef, playerX, playerZ, yaw }
 *   weapon.switched { weaponId }
 */
export class WeaponSystem {
  private eventBus: EventBus;
  private state: WeaponState = WeaponState.READY;
  private stateTimer: number = 0;
  private currentWeapon: WeaponId = WeaponId.PISTOL;
  private pendingWeapon: WeaponId | null = null;

  /** Viewmodel vertical offset for lower/raise animation (0 = fully up, 1 = fully down). */
  viewmodelOffset: number = 0;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  getCurrentWeapon(): WeaponId {
    return this.currentWeapon;
  }

  getCurrentWeaponDef(): WeaponDef {
    return WEAPON_DEFS[this.currentWeapon];
  }

  getState(): WeaponState {
    return this.state;
  }

  update(dt: number, input: InputSystem, player: Player): void {
    // Advance state timer
    if (this.stateTimer > 0) {
      this.stateTimer -= dt;
    }

    switch (this.state) {
      case WeaponState.READY:
        this.handleReady(input, player);
        this.viewmodelOffset = 0;
        break;

      case WeaponState.FIRE:
        if (this.stateTimer <= 0) {
          this.state = WeaponState.RECOVERY;
          this.stateTimer = this.getCurrentWeaponDef().recoveryDuration;
        }
        this.viewmodelOffset = 0;
        break;

      case WeaponState.RECOVERY:
        if (this.stateTimer <= 0) {
          this.state = WeaponState.READY;
          // If auto-rifle and still holding fire, immediately fire again
          if (
            this.currentWeapon === WeaponId.AUTO_RIFLE &&
            input.isMouseDown()
          ) {
            this.handleReady(input, player);
          }
        }
        this.viewmodelOffset = 0;
        break;

      case WeaponState.LOWER: {
        const def = this.getCurrentWeaponDef();
        const progress = 1 - this.stateTimer / def.switchDuration;
        this.viewmodelOffset = Math.min(1, progress);

        if (this.stateTimer <= 0) {
          // Switch to pending weapon
          if (this.pendingWeapon !== null) {
            this.currentWeapon = this.pendingWeapon;
            this.pendingWeapon = null;
          }
          this.state = WeaponState.RAISE;
          this.stateTimer = this.getCurrentWeaponDef().switchDuration;
          this.viewmodelOffset = 1;
          this.eventBus.emit('weapon.switched', { weaponId: this.currentWeapon });
        }
        break;
      }

      case WeaponState.RAISE: {
        const def = this.getCurrentWeaponDef();
        const progress = this.stateTimer / def.switchDuration;
        this.viewmodelOffset = Math.max(0, progress);

        if (this.stateTimer <= 0) {
          this.state = WeaponState.READY;
          this.viewmodelOffset = 0;
        }
        break;
      }
    }

    // Handle weapon switching input (only when READY)
    if (this.state === WeaponState.READY) {
      this.handleWeaponSwitch(input, player);
    }
  }

  private handleReady(input: InputSystem, player: Player): void {
    // Fire if mouse is down (or Ctrl)
    const wantsFire = input.isMouseDown() || input.isKeyDown('ControlLeft') || input.isKeyDown('ControlRight');

    if (!wantsFire) return;

    const def = this.getCurrentWeaponDef();

    // Check ammo
    if (def.ammoType !== AmmoType.NONE) {
      const ammo = player.ammo[def.ammoType];
      if (ammo < def.ammoCost) return; // No ammo
      player.ammo[def.ammoType] -= def.ammoCost;
    }

    // Transition to FIRE state
    this.state = WeaponState.FIRE;
    this.stateTimer = def.fireDuration;

    // Emit fire event — Game.ts handles the actual hitscan/projectile
    this.eventBus.emit('weapon.fire', {
      weaponDef: def,
      playerX: player.position.x,
      playerZ: player.position.z,
      yaw: player.yaw,
    });
  }

  private handleWeaponSwitch(input: InputSystem, player: Player): void {
    let targetWeapon: WeaponId | null = null;

    // Number keys 1-5
    if (input.wasKeyPressed('Digit1')) targetWeapon = WeaponId.BATON;
    if (input.wasKeyPressed('Digit2')) targetWeapon = WeaponId.PISTOL;
    if (input.wasKeyPressed('Digit3')) targetWeapon = WeaponId.SHOTGUN;
    if (input.wasKeyPressed('Digit4')) targetWeapon = WeaponId.AUTO_RIFLE;
    if (input.wasKeyPressed('Digit5')) targetWeapon = WeaponId.LAUNCHER;

    // Scroll wheel
    const scroll = input.consumeScrollDelta();
    if (scroll !== 0 && targetWeapon === null) {
      const owned = this.getOwnedWeapons(player);
      if (owned.length > 1) {
        const currentIdx = owned.indexOf(this.currentWeapon);
        const dir = scroll > 0 ? -1 : 1; // Scroll up = prev, down = next
        const nextIdx = (currentIdx + dir + owned.length) % owned.length;
        targetWeapon = owned[nextIdx];
      }
    }

    // Validate and start switch
    if (
      targetWeapon !== null &&
      targetWeapon !== this.currentWeapon &&
      player.weapons.has(targetWeapon)
    ) {
      this.pendingWeapon = targetWeapon;
      this.state = WeaponState.LOWER;
      this.stateTimer = this.getCurrentWeaponDef().switchDuration;
    }
  }

  private getOwnedWeapons(player: Player): WeaponId[] {
    const all: WeaponId[] = [
      WeaponId.BATON,
      WeaponId.PISTOL,
      WeaponId.SHOTGUN,
      WeaponId.AUTO_RIFLE,
      WeaponId.LAUNCHER,
    ];
    return all.filter((w) => player.weapons.has(w));
  }
}
