type Props = {
  name: string;
  line: string;
};

/** Caption that appears when the loop tour faces a resident. */
export function LoopCaption({ name, line }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center px-4">
      <div className="max-w-[min(520px,calc(100vw-2rem))] rounded-2xl bg-black/70 px-5 py-3 text-center shadow-lg backdrop-blur-sm">
        <div className="text-[13px] font-medium tracking-wide text-amber-200/90">{name}</div>
        <div className="mt-1 text-[15px] leading-snug text-white">{line}</div>
      </div>
    </div>
  );
}
