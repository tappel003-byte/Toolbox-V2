import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Link2 } from "lucide-react";
import { COMMON_SURFACES, OTHER_SENTINEL, formatDelta } from "@/lib/transitions";

/** One ancestor in the active chain, ordered nearest parent → root. */
export interface AncestorOption {
  id: string;
  /** The surface on the "downstream" side of that ancestor (its surfaceB) —
   * the surface you're standing on when you take a raw reading against it. */
  surface: string;
  /** ancestor.readingA − ancestor.readingB. Adding this to a raw reading
   * taken on `surface` yields the base-frame value. */
  delta: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    surfaceA: string;
    surfaceB: string;
    readingA: number; // base-frame (already includes parentDelta if chained)
    readingB: number;
    readingARawOnParent?: number; // what the user typed, if chained
    /** Chosen ancestor id when chaining; undefined for a fresh (unchained) transition. */
    parentId?: string;
  }) => void;
  /** Ancestors of the currently-active transition (nearest parent first, root last).
   * When non-empty, the sheet enters "chained" mode and lets the user pick which
   * ancestor to branch from — matches the real hub/branch flow in the field. */
  ancestors?: AncestorOption[];
  /** Project-scoped custom surface names, shown in both dropdowns. */
  customSurfaces?: string[];
  /** Persists a newly typed custom surface name onto the project. */
  onAddCustomSurface?: (name: string) => void;
}

/**
 * Sheet for creating a flooring transition. User picks two surfaces and
 * enters both raw readings taken at the doorway. When ancestors are provided,
 * Reading A is a raw reading on the *selected* ancestor's surface and is
 * converted to base-frame using that ancestor's stored delta.
 */
export function AddTransitionSheet({
  open,
  onClose,
  onSave,
  ancestors,
  customSurfaces,
  onAddCustomSurface,
}: Props) {
  const chained = !!ancestors && ancestors.length > 0;
  const [selectedParentId, setSelectedParentId] = useState<string>("");
  const [surfaceA, setSurfaceA] = useState<string>("Tile");
  const [surfaceB, setSurfaceB] = useState<string>("Carpet/slab");
  const [readingA, setReadingA] = useState<string>("");
  const [readingB, setReadingB] = useState<string>("");
  // Custom-text buffers for the "Other" option. When non-empty, the actual
  // stored surface string is the typed label.
  const [otherA, setOtherA] = useState<string>("");
  const [otherB, setOtherB] = useState<string>("");
  const [isOtherA, setIsOtherA] = useState<boolean>(false);
  const [isOtherB, setIsOtherB] = useState<boolean>(false);

  // Dedupe ancestors by surface so the picker isn't cluttered when two
  // ancestors happen to share a surface — we key by id but display by surface.
  const ancestorOptions = useMemo(() => ancestors ?? [], [ancestors]);

  // Built-in surfaces + any project-saved custom names, with "Other" last.
  const surfaceOptions = useMemo(() => {
    const base = COMMON_SURFACES.filter((s) => s !== OTHER_SENTINEL);
    const seen = new Set(base.map((s) => s.toLowerCase()));
    const extras: string[] = [];
    for (const s of customSurfaces ?? []) {
      const clean = s.trim();
      if (!clean || seen.has(clean.toLowerCase())) continue;
      seen.add(clean.toLowerCase());
      extras.push(clean);
    }
    return [...base, ...extras, OTHER_SENTINEL];
  }, [customSurfaces]);

  useEffect(() => {
    if (open) {
      setReadingA("");
      setReadingB("");
      setOtherA("");
      setOtherB("");
      setIsOtherA(false);
      setIsOtherB(false);
      if (chained) {
        // Default to the nearest parent (index 0) — that's the most common case.
        const first = ancestorOptions[0];
        setSelectedParentId(first.id);
        setSurfaceA(first.surface);
      } else {
        setSurfaceA("Tile");
        setSurfaceB("Carpet/slab");
      }
    }
  }, [open, chained, ancestorOptions]);

  if (!open) return null;

  const selectedAncestor = chained
    ? ancestorOptions.find((a) => a.id === selectedParentId) ?? ancestorOptions[0]
    : undefined;
  const parentDelta = selectedAncestor?.delta ?? 0;

  const aRaw = parseFloat(readingA);
  const b = parseFloat(readingB);
  const valid = isFinite(aRaw) && isFinite(b);
  const aBase = valid ? Math.round((aRaw + parentDelta) * 100) / 100 : 0;
  const delta = valid ? aBase - b : 0;

  const effectiveA = isOtherA ? otherA.trim() : surfaceA;
  const effectiveB = isOtherB ? otherB.trim() : surfaceB;
  const surfacesReady = !!effectiveA && !!effectiveB;

  function submit() {
    if (!valid || !surfacesReady) return;
    if (isOtherA) onAddCustomSurface?.(effectiveA);
    if (isOtherB) onAddCustomSurface?.(effectiveB);
    onSave({
      surfaceA: effectiveA,
      surfaceB: effectiveB,
      readingA: aBase,
      readingB: b,
      readingARawOnParent: chained ? aRaw : undefined,
      parentId: selectedAncestor?.id,
    });
  }

  function onPickParent(id: string) {
    setSelectedParentId(id);
    const a = ancestorOptions.find((x) => x.id === id);
    if (a) setSurfaceA(a.surface);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-2xl w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Add Transition
            </div>
            <div className="text-sm font-semibold">Flooring change at this location</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {chained && selectedAncestor && (
          <div className="mb-3 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs flex items-start gap-2">
            <Link2 className="h-3.5 w-3.5 mt-0.5 text-amber-600" />
            <div className="min-w-0">
              <div className="truncate font-medium text-amber-900 dark:text-amber-200">
                Chained from {selectedAncestor.surface} ({formatDelta(parentDelta)}")
              </div>
              <div className="text-amber-800/80 dark:text-amber-200/70">
                Pick which anchor in this chain you're branching from. Reading A is a raw
                reading on that surface; the app converts it to the base datum.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {chained ? "Branch from (chain)" : "From surface (reference)"}
            </span>
            {chained ? (
              <select
                value={selectedParentId}
                onChange={(e) => onPickParent(e.target.value)}
                className="h-10 rounded-md border px-2 bg-background text-sm"
              >
                {ancestorOptions.map((a, i) => (
                  <option key={a.id} value={a.id}>
                    {a.surface}
                    {i === 0 ? " (current)" : i === ancestorOptions.length - 1 ? " (root)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <select
                  value={isOtherA ? OTHER_SENTINEL : surfaceA}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === OTHER_SENTINEL) {
                      setIsOtherA(true);
                    } else {
                      setIsOtherA(false);
                      setSurfaceA(v);
                    }
                  }}
                  className="h-10 rounded-md border px-2 bg-background text-sm"
                >
                  {surfaceOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {isOtherA && (
                  <input
                    type="text"
                    value={otherA}
                    onChange={(e) => setOtherA(e.target.value)}
                    maxLength={20}
                    placeholder="(20 characters max)"
                    className="mt-1 h-9 w-full min-w-0 rounded-md border px-2 bg-background text-sm"
                  />
                )}
              </>
            )}
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted-foreground">To surface (other side)</span>
            <select
              value={isOtherB ? OTHER_SENTINEL : surfaceB}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OTHER_SENTINEL) {
                  setIsOtherB(true);
                } else {
                  setIsOtherB(false);
                  setSurfaceB(v);
                }
              }}
              className="h-10 rounded-md border px-2 bg-background text-sm"
            >
              {surfaceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {isOtherB && (
              <input
                type="text"
                value={otherB}
                onChange={(e) => setOtherB(e.target.value)}
                maxLength={20}
                placeholder="(20 characters max)"
                className="mt-1 h-9 w-full min-w-0 rounded-md border px-2 bg-background text-sm"
              />
            )}
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-xs text-muted-foreground">
              From reading" {chained ? "(raw)" : ""}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={readingA}
              onChange={(e) => setReadingA(e.target.value)}
              placeholder="0.0"
              className="h-12 rounded-md border px-3 text-lg font-mono tabular-nums text-right bg-background placeholder:text-muted-foreground/25"
              autoFocus
            />
            {chained && valid && (
              <span className="text-[10px] text-muted-foreground font-mono">
                = {aBase.toFixed(2)}" corrected
              </span>
            )}
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-xs text-muted-foreground">To reading" (raw)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={readingB}
              onChange={(e) => setReadingB(e.target.value)}
              placeholder="0.0"
              className="h-12 rounded-md border px-3 text-lg font-mono tabular-nums text-right bg-background placeholder:text-muted-foreground/25"
            />
          </label>
        </div>

        <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-sm flex items-center justify-between">
          <span className="text-muted-foreground">
            Correction
          </span>
          <span className="font-mono tabular-nums font-semibold">
            {valid ? `${formatDelta(delta)}"` : "—"}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Plots a diamond anchor. Subsequent readings display as{" "}
          <span className="font-mono">raw {formatDelta(delta || 0.4)}</span>.
        </p>


        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || !surfacesReady}>
            Save transition
          </Button>
        </div>
      </div>
    </div>
  );
}
