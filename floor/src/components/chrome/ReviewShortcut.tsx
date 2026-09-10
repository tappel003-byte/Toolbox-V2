import type { SurveyPoint } from "@/lib/types";

/**
 * Upper-left tiny card on the Data screen.
 * Shows selected point elevation (or point count) and opens Review on tap.
 */
export function ReviewShortcut({
  points,
  selectedIds,
  onOpen,
}: {
  points: SurveyPoint[];
  selectedIds: Set<string>;
  onOpen: () => void;
}) {
  const selected = points.find((p) => selectedIds.has(p.id));
  const label = selected
    ? selected.value.toFixed(2)
    : `${points.length} pt${points.length === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed z-40 top-11 left-2 h-8 min-w-[3rem] px-2.5 rounded-full bg-background/90 backdrop-blur border shadow-md text-xs font-medium text-foreground hover:bg-accent"
      aria-label="Open review"
    >
      {label}
    </button>
  );
}
