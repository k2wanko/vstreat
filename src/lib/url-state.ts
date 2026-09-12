/**
 * The view as a shareable URL.
 *
 *   /?w=dragon&n=plaza&y=53.5&p=-2.1&z=30
 *
 * Angles are written in degrees rather than radians so a link is legible and
 * can be edited by hand. Everything is optional: a link with only `w` and `n`
 * drops you at that place looking wherever the tour would have pointed you.
 */

export type ViewState = {
  world: string;
  node: string;
  /** degrees, 0 to 360, measured from the centre of the panorama */
  yaw: number;
  /** degrees, -90 (straight down) to 90 (straight up) */
  pitch: number;
  /** PhotoSphereViewer zoom level, 0 to 100 */
  zoom: number;
};

const KEYS = { world: 'w', node: 'n', yaw: 'y', pitch: 'p', zoom: 'z' } as const;

export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One decimal is about 0.3 m of aim at arm's length - plenty, and keeps links short. */
const round = (v: number) => Math.round(v * 10) / 10;

function num(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Read whatever the URL actually carries. Missing and malformed values are
 * both simply absent, so a hand-edited or truncated link still opens.
 */
export function parseViewState(search: string): Partial<ViewState> {
  const q = new URLSearchParams(search);
  const out: Partial<ViewState> = {};

  const world = q.get(KEYS.world);
  if (world) out.world = world;
  const node = q.get(KEYS.node);
  if (node) out.node = node;

  const yaw = num(q.get(KEYS.yaw));
  if (yaw !== undefined) out.yaw = wrap360(yaw);
  const pitch = num(q.get(KEYS.pitch));
  if (pitch !== undefined) out.pitch = clamp(pitch, -90, 90);
  const zoom = num(q.get(KEYS.zoom));
  if (zoom !== undefined) out.zoom = clamp(zoom, 0, 100);

  return out;
}

export function toSearch(state: ViewState): string {
  const q = new URLSearchParams();
  q.set(KEYS.world, state.world);
  q.set(KEYS.node, state.node);
  q.set(KEYS.yaw, String(round(wrap360(state.yaw))));
  q.set(KEYS.pitch, String(round(clamp(state.pitch, -90, 90))));
  q.set(KEYS.zoom, String(Math.round(clamp(state.zoom, 0, 100))));
  return `?${q}`;
}

/** True when the two would produce the same link, so we can skip writing. */
export function sameLink(a: ViewState | null, b: ViewState): boolean {
  return a !== null && toSearch(a) === toSearch(b);
}

export const toRadians = (deg: number) => (deg * Math.PI) / 180;
export const toDegrees = (rad: number) => (rad * 180) / Math.PI;
