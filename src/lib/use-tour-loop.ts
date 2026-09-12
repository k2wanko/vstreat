import type { Viewer } from '@photo-sphere-viewer/core';
import { VirtualTourPlugin } from '@photo-sphere-viewer/virtual-tour-plugin';
import { useEffect, useRef } from 'react';
import type { LoopBeat } from '../data/loop-script.ts';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });

async function waitForNode(viewer: Viewer, nodeId: string, signal: AbortSignal) {
  const tour = viewer.getPlugin(VirtualTourPlugin) as VirtualTourPlugin;
  if (tour.getCurrentNode()?.id === nodeId) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    const onChange = (e: { node: { id: string } }) => {
      if (e.node.id !== nodeId) return;
      cleanup();
      // Give the fade / rotate-to a moment to finish before we animate again.
      setTimeout(resolve, 900);
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      tour.removeEventListener('node-changed', onChange as never);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    tour.addEventListener('node-changed', onChange as never);
    tour.setCurrentNode(nodeId);
  });
}

async function lookAt(
  viewer: Viewer,
  beat: Pick<LoopBeat, 'yaw' | 'pitch'>,
  speed: string | number,
  signal: AbortSignal,
) {
  if (beat.yaw === undefined && beat.pitch === undefined) return;
  const animation = viewer.animate({
    yaw: beat.yaw !== undefined ? `${beat.yaw}deg` : undefined,
    pitch: `${beat.pitch ?? 0}deg`,
    speed,
  });
  // The watchdog loses the race whenever the animation finishes normally, and
  // then nothing is awaiting it: without the catch, aborting the loop rejects
  // it into an unhandled AbortError on the page.
  const watchdog = sleep(60_000, signal).then(
    () => animation.cancel(),
    () => {},
  );
  await Promise.race([animation, watchdog]);
}

/**
 * Drives the viewer through a loop script forever. Abort by unmounting or by
 * passing a null viewer.
 */
export function useTourLoop(viewer: Viewer | null, script: LoopBeat[] | null, onBeat?: (beat: LoopBeat) => void) {
  const onBeatRef = useRef(onBeat);
  onBeatRef.current = onBeat;

  useEffect(() => {
    if (!viewer || !script?.length) return;
    const ac = new AbortController();
    const { signal } = ac;

    (async () => {
      try {
        // Let the opening panorama settle before the first move.
        await sleep(1200, signal);
        while (!signal.aborted) {
          for (const beat of script) {
            await waitForNode(viewer, beat.nodeId, signal);
            await lookAt(viewer, beat, '3rpm', signal);
            onBeatRef.current?.(beat);
            if (beat.panTo) {
              // Hold a beat, then pan; remaining hold covers the pan itself.
              const before = Math.min(1200, beat.holdMs);
              await sleep(before, signal);
              await lookAt(
                viewer,
                { yaw: beat.panTo.yaw, pitch: beat.panTo.pitch ?? beat.pitch },
                beat.panTo.durationMs,
                signal,
              );
              const rest = beat.holdMs - before;
              if (rest > 0) await sleep(rest, signal);
            } else {
              await sleep(beat.holdMs, signal);
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        throw err;
      }
    })();

    return () => ac.abort();
  }, [viewer, script]);
}
