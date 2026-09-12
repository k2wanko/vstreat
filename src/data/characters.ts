import { yawFromImageX } from './world.ts';

/**
 * AI residents of a world. They are a separate layer from the panoramas:
 * each one stands at a spherical position inside one node, drawn as a marker
 * rather than baked into the generated image.
 *
 * `at` uses the same image-fraction convention as tour links, so placements
 * can be read off a panorama against the same ruler.
 */

export type Character = {
  id: string;
  worldId: string;
  nodeId: string;
  name: string;
  /** One-line caption shown when the loop tour faces them. */
  line: string;
  sprite: string;
  /** Horizontal position in the panorama image, 0 = left edge, 1 = right. */
  at: number;
  /** Radians; 0 is the horizon. Feet pitch — also determines size (see character-marker). */
  pitch: number;
  /** Metres from feet to the top of the sprite; a standing adult when omitted. */
  height?: number;
};

export type CharacterPresence = Character & {
  yaw: number;
};

export function withYaw(character: Character): CharacterPresence {
  return { ...character, yaw: yawFromImageX(character.at) };
}

/**
 * Residents are declared beside their town, and their sprite is named after
 * them, so adding one is a JSON file and a PNG.
 */
type ResidentSpec = Omit<Character, 'worldId' | 'sprite'>;

const RESIDENTS: Character[] = Object.entries(
  import.meta.glob('../../worlds/*/characters.json', { eager: true, import: 'default' }) as Record<
    string,
    ResidentSpec[]
  >,
).flatMap(([path, specs]) => {
  const worldId = path.split('/')[3];
  return specs.map((spec) => ({ ...spec, worldId, sprite: `/worlds/${worldId}/characters/${spec.id}.png` }));
});

export const residentsOf = (worldId: string): Character[] => RESIDENTS.filter((c) => c.worldId === worldId);

export function charactersInWorld(worldId: string): Character[] {
  return RESIDENTS.filter((c) => c.worldId === worldId);
}

export function charactersAtNode(worldId: string, nodeId: string): CharacterPresence[] {
  return charactersInWorld(worldId)
    .filter((c) => c.nodeId === nodeId)
    .map(withYaw);
}
