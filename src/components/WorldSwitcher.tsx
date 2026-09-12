import type { World } from '@/data/world.ts';
import { cn } from '@/lib/utils.ts';

type Props = {
  worlds: World[];
  currentId: string;
  onSelect: (world: World) => void;
};

/** Top-right segmented control for hopping between towns. */
export function WorldSwitcher({ worlds, currentId, onSelect }: Props) {
  return (
    <div className="absolute top-4 right-4 flex gap-1 rounded-full bg-white/95 p-1 shadow-lg">
      {worlds.map((world) => {
        const active = world.id === currentId;
        return (
          <button
            key={world.id}
            type="button"
            aria-pressed={active}
            onClick={() => !active && onSelect(world)}
            className={cn(
              'rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
            )}
          >
            {world.label}
          </button>
        );
      })}
    </div>
  );
}
