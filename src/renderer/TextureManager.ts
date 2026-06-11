import * as THREE from 'three';
import { TEXTURE_MANIFEST } from './TextureManifest.ts';

const TEX_SIZE = 128;

/**
 * Provides wall/floor/ceiling materials. Textures listed in the generated
 * TEXTURE_MANIFEST are loaded from /assets/textures/ (pixel-art PNGs, with
 * optional emissive maps for neon/glowing elements); anything else falls
 * back to a procedural canvas-drawn pattern.
 */
export class TextureManager {
  private materials: Map<string, THREE.MeshStandardMaterial> = new Map();
  private loader = new THREE.TextureLoader();

  getMaterial(name: string | null | undefined): THREE.MeshStandardMaterial {
    const key = name ?? '_default';
    const cached = this.materials.get(key);
    if (cached) return cached;

    const manifestEntry = TEXTURE_MANIFEST[key];
    const material = manifestEntry
      ? this.createFileMaterial(key, manifestEntry.emissive)
      : this.createProceduralMaterial(key);

    this.materials.set(key, material);
    return material;
  }

  private createFileMaterial(
    name: string,
    emissive: boolean,
  ): THREE.MeshStandardMaterial {
    const map = this.loadTile(`/assets/textures/${name}.png`);

    const material = new THREE.MeshStandardMaterial({
      map,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.05,
    });

    if (emissive) {
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveMap = this.loadTile(`/assets/textures/${name}_emissive.png`);
      material.emissiveIntensity = 1.0;
    }

    return material;
  }

  private loadTile(url: string): THREE.Texture {
    const tex = this.loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  private createProceduralMaterial(key: string): THREE.MeshStandardMaterial {
    const texture = this.generateTexture(key);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    return new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      roughness: 0.65,
      metalness: 0.25,
    });
  }

  dispose(): void {
    for (const mat of this.materials.values()) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.materials.clear();
  }

  // ── Texture generation ─────────────────────────────────────

  private generateTexture(name: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext('2d')!;

    if (name.includes('metal_grate') || name.includes('floor_metal')) {
      this.drawMetalGrate(ctx);
    } else if (name.includes('concrete_wet') || name.includes('floor_concrete')) {
      this.drawConcreteWet(ctx);
    } else if (name.includes('concrete') || name.includes('wall_concrete')) {
      this.drawConcrete(ctx);
    } else if (name.includes('neon_blue')) {
      this.drawNeonWall(ctx, '#00ccff');
    } else if (name.includes('neon_pink') || name.includes('neon_magenta')) {
      this.drawNeonWall(ctx, '#ff0066');
    } else if (name.includes('neon_green')) {
      this.drawNeonWall(ctx, '#00ff88');
    } else if (name.includes('neon_orange')) {
      this.drawNeonWall(ctx, '#ff8800');
    } else if (name.includes('door')) {
      this.drawDoor(ctx);
    } else if (name.includes('pipes') || name.includes('ceiling_pipes')) {
      this.drawPipes(ctx);
    } else if (name.includes('ceiling') || name.includes('industrial')) {
      this.drawIndustrial(ctx);
    } else {
      this.drawDefault(ctx, name);
    }

    return new THREE.CanvasTexture(canvas);
  }

  // ── Pattern helpers ────────────────────────────────────────

  private drawConcrete(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#5a5a6a';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.addNoise(ctx, 12);
    // Subtle horizontal grout lines
    ctx.strokeStyle = '#484858';
    ctx.lineWidth = 1;
    for (let y = 0; y < TEX_SIZE; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEX_SIZE, y);
      ctx.stroke();
    }
  }

  private drawConcreteWet(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#404050';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.addNoise(ctx, 10);
    // Wet sheen — lighter horizontal streaks
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#8899bb';
    for (let y = 0; y < TEX_SIZE; y += 8) {
      ctx.fillRect(0, y, TEX_SIZE, 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawMetalGrate(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#2a2a40';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    ctx.strokeStyle = '#3e3e55';
    ctx.lineWidth = 2;
    // Grid pattern
    for (let x = 0; x < TEX_SIZE; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, TEX_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y < TEX_SIZE; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEX_SIZE, y);
      ctx.stroke();
    }
    this.addNoise(ctx, 5);
  }

  private drawNeonWall(ctx: CanvasRenderingContext2D, neonColor: string): void {
    // Dark base
    ctx.fillStyle = '#2a2a40';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.addNoise(ctx, 8);
    // Neon horizontal strip
    const stripY = TEX_SIZE * 0.4;
    const stripH = 12;
    // Glow
    ctx.shadowColor = neonColor;
    ctx.shadowBlur = 20;
    ctx.fillStyle = neonColor;
    ctx.fillRect(0, stripY, TEX_SIZE, stripH);
    ctx.shadowBlur = 0;
    // Bright core
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.4;
    ctx.fillRect(0, stripY + 3, TEX_SIZE, stripH - 6);
    ctx.globalAlpha = 1;
  }

  private drawDoor(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#5a5a6a';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.addNoise(ctx, 10);
    // Door panels
    ctx.strokeStyle = '#484858';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, TEX_SIZE - 16, TEX_SIZE / 2 - 12);
    ctx.strokeRect(8, TEX_SIZE / 2 + 4, TEX_SIZE - 16, TEX_SIZE / 2 - 12);
    // Handle
    ctx.fillStyle = '#888899';
    ctx.fillRect(TEX_SIZE - 24, TEX_SIZE / 2 - 4, 8, 8);
  }

  private drawPipes(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#252530';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    // Horizontal pipes
    ctx.fillStyle = '#3a3a48';
    for (let y = 16; y < TEX_SIZE; y += 32) {
      ctx.fillRect(0, y, TEX_SIZE, 12);
      ctx.fillStyle = '#2a2a38';
      ctx.fillRect(0, y + 12, TEX_SIZE, 2);
      ctx.fillStyle = '#3a3a48';
    }
    this.addNoise(ctx, 4);
  }

  private drawIndustrial(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#222230';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.addNoise(ctx, 6);
    // Rivets
    ctx.fillStyle = '#30303e';
    for (let x = 8; x < TEX_SIZE; x += 32) {
      for (let y = 8; y < TEX_SIZE; y += 32) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawDefault(ctx: CanvasRenderingContext2D, name: string): void {
    // Deterministic color from name hash
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
    }
    const r = ((hash >> 16) & 0xff) * 0.3;
    const g = ((hash >> 8) & 0xff) * 0.3;
    const b = (hash & 0xff) * 0.3;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.addNoise(ctx, 8);
  }

  private addNoise(
    ctx: CanvasRenderingContext2D,
    amount: number,
  ): void {
    const imageData = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * amount * 2;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);
  }
}
