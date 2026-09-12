import type { MarkerConfig } from '@photo-sphere-viewer/markers-plugin';
import type { CharacterPresence } from '../data/characters.ts';

/**
 * Size follows from where the feet stand, so the figure and its ground
 * position can never contradict each other — that contradiction is what
 * makes an overlay read as a sticker instead of a person.
 *
 * PSV imageLayer geometry: a plane of world height size/100 on a sphere of
 * radius 10, so marker size in px ≈ subtended angle in radians × 1000.
 * With the camera eye at EYE metres, feet at pitch p stand at ground
 * distance EYE/tan(-p); a figure `standing` metres tall then subtends
 * (atan((standing - EYE) / d) - p) radians, which also holds for a seated
 * man or a cat whose top sits below the eye.
 */
const EYE = 1.5;
const STANDING_HEIGHT = 1.7;
/** Slight stage presence; depth (pitch) is the knob for "closer", not this. */
const PRESENCE = 1.1;
/** All sprites share the 1024x1536 tachie canvas. */
const SPRITE_ASPECT = 1024 / 1536;

export function characterSize(pitch: number, standing = STANDING_HEIGHT): { width: number; height: number } {
  const d = EYE / Math.tan(-pitch);
  const top = Math.atan((standing - EYE) / d);
  const height = Math.round(1000 * (top - pitch) * PRESENCE);
  return { width: Math.round(height * SPRITE_ASPECT), height };
}

/** Turn a resident into a MarkersPlugin image marker. */
export function characterMarker(character: CharacterPresence): MarkerConfig {
  return {
    id: `character:${character.id}`,
    // imageLayer, not image: a DOM marker keeps its pixel size as the camera
    // zooms, so the figure reads as a sticker on the screen. A layer is a
    // textured plane inside the sphere — it grows and shrinks with the scene.
    imageLayer: character.sprite,
    position: { yaw: character.yaw, pitch: character.pitch },
    size: characterSize(character.pitch, character.height),
    // Feet on the ground point; the figure rises above it.
    anchor: 'bottom center',
    opacity: 1,
    // Keep the list / panel clean — these are residents, not hotspots.
    hideList: true,
    tooltip: {
      content: character.name,
      position: 'top center',
      trigger: 'hover',
    },
    data: { characterId: character.id },
  };
}
