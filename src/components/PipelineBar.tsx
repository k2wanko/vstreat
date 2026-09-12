import { STAGES, type StageId } from '@/data/pipeline.ts';
import { cn } from '@/lib/utils.ts';

type Props = {
  stage: StageId;
  onSelect: (stage: StageId) => void;
  /** Show progress only, as the exhibit loop drives the stages itself. */
  passive?: boolean;
};

export function PipelineBar({ stage, onSelect, passive = false }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-[200] flex flex-col items-center gap-2 px-4">
      <div className={cn('flex items-center gap-1 rounded-full bg-white/95 p-1 shadow-lg', passive ? 'pointer-events-none' : 'pointer-events-auto')}>
        {STAGES.map((s, i) => {
          const active = s.id === stage;
          return (
            <div key={s.id} className="flex items-center">
              {i > 0 && <span className="px-0.5 text-neutral-300">→</span>}
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(s.id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
                )}
              >
                {s.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
