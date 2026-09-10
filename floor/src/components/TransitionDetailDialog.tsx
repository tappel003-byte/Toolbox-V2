import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, X, Minus, Maximize2 } from "lucide-react";
import { COMMON_SURFACES, OTHER_SENTINEL, formatDelta } from "@/lib/transitions";
import type { Transition } from "@/lib/types";

interface Props {
  open: boolean;
  transition: Transition | null;
  downstreamCount: number;
  onClose: () => void;
  onSave: (t: Transition) => void;
  onDelete: () => void;
  /** Optional anchor-relative placement. When omitted, floats bottom-center. */
  positionScreen?: { left: number; top: number };
}

/** Dialog opened when the diamond anchor is tapped. Edit readings/surfaces or delete. */
export function TransitionDetailDialog({
  open,
  transition,
  downstreamCount,
  onClose,
  onSave,
  onDelete,
  positionScreen,
}: Props) {
  const [surfaceA, setSurfaceA] = useState("");
  const [surfaceB, setSurfaceB] = useState("");
  const [readingA, setReadingA] = useState("");
  const [readingB, setReadingB] = useState("");
  const [overrideDelta, setOverrideDelta] = useState<number | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open && transition) {
      setSurfaceA(transition.surfaceA);
      setSurfaceB(transition.surfaceB);
      setReadingA(String(transition.readingA));
      setReadingB(String(transition.readingB));
      setOverrideDelta(
        transition.manualDeltaOverride !== undefined ? transition.manualDeltaOverride : null,
      );
      setMinimized(false);
      setConfirmDelete(false);
    }
  }, [open, transition]);

  if (!open || !transition) return null;

  const a = parseFloat(readingA);
  const b = parseFloat(readingB);
  const valid = isFinite(a) && isFinite(b);
  const computedDelta = valid ? a - b : 0;
  const effectiveDelta = overrideDelta !== null ? overrideDelta : computedDelta;
  const isOverridden = overrideDelta !== null;

  function submit() {
    if (!valid || !transition) return;
    onSave({
      ...transition,
      surfaceA,
      surfaceB,
      readingA: a,
      readingB: b,
      manualDeltaOverride: overrideDelta ?? undefined,
    });
  }

  function onReadingAChange(v: string) {
    setReadingA(v);
    setOverrideDelta(null);
  }
  function onReadingBChange(v: string) {
    setReadingB(v);
    setOverrideDelta(null);
  }

  if (minimized) {
    const deltaLabel = formatDelta(effectiveDelta);
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border bg-background shadow-lg pl-3 pr-1 h-9">
          <button
            onClick={() => setMinimized(false)}
            className="flex items-center gap-1.5 text-xs font-medium"
            aria-label="Expand transition"
          >
            <span className="text-muted-foreground">{transition.surfaceB} correction</span>
            <span className={`font-mono font-semibold ${isOverridden ? "text-destructive" : ""}`}>{deltaLabel}"</span>
          </button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMinimized(false)} aria-label="Expand">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  function nudgeDelta(step: number) {
    const base = overrideDelta !== null ? overrideDelta : computedDelta;
    const next = Math.round((base + step) * 100) / 100;
    if (valid && Math.abs(next - computedDelta) < 0.005) {
      setOverrideDelta(null);
    } else {
      setOverrideDelta(next);
    }
  }


  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
      <div className="w-[min(20rem,calc(100vw-1rem))] pointer-events-none">

      <div
        className="bg-background rounded-xl shadow-2xl border p-4 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Transition
            </div>
            <div className="text-sm font-semibold">Anchor reference point</div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setMinimized(true)} aria-label="Minimize">
              <Minus className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Derive "custom / Other" state from whether the current surface
            string is in the built-in list. Anything else is a user-typed
            label — show the text input for direct editing. */}
        <div className="grid grid-cols-2 gap-3">
          {(["A", "B"] as const).map((side) => {
            const value = side === "A" ? surfaceA : surfaceB;
            const setValue = side === "A" ? setSurfaceA : setSurfaceB;
            const builtIn = (COMMON_SURFACES as readonly string[]).includes(value);
            const isOther = !builtIn && value !== "";
            const selectValue = isOther ? OTHER_SENTINEL : value;
            return (
              <label key={side} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  {side === "A" ? "From surface" : "To surface"}
                </span>
                <select
                  value={selectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === OTHER_SENTINEL) {
                      // Preserve existing custom text if already custom; else blank.
                      setValue(isOther ? value : "");
                    } else {
                      setValue(v);
                    }
                  }}
                  className="h-10 rounded-md border px-2 bg-background text-sm"
                >
                  {COMMON_SURFACES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {selectValue === OTHER_SENTINEL && (
                  <input
                    type="text"
                    value={isOther ? value : ""}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="e.g. Sunroom tile"
                    className="mt-1 h-9 rounded-md border px-2 bg-background text-sm"
                  />
                )}
              </label>
            );
          })}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{surfaceA || "From"} reading"</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={readingA}
              onChange={(e) => onReadingAChange(e.target.value)}
              placeholder="0.0"
              className="h-12 rounded-md border px-3 text-lg font-mono tabular-nums text-right bg-background placeholder:text-muted-foreground/25"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{surfaceB || "To"} reading"</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={readingB}
              onChange={(e) => onReadingBChange(e.target.value)}
              placeholder="0.0"
              className="h-12 rounded-md border px-3 text-lg font-mono tabular-nums text-right bg-background placeholder:text-muted-foreground/25"
            />
          </label>
        </div>

        <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-sm flex items-center justify-between">
          <span className="text-muted-foreground">
            {surfaceB || "Surface"} correction
          </span>
          <span className={`font-mono tabular-nums font-semibold ${isOverridden ? "text-destructive" : ""}`}>
            {valid || isOverridden ? `${formatDelta(effectiveDelta)}"` : "—"}
          </span>
        </div>

        <div className="mt-2 rounded-md border bg-muted/20 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Manual adjust</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => nudgeDelta(-0.1)} aria-label="Decrease correction 0.1">
              −0.1
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => nudgeDelta(-0.05)} aria-label="Decrease correction 0.05">
              −0.05
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => nudgeDelta(0.05)} aria-label="Increase correction 0.05">
              +0.05
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => nudgeDelta(0.1)} aria-label="Increase correction 0.1">
              +0.1
            </Button>
          </div>
        </div>


        {downstreamCount > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {downstreamCount} downstream point{downstreamCount === 1 ? "" : "s"} reference this
            transition. Editing readings updates all of them.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {confirmDelete ? (
            <div className="flex-1">
              <p className="mb-2 text-xs text-muted-foreground">
                Delete this transition?{" "}
                {downstreamCount} downstream point{downstreamCount === 1 ? "" : "s"} will lose this
                correction and revert to raw readings. To just change the correction amount, edit the
                readings above and tap Save instead.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Edit instead
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  Delete anyway
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (downstreamCount > 0) {
                    setConfirmDelete(true);
                  } else {
                    onDelete();
                  }
                }}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={!valid}>
                  Save
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

