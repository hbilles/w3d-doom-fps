#!/usr/bin/env node
/**
 * Sprite sheet processing pipeline.
 *
 * Takes raw AI-generated sprite sheets (grid of poses on a flat magenta
 * background), and produces a game-ready atlas PNG + JSON metadata:
 *
 *   1. Slice the raw sheet into grid cells
 *   2. Chroma-key the magenta background to transparency
 *   3. Downscale each cell to the target frame size (nearest-neighbor,
 *      keeps pixels crisp)
 *   4. Pack all frames into a single atlas and emit metadata in the
 *      SpriteAtlasManager format
 *
 * Usage: node tools/process-sheets.mjs tools/atlas-configs/enemies.json
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node tools/process-sheets.mjs <atlas-config.json>');
  process.exit(1);
}

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(readFileSync(resolve(root, configPath), 'utf8'));

const ATLAS_COLUMNS = config.atlasColumns ?? 8;

/** Is this pixel close enough to chroma magenta to be background? */
function isChromaKey(r, g, b) {
  return r > 110 && b > 110 && g < Math.min(r, b) * 0.55;
}

/** Key out magenta, including despill on edge pixels. */
function chromaKey(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (isChromaKey(r, g, b)) {
      data[i + 3] = 0;
    } else if (r > g && b > g && Math.min(r, b) - g > 40) {
      // Partial magenta fringe: pull the pixel toward neutral
      const spill = Math.min(r, b) - g;
      data[i] = r - spill * 0.5;
      data[i + 2] = b - spill * 0.5;
    }
  }
  return data;
}

async function processSheet(sheet) {
  const inputPath = resolve(root, sheet.input);
  const image = sharp(inputPath);
  const meta = await image.metadata();
  const { width, height } = meta;
  const { cols, rows, frameSize } = sheet;

  const frames = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const frameName = sheet.frames[index];
      if (!frameName) continue; // Unused cell

      const left = Math.round((col * width) / cols);
      const right = Math.round(((col + 1) * width) / cols);
      const top = Math.round((row * height) / rows);
      const bottom = Math.round(((row + 1) * height) / rows);

      // Slice cell and key BEFORE downscaling so magenta never blends in
      const cell = await sharp(inputPath)
        .extract({ left, top, width: right - left, height: bottom - top })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      chromaKey(cell.data);

      const keyed = await sharp(cell.data, {
        raw: {
          width: cell.info.width,
          height: cell.info.height,
          channels: 4,
        },
      })
        .resize(frameSize, frameSize, { kernel: 'nearest', fit: 'fill' })
        .png()
        .toBuffer();

      frames.push({
        name: `${sheet.prefix}_${frameName}`,
        buffer: keyed,
        size: frameSize,
      });
    }
  }

  return frames;
}

// ── Collect frames from all sheets ───────────────────────────

const allFrames = [];
const animations = {};

for (const sheet of config.sheets) {
  const frames = await processSheet(sheet);
  allFrames.push(...frames);

  for (const [animName, anim] of Object.entries(sheet.animations ?? {})) {
    animations[`${sheet.prefix}${animName ? '_' + animName : ''}`] = {
      frames: anim.frames.map((f) => `${sheet.prefix}_${f}`),
      fps: anim.fps ?? 8,
      loop: anim.loop ?? false,
    };
  }
  console.log(`Processed ${sheet.input}: ${frames.length} frames`);
}

// ── Pack into atlas ──────────────────────────────────────────

const frameSize = config.frameSize ?? 64;
const atlasCols = Math.min(ATLAS_COLUMNS, allFrames.length);
const atlasRows = Math.ceil(allFrames.length / atlasCols);
const atlasWidth = atlasCols * frameSize;
const atlasHeight = atlasRows * frameSize;

const composites = [];
const frameMeta = {};

allFrames.forEach((frame, i) => {
  const x = (i % atlasCols) * frameSize;
  const y = Math.floor(i / atlasCols) * frameSize;
  composites.push({ input: frame.buffer, left: x, top: y });
  frameMeta[frame.name] = { x, y, w: frameSize, h: frameSize };
});

const outputImage = resolve(root, config.outputImage);
const outputMeta = resolve(root, config.outputMeta);
mkdirSync(dirname(outputImage), { recursive: true });

await sharp({
  create: {
    width: atlasWidth,
    height: atlasHeight,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toFile(outputImage);

writeFileSync(
  outputMeta,
  JSON.stringify(
    {
      id: config.id,
      image: config.imageUrl,
      frames: frameMeta,
      animations,
    },
    null,
    2,
  ) + '\n',
);

console.log(`Atlas written: ${config.outputImage} (${atlasWidth}x${atlasHeight}, ${allFrames.length} frames)`);
console.log(`Metadata written: ${config.outputMeta}`);
