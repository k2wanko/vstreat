import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Light } from '../sun.ts';
import {
  worldFromData,
  type PlaceSpec,
  type Scene,
  type Survey,
  type World,
  type WorldManifest,
} from '../../src/data/world.ts';

/**
 * The scripts' half of the world loader. The browser reaches worlds/ through a
 * Vite glob, which does not exist under bun, so the same directories are read
 * off the filesystem here and handed to the same assembler.
 */

const ROOT = new URL('../../worlds/', import.meta.url);
const read = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T;

export type Terrain = {
  ridgeM: number;
  /** Which traced cover the high ground follows. */
  ridgeFrom: string;
  terraceM: number;
  /** Which traced cover counts as the low ground everything ramps up from. */
  terraceFrom: string;
  river?: { widthM: number; depthM: number };
};

/**
 * Where a town's files live. Every script goes through here, so no script
 * builds a path by hand and no town's name ends up inside one.
 */
export function paths(id: string) {
  const dir = `worlds/${id}`;
  const raw = `${dir}/raw`;
  const served = `public/worlds/${id}`;
  return {
    dir,
    geojson: `${dir}/town.geojson`,
    survey: `${dir}/survey.json`,
    scenes: `${dir}/scenes`,
    raw,
    aerial: `${raw}/aerial.png`,
    overlay: `${raw}/overlay.png`,
    blockouts: `${raw}/blockouts`,
    panoramas: `${raw}/panoramas`,
    characters: `${raw}/characters`,
    served,
    map: `${served}/map.jpg`,
    servedPanoramas: `${served}/panoramas`,
    servedBlockouts: `${served}/pipeline/blockouts`,
    servedPipeline: `${served}/pipeline`,
    servedCharacters: `${served}/characters`,
  };
}

export function terrainOf(id: string): Terrain {
  const m = read<Manifest>(new URL(`${id}/world.json`, ROOT));
  if (!m.terrain) throw new Error(`${id}: world.json has no terrain block; a massing world needs one`);
  return m.terrain;
}

export function worldIds(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(new URL(`${e.name}/world.json`, ROOT)))
    .map((e) => e.name)
    .sort();
}

export type Manifest = WorldManifest & {
  terrain?: Terrain;
  light: Light;
  style: { outdoor: string; indoor: string };
  continuity?: string[];
};

export function manifestOf(id: string): Manifest {
  return read<Manifest>(new URL(`${id}/world.json`, ROOT));
}

export function loadSurvey(id: string): Survey {
  return read<Survey>(new URL(`${id}/survey.json`, ROOT));
}

export type Resident = { id: string; nodeId: string; name: string; line: string; at: number; pitch: number };

export function loadCharacters(id: string): Resident[] {
  const file = new URL(`${id}/characters.json`, ROOT);
  return existsSync(file) ? read<Resident[]>(file) : [];
}

export function loadPlaces(id: string): PlaceSpec[] {
  return read<PlaceSpec[]>(new URL(`${id}/places.json`, ROOT));
}

export function loadWorld(id: string): World {
  const dir = new URL(`${id}/`, ROOT);
  const manifest = new URL('world.json', dir);
  if (!existsSync(manifest)) throw new Error(`no world "${id}" under worlds/ (have: ${worldIds().join(', ')})`);
  const surveyFile = new URL('survey.json', dir);
  if (!existsSync(surveyFile))
    throw new Error(`${id}: no survey.json yet. Site the places, then run: bun scripts/stations.ts ${id} --write`);
  const scenesDir = new URL('scenes/', dir);
  const scenes: Record<string, Scene> = {};
  if (existsSync(scenesDir)) {
    for (const file of readdirSync(scenesDir).filter((f) => f.endsWith('.json'))) {
      scenes[file.slice(0, -'.json'.length)] = read<Scene>(new URL(file, scenesDir));
    }
  }
  return worldFromData({
    manifest: read<WorldManifest>(manifest),
    places: read<PlaceSpec[]>(new URL('places.json', dir)),
    survey: read<Survey>(surveyFile),
    scenes,
  });
}

// A town under construction has a world.json before it has places.json or
// survey.json - AGENTS.md's own method creates them in that order. worldIds()
// still lists it (useful in an error naming every directory that exists), but
// nothing tries to build a World out of it until it is ready.
function isReady(id: string): boolean {
  return existsSync(new URL(`${id}/places.json`, ROOT)) && existsSync(new URL(`${id}/survey.json`, ROOT));
}

export function readyWorldIds(): string[] {
  return worldIds().filter(isReady);
}

export const WORLDS: World[] = readyWorldIds().map(loadWorld);
