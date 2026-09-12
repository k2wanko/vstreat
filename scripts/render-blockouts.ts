#!/usr/bin/env bun
/**
 * Raycast the built world straight to an equirectangular image, from one
 * station's own position and heading.
 *
 *   bun scripts/render-world-pano.ts road-mid
 *   bun scripts/render-world-pano.ts --all
 *
 * Same idea as scripts/render-blockout.ts, which hands the image model a
 * picture instead of measurements - but the world here is a heightfield rather
 * than a set of boxes, so the sea, the beach ramp and the ridge come out too.
 * The projection is exact by construction: every pixel is one ray.
 */
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { manifestOf, paths } from './lib/worlds.ts';
import { stationsFor } from './stations.ts';
import { buildWorld, CELL, CLASS, COLOUR, heightAt, N, SKY } from './terrain.ts';

const W = 1536;
const H = 768;
const FAR = 2400;

const SUN_DISC_DEG = 2.5;
const SUN_HALO_DEG = 14;

const worldId = process.argv[2];
if (!worldId || worldId.startsWith('--')) {
  console.error('usage: render-blockouts.ts <worldId> <station|--all>');
  process.exit(2);
}
const STATIONS = stationsFor(worldId);
const args = process.argv.slice(3);
const LIGHT = manifestOf(worldId).light;
const SUN = { az: (LIGHT.azDeg * Math.PI) / 180, el: (LIGHT.elDeg * Math.PI) / 180 };
const SKY_HERE = SKY;
const DISC: [number, number, number] = [255, 250, 225];
const wanted = args.includes('--all')
  ? Object.values(STATIONS).filter((s) => !s.indoor).map((s) => s.id)
  : args.filter((a) => !a.startsWith('--'));
if (!wanted.length) {
  console.error(`usage: bun scripts/render-blockouts.ts <worldId> <station|--all>\nstations: ${Object.keys(STATIONS).join(', ')}`);
  process.exit(2);
}

const world = buildWorld(worldId);
const { height, cls } = world;
const sun: [number, number, number] = [
  Math.cos(SUN.el) * Math.sin(SUN.az),
  Math.sin(SUN.el),
  Math.cos(SUN.el) * Math.cos(SUN.az),
];
const HALF = (N * CELL) / 2;

/** Terrain normal from the heightfield, for shading the ground. */
function normalAt(i: number, j: number): [number, number, number] {
  const hx = height[j * N + Math.min(N - 1, i + 1)] - height[j * N + Math.max(0, i - 1)];
  const hy = height[Math.min(N - 1, j + 1) * N + i] - height[Math.max(0, j - 1) * N + i];
  const nx = -hx / (2 * CELL);
  const nz = hy / (2 * CELL);
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, 1 / len, nz / len];
}

type Hit = { colour: [number, number, number]; dist: number } | null;

/**
 * March the grid one cell at a time (a DDA), comparing the ray's height at
 * each cell boundary against the column standing in that cell. A heightfield
 * has no analytic intersection, but at 2 m cells the boundary test is exact
 * enough that a roofline stays straight.
 */
function cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Hit {
  // Grid space: x east -> i, z north -> j (flipped, row 0 is the north edge).
  let i = Math.floor((ox + HALF) / CELL);
  let j = Math.floor((HALF - oz) / CELL);
  const stepI = dx > 0 ? 1 : -1;
  const stepJ = dz > 0 ? -1 : 1;
  const tDeltaI = Math.abs(CELL / (dx || 1e-9));
  const tDeltaJ = Math.abs(CELL / (dz || 1e-9));
  const nextEdgeE = (i + (dx > 0 ? 1 : 0)) * CELL - HALF;
  const nextEdgeN = HALF - (j + (dz > 0 ? 0 : 1)) * CELL;
  let tMaxI = dx === 0 ? Infinity : (nextEdgeE - ox) / dx;
  let tMaxJ = dz === 0 ? Infinity : (nextEdgeN - oz) / dz;

  let t = 0;
  let axis: 'i' | 'j' = 'i';
  while (t < FAR) {
    if (i < 0 || j < 0 || i >= N || j >= N) break;
    const tExit = Math.min(tMaxI, tMaxJ);
    const cellH = height[j * N + i];
    const hIn = oy + dy * t;
    const hOut = oy + dy * tExit;
    if (Math.min(hIn, hOut) <= cellH) {
      // Where the ray crosses the top of this column.
      const tHit = hIn <= cellH ? t : t + ((hIn - cellH) / (hIn - hOut)) * (tExit - t);
      const c = cls[j * N + i];
      const base = COLOUR[c];
      let lambert: number;
      if (c === CLASS.building && hIn > cellH - 0.01) {
        // Hit the wall, not the roof: shade by which face the march crossed.
        lambert = axis === 'i' ? 0.62 : 0.86;
      } else {
        const nrm = normalAt(i, j);
        lambert = Math.max(0.2, nrm[0] * sun[0] + nrm[1] * sun[1] + nrm[2] * sun[2]);
      }
      // A gentle range: the chamfer terrain is faceted, and a wide lambert
      // range turns those facets into what reads as cast shadow on flat ground.
      const shade = c === CLASS.sea ? 1 : c === CLASS.building ? 0.5 + 0.7 * lambert : 0.86 + 0.24 * lambert;
      return { colour: [base[0] * shade, base[1] * shade, base[2] * shade], dist: tHit };
    }
    if (dy > 0 && hIn > world.maxHeight) break; // climbing out of the world
    if (tMaxI < tMaxJ) {
      i += stepI;
      t = tMaxI;
      tMaxI += tDeltaI;
      axis = 'i';
    } else {
      j += stepJ;
      t = tMaxJ;
      tMaxJ += tDeltaJ;
      axis = 'j';
    }
  }
  // Outside the frame the world is open sea at zero.
  if (dy < 0) {
    const t = -oy / dy;
    if (t < FAR * 3) {
      const base = COLOUR[CLASS.sea];
      return { colour: [base[0], base[1], base[2]], dist: t };
    }
  }
  return null;
}


for (const id of wanted) {
  const st = STATIONS[id];
  if (!st) {
    console.error(`no such station: ${id}`);
    continue;
  }
  const eye = heightAt(world, st.e, st.n) + st.eye;
  const px = new Uint8ClampedArray(W * H * 3);
  const t0 = performance.now();

  for (let y = 0; y < H; y++) {
    const pitch = ((0.5 - (y + 0.5) / H) * Math.PI) / 1;
    const cp = Math.cos(pitch / 1);
    const sp = Math.sin(pitch / 1);
    for (let x = 0; x < W; x++) {
      // Image centre faces the station's heading, as src/data/gis defines it.
      const yaw = (((x + 0.5) / W - 0.5) * 360 + st.heading) * (Math.PI / 180);
      const dx = Math.sin(yaw) * cp;
      const dz = Math.cos(yaw) * cp;
      const hit = cast(st.e, eye, st.n, dx, sp, dz);
      const o = (y * W + x) * 3;
      if (!hit) {
        // A gradient rather than a flat field, so the model reads which way is up.
        const k = Math.min(1, Math.max(0, sp)) * 0.35;
        const sunDeg = (Math.acos(Math.min(1, dx * sun[0] + sp * sun[1] + dz * sun[2])) * 180) / Math.PI;
        const glow = sunDeg < SUN_DISC_DEG ? 1 : Math.max(0, (SUN_HALO_DEG - sunDeg) / (SUN_HALO_DEG - SUN_DISC_DEG)) ** 2 * 0.85;
        const zenith: [number, number, number] = [120, 160, 210];
        px[o] = (SKY_HERE[0] * (1 - k) + zenith[0] * k) * (1 - glow) + DISC[0] * glow;
        px[o + 1] = (SKY_HERE[1] * (1 - k) + zenith[1] * k) * (1 - glow) + DISC[1] * glow;
        px[o + 2] = (SKY_HERE[2] * (1 - k) + zenith[2] * k) * (1 - glow) + DISC[2] * glow;
        continue;
      }
      // Haze with distance: 1.2 km of town and a 220 m ridge behind it need
      // some aerial perspective or the far side reads as near.
      const haze = Math.min(0.55, hit.dist / 3000);
      const dim = 1;
      px[o] = (hit.colour[0] * (1 - haze) + SKY_HERE[0] * haze) * dim;
      px[o + 1] = (hit.colour[1] * (1 - haze) + SKY_HERE[1] * haze) * dim;
      px[o + 2] = (hit.colour[2] * (1 - haze) + SKY_HERE[2] * haze) * dim;
    }
  }

  const dir = paths(worldId).blockouts;
  await mkdir(dir, { recursive: true });
  const out = `${dir}/${id}.png`;
  await sharp(Buffer.from(px.buffer), { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toFile(out);
  console.log(
    `${out}  at (${st.e.toFixed(0)}, ${st.n.toFixed(0)}) heading ${st.heading.toFixed(0)}deg eye ${eye.toFixed(1)} m  ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
}
