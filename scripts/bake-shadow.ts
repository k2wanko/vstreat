#!/usr/bin/env bun
/**
 * Bake a soft contact shadow under a character sprite's feet.
 *
 *   bun scripts/bake-shadow.ts public/characters/dragon/merchant.png
 *
 * Edits the file in place. The ellipse is drawn UNDER the figure, centred on
 * the bottom of the visible silhouette, so it scales and moves with the
 * sprite by construction — no second marker to keep in sync.
 */
import sharp from 'sharp';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun scripts/bake-shadow.ts <sprite.png>');
  process.exit(2);
}

const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

// Bounding box of the visible figure.
let minX = width, maxX = 0, maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * channels + 3] > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

const figureWidth = maxX - minX;
const cx = (minX + maxX) / 2;
// Feet are the bottom of the silhouette; a standing pose is narrower at the
// feet than at the torso, so the shadow uses a fraction of the full width.
// The sprite plane stands vertically in the panorama, so vertical extent is
// heavily foreshortened when viewed from eye height — the ellipse must be
// much taller in the texture than the shade it produces on screen.
const rx = figureWidth * 0.55;
const ry = rx * 0.45;
// A touch below the lowest foot pixel so the pool of shade peeks out in
// front of the boots instead of hiding entirely behind them.
const cy = Math.min(maxY + 30, height - 4);

const shadow = Buffer.from(
  `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="black" stop-opacity="0.7"/>
        <stop offset="55%" stop-color="black" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="black" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#g)"/>
  </svg>`,
);

const composited = await sharp(data, { raw: { width, height, channels: 4 } })
  .composite([{ input: shadow, blend: 'dest-over' }])
  .raw()
  .toBuffer();

// The ellipse may clip at the canvas bottom; fade the last rows out so the
// clip never shows as a straight edge in the viewer.
const FADE = 48;
for (let y = height - FADE; y < height; y++) {
  const k = (height - y) / FADE;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4 + 3;
    composited[i] = Math.round(composited[i] * k);
  }
}

await sharp(composited, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(file + '.tmp.png');
await Bun.write(file, Bun.file(file + '.tmp.png'));
await Bun.file(file + '.tmp.png').delete();
console.log(`baked shadow into ${file} (feet y=${Math.round(cy)}, rx=${Math.round(rx)})`);
