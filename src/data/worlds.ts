import { worldFromData, type PlaceSpec, type Scene, type Survey, type World, type WorldManifest } from './world.ts';

/**
 * Every town is a directory under worlds/. A manifest says how big the frame
 * is and where the minimap lives, places.json is the graph, survey.json is the
 * metres grid a script derived, and scenes/ describes what each place looks
 * like. Nothing about a town lives in this file, so adding one is `mkdir`.
 *
 * The scripts read the same directories through scripts/lib/worlds.ts; this is
 * the browser's half, because a Vite glob is the only way to reach the
 * filesystem from a bundle.
 */

const dirOf = (path: string) => path.split('/')[3];

function byWorld<T>(glob: Record<string, unknown>): Record<string, T> {
  return Object.fromEntries(Object.entries(glob).map(([path, value]) => [dirOf(path), value as T]));
}

const MANIFESTS = byWorld<WorldManifest>(
  import.meta.glob('../../worlds/*/world.json', { eager: true, import: 'default' }),
);
const PLACES = byWorld<PlaceSpec[]>(import.meta.glob('../../worlds/*/places.json', { eager: true, import: 'default' }));
const SURVEYS = byWorld<Survey>(import.meta.glob('../../worlds/*/survey.json', { eager: true, import: 'default' }));

const SCENES: Record<string, Record<string, Scene>> = {};
for (const [path, scene] of Object.entries(
  import.meta.glob('../../worlds/*/scenes/*.json', { eager: true, import: 'default' }),
)) {
  (SCENES[dirOf(path)] ??= {})[path.slice(path.lastIndexOf('/') + 1, -'.json'.length)] = scene as Scene;
}

function world(id: string): World {
  return worldFromData({ manifest: MANIFESTS[id], places: PLACES[id], survey: SURVEYS[id], scenes: SCENES[id] });
}

// A town under construction has a world.json before it has places.json or
// survey.json - AGENTS.md's own method creates them in that order - so it is
// left out of the switcher rather than crashing everyone else's.
const readyIds = Object.keys(MANIFESTS)
  .filter((id) => id in PLACES && id in SURVEYS)
  .sort();

export const WORLDS: World[] = readyIds.map(world);
