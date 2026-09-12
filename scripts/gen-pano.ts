#!/usr/bin/env bun
/**
 * Generate one node's panorama and prepare it for the viewer.
 *
 *   bun scripts/gen-pano.ts dragon market-street --blockout <png> \
 *     --neighbour <png>:"twenty metres back down the same street"
 *
 * Which image generator runs is the fork's business: see adapters/README.md.
 * Paint the hub of a town first and chain outward, handing each finished
 * neighbour to the next, or two stations twenty metres apart come out as two
 * different streets that happen to share a style.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { analyseSeam, RATIO_LIMIT } from '../src/lib/pano.ts';
import { generate } from './lib/imagegen.ts';
import { paths } from './lib/worlds.ts';
import { buildPrompt } from './prompts.ts';

const worldId = process.argv[2];
const id = process.argv[3];
// An equirectangular blockout of the same survey, rendered from this very
// camera - the same projection as the output, so no mental projection needed.
const blockFlag = process.argv.indexOf('--blockout');
const blockout = blockFlag > 0 ? process.argv[blockFlag + 1] : null;
// Finished panoramas from nearby stations, as `path:where-it-stands`, so the
// same houses come out as the same houses. Repeatable.
const neighbours = process.argv
  .map((arg, i) => (arg === '--neighbour' ? process.argv[i + 1] : null))
  .filter((v): v is string => Boolean(v))
  .map((v) => {
    const at = v.indexOf(':');
    return { path: v.slice(0, at), where: v.slice(at + 1) };
  });
// A finished panorama from just outside a room, as `path:where-it-stands`:
// what shows through the door and the windows, and the town's palette.
const contexts = process.argv
  .map((arg, i) => (arg === '--context' ? process.argv[i + 1] : null))
  .filter((v): v is string => Boolean(v))
  .map((v) => {
    const at = v.indexOf(':');
    return { path: v.slice(0, at), where: v.slice(at + 1) };
  });
// keeps every building where the day painting put it.
const daytimes = process.argv
  .map((arg, i) => (arg === '--daytime' ? process.argv[i + 1] : null))
  .filter((v): v is string => Boolean(v));
// Where to write, so an experiment does not overwrite what the site is using.
const suffix = process.argv.includes('--suffix')
  ? process.argv[process.argv.indexOf('--suffix') + 1]
  : '';

if (!worldId || !id || worldId.startsWith('--') || id.startsWith('--')) {
  console.error('usage: bun scripts/gen-pano.ts <worldId> <node-id> [--blockout <png>] [--suffix <tag>]');
  process.exit(2);
}
const p = paths(worldId);

const BLOCKOUT_BRIEF = `MASSING REFERENCE: Image 1 is a grey blockout of this exact location, rendered in the SAME equirectangular projection as the image you are producing, from the SAME camera position and facing the same way. Every pixel of it corresponds to the same pixel of your output.

Use it for STRUCTURE ONLY - where solid mass is, where openings are, how wide the street reads, how tall things are against the horizon, and where the ground meets the buildings. Do NOT copy its grey palette, its flat shading or its bare geometry: it is a massing study, not the look.

Read it as: mid-grey blocks are buildings, the darker span overhead is a roof, the flat plane below the horizon is the ground with roads picked out slightly darker, and the pale area is open sky. Replace each block with the real building described below, keeping it at the same angular position and the same size against the horizon.

The bright disc in the sky of Image 1 is the light. Put it at exactly that place in your image, and let every shadow fall directly away from it; the lit faces of the blocks in Image 1 show which sides catch the light.`;

const neighbourBrief = (index: number, where: string) =>
  `NEIGHBOURING VIEW: Image ${index} is the finished panorama from the station ${where}. Every house, wall, pole, shed, boat and crate in it is the same object you are looking at now, only nearer or further and from a slightly different angle. Keep their identity: the same houses in the same order with the same roofs, cladding and colours, the same sea wall, the same sheds. Do NOT copy Image ${index}'s pixels or its projection - re-draw the same place from your own camera position.`;

const daytimeBrief = (index: number) =>
  `DAYTIME VIEW: Image ${index} is this very place painted in daylight from the same camera, in the same projection. Keep every building, wall, pole, boat, tree, shed and road exactly where and how it is there; change only the light, the sky, the weather and the mood.`;

const contextBrief = (index: number, where: string) =>
  `CONTEXT VIEW: Image ${index} is the finished panorama from ${where}. Use it only for what can be seen through this room's doorway and windows, and for the town's palette, materials and light. Do not reproduce it and do not draw the outdoors as the subject.`;

const firstNeighbourIndex = 1 + (blockout ? 1 : 0);
const firstContextIndex = firstNeighbourIndex + neighbours.length;
const firstDaytimeIndex = firstContextIndex + contexts.length;
const prompt = [
  buildPrompt(worldId, id),
  blockout ? BLOCKOUT_BRIEF : null,
  ...neighbours.map((n, i) => neighbourBrief(firstNeighbourIndex + i, n.where)),
  ...contexts.map((c, i) => contextBrief(firstContextIndex + i, c.where)),
  ...daytimes.map((_, i) => daytimeBrief(firstDaytimeIndex + i)),
]
  .filter(Boolean)
  .join('\n\n');
await mkdir(p.panoramas, { recursive: true });
await mkdir(p.servedPanoramas, { recursive: true });
const name = `${id}${suffix ? `-${suffix}` : ''}`;
const promptFile = `${p.panoramas}/${name}.prompt.txt`;
await writeFile(promptFile, prompt);

const rawPath = `${p.panoramas}/${name}.png`;

// The order of these is the contract: --ref 1 is "Image 1" in the prompt, so
// the numbering in the briefs above and the flags below are computed together.
const refs = [
  ...(blockout ? [{ path: blockout, label: 'equirectangular-massing-blockout-same-projection' }] : []),
  ...neighbours.map((n) => ({ path: n.path, label: 'finished-panorama-from-a-neighbouring-station' })),
  ...contexts.map((c) => ({ path: c.path, label: 'finished-panorama-from-just-outside-this-room' })),
  ...daytimes.map((d) => ({ path: d, label: 'the-same-place-painted-in-daylight' })),
];

async function generateOnce(): Promise<boolean> {
  try {
    await generate({ promptFile, out: rawPath, refs, aspect: '2:1' });
  } catch (err) {
    console.error(`[${name}] ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  console.log(`[${name}] -> ${rawPath}`);
  return true;
}

async function wrapRatio(): Promise<number> {
  const { data, info } = await sharp(rawPath).raw().toBuffer({ resolveWithObject: true });
  return analyseSeam(data, info.width, info.height, info.channels).ratio;
}

// A wrap that nearly joins is feathered; one that does not join at all - a
// ridge on one edge and sky on the other - is painted again, because no blend
// hides that. Flat colour fields make the ratio harsh, hence the two limits.
const FEATHER_UP_TO = 4.5;
const ATTEMPTS = 3;
let ratio = Infinity;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  console.log(`[${name}] generating${blockout ? ` with blockout ${blockout}` : ''}${neighbours.length ? ` and ${neighbours.length} neighbouring view(s)` : ''}${attempt > 1 ? ` (attempt ${attempt})` : ''}...`);
  if (!(await generateOnce())) process.exit(1);
  ratio = await wrapRatio();
  if (ratio < RATIO_LIMIT) break;
  if (ratio <= FEATHER_UP_TO || attempt === ATTEMPTS) {
    const feathered = Bun.spawn(['bun', 'scripts/seam-feather.ts', rawPath, rawPath, '48'], { stdout: 'inherit', stderr: 'inherit' });
    await feathered.exited;
    console.log(`[${name}] wrap ratio ${ratio.toFixed(2)}${ratio > FEATHER_UP_TO ? ' still' : ''} over the limit; feathered`);
    break;
  }
  console.log(`[${name}] wrap ratio ${ratio.toFixed(2)}: the edges do not join, painting again`);
}

for (const args of [
  // An experiment writes only to raw/; only the unsuffixed run feeds the site.
  ...(suffix ? [] : [['scripts/prep-pano.ts', rawPath, `${p.servedPanoramas}/${id}.jpg`]]),
  ['scripts/pano-check.ts', rawPath],
]) {
  const step = Bun.spawn(['bun', ...args], { stdout: 'inherit', stderr: 'inherit' });
  await step.exited;
}
