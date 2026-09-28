"use client";

export default function CommentPin({
  x,
  y,
  number,
  active,
  resolved,
  onClick,
}: {
  x: number;
  y: number;
  number: number;
  active: boolean;
  resolved?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Comment ${number}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      className={`absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[11px] font-bold shadow transition ${
        active
          ? "border-teal-700 bg-teal-600 text-white scale-125"
          : resolved
          ? "border-[#8b8676] bg-white text-[#8b8676]"
          : "border-coral-600 bg-coral-600 text-white hover:scale-110"
      }`}
    >
      {number}
    </button>
  );
}
