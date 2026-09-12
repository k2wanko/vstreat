import { describe, expect, it } from 'vitest';
import { residentsOf, withYaw } from './characters.ts';
import { DIALOGUES, dialogueFor } from './dialogue.ts';
import { WORLDS } from './worlds.ts';

const RESIDENTS = residentsOf('dragon');

describe('dialogues', () => {
  it('every resident has something to say', () => {
    for (const c of RESIDENTS) expect(dialogueFor(c.id), c.id).toBeDefined();
  });

  it('every script opens, offers choices and says goodbye', () => {
    for (const d of DIALOGUES) {
      expect(d.opening.length, d.characterId).toBeGreaterThan(0);
      expect(d.choices.length, d.characterId).toBeGreaterThanOrEqual(2);
      expect(d.farewell.length, d.characterId).toBeGreaterThan(0);
      expect(new Set(d.choices.map((c) => c.id)).size).toBe(d.choices.length);
    }
  });

  it('no resident stands on a ground arrow', () => {
    for (const c of RESIDENTS) {
      const node = WORLDS.find((w) => w.id === c.worldId)?.nodes.find((n) => n.id === c.nodeId);
      expect(node, `${c.worldId}/${c.nodeId}`).toBeDefined();
      const yaw = withYaw(c).yaw;
      for (const link of node!.links) {
        const d = Math.abs(((link.position.yaw - yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(d, `${c.id} vs arrow to ${link.nodeId}`).toBeGreaterThan(Math.PI / 12);
      }
    }
  });
});
