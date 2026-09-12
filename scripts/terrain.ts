/**
 * Build the massing world for a town from its traced GeoJSON.
 *
 * The world is a heightfield with a surface class per cell - the voxel
 * treatment, at 2 m. Buildings are cells raised by their storey height rather
 * than separate boxes, so one march answers terrain, sea and town alike.
 *
 * Elevation is the one thing the aerial photo cannot tell us: a nadir picture
 * carries no height. The high ground is therefore declared, not detected -
 * terrain.ridgeM in the town's manifest - and grown from the distance into
 * whichever traced class the town says its high ground follows, which puts the
 * summit where that cover is deepest and brings it down to the town.
 *
 * Coordinates are metres on a local tangent plane, +x east, +y north, origin
 * at the centre of the aerial frame.
 */
import { readFileSync } from 'node:fs';
import { manifestOf, paths, terrainOf } from './lib/worlds.ts';

// The grid is fixed: 600 cells of 2 m, so a town is 1200 m across. A town
// declares the same number as terrain.frameM and buildWorld holds it to that,
// because a frame smaller than the grid puts a flat plain beyond the town in
// every blockout, and a larger one traces features off the edge of the world.
export const CELL = 2;
export const N = 600;
export const GRID_M = N * CELL;

export const CLASS = {
  sea: 0,
  sand: 1,
  field: 2,
  forest: 3,
  road: 4,
  ground: 5,
  building: 6,
  // Appended, never inserted: the numbers are baked into every heightfield a
  // town has already built.
  river: 7,
} as const;
export type ClassId = (typeof CLASS)[keyof typeof CLASS];

/** The blockout's legend. Hues, not greys: the reference has to separate. */
export const COLOUR: Record<number, [number, number, number]> = {
  [CLASS.sea]: [64, 104, 138],
  [CLASS.sand]: [214, 203, 176],
  [CLASS.field]: [150, 172, 118],
  [CLASS.forest]: [96, 120, 86],
  [CLASS.road]: [206, 200, 188],
  [CLASS.ground]: [166, 162, 148],
  [CLASS.building]: [150, 146, 140],
  [CLASS.river]: [78, 118, 148],
};
export const SKY: [number, number, number] = [201, 219, 236];

type Feature = {
  properties: { kind: string; bearingDeg?: number; length?: number; depth?: number; area?: number };
  geometry: { type: string; coordinates: number[] | number[][] | number[][][] };
};

export type World = {
  height: Float32Array;
  cls: Uint8Array;
  maxHeight: number;
};

/** Grid index from metres. Row 0 is the north edge, so northing flips. */
export function cellOf(e: number, n: number): { i: number; j: number } {
  return { i: Math.floor((e + (N * CELL) / 2) / CELL), j: Math.floor(((N * CELL) / 2 - n) / CELL) };
}

function fillPolygon(target: Uint8Array, ring: number[][], value: number) {
  const pts = ring.map(([e, n]) => {
    const { i, j } = cellOf(e, n);
    return [i, j] as const;
  });
  let minJ = N;
  let maxJ = 0;
  for (const [, j] of pts) {
    minJ = Math.min(minJ, j);
    maxJ = Math.max(maxJ, j);
  }
  for (let j = Math.max(0, minJ); j <= Math.min(N - 1, maxJ); j++) {
    const xs: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const [x1, y1] = pts[k];
      const [x2, y2] = pts[(k + 1) % pts.length];
      if (y1 === y2) continue;
      const yTop = Math.min(y1, y2);
      const yBot = Math.max(y1, y2);
      if (j < yTop || j >= yBot) continue;
      xs.push(x1 + ((j - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil(xs[k])); i <= Math.min(N - 1, Math.floor(xs[k + 1])); i++) {
        target[j * N + i] = value;
      }
    }
  }
}

function stampRect(
  target: Uint8Array,
  centre: number[],
  bearingDeg: number,
  length: number,
  depth: number,
  value: number,
) {
  const r = (bearingDeg * Math.PI) / 180;
  const ux = Math.sin(r) * (length / 2);
  const uy = Math.cos(r) * (length / 2);
  const vx = Math.cos(r) * (depth / 2);
  const vy = -Math.sin(r) * (depth / 2);
  const [e, n] = centre;
  fillPolygon(
    target,
    [
      [e - ux - vx, n - uy - vy],
      [e + ux - vx, n + uy - vy],
      [e + ux + vx, n + uy + vy],
      [e - ux + vx, n - uy + vy],
    ],
    value,
  );
}

function stampLine(target: Uint8Array, points: number[][], widthM: number, value: number) {
  const h = widthM / 2;
  for (let k = 0; k + 1 < points.length; k++) {
    const [e1, n1] = points[k];
    const [e2, n2] = points[k + 1];
    const dx = e2 - e1;
    const dy = n2 - n1;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * h;
    const py = (dx / len) * h;
    fillPolygon(
      target,
      [
        [e1 + px, n1 + py],
        [e2 + px, n2 + py],
        [e2 - px, n2 - py],
        [e1 - px, n1 - py],
      ],
      value,
    );
  }
}

/** Chamfer distance in cells to the nearest cell where `is` is false. */
function distanceTo(is: (idx: number) => boolean): Float32Array {
  const d = new Float32Array(N * N);
  const BIG = 1e6;
  for (let k = 0; k < N * N; k++) d[k] = is(k) ? BIG : 0;
  const put = (k: number, v: number) => {
    if (v < d[k]) d[k] = v;
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (d[k] === 0) continue;
      if (i > 0) put(k, d[k - 1] + 1);
      if (j > 0) put(k, d[k - N] + 1);
      if (i > 0 && j > 0) put(k, d[k - N - 1] + 1.41421);
      if (i < N - 1 && j > 0) put(k, d[k - N + 1] + 1.41421);
    }
  }
  for (let j = N - 1; j >= 0; j--) {
    for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i;
      if (d[k] === 0) continue;
      if (i < N - 1) put(k, d[k + 1] + 1);
      if (j < N - 1) put(k, d[k + N] + 1);
      if (i < N - 1 && j < N - 1) put(k, d[k + N + 1] + 1.41421);
      if (i > 0 && j < N - 1) put(k, d[k + N - 1] + 1.41421);
    }
  }
  return d;
}

export function buildWorld(worldId: string): World {
  const t = terrainOf(worldId);
  const frameM = manifestOf(worldId).frameM;
  if (frameM !== GRID_M) {
    throw new Error(
      `${worldId}: frameM is ${frameM} m but the massing grid is ${GRID_M} m. ` +
        `Set "frameM": ${GRID_M} in worlds/${worldId}/world.json and paint the aerial to cover that much ground.`,
    );
  }
  const gj = JSON.parse(readFileSync(paths(worldId).geojson, 'utf8')) as { features: Feature[] };
  const cls = new Uint8Array(N * N).fill(CLASS.ground);
  const by = (kind: string) => gj.features.filter((f) => f.properties.kind === kind);

  // Surfaces, coarse to fine: the later stamp wins, which is the same order
  // the eye reads them in - a road is drawn on the field, not under it.
  for (const f of by('field')) fillPolygon(cls, f.geometry.coordinates[0] as number[][], CLASS.field);
  for (const f of by('forest')) fillPolygon(cls, f.geometry.coordinates[0] as number[][], CLASS.forest);
  // Only the massif carries the ridge. A stray strip of weed along the water
  // was traced as forest too, and growing height from it walled the beach off
  // from the sea with a 30 m bank of trees.
  const massif = new Uint8Array(N * N);
  const ringArea = (r: number[][]) =>
    Math.abs(r.reduce((a, _, i) => a + r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1], 0) / 2);
  const woods = by(t.ridgeFrom).sort(
    (a, b) => ringArea(b.geometry.coordinates[0] as number[][]) - ringArea(a.geometry.coordinates[0] as number[][]),
  );
  if (woods.length) fillPolygon(massif, woods[0].geometry.coordinates[0] as number[][], 1);
  for (const f of by('sand')) fillPolygon(cls, f.geometry.coordinates[0] as number[][], CLASS.sand);
  for (const f of by('sea')) fillPolygon(cls, f.geometry.coordinates[0] as number[][], CLASS.sea);
  for (const f of by('road')) stampLine(cls, f.geometry.coordinates as number[][], 8, CLASS.road);
  // A river is a surface and a cut, and only for a town that declares one:
  // the detector traces river centrelines, but how wide and how deep is a
  // decision the photo cannot carry.
  // A traced river arrives either way: wide enough to come out as water the
  // detector outlined, or narrow enough that only its centreline survived.
  const channel = new Uint8Array(N * N);
  if (t.river) {
    for (const f of by('river')) {
      if (f.geometry.type === 'Polygon') {
        fillPolygon(cls, f.geometry.coordinates[0] as number[][], CLASS.river);
        fillPolygon(channel, f.geometry.coordinates[0] as number[][], 1);
      } else {
        stampLine(cls, f.geometry.coordinates as number[][], t.river.widthM / CELL, CLASS.river);
        stampLine(channel, f.geometry.coordinates as number[][], t.river.widthM / CELL, 1);
      }
    }
  }

  // Terrain, before the buildings go on top of it.
  const height = new Float32Array(N * N);
  const datum = CLASS[t.terraceFrom as keyof typeof CLASS];
  const inland = distanceTo((k) => cls[k] !== datum); // cells from the low ground
  const wood = distanceTo((k) => massif[k] === 1); // cells deep into the massif
  let woodMax = 0;
  for (let k = 0; k < N * N; k++) woodMax = Math.max(woodMax, wood[k]);
  for (let k = 0; k < N * N; k++) {
    if (cls[k] === datum) {
      height[k] = 0;
      continue;
    }
    // The shore ramps out of the low ground onto the terrace the town stands on.
    const terrace = Math.min(t.terraceM, inland[k] * CELL * 0.06);
    // The ridge is deepest where the wood is widest. The exponent rounds the
    // profile off: linear distance gives a cone, and a cone reads as a spoil
    // heap rather than a hill.
    const ridge = massif[k] ? t.ridgeM * Math.pow(wood[k] / woodMax, 0.62) : 0;
    height[k] = terrace + ridge - (channel[k] ? t.river!.depthM : 0);
  }
  // Smooth once: chamfer distance is faceted, and the facets show as terraces
  // on the skyline, which is exactly the artefact the reference must not have.
  const smooth = Float32Array.from(height);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        if (cls[k] === datum) continue;
        smooth[k] =
          (height[k] * 4 + height[k - 1] + height[k + 1] + height[k - N] + height[k + N]) / 8;
      }
    }
    height.set(smooth);
  }

  // Buildings last: a house stands on whatever ground it was traced over.
  const roofs = new Uint8Array(N * N);
  for (const f of by('building')) {
    const p = f.properties;
    stampRect(
      roofs,
      f.geometry.coordinates as number[],
      p.bearingDeg ?? 0,
      p.length ?? 10,
      p.depth ?? 8,
      (p.area ?? 0) > 300 ? 9 : 6,
    );
  }
  let maxHeight = 0;
  for (let k = 0; k < N * N; k++) {
    if (roofs[k]) {
      height[k] += roofs[k];
      cls[k] = CLASS.building;
    }
    maxHeight = Math.max(maxHeight, height[k]);
  }
  return { height, cls, maxHeight };
}

/** Ground height at a point, bilinear so a camera does not sit on a step. */
export function heightAt(w: World, e: number, n: number): number {
  const x = (e + (N * CELL) / 2) / CELL - 0.5;
  const y = ((N * CELL) / 2 - n) / CELL - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(x)));
  const j = Math.max(0, Math.min(N - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - i));
  const fy = Math.max(0, Math.min(1, y - j));
  const h = (a: number, b: number) => w.height[b * N + a];
  return (
    h(i, j) * (1 - fx) * (1 - fy) +
    h(i + 1, j) * fx * (1 - fy) +
    h(i, j + 1) * (1 - fx) * fy +
    h(i + 1, j + 1) * fx * fy
  );
}
