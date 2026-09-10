import { useEffect, useMemo, useRef, useState } from "react";

type SizeTier = "sm" | "md" | "lg";
/** Auto tier heights in px (used when the user has not chosen a size). */
const TIER_HEIGHT: Record<SizeTier, number> = { sm: 24, md: 32, lg: 40 };
function pickTier(w: number): SizeTier {
  if (w >= 1280) return "lg";
  if (w >= 768) return "md";
  return "sm";
}

/** localStorage key holding the user's chosen chip height in px. */
export const STATS_CHIP_SIZE_KEY = "stats-chip-size";
export const STATS_CHIP_SIZE_EVENT = "stats-chip-size-change";
export const STATS_CHIP_MIN = 20;
export const STATS_CHIP_MAX = 56;

/** Read the user's chosen chip height, or null when unset (auto). */
export function getStatsChipSize(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATS_CHIP_SIZE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Auto height for the current viewport width. */
export function autoStatsChipSize(): number {
  if (typeof window === "undefined") return TIER_HEIGHT.sm;
  return TIER_HEIGHT[pickTier(window.innerWidth)];
}

/** Persist a chip height and notify any mounted chip immediately. */
export function setStatsChipSize(px: number) {
  const n = Math.max(STATS_CHIP_MIN, Math.min(STATS_CHIP_MAX, Math.round(px)));
  try {
    window.localStorage.setItem(STATS_CHIP_SIZE_KEY, String(n));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(STATS_CHIP_SIZE_EVENT, { detail: n }));
}

import type { SurveyPoint } from "@/lib/types";

interface Props {
  points: SurveyPoint[];
  onHighlight?: (point: SurveyPoint) => void;
  storageKey?: string;
  /** Optional area name shown as a leading segment (combined multi-area view). */
  label?: string;
  /** Vertical stacking slot so multiple pills don't overlap. */
  stackIndex?: number;
}

/** Height in px of the top chrome (header + optional floor selector) plus a gap. */
function topChromeHeight() {
  const header = document.querySelector("header");
  const selector = document.querySelector("[data-floor-selector]");
  const h =
    (header?.getBoundingClientRect().height ?? 0) + (selector?.getBoundingClientRect().height ?? 0);
  return h + 4; // 4px gap below chrome
}

/**
 * Floating pill: High / Low / Delta.
 * - Drag anywhere on the chip to move it (5px threshold).
 * - Quick tap on High/Low = highlight that point.
 * - Size follows the viewport width tier unless the user picked a size in
 *   Topo → Labels & layers → "Stats pill size" (persisted in localStorage).
 * - Position persists per storageKey and clamps to viewport on resize/rotate.
 */
export function StatsChip({
  points,
  onHighlight,
  storageKey = "stats-chip-pos",
  label,
  stackIndex = 0,
}: Props) {
  const stats = useMemo(() => {
    if (points.length === 0) return null;
    let hi = points[0];
    let lo = points[0];
    for (const p of points) {
      if (p.value > hi.value) hi = p;
      if (p.value < lo.value) lo = p;
    }
    return { hi, lo, delta: hi.value - lo.value };
  }, [points]);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return null;
  });

  // User-chosen height (px) wins over the automatic width tier.
  const [userSize, setUserSize] = useState<number | null>(null);
  const [autoSize, setAutoSize] = useState<number>(TIER_HEIGHT.sm);
  useEffect(() => {
    setUserSize(getStatsChipSize());
    setAutoSize(autoStatsChipSize());
    const onResize = () => setAutoSize(autoStatsChipSize());
    const onSize = (e: Event) => setUserSize((e as CustomEvent<number>).detail);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener(STATS_CHIP_SIZE_EVENT, onSize as EventListener);
    };
  }, []);

  const height = userSize ?? autoSize;
  const fontPx = Math.max(9, Math.round(height * 0.42));
  const padPx = Math.max(4, Math.round(height * 0.22));

  // Default: bottom center, above the bottom pill row. Persisted position wins.
  useEffect(() => {
    if (pos) return;
    const w = ref.current?.offsetWidth ?? 180;
    const h = ref.current?.offsetHeight ?? 24;
    const top = topChromeHeight();
    setPos({
      x: Math.max(8, window.innerWidth / 2 - w / 2),
      y: Math.max(top, window.innerHeight - h - 80),
    });
  }, [pos]);

  // Clamp on resize / rotation.
  useEffect(() => {
    const clamp = () => {
      setPos((p) => {
        if (!p || !ref.current) return p;
        const w = ref.current.offsetWidth;
        const h = ref.current.offsetHeight;
        const top = topChromeHeight();
        const x = Math.min(Math.max(4, p.x), window.innerWidth - w - 4);
        const y = Math.min(Math.max(top, p.y), window.innerHeight - h - 60);
        return x === p.x && y === p.y ? p : { x, y };
      });
    };
    window.addEventListener("resize", clamp);
    window.addEventListener("orientationchange", clamp);
    return () => {
      window.removeEventListener("resize", clamp);
      window.removeEventListener("orientationchange", clamp);
    };
  }, []);

  const drag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      pointerId: e.pointerId,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    const w = ref.current?.offsetWidth ?? 0;
    const h = ref.current?.offsetHeight ?? 0;
    const top = topChromeHeight();
    const x = Math.min(Math.max(4, d.originX + dx), window.innerWidth - w - 4);
    const y = Math.min(Math.max(top, d.originY + dy), window.innerHeight - h - 4);
    setPos({ x, y });
  };
  const endDrag = (e: React.PointerEvent, target?: "hi" | "lo") => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(pos));
      } catch {
        /* ignore */
      }
      return;
    }
    if (target && stats) onHighlight?.(target === "hi" ? stats.hi : stats.lo);
  };

  if (!stats || !pos) {
    return (
      <div
        ref={ref}
        className="fixed pointer-events-none opacity-0"
        style={{ left: -9999, top: -9999 }}
      />
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-40 flex items-stretch rounded-full bg-white/95 backdrop-blur shadow-sm border border-gray-300 overflow-hidden font-medium tabular-nums select-none touch-none cursor-grab active:cursor-grabbing"
      style={{
        left: pos.x,
        top: pos.y + stackIndex * (height + 6),
        height,
        fontSize: fontPx,
        lineHeight: 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e)}
      aria-label="Elevation stats — drag to move"
    >
      {label && (
        <div
          className="flex items-center border-r border-gray-200 text-gray-500 max-w-[8rem] truncate"
          style={{ paddingLeft: padPx, paddingRight: padPx }}
        >
          {label}
        </div>
      )}
      <div
        className="flex items-center gap-0.5 text-gray-700"
        style={{ paddingLeft: padPx, paddingRight: padPx }}
        onPointerUp={(e) => endDrag(e, "hi")}
      >
        {/* Same red as the High pin marker on the plan (#b51d16). */}
        <span className="font-semibold" style={{ color: "#b51d16" }}>
          H
        </span>
        <span className="font-mono">{stats.hi.value.toFixed(2)}</span>
      </div>
      <div
        className="flex items-center gap-0.5 border-l border-gray-200 text-gray-700"
        style={{ paddingLeft: padPx, paddingRight: padPx }}
        onPointerUp={(e) => endDrag(e, "lo")}
      >
        <span className="font-semibold text-sky-600">L</span>
        <span className="font-mono">{stats.lo.value.toFixed(2)}</span>
      </div>
      <div
        className="flex items-center gap-0.5 border-l border-gray-200 text-gray-500"
        style={{ paddingLeft: padPx, paddingRight: padPx }}
      >
        <span className="font-mono">Δ{stats.delta.toFixed(2)}</span>
      </div>
    </div>
  );
}
