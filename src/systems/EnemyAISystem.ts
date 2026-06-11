import type { MapData, LineDef } from '../world/MapTypes.ts';
import type { EventBus } from '../core/EventBus.ts';
import { PLAYER_RADIUS, type Player } from '../entities/Player.ts';
import type { Enemy } from '../entities/Enemy.ts';
import type { WeaponDef } from '../combat/WeaponDefs.ts';
import { EnemyState } from '../entities/EnemyDefs.ts';
import type { PhysicsSystem, CircleObstacle } from './PhysicsSystem.ts';
import type { DoorSystem } from './DoorSystem.ts';
import type { CombatSystem } from '../combat/CombatSystem.ts';
import { rayVsSegment } from '../combat/HitscanRay.ts';

const SOUND_ALERT_RADIUS = 30; // Units within which gunfire alerts enemies
const LOS_GIVE_UP_TIME = 3.0;  // Seconds without LOS before returning to IDLE
const DOOR_OPEN_DISTANCE = 1.5; // How close an enemy must be to open a door

type WallSegment = { v1: [number, number]; v2: [number, number] };

// Door-related linedef info for LOS checks
interface DoorLinedef {
  sectorId: number;
  v1: [number, number];
  v2: [number, number];
}

/**
 * Manages enemy AI: state machine, line-of-sight, movement, sound propagation.
 * Follows the DoorSystem pattern: init() with MapData + EventBus, update() each frame.
 */
export class EnemyAISystem {
  private mapData: MapData | null = null;
  private eventBus: EventBus | null = null;
  private physicsSystem: PhysicsSystem | null = null;
  private doorSystem: DoorSystem | null = null;
  // LOS wall segments (static walls from CombatSystem)
  private wallSegments: WallSegment[] = [];
  // Door linedefs for dynamic LOS blocking
  private doorLinedefs: DoorLinedef[] = [];
  // Door sector IDs mapped to their linedef indices for quick lookup
  private doorSectorLinedefs: Map<number, LineDef[]> = new Map();

  init(
    mapData: MapData,
    eventBus: EventBus,
    physicsSystem: PhysicsSystem,
    doorSystem: DoorSystem,
    combatSystem: CombatSystem,
  ): void {
    this.mapData = mapData;
    this.eventBus = eventBus;
    this.physicsSystem = physicsSystem;
    this.doorSystem = doorSystem;

    // Get static wall segments from combat system
    this.wallSegments = combatSystem.getWallSegments();

    // Build door linedef list for dynamic LOS checks
    this.buildDoorLinedefs();

    // Listen for weapon fire events to alert nearby enemies
    this.eventBus.on<{ weaponDef: WeaponDef; playerX: number; playerZ: number; yaw: number }>(
      'weapon.fire',
      (data) => this.onWeaponFire(data.playerX, data.playerZ),
    );
  }

  update(dt: number, player: Player, enemies: Enemy[]): void {
    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      // Tick cooldowns
      if (enemy.attackCooldown > 0) {
        enemy.attackCooldown -= dt;
      }

      switch (enemy.state) {
        case EnemyState.IDLE:
          this.updateIdle(enemy, player);
          break;
        case EnemyState.CHASE:
          this.updateChase(dt, enemy, player, enemies);
          break;
        case EnemyState.ATTACK:
          this.updateAttack(dt, enemy, player);
          break;
        case EnemyState.PAIN:
          this.updatePain(dt, enemy);
          break;
        case EnemyState.DEAD:
          // Dead enemies do nothing, remain as corpses
          break;
      }
    }
  }

  // ── State handlers ─────────────────────────────────────

  private updateIdle(enemy: Enemy, player: Player): void {
    if (this.checkLOS(enemy, player)) {
      this.alertEnemy(enemy);
    }
  }

  private updateChase(dt: number, enemy: Enemy, player: Player, allEnemies: Enemy[]): void {
    const hasLOS = this.checkLOS(enemy, player);

    if (hasLOS) {
      enemy.losTimer = 0;
    } else {
      enemy.losTimer += dt;
      if (enemy.losTimer >= LOS_GIVE_UP_TIME) {
        enemy.state = EnemyState.IDLE;
        enemy.losTimer = 0;
        return;
      }
    }

    // Check if in attack range with LOS
    const dist = enemy.distanceTo(player.position.x, player.position.z);
    if (hasLOS && dist <= enemy.def.attackRange && enemy.attackCooldown <= 0) {
      enemy.state = EnemyState.ATTACK;
      enemy.stateTimer = 0;
      return;
    }

    // Move toward player
    this.moveTowardPlayer(dt, enemy, player, allEnemies);
  }

  private updateAttack(dt: number, enemy: Enemy, _player: Player): void {
    // Attack is executed on entry (stateTimer === 0) then we wait for the attack anim
    if (enemy.stateTimer === 0) {
      this.executeAttack(enemy, _player);
      enemy.attackCooldown = enemy.def.attackCooldown;
    }

    enemy.stateTimer += dt;

    // Attack animation lasts ~0.3s, then return to chase
    if (enemy.stateTimer >= 0.3) {
      enemy.state = EnemyState.CHASE;
      enemy.stateTimer = 0;
    }
  }

  private updatePain(dt: number, enemy: Enemy): void {
    enemy.stateTimer -= dt;
    if (enemy.stateTimer <= 0) {
      enemy.state = EnemyState.CHASE;
      enemy.stateTimer = 0;
      enemy.losTimer = 0; // Reset so it doesn't immediately give up
    }
  }

  // ── Attack execution ───────────────────────────────────

  private executeAttack(enemy: Enemy, player: Player): void {
    const def = enemy.def;
    const damage = def.damage[0] + Math.random() * (def.damage[1] - def.damage[0]);

    switch (def.attackType) {
      case 'hitscan': {
        // Check LOS before applying damage (enemy might have been pushed out of sight)
        if (this.checkLOS(enemy, player)) {
          // Doom-style miss chance: base hit probability falls off with
          // distance, scaled by the enemy's accuracy stat.
          const dist = enemy.distanceTo(player.position.x, player.position.z);
          const hitChance =
            Math.max(0.25, Math.min(0.95, 1.0 - dist * 0.04)) * def.accuracy;

          if (Math.random() < hitChance) {
            this.eventBus?.emit('enemy.attack', {
              enemyId: enemy.id,
              attackType: 'hitscan',
              x: enemy.position.x,
              z: enemy.position.z,
              damage: Math.round(damage),
            });
          }
        }
        break;
      }
      case 'melee': {
        const dist = enemy.distanceTo(player.position.x, player.position.z);
        if (dist <= enemy.def.attackRange) {
          this.eventBus?.emit('enemy.attack', {
            enemyId: enemy.id,
            attackType: 'melee',
            x: enemy.position.x,
            z: enemy.position.z,
            damage: Math.round(damage),
          });
        }
        break;
      }
      case 'projectile': {
        // Emit event for Game.ts to spawn the projectile
        const dirX = player.position.x - enemy.position.x;
        const dirZ = player.position.z - enemy.position.z;
        const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
        const yaw = Math.atan2(-dirX, -dirZ); // Match the player yaw convention
        this.eventBus?.emit('enemy.attack', {
          enemyId: enemy.id,
          attackType: 'projectile',
          x: enemy.position.x,
          z: enemy.position.z,
          yaw,
          damage: Math.round(damage),
          dirX: len > 0 ? dirX / len : 0,
          dirZ: len > 0 ? dirZ / len : 0,
        });
        break;
      }
    }

    // Face the player when attacking
    const dx = player.position.x - enemy.position.x;
    const dz = player.position.z - enemy.position.z;
    enemy.yaw = Math.atan2(-dx, -dz);
  }

  // ── Movement ───────────────────────────────────────────

  private moveTowardPlayer(
    dt: number,
    enemy: Enemy,
    player: Player,
    allEnemies: Enemy[],
  ): void {
    if (!this.physicsSystem) return;

    const dx = player.position.x - enemy.position.x;
    const dz = player.position.z - enemy.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.1) return; // Already at player position

    // Normalize direction and scale by speed
    const moveX = (dx / dist) * enemy.def.speed * dt;
    const moveZ = (dz / dist) * enemy.def.speed * dt;

    const desiredX = enemy.position.x + moveX;
    const desiredZ = enemy.position.z + moveZ;

    // Build obstacle list: the player + other alive enemies
    const obstacles: CircleObstacle[] = [
      {
        x: player.position.x,
        z: player.position.z,
        radius: PLAYER_RADIUS,
      },
    ];
    for (const other of allEnemies) {
      if (other === enemy || !other.alive) continue;
      obstacles.push({
        x: other.position.x,
        z: other.position.z,
        radius: other.radius,
      });
    }

    const floorHeight = this.physicsSystem.findSectorAt(
      enemy.position.x, enemy.position.z,
    )?.floorHeight ?? 0;

    const result = this.physicsSystem.resolveEntityMovement(
      desiredX,
      desiredZ,
      enemy.radius,
      floorHeight,
      obstacles,
    );

    enemy.position.x = result.x;
    enemy.position.z = result.z;
    enemy.position.y = result.floorHeight + enemy.def.worldScale * 0.5;

    // Face movement direction
    enemy.yaw = Math.atan2(-dx, -dz);

    // Try to open doors if movement was blocked
    const movedDist = Math.sqrt(
      (result.x - enemy.position.x + moveX) ** 2 +
      (result.z - enemy.position.z + moveZ) ** 2,
    );
    const expectedDist = Math.sqrt(moveX * moveX + moveZ * moveZ);

    if (movedDist < expectedDist * 0.3 && this.doorSystem && this.mapData) {
      // Movement was significantly blocked — try to open nearby doors
      this.tryOpenNearbyDoor(enemy);
    }
  }

  private tryOpenNearbyDoor(enemy: Enemy): void {
    if (!this.mapData || !this.doorSystem) return;

    for (const ld of this.mapData.linedefs) {
      if (!ld.flags?.door) continue;

      const doorSectorId = ld.backSector ?? ld.frontSector;
      if (doorSectorId === null) continue;

      const v1 = this.mapData.vertices[ld.v1];
      const v2 = this.mapData.vertices[ld.v2];

      const dist = pointToSegmentDist(
        enemy.position.x, enemy.position.z, v1, v2,
      );

      if (dist < DOOR_OPEN_DISTANCE) {
        this.doorSystem.tryOpenDoor(doorSectorId);
        return;
      }
    }
  }

  // ── Line of Sight ──────────────────────────────────────

  /**
   * Check if an enemy has clear line of sight to the player.
   * Tests against static walls and closed doors.
   */
  private checkLOS(enemy: Enemy, player: Player): boolean {
    const ex = enemy.position.x;
    const ez = enemy.position.z;
    const px = player.position.x;
    const pz = player.position.z;

    const dx = px - ex;
    const dz = pz - ez;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.01) return true; // Same position

    // Check against static walls
    for (const seg of this.wallSegments) {
      const hit = rayVsSegment(ex, ez, dx, dz, seg.v1, seg.v2, dist);
      if (hit) return false;
    }

    // Check against closed door linedefs
    for (const doorLd of this.doorLinedefs) {
      const progress = this.doorSystem?.getDoorProgress(doorLd.sectorId) ?? 0;
      if (progress < 0.5) {
        // Door is mostly closed — blocks LOS
        const hit = rayVsSegment(ex, ez, dx, dz, doorLd.v1, doorLd.v2, dist);
        if (hit) return false;
      }
    }

    return true;
  }

  // ── Sound Propagation ──────────────────────────────────

  /**
   * Called when a weapon fires. Alerts nearby idle enemies
   * that don't have the ambush flag.
   */
  private onWeaponFire(px: number, pz: number): void {
    // This method will be called with enemy references from Game.ts
    // We need to alert enemies tracked externally. Emit an event instead.
    this.eventBus?.emit('combat.soundAlert', {
      x: px,
      z: pz,
      radius: SOUND_ALERT_RADIUS,
    });
  }

  /**
   * Alert enemies within range of a sound. Called by Game.ts when
   * combat.soundAlert is emitted, passing in the enemies array.
   */
  alertEnemiesInRange(
    sourceX: number,
    sourceZ: number,
    radius: number,
    enemies: Enemy[],
  ): void {
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (enemy.state !== EnemyState.IDLE) continue;
      if (enemy.ambush) continue; // Ambush enemies only respond to LOS

      const dist = enemy.distanceTo(sourceX, sourceZ);
      if (dist > radius) continue;

      // Check if a closed door blocks the sound path
      if (this.isSoundBlocked(enemy.position.x, enemy.position.z, sourceX, sourceZ)) {
        continue;
      }

      this.alertEnemy(enemy);
    }
  }

  private isSoundBlocked(
    ex: number, ez: number, sx: number, sz: number,
  ): boolean {
    const dx = sx - ex;
    const dz = sz - ez;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) return false;

    for (const doorLd of this.doorLinedefs) {
      const progress = this.doorSystem?.getDoorProgress(doorLd.sectorId) ?? 0;
      if (progress < 0.1) {
        // Door is essentially closed — blocks sound
        const hit = rayVsSegment(ex, ez, dx, dz, doorLd.v1, doorLd.v2, dist);
        if (hit) return true;
      }
    }

    return false;
  }

  private alertEnemy(enemy: Enemy): void {
    enemy.state = EnemyState.CHASE;
    enemy.stateTimer = 0;
    enemy.losTimer = 0;
  }

  // ── Setup ──────────────────────────────────────────────

  private buildDoorLinedefs(): void {
    if (!this.mapData || !this.doorSystem) return;

    this.doorLinedefs = [];
    this.doorSectorLinedefs.clear();

    for (const ld of this.mapData.linedefs) {
      const frontId = ld.frontSector;
      const backId = ld.backSector;

      // Check if either adjacent sector is a door sector
      const checkSector = (sectorId: number | null) => {
        if (sectorId === null) return;
        if (!this.doorSystem!.isDoorSector(sectorId)) return;

        // Only include two-sided linedefs that border the door sector
        if (frontId === null || backId === null) return;

        this.doorLinedefs.push({
          sectorId,
          v1: this.mapData!.vertices[ld.v1],
          v2: this.mapData!.vertices[ld.v2],
        });

        if (!this.doorSectorLinedefs.has(sectorId)) {
          this.doorSectorLinedefs.set(sectorId, []);
        }
        this.doorSectorLinedefs.get(sectorId)!.push(ld);
      };

      checkSector(frontId);
      checkSector(backId);
    }
  }
}

// ── Geometry Utilities ──────────────────────────────────

function pointToSegmentDist(
  px: number,
  pz: number,
  v1: [number, number],
  v2: [number, number],
): number {
  const dx = v2[0] - v1[0];
  const dz = v2[1] - v1[1];
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.0001) {
    return Math.sqrt((px - v1[0]) ** 2 + (pz - v1[1]) ** 2);
  }
  let t = ((px - v1[0]) * dx + (pz - v1[1]) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = v1[0] + t * dx;
  const closestZ = v1[1] + t * dz;
  return Math.sqrt((px - closestX) ** 2 + (pz - closestZ) ** 2);
}
