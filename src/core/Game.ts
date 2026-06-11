import type { IRenderer } from '../renderer/IRenderer.ts';
import type { HUDState, WeaponViewmodelState } from '../renderer/RenderTypes.ts';
import { EventBus } from './EventBus.ts';
import { GameState } from './GameState.ts';
import { InputSystem } from '../systems/InputSystem.ts';
import { PhysicsSystem } from '../systems/PhysicsSystem.ts';
import { DoorSystem } from '../systems/DoorSystem.ts';
import { Player } from '../entities/Player.ts';
import { Projectile } from '../entities/Projectile.ts';
import { Pickup, thingTypeToPickupType } from '../entities/Pickup.ts';
import { Barrel } from '../entities/Barrel.ts';
import { Enemy } from '../entities/Enemy.ts';
import { ENEMY_ANIMS, EnemyState, thingTypeToEnemyType } from '../entities/EnemyDefs.ts';
import { EnemyAISystem } from '../systems/EnemyAISystem.ts';
import { MapLoader } from '../world/MapLoader.ts';
import { World } from '../world/World.ts';
import { ThingType } from '../world/MapTypes.ts';
import { WeaponSystem } from '../combat/WeaponSystem.ts';
import { CombatSystem } from '../combat/CombatSystem.ts';
import { WeaponId, WeaponState, WEAPON_DEFS, AmmoType, type WeaponDef } from '../combat/WeaponDefs.ts';
import type { RayHit } from '../combat/HitscanRay.ts';

const MESSAGE_DURATION = 2.5;

export class Game {
  private renderer: IRenderer;
  private eventBus: EventBus;
  private inputSystem: InputSystem;
  private physicsSystem: PhysicsSystem;
  private doorSystem: DoorSystem;
  private weaponSystem: WeaponSystem;
  private combatSystem: CombatSystem;
  private enemyAISystem: EnemyAISystem;
  private player: Player | null = null;
  private world: World | null = null;
  private state: GameState = GameState.MENU;
  private lastTime: number = 0;
  private animationFrameId: number = 0;

  // ── Entity management ──────────────────────────────────────
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private barrels: Barrel[] = [];
  private enemies: Enemy[] = [];

  // ── HUD message ────────────────────────────────────────────
  private hudMessage: string = '';
  private hudMessageTimer: number = 0;

  constructor(renderer: IRenderer) {
    this.renderer = renderer;
    this.eventBus = new EventBus();
    this.inputSystem = new InputSystem();
    this.physicsSystem = new PhysicsSystem();
    this.doorSystem = new DoorSystem();
    this.weaponSystem = new WeaponSystem(this.eventBus);
    this.combatSystem = new CombatSystem();
    this.enemyAISystem = new EnemyAISystem();

    // Listen for weapon fire events
    this.eventBus.on<{ weaponDef: WeaponDef; playerX: number; playerZ: number; yaw: number }>(
      'weapon.fire',
      (data) => this.onWeaponFire(data),
    );

    // Listen for door locked events
    this.eventBus.on<{ sectorId: number; keyRequired: string }>(
      'door.locked',
      (data) => {
        this.showMessage(`You need the ${data.keyRequired} key`);
      },
    );

    // Door open pulse
    this.eventBus.on<{ sectorId: number }>(
      'door.opened',
      (data) => {
        const center = this.getSectorCenter(data.sectorId);
        if (!center) return;
        this.renderer.spawnDoorFx({
          x: center.x,
          y: this.getFloorHeightAt(center.x, center.z),
          z: center.z,
        });
      },
    );

    // Listen for pickup collection events
    this.eventBus.on<{ pickupId: string; pickupType: number; x: number; y: number; z: number }>(
      'pickup.collected',
      (data) => {
        this.renderer.spawnPickupFx({ x: data.x, y: data.y, z: data.z });
      },
    );

    // Bullet / projectile impact sparks
    this.eventBus.on<{ x: number; z: number; normalX: number; normalZ: number }>(
      'combat.wallHit',
      (data) => {
        const y = this.getFloorHeightAt(data.x, data.z) + 1.0;
        this.renderer.spawnImpactFx(
          { x: data.x, y, z: data.z },
          { x: data.normalX, y: 0, z: data.normalZ },
        );
      },
    );

    // Projectile explosion bursts
    this.eventBus.on<{ x: number; z: number; normalX?: number; normalZ?: number }>(
      'combat.explosion',
      (data) => {
        this.renderer.spawnExplosionFx({
          x: data.x,
          y: this.getFloorHeightAt(data.x, data.z) + 0.85,
          z: data.z,
        }, 1.1, { x: data.normalX ?? 0, y: 0, z: data.normalZ ?? 0 });
      },
    );

    // Listen for barrel explosions
    this.eventBus.on<{ barrelId: string; x: number; z: number }>(
      'barrel.exploded',
      (data) => {
        this.renderer.spawnExplosionFx({
          x: data.x,
          y: this.getFloorHeightAt(data.x, data.z) + 0.8,
          z: data.z,
        }, 1.5);
      },
    );

    // Sound alert from weapon fire — alert nearby enemies
    this.eventBus.on<{ x: number; z: number; radius: number }>(
      'combat.soundAlert',
      (data) => {
        this.enemyAISystem.alertEnemiesInRange(
          data.x, data.z, data.radius, this.enemies,
        );
      },
    );

    // Enemy attack — apply damage to player
    this.eventBus.on<{
      enemyId: string;
      attackType: string;
      x: number;
      z: number;
      damage: number;
      yaw?: number;
      dirX?: number;
      dirZ?: number;
    }>(
      'enemy.attack',
      (data) => this.onEnemyAttack(data),
    );
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

    // Door system must init BEFORE renderer so it can mutate sector
    // ceiling heights to their closed position before geometry is built.
    this.doorSystem.init(mapData, this.eventBus, this.renderer);
    this.renderer.loadMap(mapData);
    this.physicsSystem.init(mapData);
    this.combatSystem.init(mapData, this.eventBus);
    this.enemyAISystem.init(
      mapData, this.eventBus, this.physicsSystem, this.doorSystem, this.combatSystem,
    );

    // Spawn player at map start
    const start = this.world.getPlayerStart();
    this.player = new Player(start.x, start.z, start.angle);

    // Set initial floor height
    const sector = this.physicsSystem.findSectorAt(start.x, start.z);
    if (sector) {
      this.player.floorHeight = sector.floorHeight;
      this.player.sectorFloorHeight = sector.floorHeight;
    }

    // Spawn pickups and barrels from map things
    this.spawnEntitiesFromMap(mapData);

    // Handle resize
    window.addEventListener('resize', () => {
      this.renderer.resize(window.innerWidth, window.innerHeight);
    });

    // Handle pointer lock changes (pause/resume)
    document.addEventListener('pointerlockchange', () => {
      if (this.inputSystem.isPointerLocked()) {
        if (this.state === GameState.PAUSED) {
          this.state = GameState.PLAYING;
          this.lastTime = performance.now();
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

    this.renderer.beginFrame(dt);

    if (this.state === GameState.PLAYING) {
      this.update(dt);
    }

    this.renderFrame();

    this.inputSystem.endFrame();
  };

  private update(dt: number): void {
    if (!this.player || !this.world) return;

    // Save old position before player movement
    const oldX = this.player.position.x;
    const oldZ = this.player.position.z;

    // Player computes movement from input
    this.player.update(dt, this.inputSystem);

    const barrelObstacles = this.barrels
      .filter((barrel) => barrel.alive)
      .map((barrel) => ({
        x: barrel.position.x,
        z: barrel.position.z,
        radius: barrel.radius,
      }));

    const enemyObstacles = this.enemies
      .filter((enemy) => enemy.alive)
      .map((enemy) => ({
        x: enemy.position.x,
        z: enemy.position.z,
        radius: enemy.radius,
      }));

    const circleObstacles = [...barrelObstacles, ...enemyObstacles];

    // Physics resolves collision and determines floor height
    const result = this.physicsSystem.resolveMovement(
      oldX,
      oldZ,
      this.player.position.x,
      this.player.position.z,
      this.player.sectorFloorHeight,
      circleObstacles,
    );

    this.player.position.x = result.x;
    this.player.position.z = result.z;
    this.player.sectorFloorHeight = result.floorHeight;

    // Lerp the visual floor height
    const lerpFactor = Math.min(1, dt * 15);
    this.player.floorHeight +=
      (result.floorHeight - this.player.floorHeight) * lerpFactor;

    // Register entities for hitscan testing this frame
    this.combatSystem.setEntities(this.enemies, this.barrels);

    // Update weapon system
    this.weaponSystem.update(dt, this.inputSystem, this.player);

    // Handle Use key (doors)
    if (this.inputSystem.wasKeyPressed('KeyE') || this.inputSystem.wasKeyPressed('Space')) {
      this.doorSystem.tryActivate(this.player);
    }

    // Update door system
    this.doorSystem.update(dt, this.player);

    // Update enemies (AI, movement, attacks)
    this.updateEnemies(dt);

    // Update projectiles
    this.updateProjectiles(dt);

    // Update pickups
    this.updatePickups(dt);

    // Update HUD message timer
    if (this.hudMessageTimer > 0) {
      this.hudMessageTimer -= dt;
    }
  }

  // ── Entity Spawning ────────────────────────────────────────

  private spawnEntitiesFromMap(mapData: import('../world/MapTypes.ts').MapData): void {
    for (const thing of mapData.things) {
      const x = thing.position[0];
      const z = thing.position[1];
      const floorHeight = this.getFloorHeightAt(x, z);

      // Pickups
      const pickupType = thingTypeToPickupType(thing.type);
      if (pickupType !== null) {
        const pickup = new Pickup(pickupType, x, z, floorHeight);
        this.pickups.push(pickup);

        // Add sprite to renderer
        this.renderer.addSprite(pickup.id, {
          spriteSheet: pickup.display.spriteKey,
          frameWidth: 64,
          frameHeight: 64,
          animations: { idle: [0] },
          worldScale: pickup.display.worldScale,
        });
        this.renderer.updateSprite(pickup.id, pickup.position, 0);
        continue;
      }

      // Explosive barrels
      if (thing.type === ThingType.BARREL_EXPLOSIVE) {
        const barrel = new Barrel(x, z, floorHeight);
        this.barrels.push(barrel);

        this.renderer.addSprite(barrel.id, {
          spriteSheet: 'barrel_explosive',
          frameWidth: 64,
          frameHeight: 64,
          animations: { idle: [0] },
          worldScale: 1.15,
        });
        this.renderer.updateSprite(barrel.id, barrel.position, 0);
        continue;
      }

      // Enemies
      const enemyType = thingTypeToEnemyType(thing.type);
      if (enemyType !== null) {
        const yaw = (thing.angle * Math.PI) / 180;
        const ambush = thing.flags?.ambush ?? false;
        const enemy = new Enemy(enemyType, x, z, floorHeight, yaw, ambush);
        this.enemies.push(enemy);

        this.renderer.addSprite(enemy.id, {
          spriteSheet: enemy.def.spriteKey,
          frameWidth: 64,
          frameHeight: 64,
          animations: { idle: [0] },
          worldScale: enemy.def.worldScale,
          brightness: 0.8,
        });
        this.renderer.updateSprite(enemy.id, enemy.position, 0);
      }
    }
  }

  private getFloorHeightAt(x: number, z: number): number {
    const sector = this.physicsSystem.findSectorAt(x, z);
    return sector ? sector.floorHeight : 0;
  }

  private getSectorCenter(sectorId: number): { x: number; z: number } | null {
    const mapData = this.world?.getMapData();
    if (!mapData) return null;

    const vertexIndices = new Set<number>();
    for (const ld of mapData.linedefs) {
      if (ld.frontSector === sectorId || ld.backSector === sectorId) {
        vertexIndices.add(ld.v1);
        vertexIndices.add(ld.v2);
      }
    }
    if (vertexIndices.size === 0) return null;

    let sumX = 0;
    let sumZ = 0;
    for (const index of vertexIndices) {
      const v = mapData.vertices[index];
      sumX += v[0];
      sumZ += v[1];
    }

    const count = vertexIndices.size;
    return { x: sumX / count, z: sumZ / count };
  }

  // ── Pickup Update ──────────────────────────────────────────

  private updatePickups(dt: number): void {
    if (!this.player) return;

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      if (pickup.collected) {
        this.renderer.removeSprite(pickup.id);
        this.pickups.splice(i, 1);
        continue;
      }

      const wasCollected = pickup.update(dt, this.player);
      if (wasCollected) {
        this.eventBus.emit('pickup.collected', {
          pickupId: pickup.id,
          pickupType: pickup.pickupType,
          x: pickup.position.x,
          y: pickup.position.y,
          z: pickup.position.z,
        });
        this.renderer.removeSprite(pickup.id);
        this.pickups.splice(i, 1);
      } else {
        // Update sprite position with bob
        const bobPos = {
          x: pickup.position.x,
          y: pickup.position.y + pickup.getBobOffset(),
          z: pickup.position.z,
        };
        this.renderer.updateSprite(pickup.id, bobPos, 0);
      }
    }
  }

  // ── Enemy Update ─────────────────────────────────────────

  private updateEnemies(dt: number): void {
    if (!this.player) return;

    this.enemyAISystem.update(dt, this.player, this.enemies);

    // Sync sprite positions/animations and handle dead enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];

      // On first frame of death: emit event and drop pickup. The enemy
      // stays in the list until its death animation finishes.
      if (enemy.state === EnemyState.DEAD && enemy.stateTimer === 0) {
        enemy.stateTimer = 1; // Mark death as processed
        this.eventBus.emit('enemy.died', {
          enemyId: enemy.id,
          enemyType: enemy.enemyType,
          x: enemy.position.x,
          z: enemy.position.z,
          dropPickup: enemy.def.dropPickup,
        });

        if (enemy.def.dropPickup !== null) {
          this.spawnDropPickup(enemy.def.dropPickup, enemy.position.x, enemy.position.z);
        }
      }

      // Drive sprite animation from AI state
      const anim = ENEMY_ANIMS[enemy.state];
      const animKey = enemy.def.spriteKey + anim.suffix;
      if (enemy.animKey !== animKey) {
        enemy.animKey = animKey;
        enemy.animTime = 0;
        this.renderer.setSpriteAnimation(enemy.id, animKey);
      } else {
        enemy.animTime += dt;
      }

      let frame = Math.floor(enemy.animTime * anim.fps);
      if (!anim.loop) frame = Math.min(frame, anim.frameCount - 1);

      this.renderer.updateSprite(enemy.id, enemy.position, frame);

      // Once the death animation has played out, retire the enemy from the
      // active list but leave its sprite in the world as a corpse.
      if (enemy.state === EnemyState.DEAD) {
        const deathDuration = anim.frameCount / anim.fps;
        if (enemy.animTime >= deathDuration + 0.2) {
          this.enemies.splice(i, 1);
        }
      }
    }
  }

  private spawnDropPickup(thingType: number, x: number, z: number): void {
    const pickupType = thingTypeToPickupType(thingType);
    if (pickupType === null) return;

    const floorHeight = this.getFloorHeightAt(x, z);
    const pickup = new Pickup(pickupType, x, z, floorHeight);
    this.pickups.push(pickup);

    this.renderer.addSprite(pickup.id, {
      spriteSheet: pickup.display.spriteKey,
      frameWidth: 64,
      frameHeight: 64,
      animations: { idle: [0] },
      worldScale: pickup.display.worldScale,
    });
    this.renderer.updateSprite(pickup.id, pickup.position, 0);
  }

  private onEnemyAttack(data: {
    enemyId: string;
    attackType: string;
    x: number;
    z: number;
    damage: number;
    yaw?: number;
    dirX?: number;
    dirZ?: number;
  }): void {
    if (!this.player) return;

    if (data.attackType === 'hitscan' || data.attackType === 'melee') {
      // Direct damage to player with armor absorption
      this.applyDamageToPlayer(data.damage, data.attackType);
      this.renderer.screenShake(0.04, 0.12);
    } else if (data.attackType === 'projectile') {
      // Spawn enemy projectile using launcher as base template
      const launcherDef = WEAPON_DEFS[WeaponId.LAUNCHER];
      const floorHeight = this.getFloorHeightAt(data.x, data.z);
      const enemyWeaponDef: WeaponDef = {
        ...launcherDef,
        damage: data.damage,
        projectileSpeed: 6, // Slower than player rockets
        splashRadius: 2.5,
        splashDamage: Math.round(data.damage * 0.6),
      };
      const proj = new Projectile({
        x: data.x,
        z: data.z,
        yaw: data.yaw ?? 0,
        floorHeight,
        weaponDef: enemyWeaponDef,
        ownerId: data.enemyId,
      });

      this.projectiles.push(proj);
      this.renderer.addSprite(proj.id, {
        spriteSheet: 'projectile_rocket',
        frameWidth: 64,
        frameHeight: 64,
        animations: { idle: [0] },
        worldScale: 0.4,
      });
      this.renderer.updateSprite(proj.id, proj.position, 0);
    }
  }

  // ── Projectile Update ──────────────────────────────────────

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      if (!proj.alive) {
        this.removeProjectile(i);
        continue;
      }

      const prevX = proj.position.x;
      const prevZ = proj.position.z;
      const move = proj.update(dt);

      if (!proj.alive) {
        this.removeProjectile(i);
        continue;
      }

      // Check wall collision
      const moveDist = Math.sqrt(move.dx * move.dx + move.dz * move.dz);
      if (moveDist > 0.001) {
        const hit = this.combatSystem.raycastWalls(
          prevX, prevZ,
          move.dx, move.dz,
          moveDist,
        );

        if (hit) {
          proj.position.x = hit.x;
          proj.position.z = hit.z;
          this.onProjectileImpact(proj, hit);
          this.removeProjectile(i);
          continue;
        }
      }

      // Check barrel collision
      let projHitEntity = false;
      for (const barrel of this.barrels) {
        if (!barrel.alive) continue;
        if (barrel.distanceTo(proj.position.x, proj.position.z) < barrel.radius + 0.3) {
          this.onProjectileImpact(proj, {
            x: proj.position.x,
            z: proj.position.z,
            distance: 0,
            normalX: 0,
            normalZ: 0,
          });
          barrel.takeDamage(proj.damage);
          if (!barrel.alive) {
            this.detonateBarrel(barrel);
          }
          this.removeProjectile(i);
          projHitEntity = true;
          break;
        }
      }

      // Check enemy collision (skip if projectile already hit something)
      if (!projHitEntity && proj.alive) {
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          // Don't let an enemy's own projectile hit itself
          if (proj.ownerId === enemy.id) continue;
          if (enemy.distanceTo(proj.position.x, proj.position.z) < enemy.radius + 0.3) {
            this.onProjectileImpact(proj, {
              x: proj.position.x,
              z: proj.position.z,
              distance: 0,
              normalX: 0,
              normalZ: 0,
            });

            const { died } = enemy.takeDamage(proj.damage);
            enemy.lastDamageSourceId = proj.ownerId;

            // Infighting: if hit by another enemy's projectile, retarget
            if (proj.ownerId !== 'player' && proj.ownerId !== enemy.id) {
              enemy.targetId = proj.ownerId;
              if (enemy.state === EnemyState.IDLE) {
                enemy.state = EnemyState.CHASE;
                enemy.losTimer = 0;
              }
            }

            if (died) {
              this.eventBus.emit('enemy.died', {
                enemyId: enemy.id,
                enemyType: enemy.enemyType,
                x: enemy.position.x,
                z: enemy.position.z,
              });
            }

            this.removeProjectile(i);
            break;
          }
        }
      }

      if (proj.alive) {
        this.renderer.updateSprite(proj.id, proj.position, 0);
      }
    }
  }

  private onProjectileImpact(proj: Projectile, hit: RayHit): void {
    const hitX = hit.x;
    const hitZ = hit.z;

    this.renderer.screenShake(0.08, 0.2);

    this.eventBus.emit('combat.wallHit', {
      x: hitX,
      z: hitZ,
      normalX: hit.normalX,
      normalZ: hit.normalZ,
    });
    this.eventBus.emit('combat.explosion', {
      x: hitX,
      z: hitZ,
      normalX: hit.normalX,
      normalZ: hit.normalZ,
    });

    if (proj.splashRadius > 0) {
      this.applySplashDamage(hitX, hitZ, proj.splashRadius, proj.splashDamage);
    }
  }

  private spawnProjectile(
    x: number,
    z: number,
    yaw: number,
    weaponDef: WeaponDef,
  ): void {
    const floorHeight = this.player?.sectorFloorHeight ?? 0;
    const proj = new Projectile({
      x,
      z,
      yaw,
      floorHeight,
      weaponDef,
      ownerId: 'player',
    });

    this.projectiles.push(proj);

    this.renderer.addSprite(proj.id, {
      spriteSheet: 'projectile_rocket',
      frameWidth: 64,
      frameHeight: 64,
      animations: { idle: [0] },
      worldScale: 0.5,
    });
    this.renderer.updateSprite(proj.id, proj.position, 0);
  }

  private removeProjectile(index: number): void {
    const proj = this.projectiles[index];
    this.renderer.removeSprite(proj.id);
    this.projectiles.splice(index, 1);
  }

  // ── Damage Application ──────────────────────────────────────

  /**
   * Apply damage to the player with armor absorption.
   * Green armor absorbs 1/3 of damage, blue armor absorbs 1/2.
   */
  private applyDamageToPlayer(rawDamage: number, source: string): void {
    if (!this.player) return;

    let healthDamage = rawDamage;

    if (this.player.armor > 0 && this.player.armorType !== 'none') {
      const absorptionRate = this.player.armorType === 'blue' ? 0.5 : 1 / 3;
      const armorAbsorb = Math.round(rawDamage * absorptionRate);
      const actualAbsorb = Math.min(armorAbsorb, this.player.armor);
      this.player.armor -= actualAbsorb;
      healthDamage = rawDamage - actualAbsorb;

      if (this.player.armor <= 0) {
        this.player.armor = 0;
        this.player.armorType = 'none';
      }
    }

    this.player.health = Math.max(0, this.player.health - healthDamage);
    this.eventBus.emit('player.damage', { damage: healthDamage, source });
  }

  // ── Barrel / Splash Damage ─────────────────────────────────

  private applySplashDamage(x: number, z: number, radius: number, damage: number): void {
    // Damage player
    if (this.player) {
      const dx = this.player.position.x - x;
      const dz = this.player.position.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < radius) {
        const falloff = 1 - dist / radius;
        const dmg = Math.round(damage * falloff);
        if (dmg > 0) {
          this.applyDamageToPlayer(dmg, 'splash');
        }
      }
    }

    // Damage barrels (can chain-react)
    const barrelsToDetonate: Barrel[] = [];
    for (const barrel of this.barrels) {
      if (!barrel.alive) continue;
      const dist = barrel.distanceTo(x, z);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        const dmg = Math.round(damage * falloff);
        if (dmg > 0) {
          const died = barrel.takeDamage(dmg);
          if (died) {
            barrelsToDetonate.push(barrel);
          }
        }
      }
    }

    // Chain-detonate barrels
    for (const barrel of barrelsToDetonate) {
      this.detonateBarrel(barrel);
    }

    // Damage enemies
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dist = enemy.distanceTo(x, z);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        const dmg = Math.round(damage * falloff);
        if (dmg > 0) {
          const { died } = enemy.takeDamage(dmg);
          if (died) {
            this.eventBus.emit('enemy.died', {
              enemyId: enemy.id,
              enemyType: enemy.enemyType,
              x: enemy.position.x,
              z: enemy.position.z,
            });
          }
        }
      }
    }
  }

  private detonateBarrel(barrel: Barrel): void {
    const explosion = barrel.getExplosion();

    this.renderer.screenShake(0.1, 0.25);
    this.eventBus.emit('barrel.exploded', {
      barrelId: barrel.id,
      x: explosion.x,
      z: explosion.z,
    });

    // Remove barrel sprite
    this.renderer.removeSprite(barrel.id);

    // Apply splash damage from barrel explosion
    this.applySplashDamage(explosion.x, explosion.z, explosion.radius, explosion.damage);
  }

  // ── HUD Message ────────────────────────────────────────────

  private showMessage(text: string): void {
    this.hudMessage = text;
    this.hudMessageTimer = MESSAGE_DURATION;
  }

  // ── Render ─────────────────────────────────────────────────

  private renderFrame(): void {
    if (!this.player) return;

    this.renderer.render(this.player.getCameraState(), [], []);

    // Draw weapon viewmodel on HUD canvas
    const weaponState = this.weaponSystem.getState();
    const viewmodelState: WeaponViewmodelState = {
      weaponId: this.weaponSystem.getCurrentWeapon(),
      state: weaponState,
      offset: this.weaponSystem.viewmodelOffset,
      isFiring: weaponState === WeaponState.FIRE,
    };
    this.renderer.drawWeaponViewmodel(viewmodelState);

    // Draw HUD
    const currentWeaponDef = WEAPON_DEFS[this.weaponSystem.getCurrentWeapon()];
    const hudState: HUDState = {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      armor: this.player.armor,
      ammo: currentWeaponDef.ammoType !== AmmoType.NONE
        ? this.player.ammo[currentWeaponDef.ammoType]
        : 0,
      maxAmmo: currentWeaponDef.ammoType !== AmmoType.NONE
        ? this.player.maxAmmo[currentWeaponDef.ammoType]
        : 0,
      weaponName: currentWeaponDef.name,
      keys: { ...this.player.keys },
      message: this.hudMessageTimer > 0 ? this.hudMessage : undefined,
      messageTimer: this.hudMessageTimer > 0 ? this.hudMessageTimer : undefined,
    };
    this.renderer.drawHUD(hudState);

    this.renderer.endFrame();
  }

  // ── Combat Event Handlers ────────────────────────────────

  private onWeaponFire(data: {
    weaponDef: WeaponDef;
    playerX: number;
    playerZ: number;
    yaw: number;
  }): void {
    const { weaponDef, playerX, playerZ, yaw } = data;

    // Screen shake
    this.renderer.screenShake(weaponDef.screenShake * 0.05, 0.15);

    // Muzzle flash (not for melee)
    if (!weaponDef.isMelee) {
      this.renderer.muzzleFlash();
    }

    if (weaponDef.isProjectile) {
      this.spawnProjectile(playerX, playerZ, yaw, weaponDef);
      return;
    }

    // Fire hitscan(s) — CombatSystem now tests against enemies and barrels
    const results = this.combatSystem.fireWeapon(weaponDef, playerX, playerZ, yaw);

    for (const result of results) {
      for (const entityHit of result.entityHits) {
        if (entityHit.entityType === 'enemy') {
          this.onHitscanHitEnemy(entityHit);
        } else if (entityHit.entityType === 'barrel') {
          this.onHitscanHitBarrel(entityHit);
        }
      }
    }
  }

  private onHitscanHitEnemy(hit: import('../combat/CombatSystem.ts').EntityHitInfo): void {
    const enemy = this.enemies.find((e) => e.id === hit.entityId);
    if (!enemy || !enemy.alive) return;

    const { died, enterPain } = enemy.takeDamage(hit.damage);
    enemy.lastDamageSourceId = 'player';

    // Spawn hit VFX
    this.renderer.spawnImpactFx(
      { x: enemy.position.x, y: enemy.position.y, z: enemy.position.z },
      { x: 0, y: 0, z: 0 },
    );
    this.renderer.screenShake(0.02, 0.08);

    if (died) {
      this.eventBus.emit('enemy.died', {
        enemyId: enemy.id,
        enemyType: enemy.enemyType,
        x: enemy.position.x,
        z: enemy.position.z,
      });
    } else if (enterPain) {
      // Alert the enemy if it was idle
      if (enemy.state === EnemyState.IDLE) {
        enemy.state = EnemyState.CHASE;
        enemy.losTimer = 0;
      }
    }
  }

  private onHitscanHitBarrel(hit: import('../combat/CombatSystem.ts').EntityHitInfo): void {
    const barrel = this.barrels.find((b) => b.id === hit.entityId);
    if (!barrel || !barrel.alive) return;

    const died = barrel.takeDamage(hit.damage);
    if (died) {
      this.detonateBarrel(barrel);
    }
  }
}
