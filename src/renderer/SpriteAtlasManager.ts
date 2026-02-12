import * as THREE from 'three';

interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasAnimation {
  frames: string[];
  fps?: number;
  loop?: boolean;
}

interface AtlasMeta {
  id: string;
  image: string;
  frames: Record<string, AtlasFrame>;
  animations?: Record<string, AtlasAnimation>;
}

interface AtlasStore {
  texture: THREE.Texture;
  image: CanvasImageSource;
  width: number;
  height: number;
  frames: Record<string, AtlasFrame>;
}

interface SpriteDef {
  atlasId: string;
  frameNames: string[];
}

export interface SpriteMaterialInfo {
  material: THREE.SpriteMaterial;
  texture: THREE.Texture;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
}

/**
 * Loads sprite atlas metadata + textures and exposes sprite frame lookup.
 * Sprites can be single-frame or animation aliases defined in `animations`.
 */
export class SpriteAtlasManager {
  private textureLoader = new THREE.TextureLoader();
  private atlases: Map<string, AtlasStore> = new Map();
  private spriteDefs: Map<string, SpriteDef> = new Map();

  async loadDefaultAtlases(): Promise<void> {
    const paths = [
      '/assets/sprites/items_atlas.json',
      '/assets/sprites/viewmodels_atlas.json',
    ];

    let loaded = 0;
    let firstError: unknown = null;

    for (const path of paths) {
      try {
        await this.loadAtlas(path);
        loaded++;
      } catch (err) {
        if (firstError === null) firstError = err;
      }
    }

    if (loaded === 0 && firstError) {
      throw firstError;
    }
  }

  async loadAtlas(metaPath: string): Promise<void> {
    const response = await fetch(metaPath);
    if (!response.ok) {
      throw new Error(`Failed to load sprite atlas meta "${metaPath}": ${response.status} ${response.statusText}`);
    }

    const meta = this.validateMeta(await response.json());
    const texture = await this.textureLoader.loadAsync(meta.image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const image = texture.image as { width?: number; height?: number };
    const imageSource = texture.image as CanvasImageSource | null;
    const width = image.width ?? 1;
    const height = image.height ?? 1;
    if (!imageSource) {
      throw new Error(`Invalid atlas image for "${meta.id}"`);
    }

    this.atlases.set(meta.id, {
      texture,
      image: imageSource,
      width,
      height,
      frames: meta.frames,
    });

    // Every frame key can be used directly as a sprite key.
    for (const frameName of Object.keys(meta.frames)) {
      this.spriteDefs.set(frameName, {
        atlasId: meta.id,
        frameNames: [frameName],
      });
    }

    // Optional animation aliases (e.g. projectile_rocket -> [frame0, frame1]).
    if (meta.animations) {
      for (const [spriteKey, animation] of Object.entries(meta.animations)) {
        const validFrames = animation.frames.filter((name) => !!meta.frames[name]);
        if (validFrames.length === 0) continue;
        this.spriteDefs.set(spriteKey, {
          atlasId: meta.id,
          frameNames: validFrames,
        });
      }
    }
  }

  hasSprite(spriteKey: string): boolean {
    return this.spriteDefs.has(spriteKey);
  }

  createSpriteMaterial(spriteKey: string): SpriteMaterialInfo | null {
    const spriteDef = this.spriteDefs.get(spriteKey);
    if (!spriteDef) return null;

    const atlas = this.atlases.get(spriteDef.atlasId);
    if (!atlas) return null;

    // Clone texture object so each sprite can have independent UV offset/repeat.
    const texture = atlas.texture.clone();
    texture.needsUpdate = true;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });

    this.applyFrame(texture, spriteKey, 0);

    const firstFrame = atlas.frames[spriteDef.frameNames[0]];
    return {
      material,
      texture,
      frameCount: spriteDef.frameNames.length,
      frameWidth: firstFrame.w,
      frameHeight: firstFrame.h,
    };
  }

  applyFrame(texture: THREE.Texture, spriteKey: string, frameIndex: number): void {
    const spriteDef = this.spriteDefs.get(spriteKey);
    if (!spriteDef) return;

    const atlas = this.atlases.get(spriteDef.atlasId);
    if (!atlas) return;

    const count = spriteDef.frameNames.length;
    if (count === 0) return;

    const normalizedIndex = ((frameIndex % count) + count) % count;
    const frameName = spriteDef.frameNames[normalizedIndex];
    const frame = atlas.frames[frameName];
    if (!frame) return;

    texture.repeat.set(frame.w / atlas.width, frame.h / atlas.height);
    texture.offset.set(
      frame.x / atlas.width,
      1 - (frame.y + frame.h) / atlas.height,
    );
    texture.needsUpdate = true;
  }

  drawFrameToCanvas(
    ctx: CanvasRenderingContext2D,
    spriteKey: string,
    frameIndex: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): boolean {
    const spriteDef = this.spriteDefs.get(spriteKey);
    if (!spriteDef) return false;

    const atlas = this.atlases.get(spriteDef.atlasId);
    if (!atlas) return false;

    const count = spriteDef.frameNames.length;
    if (count === 0) return false;

    const normalizedIndex = ((frameIndex % count) + count) % count;
    const frameName = spriteDef.frameNames[normalizedIndex];
    const frame = atlas.frames[frameName];
    if (!frame) return false;

    ctx.drawImage(
      atlas.image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      x,
      y,
      width,
      height,
    );
    return true;
  }

  dispose(): void {
    for (const atlas of this.atlases.values()) {
      atlas.texture.dispose();
    }
    this.atlases.clear();
    this.spriteDefs.clear();
  }

  private validateMeta(raw: unknown): AtlasMeta {
    const data = raw as Partial<AtlasMeta>;
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid atlas metadata: expected object');
    }
    if (typeof data.id !== 'string' || data.id.length === 0) {
      throw new Error('Invalid atlas metadata: missing id');
    }
    if (typeof data.image !== 'string' || data.image.length === 0) {
      throw new Error(`Invalid atlas metadata "${data.id}": missing image`);
    }
    if (!data.frames || typeof data.frames !== 'object') {
      throw new Error(`Invalid atlas metadata "${data.id}": missing frames`);
    }

    for (const [name, frame] of Object.entries(data.frames)) {
      const f = frame as Partial<AtlasFrame>;
      if (
        typeof f.x !== 'number' ||
        typeof f.y !== 'number' ||
        typeof f.w !== 'number' ||
        typeof f.h !== 'number'
      ) {
        throw new Error(`Invalid frame "${name}" in atlas "${data.id}"`);
      }
    }

    if (data.animations && typeof data.animations === 'object') {
      for (const [name, anim] of Object.entries(data.animations)) {
        const a = anim as Partial<AtlasAnimation>;
        if (!Array.isArray(a.frames)) {
          throw new Error(`Invalid animation "${name}" in atlas "${data.id}"`);
        }
      }
    }

    return data as AtlasMeta;
  }
}
