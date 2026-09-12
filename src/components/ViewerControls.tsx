import type { Viewer } from '@photo-sphere-viewer/core';
import { ArrowLeft, Check, Link2, Maximize2, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';

type Props = {
  viewer: Viewer | null;
  canGoBack: boolean;
  onBack: () => void;
};

/**
 * Street View stacks zoom and fullscreen bottom right; the back arrow sits
 * top left under the location card.
 */
export function ViewerControls({ viewer, canGoBack, onBack }: Props) {
  const [copied, setCopied] = useState(false);

  // The address bar already carries the current view; this just saves reaching
  // for it, and confirms that something was copied.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the URL is still there to copy by hand.
    }
  };

  return (
    <>
      {canGoBack && (
        <Button
          variant="secondary"
          size="icon-lg"
          aria-label="ひとつ前の場所に戻る"
          onClick={onBack}
          className="absolute top-24 left-4 rounded-full bg-white/95 text-neutral-700 shadow-lg hover:bg-white"
        >
          <ArrowLeft />
        </Button>
      )}

      <div className="absolute right-4 bottom-4 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="icon-lg"
          aria-label={copied ? 'リンクをコピーしました' : 'この景色へのリンクをコピー'}
          onClick={copyLink}
          className="rounded-full bg-white/95 text-neutral-700 shadow-lg hover:bg-white"
        >
          {copied ? <Check className="text-emerald-600" /> : <Link2 />}
        </Button>
        <Button
          variant="secondary"
          size="icon-lg"
          aria-label="全画面表示"
          onClick={() => viewer?.toggleFullscreen()}
          className="rounded-full bg-white/95 text-neutral-700 shadow-lg hover:bg-white"
        >
          <Maximize2 />
        </Button>
        <div className="flex flex-col overflow-hidden rounded-full bg-white/95 shadow-lg">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="ズームイン"
            onClick={() => viewer?.zoomIn(10)}
            className="rounded-none text-neutral-700 hover:bg-neutral-100"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="ズームアウト"
            onClick={() => viewer?.zoomOut(10)}
            className="rounded-none text-neutral-700 hover:bg-neutral-100"
          >
            <Minus />
          </Button>
        </div>
      </div>
    </>
  );
}
