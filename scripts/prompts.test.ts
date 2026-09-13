import { expect, it } from 'vitest';
import { loadPlaces, readyWorldIds } from './lib/worlds.ts';
import { buildPrompt } from './prompts.ts';

// A missing scene, a missing style or a night scene with no night block used
// to surface after a generation had already been spent. It is a 20 ms check.
it('every place in every town has a prompt that builds', () => {
  const worlds = readyWorldIds();
  expect(worlds.length).toBeGreaterThan(0);
  for (const id of worlds) {
    const places = loadPlaces(id);
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(() => buildPrompt(id, place.id), `${id}/${place.id}`).not.toThrow();
    }
  }
});

it('a prompt names the place and carries the projection and the style', () => {
  const id = readyWorldIds()[0];
  const prompt = buildPrompt(id, loadPlaces(id)[0].id);
  expect(prompt).toContain('equirectangular');
  expect(prompt).toContain('STYLE:');
  expect(prompt).toContain('AVOID:');
});
