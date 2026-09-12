#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { generate } from './lib/imagegen.ts';
import { paths } from './lib/worlds.ts';

const [, , worldId, id] = process.argv;
if (!worldId || !id) {
  console.error('usage: bun scripts/gen-character.ts <worldId> <characterId>');
  process.exit(2);
}
const p = paths(worldId);
const promptFile = `${p.characters}/${id}.prompt.txt`;
const rawPath = `${p.characters}/${id}.png`;
const out = `${p.servedCharacters}/${id}.png`;

console.log(`[${worldId}/${id}] generating...`);
await mkdir(p.characters, { recursive: true });
await generate({ promptFile, out: rawPath });
await mkdir(p.servedCharacters, { recursive: true });

for (const args of [
  ['scripts/chroma-key.ts', rawPath, out],
  ['scripts/bake-shadow.ts', out],
]) {
  const step = Bun.spawn(['bun', ...args], { stdout: 'inherit', stderr: 'inherit' });
  await step.exited;
}
console.log(`[${worldId}/${id}] ${out}`);
