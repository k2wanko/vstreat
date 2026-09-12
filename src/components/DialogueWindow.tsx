import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Line } from '@/data/dialogue.ts';
import type { DialogueContext, DialogueProvider, Turn } from '@/lib/dialogue-provider.ts';
import { cn } from '@/lib/utils.ts';

type Props = {
  context: DialogueContext;
  provider: DialogueProvider;
  onClose: () => void;
};

const CHARS_PER_SECOND = 32;

export function DialogueWindow({ context, provider, onClose }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const line = lines[index];
  const typing = line !== undefined && shown < line.text.length;
  const atEnd = line !== undefined && index === lines.length - 1 && !typing;
  const showMenu = turn !== null && !thinking && (lines.length === 0 || atEnd);

  const present = useCallback((next: Turn) => {
    setTurn(next);
    setLines(next.lines);
    setIndex(0);
    setShown(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setThinking(true);
    provider.start(context).then((first) => {
      if (cancelled) return;
      setThinking(false);
      present(first);
    });
    return () => {
      cancelled = true;
    };
  }, [context, provider, present]);

  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => setShown((n) => n + 1), 1000 / CHARS_PER_SECOND);
    return () => clearTimeout(timer);
  }, [typing, shown]);

  const advance = useCallback(() => {
    if (thinking || !line) return;
    if (typing) {
      setShown(line.text.length);
      return;
    }
    if (index < lines.length - 1) {
      setIndex(index + 1);
      setShown(0);
    } else if (turn?.ended) {
      onClose();
    }
  }, [thinking, line, typing, index, lines.length, turn, onClose]);

  const ask = useCallback(
    async (run: () => Promise<Turn>) => {
      setThinking(true);
      setLines([]);
      const next = await run();
      setThinking(false);
      present(next);
    },
    [present],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (document.activeElement === inputRef.current) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, onClose]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void ask(() => provider.say(context, text));
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[210] flex justify-center px-4">
      <div
        role="dialog"
        aria-label={`${context.characterName}との会話`}
        className="pointer-events-auto relative w-full max-w-[760px] rounded-2xl border border-white/15 bg-neutral-950/85 text-white shadow-2xl backdrop-blur-md"
        onClick={advance}
      >
        <div className="absolute -top-4 left-5 rounded-full bg-amber-300 px-4 py-1 text-[13px] font-semibold tracking-wide text-neutral-900 shadow">
          {line?.speaker ?? context.characterName}
        </div>
        <button
          type="button"
          aria-label="会話を閉じる"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute top-3 right-3 rounded-full p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
        <div className="min-h-[96px] px-6 pt-7 pb-5 text-[17px] leading-relaxed">
          {thinking ? (
            <span className="text-neutral-400">……</span>
          ) : line ? (
            <span data-testid="dialogue-text">{line.text.slice(0, shown)}</span>
          ) : null}
          {!thinking && line && !typing && !showMenu && (
            <span className="ml-2 inline-block animate-bounce text-amber-300" aria-hidden>
              ▼
            </span>
          )}
        </div>
        {showMenu && (
          <div className="border-t border-white/10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1.5">
              {turn.choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void ask(() => provider.choose(context, c.id))}
                  className={cn(
                    'rounded-lg px-3 py-2 text-left text-[15px] transition-colors',
                    'bg-white/5 hover:bg-amber-300/20 hover:text-amber-100',
                  )}
                >
                  ▸ {c.label}
                </button>
              ))}
            </div>
            {turn.freeText && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="自由に話しかける"
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-[15px] outline-none placeholder:text-neutral-500 focus:border-amber-300/60"
                />
                <button type="submit" className="rounded-lg bg-amber-300 px-4 py-2 text-[14px] font-semibold text-neutral-900 hover:bg-amber-200">
                  送る
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
