import { describe, expect, it } from 'vitest';
import { availableNodes, type TourNode, yawFromImageX } from './world.ts';
import { WORLDS } from './worlds.ts';

/** Every node reachable from `start` by walking links. */
function reachableFrom(start: string, nodes: TourNode[]): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const link of byId.get(id)?.links ?? []) queue.push(link.nodeId);
  }
  return seen;
}

/** Smallest angle between two headings, in radians. */
function separation(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
}

it('ships every town with a distinct id', () => {
  expect(WORLDS.length).toBeGreaterThan(0);
  expect(new Set(WORLDS.map((w) => w.id)).size).toBe(WORLDS.length);
});

it('gives every town somewhere to stand outdoors', () => {
  for (const world of WORLDS) expect(world.nodes.filter((n) => !n.indoor).length).toBeGreaterThan(0);
});

describe.each(WORLDS)('$label ($id)', (world) => {
  const ids = new Set(world.nodes.map((n) => n.id));

  it('gives every node a unique id', () => {
    expect(ids.size).toBe(world.nodes.length);
  });

  it('never links to a node that does not exist', () => {
    for (const node of world.nodes) {
      for (const link of node.links) {
        expect(ids, `${node.id} -> ${link.nodeId}`).toContain(link.nodeId);
      }
    }
  });

  it('links both ways, so no move is a one-way trip', () => {
    for (const node of world.nodes) {
      for (const link of node.links) {
        const back = world.nodes.find((n) => n.id === link.nodeId)?.links ?? [];
        expect(
          back.map((l) => l.nodeId),
          `${link.nodeId} should link back to ${node.id}`,
        ).toContain(node.id);
      }
    }
  });

  it('can reach every place on foot from the start', () => {
    expect(reachableFrom(world.startNodeId, world.nodes)).toEqual(ids);
  });

  it('starts at a node that exists', () => {
    expect(ids).toContain(world.startNodeId);
  });

  it('keeps every map coordinate inside the minimap image', () => {
    for (const node of world.nodes) {
      expect(node.map.x, node.id).toBeGreaterThanOrEqual(0);
      expect(node.map.x, node.id).toBeLessThanOrEqual(world.mapSize.width);
      expect(node.map.y, node.id).toBeGreaterThanOrEqual(0);
      expect(node.map.y, node.id).toBeLessThanOrEqual(world.mapSize.height);
    }
  });

  it('puts no two places on the same spot on the map', () => {
    const spots = world.nodes.map((n) => `${n.map.x},${n.map.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('spaces arrows further apart than the plugin fades them out (PI/4)', () => {
    // VirtualTourPlugin's linkOverlapAngle defaults to PI/4; closer than that
    // and one of the two arrows becomes unclickable.
    for (const node of world.nodes) {
      for (let i = 0; i < node.links.length; i++) {
        for (let j = i + 1; j < node.links.length; j++) {
          const gap = separation(node.links[i].position.yaw, node.links[j].position.yaw);
          expect(
            gap,
            `${node.id}: ${node.links[i].nodeId} vs ${node.links[j].nodeId}`,
          ).toBeGreaterThan(Math.PI / 4);
        }
      }
    }
  });

  it('points every panorama at its own node id', () => {
    for (const node of world.nodes) {
      expect(node.panorama).toMatch(new RegExp(`^/worlds/[a-z-]+/panoramas/(?:[a-z-]+/)?${node.id}\\.jpg$`));
    }
  });
});

it('never reuses a panorama across worlds', () => {
  const all = WORLDS.flatMap((w) => w.nodes.map((n) => n.panorama));
  expect(new Set(all).size).toBe(all.length);
});

describe('yawFromImageX', () => {
  // Pinned against what the viewer actually shows: facing yaw 0 frames what
  // sits at the middle of the panorama.
  it('puts the middle of the image at yaw 0', () => {
    expect(yawFromImageX(0.5)).toBe(0);
  });

  it('puts the wrap seam half a turn away, not at yaw 0', () => {
    expect(yawFromImageX(0)).toBeCloseTo(-Math.PI, 10);
    expect(yawFromImageX(1)).toBeCloseTo(Math.PI, 10);
  });

  it('spans exactly one turn across the image', () => {
    expect(yawFromImageX(1) - yawFromImageX(0)).toBeCloseTo(2 * Math.PI, 10);
  });
});

describe('availableNodes', () => {
  const nodes = WORLDS[0].nodes;

  it('keeps only nodes that are ready', () => {
    const result = availableNodes(nodes, ['plaza', 'market-street']);
    expect(result.map((n) => n.id)).toEqual(['plaza', 'market-street']);
  });

  it('drops arrows pointing at nodes that have no panorama yet', () => {
    const result = availableNodes(nodes, ['plaza', 'market-street']);
    expect(result.find((n) => n.id === 'plaza')?.links.map((l) => l.nodeId)).toEqual([
      'market-street',
    ]);
  });

  it('leaves the full graph untouched', () => {
    availableNodes(nodes, ['plaza']);
    expect(nodes.find((n) => n.id === 'plaza')?.links).toHaveLength(3);
  });
});
