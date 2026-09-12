#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { loadPlaces, paths } from './lib/worlds.ts';

const worldId = process.argv[2];
if (!worldId) {
  console.error('usage: bun scripts/export-pipeline.ts <worldId>');
  process.exit(2);
}
const MAP = 1200;
const p = paths(worldId);
const dir = p.servedPipeline;
await mkdir(`${dir}/blockouts`, { recursive: true });

await sharp(p.aerial).resize(MAP, MAP, { fit: 'fill' }).jpeg({ quality: 84, mozjpeg: true }).toFile(`${dir}/aerial.jpg`);
await sharp(p.overlay).resize(MAP, MAP, { fit: 'fill' }).jpeg({ quality: 86, mozjpeg: true }).toFile(`${dir}/overlay.jpg`);
const outdoor = loadPlaces(worldId).filter((place) => !place.indoor).map((place) => place.id);
for (const id of outdoor) {
  await sharp(`${p.blockouts}/${id}.png`).jpeg({ quality: 82, mozjpeg: true }).toFile(`${dir}/blockouts/${id}.jpg`);
}
console.log(`wrote ${dir}/aerial.jpg, overlay.jpg, ${outdoor.length} blockouts`);
