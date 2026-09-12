import { Viewer } from '@photo-sphere-viewer/core';
import { MapPlugin } from '@photo-sphere-viewer/map-plugin';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import {
  VirtualTourPlugin,
  type VirtualTourNode,
  type VirtualTourTransitionOptions,
} from '@photo-sphere-viewer/virtual-tour-plugin';
import { useEffect, useRef } from 'react';
import { charactersAtNode, type Character } from '../data/characters.ts';
import { PIN_IMAGE, type World } from '../data/world.ts';
import { characterMarker } from '../lib/character-marker.ts';

type Props = {
  world: World;
  /** Residents drawn as markers on the current node. Defaults to none. */
  characters?: Character[];
  /** Where to start, when a shared link names a place. Defaults to the world's own. */
  startNodeId?: string;
  /** Where to look on arrival, when a shared link carries a heading. Degrees. */
  initialView?: { yaw: number; pitch: number; zoom: number };
  /** Hide the minimap (used by the exhibit loop). */
  minimalChrome?: boolean;
  /** Keep the minimap even with minimal chrome; the pipeline stages draw on it. */
  keepMap?: boolean;
  onNodeChange?: (nodeId: string) => void;
  /** A resident was clicked. */
  onCharacterSelect?: (characterId: string) => void;
  onReady?: (viewer: Viewer) => void;
};

const BASE_TRANSITION = { showLoader: true, speed: '20rpm', effect: 'fade', rotation: true } as const;

/**
 * Face the way you were walking when you arrive.
 *
 * Left alone, the plugin carries the departing yaw across: it rotates the new
 * panorama to wherever the arrow sat in the *previous* one. That only lands
 * right when both panoramas happen to be oriented the same way in the world.
 * Where they are not, you arrive facing sideways or - between the station and
 * the arcade, whose headings are 180 apart - dead backwards.
 *
 * The destination already knows the way home: its own link back to where we
 * came from. Turning to the opposite of that is, by definition, onward.
 */
function arriveFacingForward(
  toNode: VirtualTourNode,
  fromNode?: VirtualTourNode,
): VirtualTourTransitionOptions {
  if (!fromNode) return { ...BASE_TRANSITION };
  const position = toNode.links?.find((link) => link.nodeId === fromNode.id)?.position;
  // A link position may be spherical or given in texture coordinates, and PSV
  // accepts yaw as '30deg' as well as radians. Ours are always spherical
  // numbers; anything else has no sensible opposite to turn to.
  if (!position || !('yaw' in position) || typeof position.yaw !== 'number') {
    return { ...BASE_TRANSITION };
  }
  return { ...BASE_TRANSITION, rotateTo: { yaw: position.yaw + Math.PI, pitch: 0 } };
}

function faceMapNorth(viewer: Viewer, world: World, nodeId: string) {
  const map = viewer.getPlugin(MapPlugin) as MapPlugin | undefined;
  const heading = world.nodes.find((n) => n.id === nodeId)?.heading ?? 0;
  map?.setOptions({ rotation: `${heading}deg` });
}

function syncCharacterMarkers(
  markers: MarkersPlugin,
  worldId: string,
  nodeId: string,
  characters: Character[],
) {
  const here = charactersAtNode(worldId, nodeId).filter((c) =>
    characters.some((wanted) => wanted.id === c.id),
  );
  markers.setMarkers(here.map(characterMarker));
}

export function StreetViewer({
  world,
  characters = [],
  startNodeId,
  initialView,
  minimalChrome = false,
  keepMap = false,
  onNodeChange,
  onCharacterSelect,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Kept in refs so changing a callback never tears down the WebGL context.
  const onNodeChangeRef = useRef(onNodeChange);
  const onCharacterSelectRef = useRef(onCharacterSelect);
  const onReadyRef = useRef(onReady);
  const charactersRef = useRef(characters);
  onNodeChangeRef.current = onNodeChange;
  onCharacterSelectRef.current = onCharacterSelect;
  onReadyRef.current = onReady;
  charactersRef.current = characters;
  // Only ever read once, at construction: a shared link sets the opening shot,
  // it does not keep dragging the camera back as the visitor looks around.
  const initialViewRef = useRef(initialView);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let viewer: Viewer | null = null;
    let cancelled = false;

    // StrictMode mounts, unmounts and remounts effects immediately. Building the
    // viewer synchronously would create a WebGL context only to destroy it a tick
    // later - and VirtualTourPlugin's init() starts loading the start node
    // synchronously, so tearing it down mid-flight throws inside its promise
    // chain. Deferring past that cycle means one viewer gets built, not two.
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;

      const plugins: ConstructorParameters<typeof Viewer>[0]['plugins'] = [
        MarkersPlugin,
        ...(minimalChrome && !keepMap
          ? []
          : [
              MapPlugin.withConfig({
                imageUrl: world.mapImage,
                size: '200px',
                position: 'bottom left',
                shape: 'square',
                pinImage: PIN_IMAGE,
                pinSize: 28,
                coneColor: 'rgba(66,133,244,0.55)',
                coneSize: 50,
                // North stays up, the cone turns. The plugin takes yaw 0 as north,
                // so each node's heading is added as the map rotation on arrival.
                static: true,
                minimizeOnHotspotClick: false,
                // Zoomed in much past this, neighbouring places fall outside the
                // 200px minimap and there is nothing left to click towards.
                defaultZoom: 22,
              }),
            ]),
        VirtualTourPlugin.withConfig({
          positionMode: 'manual',
          renderMode: '3d',
          nodes: world.nodes,
          startNodeId: startNodeId ?? world.startNodeId,
          // The minimap image and the node coordinates share one space, defined
          // per world. MapPlugin only styles the minimap; this is the option
          // that makes its hotspots actually navigate. Keep it even without the
          // MapPlugin chrome so node.map values stay wired for the tour.
          map: { imageUrl: world.mapImage, size: world.mapSize },
          transitionOptions: arriveFacingForward,
        }),
      ];

      viewer = new Viewer({
        container,
        defaultZoomLvl: 30,
        navbar: false,
        touchmoveTwoFingers: false,
        plugins,
      });

      const tour = viewer.getPlugin(VirtualTourPlugin) as VirtualTourPlugin;
      const markers = viewer.getPlugin(MarkersPlugin) as MarkersPlugin;

      markers.addEventListener('select-marker', ((e: { marker: { data?: { characterId?: string } } }) => {
        const id = e.marker.data?.characterId;
        if (id) onCharacterSelectRef.current?.(id);
      }) as never);

      tour.addEventListener('node-changed', ((e: { node: { id: string } }) => {
        faceMapNorth(viewer as Viewer, world, e.node.id);
        syncCharacterMarkers(markers, world.id, e.node.id, charactersRef.current);
        onNodeChangeRef.current?.(e.node.id);
      }) as never);

      const instance = viewer;
      instance.addEventListener(
        'ready',
        () => {
          // After ready, not before: the tour plugin aims the camera itself as
          // it loads the opening node, and would otherwise overwrite this.
          const opening = initialViewRef.current;
          if (opening) {
            instance.rotate({ yaw: `${opening.yaw}deg`, pitch: `${opening.pitch}deg` });
            instance.zoom(opening.zoom);
          }
          const start = startNodeId ?? world.startNodeId;
          faceMapNorth(instance, world, start);
          syncCharacterMarkers(markers, world.id, start, charactersRef.current);
          onReadyRef.current?.(instance);
        },
        { once: true },
      );

      // Exposed so the panorama gate check can drive yaw/pitch from the browser.
      (window as unknown as { psv?: Viewer }).psv = instance;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      // destroy() also detaches the plugin listeners registered above.
      viewer?.destroy();
      delete (window as unknown as { psv?: Viewer }).psv;
    };
  }, [world, startNodeId, minimalChrome, keepMap]);

  // If the character set changes without rebuilding the viewer, refresh markers
  // for wherever we currently are.
  useEffect(() => {
    const viewer = (window as unknown as { psv?: Viewer }).psv;
    if (!viewer) return;
    const tour = viewer.getPlugin(VirtualTourPlugin) as VirtualTourPlugin | undefined;
    const markers = viewer.getPlugin(MarkersPlugin) as MarkersPlugin | undefined;
    const node = tour?.getCurrentNode?.();
    if (!markers || !node) return;
    syncCharacterMarkers(markers, world.id, node.id, characters);
  }, [characters, world.id]);

  return <div ref={containerRef} className="h-full w-full" />;
}
