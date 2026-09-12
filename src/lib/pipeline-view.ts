import type { Viewer } from '@photo-sphere-viewer/core';
import { MapPlugin } from '@photo-sphere-viewer/map-plugin';
import { type StageId, stageMapImage, stagePanorama, stageShowsMapLarge } from '../data/pipeline.ts';
import type { World } from '../data/world.ts';

const SMALL_MAP_ZOOM = 22;
const LARGE_MAP_ZOOM = 58;

const shown = new WeakMap<Viewer, { image: string; large: boolean }>();

export function applyStage(viewer: Viewer, world: World, nodeId: string, stage: StageId) {
  const pipeline = world.pipeline;
  const node = world.nodes.find((n) => n.id === nodeId);
  if (!pipeline || !node) return;

  const map = viewer.getPlugin(MapPlugin) as MapPlugin | undefined;
  if (map) {
    const wanted = { image: stageMapImage(pipeline, stage), large: stageShowsMapLarge(stage) };
    const current = shown.get(viewer) ?? { image: world.mapImage, large: false };
    if (wanted.image !== current.image) map.setImage(wanted.image, node.map);
    if (wanted.large !== current.large) {
      if (wanted.large) {
        map.maximize();
        map.setZoom(LARGE_MAP_ZOOM);
      } else {
        map.minimize();
        map.setZoom(SMALL_MAP_ZOOM);
      }
    }
    shown.set(viewer, wanted);
  }

  const panorama = stagePanorama(pipeline, node, stage);
  if (viewer.config.panorama !== panorama) {
    // Picking the next stage before this one has finished loading is the
    // normal way to use the switcher, and the viewer aborts the load it no
    // longer needs. Catching that is the difference between a working
    // switcher and one that throws on every other click.
    viewer.setPanorama(panorama, { transition: { speed: 600, effect: 'fade' }, showLoader: false }).catch((err) => {
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    });
  }
}
