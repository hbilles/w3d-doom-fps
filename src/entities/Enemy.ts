import type { Vec3 } from '../renderer/RenderTypes.ts';
import { EnemyState, type EnemyType, type EnemyDef, ENEMY_DEFS } from './EnemyDefs.ts';

export class Enemy {
  readonly id: string;
  readonly position: Vec3;
  readonly def: EnemyDef;
  readonly enemyType: EnemyType;
  readonly ambush: boolean;
  readonly radius: number;

  health: number;
  maxHealth: number;
  alive: boolean = true;
  yaw: number;

  // ── AI State ───────────────────────────────────────────
  state: EnemyState = EnemyState.IDLE;
  stateTimer: number = 0;          // General-purpose timer for current state
  losTimer: number = 0;            // Time since last LOS to player (for giving up chase)
  attackCooldown: number = 0;      // Countdown until next attack allowed
  lastDamageSourceId: string | null = null; // For infighting: who last damaged this enemy
  targetId: string = 'player';     // Current target (default: player, can be enemy id)

  // ── Sprite Animation ───────────────────────────────────
  animKey: string = '';            // Currently playing animation sprite key
  animTime: number = 0;            // Seconds elapsed in current animation

  private static nextId = 0;

  constructor(
    enemyType: EnemyType,
    x: number,
    z: number,
    floorHeight: number,
    yaw: number,
    ambush: boolean,
  ) {
    this.id = `enemy_${Enemy.nextId++}`;
    this.enemyType = enemyType;
    this.def = ENEMY_DEFS[enemyType];
    this.ambush = ambush;
    this.radius = this.def.radius;
    this.health = this.def.health;
    this.maxHealth = this.def.health;
    this.yaw = yaw;

    // Position sprite center at roughly chest height
    this.position = { x, y: floorHeight + this.def.worldScale * 0.5, z };
  }

  /**
   * Apply damage to this enemy.
   * Returns whether the enemy died and whether it enters pain state.
   */
  takeDamage(amount: number): { died: boolean; enterPain: boolean } {
    if (!this.alive) return { died: false, enterPain: false };

    this.health -= amount;

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.state = EnemyState.DEAD;
      this.stateTimer = 0;
      return { died: true, enterPain: false };
    }

    // Roll for pain state
    const enterPain = Math.random() < this.def.painChance;
    if (enterPain && this.state !== EnemyState.DEAD) {
      this.state = EnemyState.PAIN;
      this.stateTimer = 0.2; // 0.2s pain stun
    }

    return { died: false, enterPain };
  }

  /**
   * Get distance from a world point to this enemy's center (2D, XZ plane).
   */
  distanceTo(x: number, z: number): number {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Check if a point is within this enemy's collision radius (2D).
   */
  containsPoint(x: number, z: number): boolean {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    return dx * dx + dz * dz < this.radius * this.radius;
  }
}
