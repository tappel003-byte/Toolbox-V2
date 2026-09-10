import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Floor, SurveyPoint } from "@/lib/types";
import {
  formatDelta,
  groupTransitionsBySurfacePair,
  type TransitionGroup,
} from "@/lib/transitions";

interface Props {
  open: boolean;
  floor: Floor;
  points: readonly SurveyPoint[];
  onClose: () => void;
  onFloorChange: (f: Floor) => void | Promise<void>;
}

export function TransitionsSheet({ open, floor, points, onClose, onFloorChange }: Props) {
  const groups = useMemo(
    () => groupTransitionsBySurfacePair(floor.transitions, points),
    [floor.transitions, points],
  );
  const averages = floor.transitionGroupAverages ?? {};

  if (!open) return null;

  async function setAverage(g: TransitionGroup, value: number | null) {
    const next = { ...(floor.transitionGroupAverages ?? {}) };
    if (value === null) delete next[g.key];
    else next[g.key] = value;
    const useFlag = value !== null;
    const groupTxIds = new Set(g.transitions.map((t) => t.id));
    const nextTransitions = (floor.transitions ?? []).map((t) =>
      groupTxIds.has(t.id) ? { ...t, useGroupAverage: useFlag } : t,
    );
    const nextFloor: Floor = {
      ...floor,
      transitions: nextTransitions,
      transitionGroupAverages: Object.keys(next).length ? next : undefined,
      updatedAt: Date.now(),
    };
    await onFloorChange(nextFloor);
  }

  const appliedCount = Object.keys(averages).length;

  return (
    <div className="fixed inset-0 z-[70] bg-background/70 backdrop-blur-sm flex items-start justify-center p-2 sm:p-4">
      <div className="w-full max-w-md max-h-[90dvh] flex flex-col rounded-lg border bg-popover shadow-xl">
        <div className="flex items-center justify-between px-3 h-10 border-b">
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Transitions</span>
            <span className="text-[10px] text-muted-foreground">
              {groups.length} surface pair{groups.length === 1 ? "" : "s"}
              {appliedCount > 0 && ` · ${appliedCount} averaged`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-3">
          {groups.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">
              No transitions on this floor yet. Add one from the field screen
              when you take a doorway reading.
            </div>
          )}
          {groups.map((g) => {
            const applied = averages[g.key];
            const isApplied = applied !== undefined;
            const canAverage = g.transitions.length >= 2;
            return (
              <div
                key={g.key}
                className={
                  "rounded-md border p-3 flex flex-col gap-2 " +
                  (isApplied
                    ? "border-amber-400/70 bg-amber-50/70 dark:bg-amber-950/30"
                    : "bg-background")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">
                    {g.labelA} → {g.labelB}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {g.transitions.length} doorway
                    {g.transitions.length === 1 ? "" : "s"} · {g.affectedPointCount} pt
                    {g.affectedPointCount === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="text-xs flex flex-col gap-0.5">
                  {g.transitions.map((t, i) => {
                    const raw = t.readingA - t.readingB;
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 font-mono tabular-nums text-muted-foreground"
                      >
                        <span className="font-sans truncate">
                          Doorway {i + 1} — {t.surfaceA} → {t.surfaceB}
                        </span>
                        <span className="shrink-0">{formatDelta(raw)}"</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between text-xs border-t pt-2">
                  <span className="text-muted-foreground">Measured avg</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {formatDelta(g.measuredAverage)}"
                  </span>
                </div>
                {isApplied && (
                  <div className="flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
                    <span>Applied</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {formatDelta(applied)}"
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  {canAverage ? (
                    <Button
                      size="sm"
                      variant={isApplied ? "outline" : "default"}
                      onClick={() => setAverage(g, g.measuredAverage)}
                      className="flex-1 h-8 text-xs"
                    >
                      {isApplied ? "Re-apply average" : "Apply average"}
                    </Button>
                  ) : (
                    <span className="flex-1 text-[11px] italic text-muted-foreground">
                      Only one doorway — nothing to average.
                    </span>
                  )}
                  {isApplied && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAverage(g, null)}
                      className="h-8 text-xs"
                    >
                      Revert
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t px-3 py-2 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
