import { describe, expect, it } from 'vitest';
import { residentsOf, withYaw } from './characters.ts';
import { loopFor } from './loop-script.ts';
import { yawFromImageX } from './world.ts';
import { WORLDS } from './worlds.ts';

/** Smallest angle between two headings, in radians. */
function separation(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
}

const dragon = WORLDS.find((w) => w.id === 'dragon')!;

const RESIDENTS = residentsOf('dragon');
const LOOP = loopFor('dragon')!;

describe('dragon residents', () => {
  it('all live in the dragon world on real nodes', () => {
    const ids = new Set(dragon.nodes.map((n) => n.id));
    for (const c of RESIDENTS) {
      expect(c.worldId).toBe('dragon');
      expect(ids).toContain(c.nodeId);
    }
  });

  it('stand at least PI/4 away from every ground arrow on their node', () => {
    for (const c of RESIDENTS) {
      const node = dragon.nodes.find((n) => n.id === c.nodeId)!;
      const yaw = withYaw(c).yaw;
      for (const link of node.links) {
        expect(
          separation(yaw, link.position.yaw),
          `${c.id} too close to arrow toward ${link.nodeId}`,
        ).toBeGreaterThan(Math.PI / 4);
      }
    }
  });

  it('uses the same image-fraction convention as tour links', () => {
    for (const c of RESIDENTS) {
      expect(withYaw(c).yaw).toBeCloseTo(yawFromImageX(c.at), 10);
    }
  });
});

describe('dragon loop script', () => {
  it('only visits nodes that exist', () => {
    const ids = new Set(dragon.nodes.map((n) => n.id));
    for (const beat of LOOP) {
      expect(ids).toContain(beat.nodeId);
    }
  });

  it('faces each resident at least once', () => {
    const faced = new Set(LOOP.map((b) => b.nodeId));
    for (const c of RESIDENTS) {
      expect(faced, `loop never visits ${c.nodeId}`).toContain(c.nodeId);
    }
  });
});
