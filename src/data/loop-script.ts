import type { StageId } from './pipeline.ts';

/**
 * Exhibit loops: walk a town on its own, pausing where there is something to
 * see. 竜の街 stops when a resident is in view; 港町 shows how it was made.
 *
 * Times are approximate; the runner also waits for tour transitions to settle
 * before starting a look/hold, so the total length drifts a little with load.
 */

export type LoopBeat = {
  nodeId: string;
  /** Pipeline stage to show for this beat; only meaningful in a world that has one. */
  stage?: StageId;
  /** Degrees. When omitted, keep whatever arrival facing the tour chose. */
  yaw?: number;
  pitch?: number;
  /** How long to linger after the look settles. */
  holdMs: number;
  /** Optional slow pan during the hold, also in degrees. */
  panTo?: { yaw: number; pitch?: number; durationMs: number };
};

/** One pass through the dragon-town loop (~70–90 s depending on transitions). */
/** An optional exhibit loop, beside the town it walks. */
const LOOPS: Record<string, LoopBeat[]> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../worlds/*/loop.json', { eager: true, import: 'default' }) as Record<string, LoopBeat[]>,
  ).map(([path, beats]) => [path.split('/')[3], beats]),
);


export function loopFor(worldId: string): LoopBeat[] | null {
  return LOOPS[worldId] ?? null;
}
