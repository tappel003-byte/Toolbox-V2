import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, X } from "lucide-react";
import type { Floor, SurveyPoint, Transition } from "@/lib/types";
import {
  correctionLabel,
  formatDelta,
  getChainBaselineSurface,
  transitionDelta,
} from "@/lib/transitions";

interface Props {
  point: SurveyPoint;
  floor?: Floor;
  onClose: () => void;
  onSave: (p: SurveyPoint) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  /** Optional: reassign this point to a different transition (or clear it). */
  onReassignTransition?: (pointId: string, transitionId: string | null) => Promise<void> | void;
}

function transitionOptionLabel(t: Transition, averages?: Record<string, number>): string {
  return `${t.surfaceA} → ${t.surfaceB} (${formatDelta(transitionDelta(t, averages))}")`;
}


export function PointDetail({
  point,
  floor,
  onClose,
  onSave,
  onDelete,
  onReassignTransition,
}: Props) {
  const [value, setValue] = useState(String(point.value));
  const [notes, setNotes] = useState(point.notes ?? "");
  const [transitionId, setTransitionId] = useState<string | null>(point.transitionId ?? null);

  useEffect(() => {
    setValue(String(point.value));
    setNotes(point.notes ?? "");
    setTransitionId(point.transitionId ?? null);
  }, [point.id]);

  const transitions = floor?.transitions ?? [];
  const isAnchor = !!point.isTransitionAnchor;
  const activeTransition = useMemo(
    () => (transitionId ? transitions.find((t) => t.id === transitionId) : undefined),
    [transitionId, transitions],
  );
  const showChain = !isAnchor && !!floor && (transitions.length > 0 || !!point.transitionId);
  const baseline = activeTransition
    ? getChainBaselineSurface(activeTransition.id, transitions) ?? activeTransition.surfaceA
    : null;

  const raw = parseFloat(value);
  const validRaw = isFinite(raw);
  const delta = activeTransition ? transitionDelta(activeTransition, floor?.transitionGroupAverages) : 0;
  const corrected = validRaw ? raw + delta : NaN;

  const dirty =
    value !== String(point.value) ||
    notes !== (point.notes ?? "") ||
    transitionId !== (point.transitionId ?? null);

  async function save() {
    if (!validRaw) return;
    // Save raw value + notes first
    await onSave({ ...point, value: raw, notes: notes.trim() });
    // Then reassign transition if it changed and handler provided
    if (
      onReassignTransition &&
      transitionId !== (point.transitionId ?? null) &&
      !isAnchor
    ) {
      await onReassignTransition(point.id, transitionId);
    }
    onClose();
  }

  const rawLabel = activeTransition
    ? `Raw reading on ${activeTransition.surfaceB}`
    : "Elevation";

  return (
    <div className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-sm rounded-lg border bg-popover shadow-lg flex flex-col">
        <div className="flex items-center justify-between px-3 h-9 border-b">
          <span className="text-xs font-semibold">Point #{point.index}</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3 flex flex-col gap-3">
          {showChain && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wide text-amber-900/80 dark:text-amber-200/80 font-semibold">
                Flooring correction
              </div>
              {activeTransition ? (
                <>
                  <div className="text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {correctionLabel(activeTransition.surfaceB)}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatDelta(delta)}"
                    </span>
                  </div>
                  {validRaw && (
                    <div className="text-xs text-amber-900/90 dark:text-amber-200/90 flex items-center justify-between gap-2">
                      <span>Corrected value</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {corrected.toFixed(2)}"
                      </span>
                    </div>
                  )}
                  {baseline && (
                    <div className="text-[10px] italic text-amber-900/70 dark:text-amber-200/70">
                      All corrections resolve back to {baseline}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-amber-900/80 dark:text-amber-200/80">
                  No correction applied — raw reading only.
                </div>
              )}
              {onReassignTransition && transitions.length > 0 && (
                <label className="flex flex-col gap-1 mt-1">
                  <span className="text-[10px] uppercase tracking-wide text-amber-900/70 dark:text-amber-200/70">
                    Change correction
                  </span>
                  <select
                    value={transitionId ?? ""}
                    onChange={(e) => setTransitionId(e.target.value || null)}
                    className="h-9 rounded-md border border-amber-300/60 bg-background px-2 text-xs"
                  >
                    <option value="">None (plain reading)</option>
                    {transitions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {transitionOptionLabel(t, floor?.transitionGroupAverages)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground">{rawLabel}</label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-10 text-right font-mono text-base mt-1"
              autoFocus
            />
            {activeTransition && validRaw && (
              <div className="mt-1 text-[11px] text-muted-foreground font-mono text-right">
                = {corrected.toFixed(2)}" corrected
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Note</label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note…"
              className="text-sm mt-1"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 p-3 border-t">
          <Button size="sm" variant="outline" onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || !validRaw}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
