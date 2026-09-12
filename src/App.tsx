import type { Viewer } from '@photo-sphere-viewer/core';
import { VirtualTourPlugin } from '@photo-sphere-viewer/virtual-tour-plugin';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AddressCard } from '@/components/AddressCard.tsx';
import { DialogueWindow } from '@/components/DialogueWindow.tsx';
import { LoopCaption } from '@/components/LoopCaption.tsx';
import { PipelineBar } from '@/components/PipelineBar.tsx';
import { StreetViewer } from '@/components/StreetViewer.tsx';
import { ViewerControls } from '@/components/ViewerControls.tsx';
import { WorldSwitcher } from '@/components/WorldSwitcher.tsx';
import { charactersAtNode, charactersInWorld } from '@/data/characters.ts';
import { dialogueFor } from '@/data/dialogue.ts';
import { loopFor, type LoopBeat } from '@/data/loop-script.ts';
import { DEFAULT_STAGE, STAGES, type StageId } from '@/data/pipeline.ts';
import type { World } from '@/data/world.ts';
import { WORLDS } from '@/data/worlds.ts';
import { parseViewState, sameLink, toDegrees, toSearch, type ViewState } from '@/lib/url-state.ts';
import { cn } from '@/lib/utils.ts';
import { providerFor } from '@/lib/dialogue-provider.ts';
import { applyStage } from '@/lib/pipeline-view.ts';
import { useTourLoop } from '@/lib/use-tour-loop.ts';

/**
 * Resolve the opening view from the link, ignoring anything that names a place
 * that no longer exists - an old link should still open somewhere sensible
 * rather than at a blank screen.
 */
function openingView() {
  const params = new URLSearchParams(window.location.search);
  const loop = params.get('loop') === '1';
  // ?ai=gemma4:e2b hands the residents' replies to a local Ollama model.
  const ai = params.get('ai');
  const wanted = parseViewState(window.location.search);
  // Only towns with a loop script can run the exhibit loop; 竜の街 is the default.
  const world = loop
    ? (WORLDS.find((w) => w.id === wanted.world && loopFor(w.id)) ?? WORLDS.find((w) => w.id === 'dragon') ?? WORLDS[0])
    : (WORLDS.find((w) => w.id === wanted.world) ?? WORLDS[0]);
  const node = world.nodes.find((n) => n.id === wanted.node)?.id ?? world.startNodeId;
  const aimed = wanted.yaw !== undefined || wanted.pitch !== undefined || wanted.zoom !== undefined;
  return {
    loop,
    ai,
    world,
    node,
    view: aimed ? { yaw: wanted.yaw ?? 0, pitch: wanted.pitch ?? 0, zoom: wanted.zoom ?? 30 } : undefined,
  };
}

const OPENING = openingView();

export default function App() {
  const loop = OPENING.loop;
  const [world, setWorld] = useState<World>(OPENING.world);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [currentId, setCurrentId] = useState(OPENING.node);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loopBeat, setLoopBeat] = useState<LoopBeat | null>(null);
  const [stage, setStage] = useState<StageId>(DEFAULT_STAGE);
  const [talkingTo, setTalkingTo] = useState<string | null>(null);
  const [provider] = useState(() => providerFor(OPENING.ai));

  const currentIdRef = useRef(OPENING.node);
  const historyRef = useRef<string[]>([]);
  // Set just before a Back jump so the resulting node-changed is not recorded
  // as a new step, which would make Back bounce between two places forever.
  const backTargetRef = useRef<string | null>(null);
  // Which world the viewer should open at; only changes on a world switch.
  const [startNodeId, setStartNodeId] = useState(OPENING.node);

  const characters = charactersInWorld(world.id);

  const handleNodeChange = useCallback((id: string) => {
    const previous = currentIdRef.current;
    if (backTargetRef.current === id) {
      backTargetRef.current = null;
    } else if (previous !== id) {
      historyRef.current.push(previous);
    }
    currentIdRef.current = id;
    setCurrentId(id);
    setCanGoBack(historyRef.current.length > 0);
  }, []);

  const handleBack = useCallback(() => {
    const target = historyRef.current.pop();
    setCanGoBack(historyRef.current.length > 0);
    if (!target || !viewer) return;
    backTargetRef.current = target;
    (viewer.getPlugin(VirtualTourPlugin) as VirtualTourPlugin).setCurrentNode(target);
  }, [viewer]);

  const handleWorld = useCallback((next: World) => {
    // The other town's history is meaningless here, and the viewer is rebuilt.
    historyRef.current = [];
    backTargetRef.current = null;
    currentIdRef.current = next.startNodeId;
    setCanGoBack(false);
    setCurrentId(next.startNodeId);
    setStartNodeId(next.startNodeId);
    setViewer(null);
    setStage(DEFAULT_STAGE);
    setTalkingTo(null);
    setWorld(next);
  }, []);

  useEffect(() => {
    (window as unknown as { vstreet?: unknown }).vstreet = { talk: (id: string) => setTalkingTo(id) };
    return () => {
      delete (window as unknown as { vstreet?: unknown }).vstreet;
    };
  }, []);

  const handleBeat = useCallback((beat: LoopBeat) => {
    setLoopBeat(beat);
    if (beat.stage) setStage(beat.stage);
  }, []);
  useTourLoop(loop ? viewer : null, loop ? loopFor(world.id) : null, handleBeat);

  useEffect(() => {
    if (!viewer || !world.pipeline) return;
    applyStage(viewer, world, currentId, stage);
  }, [viewer, world, currentId, stage]);

  useEffect(() => {
    if (!world.pipeline || loop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const picked = STAGES[Number(e.key) - 1];
      if (picked) setStage(picked.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [world, loop]);

  // Keep the address bar showing the current view, so it can just be copied.
  // replaceState rather than pushState: the tour has its own Back button, and
  // one history entry per mouse-drag would bury whatever page came before.
  // Skip in loop mode so the exhibit URL stays a stable ?loop=1.
  useEffect(() => {
    if (!viewer || loop) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: ViewState | null = null;

    const write = () => {
      const position = viewer.getPosition();
      const next: ViewState = {
        world: world.id,
        node: currentIdRef.current,
        yaw: toDegrees(position.yaw),
        pitch: toDegrees(position.pitch),
        zoom: viewer.getZoomLevel(),
      };
      if (sameLink(last, next)) return;
      last = next;
      window.history.replaceState(null, '', toSearch(next));
    };

    // Dragging fires continuously; browsers rate-limit replaceState, so settle first.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(write, 350);
    };

    viewer.addEventListener('position-updated', schedule);
    viewer.addEventListener('zoom-updated', schedule);
    schedule();

    return () => {
      clearTimeout(timer);
      viewer.removeEventListener('position-updated', schedule);
      viewer.removeEventListener('zoom-updated', schedule);
    };
  }, [viewer, world, currentId, loop]);

  const current = world.nodes.find((node) => node.id === currentId);
  const residents = charactersAtNode(world.id, currentId);
  const talking = talkingTo ? residents.find((r) => r.id === talkingTo) : undefined;
  const dialogue = talking ? dialogueFor(talking.id) : undefined;
  const conversation =
    talking && dialogue && current ? { world, node: current, characterName: talking.name, dialogue } : null;
  // Loop captions appear only after the beat has looked at the resident, or
  // name the pipeline stage the beat just switched to.
  const stageInfo = STAGES.find((s) => s.id === loopBeat?.stage);
  const showCaption =
    loop && loopBeat?.nodeId === currentId
      ? stageInfo
        ? { name: stageInfo.label, line: stageInfo.hint }
        : residents[0]
      : null;

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-[#202124]', conversation && 'talking')}>
      <StreetViewer
        world={world}
        characters={characters}
        startNodeId={startNodeId}
        initialView={OPENING.view}
        minimalChrome={loop}
        keepMap={Boolean(world.pipeline)}
        onNodeChange={handleNodeChange}
        onCharacterSelect={loop ? undefined : setTalkingTo}
        onReady={setViewer}
      />

      {current && (
        <AddressCard name={current.name} caption={current.caption} indoor={current.indoor} />
      )}
      {showCaption && <LoopCaption name={showCaption.name} line={showCaption.line} />}
      {conversation && <DialogueWindow context={conversation} provider={provider} onClose={() => setTalkingTo(null)} />}
      {world.pipeline && <PipelineBar stage={stage} onSelect={setStage} passive={loop} />}
      {!loop && <WorldSwitcher worlds={WORLDS} currentId={world.id} onSelect={handleWorld} />}
      {!loop && <ViewerControls viewer={viewer} canGoBack={canGoBack} onBack={handleBack} />}
    </div>
  );
}
