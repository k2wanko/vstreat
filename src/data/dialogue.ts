export type Line = { speaker: string; text: string };

export type Choice = { id: string; label: string; lines: Line[] };

export type Dialogue = {
  characterId: string;
  /** Who this person is, for a model that continues the conversation. */
  persona: string;
  opening: Line[];
  choices: Choice[];
  farewell: Line[];
};

/** One script per resident, beside the town they live in. */
export const DIALOGUES: Dialogue[] = Object.values(
  import.meta.glob('../../worlds/*/dialogue/*.json', { eager: true, import: 'default' }) as Record<string, Dialogue>,
);

export function dialogueFor(characterId: string): Dialogue | undefined {
  return DIALOGUES.find((d) => d.characterId === characterId);
}
