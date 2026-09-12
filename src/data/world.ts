import { yawFor, type Point as SurveyPoint } from './gis/geo.ts';

/**
 * A world is one town: a set of places, how they connect, and the minimap they
 * sit on. Each world's layout is defined in data first, and its minimap image
 * is generated from those coordinates - not the other way round, which would
 * let the map and the panoramas drift apart.
 */

export type TourLink = {
  nodeId: string;
  /** where the exit appears in the panorama, as a fraction of image width */
  at: number;
};

export type TourNode = {
  id: string;
  name: string;
  caption: string;
  panorama: string;
  map: { x: number; y: number };
  /** Compass bearing the panorama's centre faces, degrees clockwise from north. */
  heading?: number;
  links: { nodeId: string; position: { yaw: number; pitch: number } }[];
  indoor: boolean;
};

/** The "you are here" pin on the minimap. Shared by every world. */
export const PIN_IMAGE = '/map/pin.svg';

/** What a scene file says about a place, for anything that needs to describe it. */
export type Scene = {
  subject?: string;
  camera?: string;
  scene?: string;
  bearings?: Record<string, string>;
};

export type Survey = Record<string, { at: SurveyPoint; heading: number }>;

export type Pipeline = {
  aerial: string;
  overlay: string;
  massing: string;
  blockouts: Record<string, string>;
};

export type World = {
  id: string;
  /** shown on the world switcher */
  label: string;
  mapImage: string;
  mapSize: { width: number; height: number };
  startNodeId: string;
  nodes: TourNode[];
  pipeline?: Pipeline;
  /** The metres-grid this world was laid out on, when it has one. */
  survey?: Survey;
  /** What each place looks like, keyed by node id. */
  scenes?: Record<string, Scene>;
};

/**
 * Converts a position in the panorama image (0 = left edge, 1 = right edge)
 * to a PhotoSphereViewer yaw.
 *
 * Verified against a real panorama rather than assumed: at yaw 0 the viewer
 * shows what sits at x≈0.5 of the image, and yaw 180° lands on the wrap seam.
 * So yaw 0 is the image CENTRE - treating it as the left edge would put every
 * arrow half a turn away from the opening it belongs to.
 */
export function yawFromImageX(fraction: number): number {
  return (fraction - 0.5) * 2 * Math.PI;
}

/** Arrows sit below the horizon, on the ground, as in Street View. */
const GROUND_PITCH = -0.45;

/**
 * A world whose geometry comes from a survey rather than from the eye.
 *
 * Arrow directions are computed as bearing(here -> there) minus this node's
 * heading, and minimap positions come from one transform applied to every
 * place. Both used to be set by hand, one number at a time, which is how
 * arrows ended up pointing at walls and how a cafe twelve metres away got
 * drawn a hundred metres from its own street.
 */
export function defineSurveyedWorld(opts: {
  id: string;
  label: string;
  mapImage: string;
  mapSize: { width: number; height: number };
  startNodeId: string;
  survey: Survey;
  /** How many metres across the minimap is; with mapSize this fixes the scale. */
  frameM: number;
  places: { id: string; name: string; caption: string; indoor?: boolean; links: string[] }[];
  pipeline?: { aerial: string; overlay: string; blockouts?: string };
  /** Where this world's panoramas live; another taste of the same town keeps its own. */
  panoramaDir?: string;
  scenes?: Record<string, Scene>;
}): World {
  const panoramaDir = opts.panoramaDir ?? `/worlds/${opts.id}/panoramas`;
  // The datum sits at the centre of the frame, and the frame is the map, so
  // one number sets the scale for both axes. This used to be a callback each
  // world passed in, and every world passed in the same arithmetic.
  const pxPerM = opts.mapSize.width / opts.frameM;
  const toMap = (p: SurveyPoint) => ({
    x: opts.mapSize.width / 2 + p.e * pxPerM,
    y: opts.mapSize.height / 2 - p.n * pxPerM,
  });
  const blockoutDir = opts.pipeline?.blockouts ?? `/worlds/${opts.id}/pipeline/blockouts`;
  return {
    id: opts.id,
    label: opts.label,
    mapImage: opts.mapImage,
    mapSize: opts.mapSize,
    startNodeId: opts.startNodeId,
    survey: opts.survey,
    scenes: opts.scenes,
    pipeline: opts.pipeline && {
      aerial: opts.pipeline.aerial,
      overlay: opts.pipeline.overlay,
      massing: opts.mapImage,
      blockouts: Object.fromEntries(opts.places.map((place) => [place.id, `${blockoutDir}/${place.id}.jpg`])),
    },
    nodes: opts.places.map((place) => {
      const here = opts.survey[place.id];
      if (!here) throw new Error(`${opts.id}: no survey entry for ${place.id}`);
      return {
        id: place.id,
        name: place.name,
        caption: place.caption,
        panorama: `${panoramaDir}/${place.id}.jpg`,
        map: toMap(here.at),
        heading: here.heading,
        indoor: place.indoor ?? false,
        links: place.links.map((to) => {
          const there = opts.survey[to];
          if (!there) throw new Error(`${opts.id}: ${place.id} links to unsurveyed ${to}`);
          return { nodeId: to, position: { yaw: yawFor(here.at, here.heading, there.at), pitch: GROUND_PITCH } };
        }),
      };
    }),
  };
}

/**
 * Panoramas are generated in stages, so the viewer runs on whichever nodes
 * already have an image. Links to nodes that are not ready yet are dropped so
 * the tour never shows an arrow that leads nowhere.
 */
export function availableNodes(nodes: TourNode[], readyIds: Iterable<string>): TourNode[] {
  const ready = new Set(readyIds);
  return nodes
    .filter((node) => ready.has(node.id))
    .map((node) => ({ ...node, links: node.links.filter((link) => ready.has(link.nodeId)) }));
}

export type WorldManifest = {
  id: string;
  label: string;
  startNodeId: string;
  /** How many metres across the minimap is. */
  frameM: number;
  map: { image: string; width: number; height: number };
  pipeline?: { aerial: string; overlay: string; blockouts: string };
};

/** How a place is sited on the traced ground. Read by the survey scripts. */
export type Site =
  | { kind: 'road'; road: number; t: number }
  | { kind: 'point'; e: number; n: number; heading: number }
  | { kind: 'indoor'; host: string; offset: { e: number; n: number }; heading: number };

export type PlaceSpec = {
  id: string;
  name: string;
  caption: string;
  indoor?: boolean;
  links: string[];
  /** Where this place stands on the traced ground; the survey is derived from it. */
  site: Site;
};

/**
 * One town's files, assembled. Both the browser and the scripts come through
 * here, from a Vite glob and from the filesystem respectively, so a town reads
 * the same either way.
 */
export function worldFromData(data: {
  manifest: WorldManifest;
  places: PlaceSpec[];
  survey: Survey;
  scenes?: Record<string, Scene>;
  panoramaDir?: string;
}): World {
  const { manifest: m, places, survey } = data;
  const mapSize = { width: m.map.width, height: m.map.height };
  return defineSurveyedWorld({
    id: m.id,
    label: m.label,
    mapImage: m.map.image,
    mapSize,
    startNodeId: m.startNodeId,
    frameM: m.frameM,
    survey,
    scenes: data.scenes,
    panoramaDir: data.panoramaDir,
    pipeline: m.pipeline,
    places: places.map(({ id, name, caption, indoor, links }) => ({ id, name, caption, indoor, links })),
  });
}
