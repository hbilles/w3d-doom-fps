import * as THREE from 'three';
import type { Vec3 } from './RenderTypes.ts';

interface TransientSpriteFx {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  drift: THREE.Vector3;
}

interface TransientLightFx {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
  startIntensity: number;
}

/**
 * Handles short-lived visual effects such as impacts, explosions, pickups, and door pulses.
 * Keeps all effect lifecycle logic local to the renderer.
 */
export class TransientFxSystem {
  private scene: THREE.Scene;
  private sprites: TransientSpriteFx[] = [];
  private lights: TransientLightFx[] = [];
  private textures: {
    spark: THREE.Texture;
    burst: THREE.Texture;
    ring: THREE.Texture;
  };
  private impactCooldown: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.textures = {
      spark: this.createSparkTexture(),
      burst: this.createBurstTexture(),
      ring: this.createRingTexture(),
    };
  }

  update(dt: number): void {
    if (this.impactCooldown > 0) {
      this.impactCooldown -= dt;
    }

    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const fx = this.sprites[i];
      fx.life -= dt;

      if (fx.life <= 0) {
        this.scene.remove(fx.sprite);
        fx.material.dispose();
        this.sprites.splice(i, 1);
        continue;
      }

      const t = 1 - fx.life / fx.maxLife;
      const scale = fx.startScale + (fx.endScale - fx.startScale) * t;
      fx.sprite.scale.set(scale, scale, 1);
      fx.sprite.position.addScaledVector(fx.drift, dt);
      fx.material.opacity = Math.max(0, 1 - t);
    }

    for (let i = this.lights.length - 1; i >= 0; i--) {
      const fx = this.lights[i];
      fx.life -= dt;

      if (fx.life <= 0) {
        this.scene.remove(fx.light);
        fx.light.dispose();
        this.lights.splice(i, 1);
        continue;
      }

      const t = 1 - fx.life / fx.maxLife;
      fx.light.intensity = fx.startIntensity * (1 - t) * (1 - t);
    }
  }

  spawnImpact(position: Vec3, normal?: Vec3): void {
    // Shotgun can emit many wall-hit events in a single frame; cap density.
    if (this.impactCooldown > 0) return;
    this.impactCooldown = 0.015;

    const nx = normal?.x ?? 0;
    const nz = normal?.z ?? 0;

    for (let i = 0; i < 3; i++) {
      const dirX = nx * 0.4 + (Math.random() - 0.5) * 1.2;
      const dirY = 0.6 + Math.random() * 1.4;
      const dirZ = nz * 0.4 + (Math.random() - 0.5) * 1.2;
      this.spawnSprite({
        position: {
          x: position.x + (Math.random() - 0.5) * 0.08,
          y: position.y + (Math.random() - 0.5) * 0.08,
          z: position.z + (Math.random() - 0.5) * 0.08,
        },
        texture: this.textures.spark,
        color: 0xffb468,
        life: 0.13 + Math.random() * 0.08,
        startScale: 0.2 + Math.random() * 0.08,
        endScale: 0.45 + Math.random() * 0.15,
        drift: new THREE.Vector3(dirX, dirY, dirZ).multiplyScalar(0.22),
      });
    }

    this.spawnLight(position, 0xffa347, 9, 5, 0.1);
  }

  spawnExplosion(position: Vec3, scale: number = 1, normal?: Vec3): void {
    // Push the explosion slightly off the impact surface to avoid clipping.
    const normalOffset = normal ? 0.22 : 0;
    const origin = {
      x: position.x + (normal?.x ?? 0) * normalOffset,
      y: position.y + 0.12,
      z: position.z + (normal?.z ?? 0) * normalOffset,
    };

    this.spawnSprite({
      position: origin,
      texture: this.textures.burst,
      color: 0xff8f4a,
      life: 0.28,
      startScale: 0.6 * scale,
      endScale: 2.2 * scale,
      drift: new THREE.Vector3(0, 0.25, 0),
    });

    this.spawnSprite({
      position: {
        x: origin.x,
        y: origin.y - 0.07,
        z: origin.z,
      },
      texture: this.textures.ring,
      color: 0xffc27a,
      life: 0.22,
      startScale: 0.4 * scale,
      endScale: 1.9 * scale,
      drift: new THREE.Vector3(0, 0.05, 0),
    });

    this.spawnLight(origin, 0xff8c42, 22 * scale, 8 * scale, 0.22);
  }

  spawnPickup(position: Vec3): void {
    this.spawnSprite({
      position: { ...position, y: position.y + 0.18 },
      texture: this.textures.ring,
      color: 0x7effd5,
      life: 0.25,
      startScale: 0.25,
      endScale: 0.95,
      drift: new THREE.Vector3(0, 0.2, 0),
    });

    this.spawnLight(position, 0x79ffd6, 6, 4.5, 0.14);
  }

  spawnDoorPulse(position: Vec3): void {
    this.spawnSprite({
      position: { ...position, y: position.y + 0.9 },
      texture: this.textures.ring,
      color: 0x44c5ff,
      life: 0.3,
      startScale: 0.4,
      endScale: 1.6,
      drift: new THREE.Vector3(0, 0.12, 0),
    });
    this.spawnLight(
      { ...position, y: position.y + 1.1 },
      0x33bbff,
      7,
      6,
      0.18,
    );
  }

  clear(): void {
    for (const fx of this.sprites) {
      this.scene.remove(fx.sprite);
      fx.material.dispose();
    }
    this.sprites = [];

    for (const fx of this.lights) {
      this.scene.remove(fx.light);
      fx.light.dispose();
    }
    this.lights = [];

    this.impactCooldown = 0;
  }

  dispose(): void {
    this.clear();
    this.textures.spark.dispose();
    this.textures.burst.dispose();
    this.textures.ring.dispose();
  }

  private spawnSprite(params: {
    position: Vec3;
    texture: THREE.Texture;
    color: number;
    life: number;
    startScale: number;
    endScale: number;
    drift: THREE.Vector3;
  }): void {
    const material = new THREE.SpriteMaterial({
      map: params.texture,
      transparent: true,
      opacity: 1,
      color: params.color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.set(params.position.x, params.position.y, params.position.z);
    sprite.scale.set(params.startScale, params.startScale, 1);

    this.scene.add(sprite);
    this.sprites.push({
      sprite,
      material,
      life: params.life,
      maxLife: params.life,
      startScale: params.startScale,
      endScale: params.endScale,
      drift: params.drift,
    });
  }

  private spawnLight(
    position: Vec3,
    color: number,
    intensity: number,
    distance: number,
    life: number,
  ): void {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(position.x, position.y, position.z);
    this.scene.add(light);

    this.lights.push({
      light,
      life,
      maxLife: life,
      startIntensity: intensity,
    });
  }

  private createSparkTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,220,150,0.95)');
    grad.addColorStop(0.7, 'rgba(255,170,80,0.35)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  private createBurstTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.25, 'rgba(255,210,120,0.95)');
    grad.addColorStop(0.55, 'rgba(255,140,70,0.55)');
    grad.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  private createRingTexture(): THREE.Texture {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }
}
