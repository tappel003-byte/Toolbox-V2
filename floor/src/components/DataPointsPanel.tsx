import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronDown, ChevronUp, X, GripVertical, Database, Minus, Plus } from "lucide-react";
import type { Floor, SurveyPoint } from "@/lib/types";
import { PointDetail } from "@/components/PointDetail";
import { deletePoint, reindexFloorPoints, savePoint } from "@/lib/db";

interface Props {
  projectId: string;
  points: SurveyPoint[];
  /** id → corrected (transition-adjusted) value. When absent for an id, falls back to point.value. */
  correctedById?: Map<string, number>;
  floor?: Floor;
  selectedIds: Set<string>;
  onSelect: (id: string, additive?: boolean) => void;
  onPointsChange: (points: SurveyPoint[]) => void;
  pointSize: number;
  onPointSizeChange: (n: number) => void;
  pointColor: string;
  onPointColorChange: (c: string) => void;
  labelFontSize: number;
  onLabelFontSizeChange: (n: number) => void;
  onCommit?: (points: SurveyPoint[]) => void;
  hasFloorSelector?: boolean;
}



const COLOR_PRESETS = ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#7c3aed", "#111827"];

type SortMode = "index" | "desc" | "asc";

interface PanelState {
  x: number;
  y: number;
  collapsed: boolean;
  hidden: boolean;
  sortMode?: SortMode;
}

function nextSortMode(m: SortMode): SortMode {
  if (m === "index") return "desc";
  if (m === "desc") return "asc";
  return "index";
}

function loadState(projectId: string): PanelState {
  const defaults: PanelState = { x: 8, y: 52, collapsed: true, hidden: true, sortMode: "index" };
  try {
    const raw = localStorage.getItem(`dpp:${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelState>;
      return { ...defaults, ...parsed, hidden: true };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function DataPointsPanel({
  projectId,
  points,
  correctedById,
  floor,
  selectedIds,
  onSelect,
  onPointsChange,
  pointSize,
  onPointSizeChange,
  pointColor,
  onPointColorChange,
  labelFontSize,
  onLabelFontSizeChange,
  onCommit,
  hasFloorSelector,
}: Props) {
  const [state, setState] = useState<PanelState>(() => loadState(projectId));
  const [detailId, setDetailId] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  // Track landscape-short reactively so rotation repositions the panel
  // without a remount. Same media query the chip's Tailwind variant uses.
  const [isLandscapeShort, setIsLandscapeShort] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches
      : false,
  );
  const portraitPositionRef = useRef<{ x: number; y: number }>({ x: state.x, y: state.y });
  const wasLandscapeShortRef = useRef(isLandscapeShort);

  const displayValue = (p: SurveyPoint) => correctedById?.get(p.id) ?? p.value;

  const sortMode = state.sortMode ?? "index";
  const sortedPoints = useMemo(() => {
    const list = [...points];
    if (sortMode === "index") return list.sort((a, b) => a.index - b.index);
    if (sortMode === "desc") return list.sort((a, b) => displayValue(b) - displayValue(a));
    return list.sort((a, b) => displayValue(a) - displayValue(b));
  }, [points, sortMode, correctedById]);


  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const next = loadState(projectId);
    portraitPositionRef.current = { x: next.x, y: next.y };
    setState(next);
  }, [projectId]);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 500px)");
    const on = () => setIsLandscapeShort(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  useEffect(() => {
    if (!isLandscapeShort) {
      if (wasLandscapeShortRef.current) {
        const { x, y } = portraitPositionRef.current;
        setState((s) => ({ ...s, x, y }));
      } else {
        portraitPositionRef.current = { x: state.x, y: state.y };
      }
    }
    wasLandscapeShortRef.current = isLandscapeShort;
  }, [isLandscapeShort, state.x, state.y]);

  useEffect(() => {
    try {
      localStorage.setItem(`dpp:${projectId}`, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, projectId]);

  useEffect(() => {
    const firstId = selectedIds.values().next().value;
    if (!firstId) return;
    const el = rowRefs.current.get(firstId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIds]);

  function onHeaderDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (isLandscapeShort) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { ox: e.clientX, oy: e.clientY, sx: state.x, sy: state.y };
  }
  function onHeaderMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.ox;
    const dy = e.clientY - d.oy;
    const maxX = Math.max(0, window.innerWidth - 200);
    const maxY = Math.max(0, window.innerHeight - 60);
    const nx = Math.max(0, Math.min(maxX, d.sx + dx));
    const ny = Math.max(0, Math.min(maxY, d.sy + dy));
    setState((s) => ({ ...s, x: nx, y: ny }));
  }
  function onHeaderUp() {
    dragRef.current = null;
  }

  const detail = detailId ? (points.find((p) => p.id === detailId) ?? null) : null;

  if (state.hidden) {
    return (
      <button
        onClick={() => setState((s) => ({ ...s, hidden: false }))}
        className="fixed top-[calc(env(safe-area-inset-top)+2.75rem+var(--fs-offset,0rem))] left-[calc(env(safe-area-inset-left)+0.5rem)] landscape-short:top-auto landscape-short:left-1/2 landscape-short:-translate-x-1/2 landscape-short:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 rounded-full bg-white/95 backdrop-blur border border-gray-300 shadow-md h-9 px-3 flex items-center gap-1 text-[11px] font-medium"
        style={{ ["--fs-offset" as any]: hasFloorSelector ? "1.75rem" : "0rem" }}
        aria-label="Show data points"
      >
        <Database className="h-4 w-4" />
      </button>
    );
  }

  const width = 150;
  // In landscape-short, anchor to bottom-right so the panel opens directly
  // above the Database chip and never hides behind the top chrome.
  // In portrait, use the user's stored drag position.
  const posStyle = isLandscapeShort
    ? {
        maxHeight: state.collapsed
          ? undefined
          : "calc(100dvh - max(env(safe-area-inset-top), 1.5rem) - env(safe-area-inset-bottom) - 6rem)",
      }
    : { left: state.x, top: state.y, maxHeight: state.collapsed ? undefined : "38dvh" };

  return (
    <>
      <div
        className={
          "fixed z-40 bg-background border rounded-lg shadow-xl flex flex-col " +
          (isLandscapeShort
            ? "bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] right-[calc(env(safe-area-inset-right)+0.5rem)]"
            : "")
        }
        style={{ width, ...posStyle }}
      >
        <div
          className="flex items-center gap-1 border-b px-2 py-1 cursor-move select-none touch-none"
          onPointerDown={onHeaderDown}
          onPointerMove={onHeaderMove}
          onPointerUp={onHeaderUp}
          onPointerCancel={onHeaderUp}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold flex-1">Data</span>
          <button
            className="p-0.5 hover:bg-muted rounded text-[10px] font-mono w-5"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() =>
              setState((s) => ({ ...s, sortMode: nextSortMode(s.sortMode ?? "index") }))
            }
            aria-label={`Sort: ${sortMode === "index" ? "number" : sortMode === "desc" ? "high to low" : "low to high"}`}
          >
            {sortMode === "index" ? "#" : sortMode === "desc" ? "↓" : "↑"}
          </button>
          <button
            className="p-0.5 hover:bg-muted rounded"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setState((s) => ({ ...s, collapsed: !s.collapsed }))}
            aria-label={state.collapsed ? "Expand" : "Collapse"}
          >
            {state.collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            className="p-0.5 hover:bg-muted rounded"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setState((s) => ({ ...s, hidden: true }))}
            aria-label="Hide"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {!state.collapsed && (
          <>
            <div className="relative px-2 py-1 border-b bg-muted/20 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                  Dot
                </span>
                <button
                  onClick={() => setColorOpen((v) => !v)}
                  className="h-5 w-5 rounded-full border shadow-sm shrink-0"
                  style={{ backgroundColor: pointColor }}
                  aria-label="Dot color"
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40"
                  onClick={() => onPointSizeChange(Math.max(1, pointSize - 1))}
                  disabled={pointSize <= 1}
                  aria-label="Smaller dot"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="text-[10px] font-mono flex-1 text-center tabular-nums">
                  {pointSize}px
                </span>
                <button
                  className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40"
                  onClick={() => onPointSizeChange(Math.min(8, pointSize + 1))}
                  disabled={pointSize >= 8}
                  aria-label="Larger dot"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 w-7">
                  Text
                </span>
                <button
                  className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40"
                  onClick={() => onLabelFontSizeChange(Math.max(6, labelFontSize - 1))}
                  disabled={labelFontSize <= 6}
                  aria-label="Smaller label"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="text-[10px] font-mono flex-1 text-center tabular-nums">
                  {labelFontSize}px
                </span>
                <button
                  className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted disabled:opacity-40"
                  onClick={() => onLabelFontSizeChange(Math.min(28, labelFontSize + 1))}
                  disabled={labelFontSize >= 28}
                  aria-label="Larger label"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              {colorOpen && (
                <div className="absolute z-50 top-full left-0 mt-1 rounded-lg border bg-popover shadow-lg p-2 flex gap-1.5">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        onPointColorChange(c);
                        setColorOpen(false);
                      }}
                      className={
                        "h-6 w-6 rounded-full border-2 " +
                        (c === pointColor ? "border-foreground" : "border-transparent")
                      }
                      style={{ backgroundColor: c }}
                      aria-label={"Color " + c}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-muted/30">
              <span className="w-8">#</span>
              <span className="flex-1">Value</span>
            </div>

            <div
              className="overflow-auto overscroll-contain flex-1"
              style={{ touchAction: "pan-y" }}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {sortedPoints.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground text-center">No points yet</div>
              ) : (
                sortedPoints.map((p) => {
                  const sel = selectedIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(p.id, el);
                        else rowRefs.current.delete(p.id);
                      }}
                      onClick={(e) => {
                        if (e.shiftKey || e.metaKey) {
                          onSelect(p.id, true);
                        } else {
                          onSelect(p.id, false);
                        }
                      }}
                      onDoubleClick={() => setDetailId(p.id)}
                      className={
                        "w-full text-left px-2 py-1.5 text-xs border-b border-border/50 flex items-start gap-1 " +
                        (sel ? "bg-primary/10 text-foreground" : "hover:bg-muted/50")
                      }
                    >
                      <span className="w-8 font-mono text-muted-foreground shrink-0">
                        {p.index}
                      </span>
                      <span className="flex-1 min-w-0">
                        <div className="font-mono tabular-nums">
                          {displayValue(p).toFixed(2)}
                          {p.isBasePoint && (
                            <span className="ml-1.5 text-[9px] uppercase text-green-700">
                              {p.label ?? "BP"}
                            </span>
                          )}
                        </div>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
      {detail && (
        <PointDetail
          key={detail.id}
          point={detail}
          floor={floor}
          onClose={() => setDetailId(null)}
          onSave={async (updated) => {
            await savePoint(updated);
            const next = points.map((x) => (x.id === updated.id ? updated : x));
            onPointsChange(next);
            onCommit?.(next);
          }}
          onReassignTransition={async (pid, tid) => {
            const target = points.find((p) => p.id === pid);
            if (!target) return;
            const updated = { ...target, transitionId: tid ?? undefined };
            await savePoint(updated);
            const next = points.map((x) => (x.id === pid ? updated : x));
            onPointsChange(next);
            onCommit?.(next);
          }}
          onDelete={async () => {
            if (!confirm(`Delete point #${detail.index}?`)) return;
            await deletePoint(detail.id);
            const reindexed = await reindexFloorPoints(detail.floorId);
            onPointsChange(reindexed);
            onCommit?.(reindexed);
            setDetailId(null);
          }}
        />
      )}
    </>
  );
}
