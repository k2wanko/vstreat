#!/usr/bin/env bun
/**
 * Paint the town from above. Step one, and the most expensive decision in the
 * project: every later stage inherits this frame, so a river you did not paint
 * here cannot be added in step six.
 *
 *   bun scripts/gen-aerial.ts <worldId>
 *
 * The prompt lives in worlds/<id>/aerial.prompt.txt and has to put the
 * topology you intend where a nadir camera can see it. Expect to paint it
 * several times; look at the result before going on.
 */
import { existsSync } from 'node:fs';
import { generate } from './lib/imagegen.ts';
import { manifestOf, paths } from './lib/worlds.ts';

const worldId = process.argv[2];
if (!worldId) {
  console.error('usage: bun scripts/gen-aerial.ts <worldId>');
  process.exit(2);
}
const p = paths(worldId);
const promptFile = `${p.dir}/aerial.prompt.txt`;
if (!existsSync(promptFile)) {
  console.error(`${worldId}: no ${promptFile}. Write the prompt for the aerial photograph there first.`);
  process.exit(2);
}

console.log(`[${worldId}] painting the aerial, ${manifestOf(worldId).frameM ?? '?'} m across...`);
await generate({ promptFile, out: p.aerial, aspect: '1:1' });
console.log(`[${worldId}] ${p.aerial}\n  Look at it before going on: nadir, north up, square, and every kind of\n  place your town needs visible from above. If not, paint it again.`);
