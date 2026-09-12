#!/usr/bin/env bun
import { stationsFor } from './stations.ts';
import { buildWorld, cellOf, CELL, CLASS, N } from './terrain.ts';

const worldId = process.argv[2];
const [e, n, radius] = process.argv.slice(3).map(Number);
if (!Number.isFinite(e) || !Number.isFinite(n)) {
  console.error('usage: bun scripts/grid.ts <worldId> <e> <n> [radius-m]   (metres, +e east, +n north)');
  process.exit(2);
}
const R = Number.isFinite(radius) ? radius : 60;
const world = buildWorld(worldId);
const STATIONS = stationsFor(worldId);
const glyph: Record<number, string> = {
  [CLASS.sea]: '~',
  [CLASS.sand]: ':',
  [CLASS.field]: '"',
  [CLASS.forest]: '^',
  [CLASS.road]: '=',
  [CLASS.ground]: '.',
  [CLASS.building]: '#',
};
const c0 = cellOf(e, n);
const step = 2;
const stations = Object.values(STATIONS).map((s) => ({ ...cellOf(s.e, s.n), id: s.id }));
console.log(`legend: ~ sea  : sand  " field  ^ forest  = road  . ground  # building  @ here  S station   (${step * CELL} m per character)`);
for (let j = c0.j - R / CELL; j <= c0.j + R / CELL; j += step) {
  let row = '';
  for (let i = c0.i - R / CELL; i <= c0.i + R / CELL; i += step) {
    const st = stations.find((s) => Math.abs(s.i - i) < step && Math.abs(s.j - j) < step);
    row += i === c0.i && j === c0.j ? '@' : st ? 'S' : i < 0 || j < 0 || i >= N || j >= N ? ' ' : (glyph[world.cls[j * N + i]] ?? '?');
  }
  console.log(`n=${String(Math.round((N * CELL) / 2 - (j + 0.5) * CELL)).padStart(5)} ${row}`);
}
console.log(`columns: e from ${Math.round((c0.i - R / CELL + 0.5) * CELL - (N * CELL) / 2)} to ${Math.round((c0.i + R / CELL + 0.5) * CELL - (N * CELL) / 2)}`);
console.log('stations:', Object.values(STATIONS).map((s) => `${s.id}(${s.e.toFixed(0)},${s.n.toFixed(0)},${s.heading.toFixed(0)}°)`).join(' '));
