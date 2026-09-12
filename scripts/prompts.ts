/**
 * Panorama prompts.
 *
 * The projection block below is the exact wording that produced a genuine
 * 1774x887 (2:1) equirectangular image for `plaza` and passed the Step 1 gate.
 * It is reused verbatim for every node - the scene text is the only thing that
 * changes, so a node that comes out flat points at the scene, not the recipe.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { loadPlaces, loadSurvey, manifestOf, paths } from './lib/worlds.ts';
import { lightBlock } from './sun.ts';

const PROJECTION = `A seamless equirectangular 360x180 degree spherical panorama (photosphere / VR panorama, 2:1 aspect ratio, full spherical projection) of SUBJECT.

CRITICAL PROJECTION REQUIREMENTS — this must be a true equirectangular projection, not a wide-angle photo:
- The image must cover the FULL 360 degrees horizontally and 180 degrees vertically.
- The left edge and the right edge must wrap around and join perfectly seamlessly — the content at x=0 continues directly into the content at the far right edge.
- The horizon line must be perfectly straight and sit exactly at the vertical center of the image.
- Vertical structures (walls, posts, building corners) must remain vertical near the horizontal center, and must curve/fan outward toward the top and bottom edges, as true equirectangular projection does.
- The top edge is the zenith (directly overhead), stretched horizontally across the entire width. The bottom edge is the nadir (the ground directly below the camera), also stretched across the entire width.
- All four cardinal directions must show DIFFERENT parts of the scene — do not repeat, mirror, or tile the same buildings.`;

const BASE_AVOID = `no watermark, no logo, no UI overlay, no frame or border, no people in the foreground, no fisheye or little-planet effect, no flat perspective photograph, no repeated tiling of the same facade`;

/**
 * Two ways to describe a scene.
 *
 * `scene` is a single prose paragraph. It works when the place is a box or a
 * corridor - a room, a street - because the walls themselves tell the model
 * what connects to what.
 *
 * `bearings` names what sits at each direction instead. Use it for open
 * junctions, where a prose list of motifs invites the model to scatter them:
 * the first level crossing came back with four barrier poles, two separate
 * roads and two rail lines at different angles - locally convincing
 * everywhere, a real place nowhere. OpenAI's guidance is to call out placement
 * explicitly when layout matters, and to use short labelled segments rather
 * than one long paragraph.
 */
type Bearings = {
  /** centre of the image, x=0.5 */
  ahead: string;
  /** x=0.75 */
  right: string;
  /** the left and right edges, which join */
  behind: string;
  /** x=0.25 */
  left: string;
  /** top edge */
  up: string;
  /** bottom edge */
  down: string;
};

type Scene = {
  subject: string;
  scene?: string;
  /** where the camera stands, stated before anything is placed around it */
  camera?: string;
  bearings?: Bearings;
  /** exact counts and single-object rules, to stop motifs multiplying */
  continuity?: string[];
  style: string;
  /** Set when the node is meant to carry readable lettering. */
  allowText?: string;
  /** Compass heading the image centre faces; fixes the sun's place in the picture. */
  heading?: number;
};

type SceneFile = {
  subject: string;
  camera?: string;
  scene?: string;
  bearings?: Bearings;
  continuity?: string[];
  allowText?: string;
};

/**
 * One town's scenes, assembled from its scene files and its manifest.
 *
 * A scene file says what this place looks like and nothing else: the style,
 * the continuity rules, the heading that fixes the sun and the night taste all
 * come from the town, so every place in it is painted to the same brief and no
 * scene file can quietly disagree with its neighbours.
 */
export function scenesFor(worldId: string): Record<string, Scene> {
  const manifest = manifestOf(worldId);
  const places = loadPlaces(worldId);
  const survey = loadSurvey(worldId);
  const dir = new URL(`../${paths(worldId).scenes}/`, import.meta.url);
  const out: Record<string, Scene> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const id = file.slice(0, -'.json'.length);
    const place = places.find((p) => p.id === id);
    if (!place) throw new Error(`${paths(worldId).scenes}/${file} has no place in places.json`);
    const spec = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as SceneFile;
    out[id] = {
      ...spec,
      continuity: spec.continuity ?? (place.indoor ? undefined : manifest.continuity),
      style: place.indoor ? manifest.style.indoor : manifest.style.outdoor,
      heading: place.indoor ? undefined : survey[id]?.heading,
    };
  }
  return out;
}

function layoutBlock(b: Bearings): string {
  return `LAYOUT — this is ONE continuous place seen from a single fixed point. The six descriptions below are different directions within the SAME space, and they must join up into one coherent scene, not sit side by side as separate pictures:

- STRAIGHT AHEAD (the centre of the image): ${b.ahead}
- 90 DEGREES TO THE RIGHT (a quarter of the way in from the right edge): ${b.right}
- DIRECTLY BEHIND (split across the far left and far right edges, which join): ${b.behind}
- 90 DEGREES TO THE LEFT (a quarter of the way in from the left edge): ${b.left}
- OVERHEAD (the top edge): ${b.up}
- UNDERFOOT (the bottom edge): ${b.down}`;
}

const GEOMETRY = `SCENE GEOMETRY — this is a real place, so it must obey these rules:
- Any straight line in the world (a road, a railway, a fence, a row of poles) runs past the camera and therefore appears in EXACTLY TWO places in the image, 180 degrees apart, meeting the horizon at one vanishing point on each side. It is one object seen in two directions, not two objects.
- Anything at the same real distance must be drawn at the same scale and sit at the same height relative to the horizon.
- The lighting comes from one sun in one position. Shadows all fall the same way.`;

export function buildPrompt(worldId: string, id: string): string {
  const scenes = scenesFor(worldId);
  const spec = scenes[id];
  if (!spec) throw new Error(`${worldId} has no scene for "${id}" (have: ${Object.keys(scenes).join(', ')})`);
  if (!spec.scene && !spec.bearings) throw new Error(`"${id}" needs either scene or bearings`);

  const avoid = spec.allowText
    ? BASE_AVOID
    : `no text, no lettering, no signage writing, ${BASE_AVOID}`;
  return [
    PROJECTION.replace('SUBJECT', spec.subject),
    spec.camera ? `CAMERA: ${spec.camera}` : null,
    spec.bearings ? layoutBlock(spec.bearings) : `SCENE: ${spec.scene}`,
    spec.bearings ? GEOMETRY : null,
    spec.continuity?.length
      ? `CONTINUITY — count these exactly:\n${spec.continuity.map((c) => `- ${c}`).join('\n')}`
      : null,
    spec.heading !== undefined ? lightBlock(manifestOf(worldId).light, spec.heading) : null,
    `STYLE: ${spec.style}`,
    spec.allowText ? `TEXT: ${spec.allowText}` : null,
    `AVOID: ${avoid}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
