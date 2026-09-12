#!/usr/bin/env bun
/**
 * Look at the built world from above: class colour with hillshade over it.
 *
 *   bun scripts/preview-world.ts
 *
 * This is the step's own check. The panorama renderer marches the same arrays,
 * so if the coast, the ridge and the town read correctly here, the reference
 * image is drawing the same place.
 */
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { stationsFor } from './stations.ts';
import { paths, terrainOf } from './lib/worlds.ts';
import { buildWorld, cellOf, CELL, CLASS, COLOUR, N } from './terrain.ts';

const worldId = process.argv[2];
if (!worldId || worldId.startsWith('--')) {
  console.error('usage: render-map.ts <worldId> [--pins]');
  process.exit(2);
}
// The shipped minimap is the default; --pins draws the debug copy with every
// station marked, which is what you look at before spending a generation.
const pins = process.argv.includes('--pins');
const clean = !pins;
const SCALE = 2; // px per cell
const SIZE = N * SCALE;
const SUN = { az: (315 * Math.PI) / 180, el: (42 * Math.PI) / 180 };

const world = buildWorld(worldId);
const STATIONS = stationsFor(worldId);
const { height, cls } = world;

const px = new Uint8ClampedArray(SIZE * SIZE * 3);
const sun: [number, number, number] = [
  Math.cos(SUN.el) * Math.sin(SUN.az),
  Math.sin(SUN.el),
  Math.cos(SUN.el) * Math.cos(SUN.az),
];

for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const k = j * N + i;
    const hx = height[j * N + Math.min(N - 1, i + 1)] - height[j * N + Math.max(0, i - 1)];
    const hy = height[Math.min(N - 1, j + 1) * N + i] - height[Math.max(0, j - 1) * N + i];
    // Surface normal of the heightfield: north is -j, so the y gradient flips.
    const nx = -hx / (2 * CELL);
    const nz = hy / (2 * CELL);
    const len = Math.hypot(nx, 1, nz);
    const lambert = Math.max(0.25, (nx * sun[0] + sun[1] + nz * sun[2]) / len);
    const base = COLOUR[cls[k]];
    const shade = cls[k] === CLASS.sea ? 1 : 0.55 + 0.65 * lambert;
    for (let sy = 0; sy < SCALE; sy++) {
      for (let sx = 0; sx < SCALE; sx++) {
        const o = ((j * SCALE + sy) * SIZE + i * SCALE + sx) * 3;
        px[o] = base[0] * shade;
        px[o + 1] = base[1] * shade;
        px[o + 2] = base[2] * shade;
      }
    }
  }
}

// Contours every 20 m, so the invented ridge can be read as a shape.
for (let j = 1; j < N; j++) {
  for (let i = 1; i < N; i++) {
    const k = j * N + i;
    if (cls[k] === CLASS.sea) continue;
    const band = (h: number) => Math.floor(h / 20);
    if (band(height[k]) !== band(height[k - 1]) || band(height[k]) !== band(height[k - N])) {
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const o = ((j * SCALE + sy) * SIZE + i * SCALE + sx) * 3;
          px[o] = px[o] * 0.7;
          px[o + 1] = px[o + 1] * 0.7;
          px[o + 2] = px[o + 2] * 0.7;
        }
      }
    }
  }
}

for (const [, p] of clean ? [] : Object.entries(STATIONS)) {
  const { i, j } = cellOf(p.e, p.n);
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (Math.hypot(dx, dy) > 5) continue;
      const y = j * SCALE + dy;
      const x = i * SCALE + dx;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const o = (y * SIZE + x) * 3;
      px[o] = 220;
      px[o + 1] = 40;
      px[o + 2] = 40;
    }
  }
}

await mkdir('raw', { recursive: true });
const out = clean ? paths(worldId).map : `${paths(worldId).raw}/world.png`;
await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true });
const image = sharp(Buffer.from(px.buffer), { raw: { width: SIZE, height: SIZE, channels: 3 } });
await (clean ? image.jpeg({ quality: 88, mozjpeg: true }) : image.png()).toFile(out);

const counts = new Map<number, number>();
for (const c of cls) counts.set(c, (counts.get(c) ?? 0) + 1);
const area = (c: number) => (((counts.get(c) ?? 0) * CELL * CELL) / 10000).toFixed(1);
console.log(`grid ${N}x${N} @ ${CELL} m   ridge declared ${terrainOf(worldId).ridgeM} m, built ${world.maxHeight.toFixed(0)} m`);
for (const [name, id] of Object.entries(CLASS)) console.log(`  ${name.padEnd(9)} ${area(id).padStart(6)} ha`);
for (const [name, p] of Object.entries(STATIONS)) {
  const { i, j } = cellOf(p.e, p.n);
  const c = Object.entries(CLASS).find(([, v]) => v === cls[j * N + i])?.[0];
  console.log(`  station ${name.padEnd(10)} ground ${height[j * N + i].toFixed(1)} m on ${c}`);
}
console.log(`wrote ${out}`);
