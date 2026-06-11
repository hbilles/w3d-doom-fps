import type { HUDState } from '../renderer/RenderTypes.ts';

/**
 * Draws the in-game HUD overlay on a 2D canvas.
 * Styled with Blade Runner neon aesthetic.
 */
export class HUD {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  draw(state: HUDState): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Damage flash / death fade (drawn under the HUD bar)
    const redAlpha = Math.max(
      (state.damageFlash ?? 0) * 0.35,
      (state.deathFade ?? 0) * 0.55,
    );
    if (redAlpha > 0) {
      ctx.fillStyle = `rgba(180, 0, 0, ${redAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    const barHeight = 60;
    const barY = h - barHeight;

    // Semi-transparent background bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, barY, w, barHeight);

    // Top border line
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, barY);
    ctx.lineTo(w, barY);
    ctx.stroke();

    const fontSize = Math.max(14, Math.min(20, w / 50));
    ctx.textBaseline = 'middle';

    // ── Health (bottom-left) ─────────────────────────────────
    const healthX = 20;
    const healthY = barY + barHeight / 2;

    // Health bar background
    const healthBarW = 120;
    const healthBarH = 12;
    ctx.fillStyle = '#333333';
    ctx.fillRect(healthX, healthY + 10, healthBarW, healthBarH);

    // Health bar fill
    const healthPct = Math.max(0, state.health / state.maxHealth);
    let healthColor = '#00ff44';
    if (healthPct < 0.25) healthColor = '#ff2222';
    else if (healthPct < 0.5) healthColor = '#ff8800';
    else if (healthPct < 0.75) healthColor = '#ffcc00';

    ctx.fillStyle = healthColor;
    ctx.fillRect(healthX, healthY + 10, healthBarW * healthPct, healthBarH);

    // Health text
    ctx.font = `bold ${fontSize}px "Courier New", monospace`;
    ctx.fillStyle = healthColor;
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${state.health}`, healthX, healthY - 4);

    // Armor (next to health)
    if (state.armor > 0) {
      ctx.fillStyle = '#00aaff';
      ctx.fillText(`ARM ${state.armor}`, healthX + healthBarW + 20, healthY - 4);
    }

    // ── Weapon name (bottom-center) ──────────────────────────
    ctx.font = `bold ${fontSize}px "Courier New", monospace`;
    ctx.fillStyle = '#ff8800';
    ctx.textAlign = 'center';
    ctx.fillText(state.weaponName.toUpperCase(), w / 2, healthY);

    // ── Ammo (bottom-right) ──────────────────────────────────
    const ammoX = w - 20;
    ctx.font = `bold ${fontSize + 4}px "Courier New", monospace`;
    ctx.textAlign = 'right';

    if (state.maxAmmo > 0) {
      ctx.fillStyle = state.ammo <= 10 ? '#ff2222' : '#ffcc00';
      ctx.fillText(`${state.ammo}`, ammoX, healthY - 6);
      ctx.font = `${fontSize - 2}px "Courier New", monospace`;
      ctx.fillStyle = '#888888';
      ctx.fillText(`/ ${state.maxAmmo}`, ammoX, healthY + 14);
    } else {
      ctx.fillStyle = '#888888';
      ctx.font = `${fontSize}px "Courier New", monospace`;
      ctx.fillText('---', ammoX, healthY);
    }

    // ── Keys (top-right) ─────────────────────────────────────
    const keySize = 18;
    const keyY = 16;
    let keyX = w - 20;

    if (state.keys.yellow) {
      ctx.fillStyle = '#ffff00';
      ctx.fillRect(keyX - keySize, keyY, keySize, keySize);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(keyX - keySize, keyY, keySize, keySize);
      ctx.fillStyle = '#000';
      ctx.font = `bold 12px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Y', keyX - keySize / 2, keyY + keySize / 2 + 1);
      keyX -= keySize + 6;
    }
    if (state.keys.blue) {
      ctx.fillStyle = '#0088ff';
      ctx.fillRect(keyX - keySize, keyY, keySize, keySize);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(keyX - keySize, keyY, keySize, keySize);
      ctx.fillStyle = '#fff';
      ctx.font = `bold 12px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('B', keyX - keySize / 2, keyY + keySize / 2 + 1);
      keyX -= keySize + 6;
    }
    if (state.keys.red) {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(keyX - keySize, keyY, keySize, keySize);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(keyX - keySize, keyY, keySize, keySize);
      ctx.fillStyle = '#fff';
      ctx.font = `bold 12px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('R', keyX - keySize / 2, keyY + keySize / 2 + 1);
    }

    // ── Message overlay ──────────────────────────────────────
    if (state.message && state.messageTimer && state.messageTimer > 0) {
      const alpha = Math.min(1, state.messageTimer);
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${fontSize + 2}px "Courier New", monospace`;
      ctx.fillStyle = '#ff8800';
      ctx.textAlign = 'center';
      ctx.fillText(state.message, w / 2, h / 2 - 60);
      ctx.globalAlpha = 1;
    }
  }
}
