#!/usr/bin/env bun
/**
 * Punch a flat #00FF00 chroma key out of a character sprite.
 *
 *   bun scripts/chroma-key.ts raw/characters/merchant.png public/characters/dragon/merchant.png
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

const src = process.argv[2];
const dest = process.argv[3];
if (!src || !dest) {
  console.error('usage: bun scripts/chroma-key.ts <src.png> <dest.png>');
  process.exit(2);
}

const similarity = 90; // how close to pure green counts as key
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += info.channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  // Strong green, weak red/blue → transparent.
  if (g > r + similarity / 2 && g > b + similarity / 2 && g > 140) {
    data[i + 3] = 0;
  }
}

// Edge cleanup: the key is binary, so silhouette pixels keep a green cast.
// Erode the alpha edge by one pixel, then despill what still borders
// transparency — only there, so genuinely green things (vegetables, cloaks)
// deep inside the figure are left alone.
const { width, height, channels } = info;
const alphaAt = (x: number, y: number) => data[(y * width + x) * channels + 3];
const bordersTransparent = (x: number, y: number) => {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
      if (alphaAt(nx, ny) === 0) return true;
    }
  }
  return false;
};
const edge: number[] = [];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (alphaAt(x, y) !== 0 && bordersTransparent(x, y)) edge.push((y * width + x) * channels);
  }
}
for (const i of edge) data[i + 3] = 0; // erode 1px
// Spill reaches a few pixels in; despill a 3px band along the silhouette.
const inBand = new Uint8Array(width * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (alphaAt(x, y) !== 0 && bordersTransparent(x, y)) inBand[y * width + x] = 1;
  }
}
for (let pass = 0; pass < 2; pass++) {
  const grown = inBand.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inBand[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && alphaAt(nx, ny) !== 0) {
            grown[ny * width + nx] = 1;
          }
        }
      }
    }
  }
  inBand.set(grown);
}
for (let p = 0; p < inBand.length; p++) {
  if (!inBand[p]) continue;
  const i = p * channels;
  const cap = Math.max(data[i], data[i + 2]);
  if (data[i + 1] > cap) data[i + 1] = cap;
}

await mkdir(dirname(dest), { recursive: true });
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(dest);
console.log(`wrote ${dest} (${info.width}x${info.height})`);
