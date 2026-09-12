/**
 * Where the camera stands. Read off the traced GIS rather than chosen by eye:
 * each place in the town's places.json, sited on a traced road, at a declared
 * point, or inside a building next to the outdoor station it is entered from.
 *
 * Headings follow the road a station stands on, so an arrival faces along the
 * street rather than at a wall.
 *
 *   bun scripts/stations.ts <worldId> [--write]
 *
 * --write puts the result in worlds/<id>/survey.json, which is the only thing
 * that should ever write that file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadPlaces, paths } from './lib/worlds.ts';

export type Station = { id: string; e: number; n: number; heading: number; eye: number; indoor?: boolean };

type Feature = { properties: { kind: string }; geometry: { type: string; coordinates: number[] | number[][] } };

function length(line: number[][]): number {
  let d = 0;
  for (let i = 0; i + 1 < line.length; i++) d += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  return d;
}

/** Point and forward bearing at a fraction along a polyline. */
function along(line: number[][], t: number): { e: number; n: number; heading: number } {
  const total = length(line) * t;
  let run = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const seg = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
    if (run + seg >= total || i + 2 === line.length) {
      const f = seg ? (total - run) / seg : 0;
      const e = line[i][0] + (line[i + 1][0] - line[i][0]) * f;
      const n = line[i][1] + (line[i + 1][1] - line[i][1]) * f;
      const heading =
        (Math.atan2(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) * 180) / Math.PI;
      return { e, n, heading: (heading + 360) % 360 };
    }
    run += seg;
  }
  return { e: line[0][0], n: line[0][1], heading: 0 };
}



export function stationsFor(worldId: string): Record<string, Station> {
  const gj = JSON.parse(readFileSync(paths(worldId).geojson, 'utf8')) as { features: Feature[] };
  const roads = gj.features
    .filter((f) => f.properties.kind === 'road')
    .map((f) => f.geometry.coordinates as number[][])
    .sort((a, b) => length(b) - length(a));
  const places = loadPlaces(worldId);

  const out: Record<string, Station> = {};
  for (const place of places) {
    if (!place.site) throw new Error(`${worldId}: ${place.id} has no site in places.json`);
    const site = place.site;
    if (site.kind === 'road') {
      const road = roads[site.road];
      if (!road) throw new Error(`${place.id}: no traced road ${site.road}`);
      out[place.id] = { id: place.id, ...along(road, site.t), eye: 1.6 };
    } else if (site.kind === 'point') {
      out[place.id] = { id: place.id, e: site.e, n: site.n, heading: site.heading, eye: 1.6 };
    }
  }
  for (const place of places) {
    const site = place.site!;
    if (site.kind !== 'indoor') continue;
    const host = out[site.host];
    if (!host) throw new Error(`${place.id}: indoor host ${site.host} is not an outdoor station`);
    out[place.id] = { id: place.id, e: host.e + site.offset.e, n: host.n + site.offset.n, heading: site.heading, eye: 1.6, indoor: true };
  }
  return out;
}

const round = (x: number) => Number(x.toFixed(1));

export function surveyOf(worldId: string): Record<string, { at: { e: number; n: number }; heading: number }> {
  return Object.fromEntries(
    Object.values(stationsFor(worldId)).map((st) => [
      st.id,
      { at: { e: round(st.e), n: round(st.n) }, heading: round(st.heading) },
    ]),
  );
}

if (import.meta.main) {
  const worldId = process.argv[2];
  if (!worldId || worldId.startsWith('--')) {
    console.error('usage: stations.ts <worldId> [--write]');
    process.exit(2);
  }
  const survey = surveyOf(worldId);
  if (process.argv.includes('--write')) {
    const file = paths(worldId).survey;
    writeFileSync(file, JSON.stringify(survey, null, 2) + '\n');
    console.log(`wrote ${Object.keys(survey).length} stations to ${file}`);
  } else {
    console.log(JSON.stringify(survey, null, 2));
  }
}
