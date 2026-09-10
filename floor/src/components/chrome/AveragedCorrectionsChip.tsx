import { useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import type { Floor } from "@/lib/types";
import { categoryLabel, formatDelta, surfaceCategory, transitionGroupKey } from "@/lib/transitions";

interface Props {
  floor: Floor;
  storageKey: string; // per-tab position/collapsed persistence
  onManage: () => void;
}

interface Pos {
  x: number;
  y: number;
}

/**
 * Small draggable status chip that surfaces the fact that averaged flooring
 * corrections are currently applied. Hidden when no group averages exist.
 * Collapsed = pill; tap to expand in place into a compact table.
 */
export function AveragedCorrectionsChip({ floor, storageKey, onManage }: Props) {
  const averages = floor.transitionGroupAverages ?? {};
  const entries = Object.entries(averages);

  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`${storageKey}:expanded`) === "1";
    } catch {
      return false;
    }
  });
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:pos`);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { x: 12, y: 96 };
  });

  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}:expanded`, expanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [expanded, storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}:pos`, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos, storageKey]);

  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: pos.x, oy: pos.y };
    moved.current = false;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
    const nx = Math.max(4, Math.min(window.innerWidth - 40, drag.current.ox + dx));
    const ny = Math.max(4, Math.min(window.innerHeight - 40, drag.current.oy + dy));
    setPos({ x: nx, y: ny });
  }
  function onPointerUp() {
    drag.current = null;
  }

  if (entries.length === 0) return null;

  // Look up display labels from the floor transitions. Group key is now
  // structural (`slab`/`subfloor`/surface name), so show category labels.
  const surfaceForKey = new Map<string, { a: string; b: string }>();
  for (const t of floor.transitions ?? []) {
    surfaceForKey.set(transitionGroupKey(t), {
      a: categoryLabel(surfaceCategory(t.surfaceA)),
      b: categoryLabel(surfaceCategory(t.surfaceB)),
    });
  }

  return (
    <div
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-40 select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={() => {
            if (!moved.current) setExpanded(true);
          }}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-amber-400/70 bg-amber-100/95 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 text-[11px] font-medium shadow-sm hover:bg-amber-200/90"
          aria-label="Averaged corrections used"
        >
          <Flag className="h-3 w-3" />
          <span>Averaged corrections used</span>
          <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-amber-500/90 text-white text-[10px] font-semibold">
            {entries.length}
          </span>
        </button>
      ) : (
        <div
          className="rounded-md border border-amber-400/70 bg-amber-50/95 dark:bg-amber-950/70 shadow-lg min-w-[13rem] max-w-[16rem]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-2.5 h-7 border-b border-amber-300/60">
            <div className="inline-flex items-center gap-1.5 text-amber-900 dark:text-amber-100 text-[11px] font-semibold">
              <Flag className="h-3 w-3" />
              Averaged corrections
            </div>
            <button
              type="button"
              onClick={() => {
                if (!moved.current) setExpanded(false);
              }}
              className="text-[10px] text-amber-900/70 dark:text-amber-100/70 hover:text-amber-900 dark:hover:text-amber-100"
              aria-label="Collapse"
            >
              Hide
            </button>
          </div>
          <ul className="px-2.5 py-1.5 flex flex-col gap-0.5">
            {entries.map(([key, value]) => {
              const s = surfaceForKey.get(key);
              const label = s ? `${s.a} → ${s.b}` : key;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between text-[11px] text-amber-900 dark:text-amber-100 font-mono tabular-nums gap-3"
                >
                  <span className="font-sans truncate">{label}</span>
                  <span className="font-semibold">{formatDelta(value)}"</span>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-amber-300/60 px-2.5 py-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (moved.current) return;
                onManage();
              }}
              className="text-[11px] font-medium text-amber-900 dark:text-amber-100 hover:underline"
            >
              Manage
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
