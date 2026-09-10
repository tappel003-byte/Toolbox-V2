import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronDown, ChevronUp, X, GripVertical, Trash2, RotateCcw } from "lucide-react";
import type { SurveyPoint } from "@/lib/types";

interface Props {
  points: SurveyPoint[];
  excludedIds: Set<string>;
  onToggleExclude: (id: string) => void;
  onRestoreAll: () => void;
  onClose: () => void;
}

type SortMode = "index" | "desc" | "asc";

function nextSortMode(m: SortMode): SortMode {
  if (m === "index") return "desc";
  if (m === "desc") return "asc";
  return "index";
}

export function TopoDiagnosticPanel({
  points,
  excludedIds,
  onToggleExclude,
  onRestoreAll,
  onClose,
}: Props) {
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 8, y: 96 });
  const [collapsed, setCollapsed] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("desc");

  const [isLandscapeShort, setIsLandscapeShort] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 500px)");
    const on = () => setIsLandscapeShort(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const sortedPoints = useMemo(() => {
    const list = [...points];
    if (sortMode === "index") return list.sort((a, b) => a.index - b.index);
    if (sortMode === "desc") return list.sort((a, b) => b.value - a.value);
    return list.sort((a, b) => a.value - b.value);
  }, [points, sortMode]);

  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);

  function onHeaderDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (isLandscapeShort) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { ox: e.clientX, oy: e.clientY, sx: pos.x, sy: pos.y };
  }
  function onHeaderMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.ox;
    const dy = e.clientY - d.oy;
    const maxX = Math.max(0, window.innerWidth - 200);
    const maxY = Math.max(0, window.innerHeight - 60);
    setPos({
      x: Math.max(0, Math.min(maxX, d.sx + dx)),
      y: Math.max(0, Math.min(maxY, d.sy + dy)),
    });
  }
  function onHeaderUp() {
    dragRef.current = null;
  }

  const width = 180;
  const posStyle = isLandscapeShort
    ? {
        maxHeight: collapsed
          ? undefined
          : "calc(100dvh - max(env(safe-area-inset-top), 1.5rem) - env(safe-area-inset-bottom) - 6rem)",
      }
    : { left: pos.x, top: pos.y, maxHeight: collapsed ? undefined : "50dvh" };

  const excludedCount = excludedIds.size;

  return (
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
        <span className="text-[11px] font-semibold flex-1">Diagnostic</span>
        <button
          className="p-0.5 hover:bg-muted rounded text-[10px] font-mono w-5"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setSortMode((m) => nextSortMode(m))}
          aria-label="Sort"
        >
          {sortMode === "index" ? "#" : sortMode === "desc" ? "↓" : "↑"}
        </button>
        <button
          className="p-0.5 hover:bg-muted rounded"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          className="p-0.5 hover:bg-muted rounded"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="px-2 py-1 border-b bg-amber-50/60 flex items-center gap-2">
            <span className="text-[10px] text-amber-900 flex-1">
              {excludedCount === 0
                ? "Tap trash to exclude from contours"
                : `${excludedCount} excluded (view only)`}
            </span>
            {excludedCount > 0 && (
              <button
                onClick={onRestoreAll}
                className="text-[10px] font-medium text-amber-900 hover:underline flex items-center gap-0.5"
                aria-label="Restore all"
              >
                <RotateCcw className="h-3 w-3" />
                Restore
              </button>
            )}
          </div>

          <div className="flex items-center px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-muted/30">
            <span className="w-8">#</span>
            <span className="flex-1">Value</span>
            <span className="w-6" />
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
                const excluded = excludedIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={
                      "w-full text-left px-2 py-1.5 text-xs border-b border-border/50 flex items-center gap-1 " +
                      (excluded ? "opacity-50 bg-muted/40" : "")
                    }
                  >
                    <span className="w-8 font-mono text-muted-foreground shrink-0">
                      {p.index}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={
                          "font-mono tabular-nums " + (excluded ? "line-through" : "")
                        }
                      >
                        {p.value.toFixed(2)}
                      </span>
                      {p.isBasePoint && (
                        <span className="ml-1.5 text-[9px] uppercase text-green-700">
                          {p.label ?? "BP"}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => onToggleExclude(p.id)}
                      className={
                        "h-6 w-6 rounded flex items-center justify-center shrink-0 " +
                        (excluded
                          ? "text-emerald-700 hover:bg-emerald-50"
                          : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive")
                      }
                      aria-label={excluded ? "Restore point" : "Exclude point"}
                    >
                      {excluded ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
