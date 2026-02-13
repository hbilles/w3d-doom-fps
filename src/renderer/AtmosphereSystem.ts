import * as THREE from 'three';
import type { Vec3 } from './RenderTypes.ts';

interface SteamParticle {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

interface SteamEmitter {
  position: Vec3;
  timer: number;
  radius: number;
}

export interface AtmosphereRuntimeConfig {
  rainEnabled: boolean;
  rainDensity: number;
  rainSpeed: number;
  rainRipplesEnabled: boolean;
  rainRippleDensity: number;
  steamEnabled: boolean;
  steamDensity: number;
  steamVents: Vec3[];
}

interface RainRipple {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

/**
 * Lightweight atmosphere layer for rain and steam.
 * Keeps effects purely renderer-side and map-configurable.
 */
export class AtmosphereSystem {
  private static readonly RAIN_MAX = 1500;
  private static readonly RAIN_RIPPLE_MAX = 120;
  private static readonly STEAM_MAX = 90;

  private scene: THREE.Scene;
  private rainGeometry: THREE.BufferGeometry | null = null;
  private rainMaterial: THREE.PointsMaterial | null = null;
  private rainPoints: THREE.Points | null = null;
  private rainPositions: Float32Array | null = null;
  private rainSpeeds: Float32Array | null = null;
  private rainDrift: Float32Array | null = null;
  private rainCount: number = 0;
  private rainEnabled: boolean = false;
  private rainDensity: number = 0.45;
  private rainSpeed: number = 11;
  private rainRipplesEnabled: boolean = true;
  private rainRippleDensity: number = 0.5;
  private rainAreaRadius: number = 14;
  private rainTopOffset: number = 7.5;
  private rainBottomOffset: number = -1.5;
  private rainTexture: THREE.Texture;
  private rainRippleTexture: THREE.Texture;
  private rainRippleGeometry: THREE.PlaneGeometry;
  private rainRipples: RainRipple[] = [];

  private steamEnabled: boolean = true;
  private steamDensity: number = 0.4;
  private steamTexture: THREE.Texture;
  private steamParticles: SteamParticle[] = [];
  private steamEmitters: SteamEmitter[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rainTexture = this.createRainTexture();
    this.rainRippleTexture = this.createRainRippleTexture();
    this.rainRippleGeometry = new THREE.PlaneGeometry(1, 1);
    this.steamTexture = this.createSteamTexture();
  }

  configure(config: AtmosphereRuntimeConfig): void {
    this.rainEnabled = config.rainEnabled;
    this.rainDensity = THREE.MathUtils.clamp(config.rainDensity, 0, 1);
    this.rainSpeed = THREE.MathUtils.clamp(config.rainSpeed, 4, 24);
    this.rainRipplesEnabled = config.rainRipplesEnabled;
    this.rainRippleDensity = THREE.MathUtils.clamp(config.rainRippleDensity, 0, 1);

    this.steamEnabled = config.steamEnabled;
    this.steamDensity = THREE.MathUtils.clamp(config.steamDensity, 0, 1);

    this.setRainCount(
      this.rainEnabled
        ? Math.floor(220 + this.rainDensity * 820)
        : 0,
    );

    this.steamEmitters = config.steamVents.map((position) => ({
      position,
      timer: Math.random() * 0.35,
      radius: 0.45 + Math.random() * 0.25,
    }));

    if (!this.steamEnabled) {
      this.clearSteamParticles();
    }
    if (!this.rainRipplesEnabled) {
      this.clearRainRipples();
    }
  }

  update(dt: number, cameraPosition: Vec3): void {
    this.updateRain(dt, cameraPosition);
    this.updateRainRipples(dt);
    this.updateSteam(dt);
  }

  clear(): void {
    this.setRainCount(0);
    this.clearRainRipples();
    this.clearSteamParticles();
    this.steamEmitters = [];
  }

  dispose(): void {
    this.clear();
    this.removeRainSystem();
    this.rainTexture.dispose();
    this.rainRippleTexture.dispose();
    this.rainRippleGeometry.dispose();
    this.steamTexture.dispose();
  }

  private updateRain(dt: number, cameraPosition: Vec3): void {
    if (!this.rainEnabled || !this.rainPositions || this.rainCount === 0) {
      if (this.rainPoints) this.rainPoints.visible = false;
      return;
    }

    if (this.rainPoints) this.rainPoints.visible = true;

    const p = this.rainPositions;
    const area = this.rainAreaRadius;
    const top = cameraPosition.y + this.rainTopOffset;
    const bottom = cameraPosition.y + this.rainBottomOffset;
    const halfArea = area * 0.5;
    const lateralDrift = Math.sin(performance.now() * 0.00035) * 0.28;
    const speedArr = this.rainSpeeds!;
    const driftArr = this.rainDrift!;

    for (let i = 0; i < this.rainCount; i++) {
      const idx = i * 3;
      p[idx] += (lateralDrift + driftArr[i] * 0.18) * dt;
      p[idx + 1] -= speedArr[i] * dt;
      p[idx + 2] += (Math.cos(i * 0.17) * 0.06 + driftArr[i] * 0.1) * dt;

      const dx = p[idx] - cameraPosition.x;
      const dz = p[idx + 2] - cameraPosition.z;
      const hitFloor = p[idx + 1] < bottom;
      if (
        hitFloor ||
        Math.abs(dx) > halfArea ||
        Math.abs(dz) > halfArea
      ) {
        if (hitFloor && this.rainRipplesEnabled && Math.random() < this.rainRippleDensity * 0.24) {
          this.spawnRainRipple(p[idx], bottom + 0.01, p[idx + 2]);
        }
        p[idx] = cameraPosition.x + (Math.random() - 0.5) * area;
        p[idx + 1] = top + Math.random() * 2.5;
        p[idx + 2] = cameraPosition.z + (Math.random() - 0.5) * area;
        speedArr[i] = this.rainSpeed * (0.7 + Math.random() * 0.7);
        driftArr[i] = (Math.random() - 0.5) * 1.8;
      }
    }

    this.rainGeometry!.attributes.position.needsUpdate = true;
  }

  private spawnRainRipple(x: number, y: number, z: number): void {
    if (this.rainRipples.length >= AtmosphereSystem.RAIN_RIPPLE_MAX) return;

    const material = new THREE.MeshBasicMaterial({
      map: this.rainRippleTexture,
      transparent: true,
      opacity: 0.16,
      color: new THREE.Color(0x8ec1e8),
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(this.rainRippleGeometry, material);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.position.set(x, y, z);
    const startScale = 0.04 + Math.random() * 0.03;
    mesh.scale.set(startScale, startScale, 1);
    this.scene.add(mesh);

    const life = 0.22 + Math.random() * 0.1;
    this.rainRipples.push({
      mesh,
      material,
      life,
      maxLife: life,
      startScale,
      endScale: 0.22 + Math.random() * 0.1,
    });
  }

  private updateRainRipples(dt: number): void {
    for (let i = this.rainRipples.length - 1; i >= 0; i--) {
      const ripple = this.rainRipples[i];
      ripple.life -= dt;

      if (ripple.life <= 0) {
        this.scene.remove(ripple.mesh);
        ripple.material.dispose();
        this.rainRipples.splice(i, 1);
        continue;
      }

      const t = 1 - ripple.life / ripple.maxLife;
      const scale = ripple.startScale + (ripple.endScale - ripple.startScale) * t;
      ripple.mesh.scale.set(scale, scale, 1);
      ripple.material.opacity = (1 - t) * 0.14;
    }
  }

  private updateSteam(dt: number): void {
    if (this.steamEnabled && this.steamDensity > 0.01) {
      const emitInterval = THREE.MathUtils.lerp(0.55, 0.12, this.steamDensity);
      for (const emitter of this.steamEmitters) {
        emitter.timer -= dt;
        if (emitter.timer <= 0) {
          this.spawnSteamParticle(emitter.position, emitter.radius);
          emitter.timer = emitInterval * (0.7 + Math.random() * 0.6);
        }
      }
    }

    for (let i = this.steamParticles.length - 1; i >= 0; i--) {
      const p = this.steamParticles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        p.material.dispose();
        this.steamParticles.splice(i, 1);
        continue;
      }

      const t = 1 - p.life / p.maxLife;
      p.sprite.position.addScaledVector(p.velocity, dt);
      const scale = p.startScale + (p.endScale - p.startScale) * t;
      p.sprite.scale.set(scale, scale, 1);
      const fadeIn = Math.min(1, t * 2.4);
      const fadeOut = Math.max(0, 1 - t);
      p.material.opacity = fadeIn * fadeOut * 0.14;
    }
  }

  private spawnSteamParticle(origin: Vec3, radius: number): void {
    if (!this.steamEnabled) return;
    if (this.steamParticles.length >= AtmosphereSystem.STEAM_MAX) return;

    const material = new THREE.SpriteMaterial({
      map: this.steamTexture,
      transparent: true,
      opacity: 0.1,
      color: new THREE.Color(0xa6d2e4),
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.set(
      origin.x + (Math.random() - 0.5) * radius * 2,
      origin.y + 0.35 + Math.random() * 0.14,
      origin.z + (Math.random() - 0.5) * radius * 2,
    );
    sprite.scale.set(0.09, 0.09, 1);
    this.scene.add(sprite);

    const life = 0.9 + Math.random() * 0.65;
    const particle: SteamParticle = {
      sprite,
      material,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.07,
        0.18 + Math.random() * 0.22,
        (Math.random() - 0.5) * 0.07,
      ),
      life,
      maxLife: life,
      startScale: 0.08 + Math.random() * 0.05,
      endScale: 0.32 + Math.random() * 0.2,
    };

    this.steamParticles.push(particle);
  }

  private setRainCount(count: number): void {
    const clamped = THREE.MathUtils.clamp(count, 0, AtmosphereSystem.RAIN_MAX);
    this.ensureRainSystem();
    this.rainCount = clamped;

    if (this.rainGeometry) {
      this.rainGeometry.setDrawRange(0, clamped);
    }
  }

  private ensureRainSystem(): void {
    if (this.rainGeometry && this.rainMaterial && this.rainPoints && this.rainPositions) {
      return;
    }

    this.rainPositions = new Float32Array(AtmosphereSystem.RAIN_MAX * 3);
    this.rainSpeeds = new Float32Array(AtmosphereSystem.RAIN_MAX);
    this.rainDrift = new Float32Array(AtmosphereSystem.RAIN_MAX);
    for (let i = 0; i < AtmosphereSystem.RAIN_MAX; i++) {
      const idx = i * 3;
      this.rainPositions[idx] = (Math.random() - 0.5) * this.rainAreaRadius;
      this.rainPositions[idx + 1] = Math.random() * this.rainTopOffset;
      this.rainPositions[idx + 2] = (Math.random() - 0.5) * this.rainAreaRadius;
      this.rainSpeeds[i] = this.rainSpeed * (0.7 + Math.random() * 0.7);
      this.rainDrift[i] = (Math.random() - 0.5) * 1.8;
    }

    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.rainPositions, 3),
    );
    this.rainGeometry.setDrawRange(0, 0);

    this.rainMaterial = new THREE.PointsMaterial({
      map: this.rainTexture,
      color: 0x9fc6ef,
      size: 0.028,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });

    this.rainPoints = new THREE.Points(this.rainGeometry, this.rainMaterial);
    this.rainPoints.frustumCulled = false;
    this.scene.add(this.rainPoints);
  }

  private removeRainSystem(): void {
    if (this.rainPoints) {
      this.scene.remove(this.rainPoints);
    }
    this.rainGeometry?.dispose();
    this.rainMaterial?.dispose();
    this.rainGeometry = null;
    this.rainMaterial = null;
    this.rainPoints = null;
    this.rainPositions = null;
    this.rainSpeeds = null;
    this.rainDrift = null;
    this.rainCount = 0;
  }

  private clearRainRipples(): void {
    for (const ripple of this.rainRipples) {
      this.scene.remove(ripple.mesh);
      ripple.material.dispose();
    }
    this.rainRipples = [];
  }

  private clearSteamParticles(): void {
    for (const p of this.steamParticles) {
      this.scene.remove(p.sprite);
      p.material.dispose();
    }
    this.steamParticles = [];
  }

  private createSteamTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(210,232,245,0.95)');
    grad.addColorStop(0.35, 'rgba(170,200,220,0.45)');
    grad.addColorStop(0.75, 'rgba(130,160,190,0.11)');
    grad.addColorStop(1, 'rgba(130,160,190,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  private createRainTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, size, size);
    const grad = ctx.createLinearGradient(size / 2, 2, size / 2, size - 2);
    grad.addColorStop(0, 'rgba(170,205,235,0)');
    grad.addColorStop(0.2, 'rgba(182,218,246,0.32)');
    grad.addColorStop(0.6, 'rgba(200,232,255,0.95)');
    grad.addColorStop(1, 'rgba(170,205,235,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(size * 0.44, 2, size * 0.12, size - 4);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  private createRainRippleTexture(): THREE.Texture {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;

    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(190,220,245,0.7)';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(190,220,245,0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }
}
