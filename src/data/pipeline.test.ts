import { describe, expect, it } from 'vitest';
import { STAGES, stageMapImage, stagePanorama, stageShowsMapLarge } from './pipeline.ts';
import { WORLDS } from './worlds.ts';

const traced = WORLDS.find((w) => w.pipeline)!;
const pipeline = traced.pipeline!;

describe('pipeline stages', () => {
  it('a traced town carries a blockout for every place', () => {
    for (const node of traced.nodes) {
      expect(pipeline.blockouts[node.id]).toBe(`/worlds/${traced.id}/pipeline/blockouts/${node.id}.jpg`);
    }
    expect(pipeline.massing).toBe(traced.mapImage);
  });

  it('any world that declares a pipeline carries every stage it promises', () => {
    const withPipeline = WORLDS.filter((w) => w.pipeline);
    expect(withPipeline.length).toBeGreaterThan(0);
    for (const world of withPipeline) {
      expect(world.pipeline!.aerial).toBeTruthy();
      expect(world.pipeline!.overlay).toBeTruthy();
      expect(world.pipeline!.massing).toBe(world.mapImage);
      for (const node of world.nodes) expect(world.pipeline!.blockouts[node.id]).toBeTruthy();
    }
  });

  it('the map shows the photo, then the vectors, then the massing', () => {
    expect(STAGES.map((s) => stageMapImage(pipeline, s.id))).toEqual([
      pipeline.aerial,
      pipeline.overlay,
      pipeline.massing,
      pipeline.massing,
    ]);
    expect(STAGES.map((s) => stageShowsMapLarge(s.id))).toEqual([true, true, false, false]);
  });

  it('only the 3D stage replaces the sphere with the massing render', () => {
    const node = traced.nodes[0];
    expect(STAGES.map((s) => stagePanorama(pipeline, node, s.id))).toEqual([
      node.panorama,
      node.panorama,
      pipeline.blockouts[node.id],
      node.panorama,
    ]);
  });
});
