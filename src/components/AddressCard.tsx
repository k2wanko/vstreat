import { DoorOpen, MapPin } from 'lucide-react';

type Props = {
  name: string;
  caption: string;
  indoor: boolean;
};

/** The Street View location card, top left over the panorama. */
export function AddressCard({ name, caption, indoor }: Props) {
  const Icon = indoor ? DoorOpen : MapPin;

  return (
    <div className="pointer-events-none absolute top-4 left-4 flex max-w-[min(320px,calc(100vw-2rem))] items-start gap-2.5 rounded-xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-neutral-500" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-[15px] leading-tight font-medium text-neutral-900">{name}</div>
        <div className="truncate text-[13px] leading-tight text-neutral-500">{caption}</div>
      </div>
    </div>
  );
}
