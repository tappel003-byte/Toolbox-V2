import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface CanvasTransform {
  scale: number;
  tx: number;
  ty: number;
}

interface Props {
  planDataUrl?: string;
  planWidth?: number;
  planHeight?: number;
  /** Draw on top of the plan, in image coordinates (transform applied) */
  drawOverlay?: (ctx: CanvasRenderingContext2D) => void;
  /** Draw AFTER the plan raster (when planOnTop). Same coord space. Use for elements that must sit over walls. */
  drawOverlayTop?: (ctx: CanvasRenderingContext2D) => void;
  /** Tap in image coordinates (single-tap, after gestures settle) */
  onTap?: (x: number, y: number) => void;
  /** Optional badge above canvas */
  badge?: React.ReactNode;
  /** Fill space or use fixed height */
  className?: string;
  /** Called on transform change */
  onTransform?: (t: CanvasTransform) => void;
  /** Optional image-space pointer hooks. Return true from down to consume pan/tap. */
  onImagePointerDown?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => boolean;
  onImagePointerMove?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  onImagePointerUp?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Fired when a custom-drag gesture is preempted (e.g. pinch takes over). Consumer should discard drag state without deleting anything. */
  onImagePointerCancel?: (x: number, y: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Plan opacity (only used when planOnTop is false) */
  planOpacity?: number;
  /** Suppress rendering the plan raster (still keeps size) */
  hidePlan?: boolean;
  /** Draw the plan ON TOP of the overlay using multiply blend, so walls stay crisp over color fills */
  planOnTop?: boolean;
  /** When nonce changes, pan (and gently zoom in if too far out) so (x,y) is centered. */
  focusRequest?: { x: number; y: number; nonce: number };
  /** Keep the current pan/zoom when the wrapper changes size, e.g. mobile keyboard. */
  refitOnResize?: boolean;
  /** Optional per-floor plan-image transform (Align mode). Applied to the raster only; points/overlays unchanged. */
  planTransform?: { tx: number; ty: number; scale: number; rotation: number };
}

const IMPLIED_W = 1000;
const IMPLIED_H = 750;

export function PlanCanvas({
  planDataUrl,
  planWidth,
  planHeight,
  drawOverlay,
  drawOverlayTop,
  onTap,
  badge,
  className,
  onTransform,
  onImagePointerDown,
  onImagePointerMove,
  onImagePointerUp,
  onImagePointerCancel,
  planOpacity = 1,
  hidePlan = false,
  planOnTop = false,
  focusRequest,
  refitOnResize = true,
  planTransform,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [transform, setTransform] = useState<CanvasTransform>({ scale: 1, tx: 0, ty: 0 });
  const [canvasSizeTick, setCanvasSizeTick] = useState(0);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const onTransformRef = useRef(onTransform);
  onTransformRef.current = onTransform;

  const imgW = planWidth ?? IMPLIED_W;
  const imgH = planHeight ?? IMPLIED_H;

  useEffect(() => {
    if (!planDataUrl) {
      imgRef.current = null;
      setImgLoaded(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.src = planDataUrl;
  }, [planDataUrl]);

  const applyTransform = useCallback((t: CanvasTransform) => {
    transformRef.current = t;
    setTransform(t);
    onTransformRef.current?.(t);
  }, []);

  // Fit-to-view only on first load/new plan, or when the user taps Fit.
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    const s = Math.min(cw / imgW, ch / imgH);
    const tx = (cw - imgW * s) / 2;
    const ty = (ch - imgH * s) / 2;
    const t = { scale: s, tx, ty };
    applyTransform(t);
  }, [imgW, imgH, applyTransform]);

  useEffect(() => {
    fit();
  }, [fit, planDataUrl, imgLoaded]);

  // Re-fit when the wrapper resizes (e.g. orientation change phone/tablet)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let lastW = wrap.clientWidth;
    let lastH = wrap.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (Math.abs(w - lastW) > 20 || Math.abs(h - lastH) > 20) {
        lastW = w;
        lastH = h;
        if (refitOnResize) fit();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, refitOnResize]);

  // Programmatic focus: pan (and gently zoom in if too zoomed out) to center (x,y).
  const focusNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focusRequest) return;
    if (focusNonceRef.current === focusRequest.nonce) return;
    focusNonceRef.current = focusRequest.nonce;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    const cur = transformRef.current;
    const fitScale = Math.min(cw / imgW, ch / imgH);
    // Zoom in to at least 1.5x the fit-scale so the point is clearly visible.
    const minScale = fitScale * 1.5;
    const scale = cur.scale < minScale ? minScale : cur.scale;
    const tx = cw / 2 - focusRequest.x * scale;
    const ty = ch / 2 - focusRequest.y * scale;
    applyTransform({ scale, tx, ty });
  }, [focusRequest, applyTransform, imgW, imgH]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setCanvasSizeTick((tick) => tick + 1);
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(transform.tx, transform.ty);
    ctx.scale(transform.scale, transform.scale);

    // Helper: wrap a plan-image draw call in the optional planTransform
    // (translate + rotate + scale around image center).
    const drawPlanImage = (img: HTMLImageElement, alpha: number) => {
      ctx.save();
      if (planTransform) {
        const cx = imgW / 2;
        const cy = imgH / 2;
        ctx.translate(cx + planTransform.tx, cy + planTransform.ty);
        ctx.rotate(planTransform.rotation);
        ctx.scale(planTransform.scale, planTransform.scale);
        ctx.translate(-cx, -cy);
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, 0, 0, imgW, imgH);
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    // Plan bounds — under the overlay UNLESS planOnTop
    if (!hidePlan && !planOnTop) {
      if (imgLoaded && imgRef.current) {
        drawPlanImage(imgRef.current, planOpacity);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, imgW, imgH);
        ctx.strokeStyle = "#e5e0d5";
        ctx.lineWidth = 2 / transform.scale;
        ctx.strokeRect(0, 0, imgW, imgH);
      }
    } else if (!hidePlan && planOnTop && (!imgLoaded || !imgRef.current)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, imgW, imgH);
    }

    if (drawOverlay) drawOverlay(ctx);

    // Plan on top: multiply blend keeps walls crisp while white paper reveals color underneath
    if (!hidePlan && planOnTop && imgLoaded && imgRef.current) {
      ctx.globalCompositeOperation = "multiply";
      drawPlanImage(imgRef.current, 1);
      ctx.globalCompositeOperation = "source-over";
    }

    // Overlay that must sit above walls (points, labels, pins, legend)
    if (drawOverlayTop) drawOverlayTop(ctx);

    ctx.restore();
  }, [
    transform,
    canvasSizeTick,
    imgLoaded,
    imgW,
    imgH,
    drawOverlay,
    drawOverlayTop,
    planOpacity,
    hidePlan,
    planOnTop,
    planTransform,
  ]);

  useEffect(() => {
    render();
  });

  // --- Pointer / gesture handling ---
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStart = useRef<{
    dist: number;
    mid: { x: number; y: number };
    transform: CanvasTransform;
  } | null>(null);
  const singleStart = useRef<{ x: number; y: number; t0: number; moved: boolean } | null>(null);
  const customPointer = useRef<number | null>(null);

  function toImage(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const t = transformRef.current;
    return { x: (localX - t.tx) / t.scale, y: (localY - t.ty) / t.scale };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // If a second finger arrives while a custom (point-drag) gesture is active,
    // cancel the custom drag and hand ALL pointers over to pinch/pan so the
    // user can always zoom regardless of where their first finger landed.
    if (customPointer.current !== null && pointers.current.size >= 1) {
      const img = toImage(e.clientX, e.clientY);
      onImagePointerCancel?.(img.x, img.y, e);
      customPointer.current = null;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gestureStart.current = { dist, mid, transform: transformRef.current };
      singleStart.current = null;
      return;
    }
    if (onImagePointerDown) {
      const img = toImage(e.clientX, e.clientY);
      if (onImagePointerDown(img.x, img.y, e)) {
        customPointer.current = e.pointerId;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      singleStart.current = { x: e.clientX, y: e.clientY, t0: performance.now(), moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gestureStart.current = { dist, mid, transform: transformRef.current };
      singleStart.current = null;
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    if (customPointer.current === e.pointerId) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const img = toImage(e.clientX, e.clientY);
      onImagePointerMove?.(img.x, img.y, e);
      return;
    }
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && gestureStart.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = gestureStart.current;
      const rect = wrapRef.current!.getBoundingClientRect();
      const scale = g.transform.scale * (dist / g.dist);
      // keep the pinch midpoint stationary
      const originalMidLocal = { x: g.mid.x - rect.left, y: g.mid.y - rect.top };
      const newMidLocal = { x: mid.x - rect.left, y: mid.y - rect.top };
      const imgX = (originalMidLocal.x - g.transform.tx) / g.transform.scale;
      const imgY = (originalMidLocal.y - g.transform.ty) / g.transform.scale;
      const tx = newMidLocal.x - imgX * scale;
      const ty = newMidLocal.y - imgY * scale;
      const t = { scale: Math.max(0.05, Math.min(20, scale)), tx, ty };
      applyTransform(t);
    } else if (pointers.current.size === 1 && singleStart.current) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      const total = Math.hypot(
        e.clientX - singleStart.current.x,
        e.clientY - singleStart.current.y,
      );
      if (total > 6) singleStart.current.moved = true;
      if (singleStart.current.moved) {
        const t = {
          scale: transformRef.current.scale,
          tx: transformRef.current.tx + dx,
          ty: transformRef.current.ty + dy,
        };
        applyTransform(t);
      }
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (customPointer.current === e.pointerId) {
      const img = toImage(e.clientX, e.clientY);
      onImagePointerUp?.(img.x, img.y, e);
      customPointer.current = null;
      pointers.current.delete(e.pointerId);
      singleStart.current = null;
      return;
    }
    const wasSingle = pointers.current.size === 1 && singleStart.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    if (wasSingle && singleStart.current && !singleStart.current.moved && onTap) {
      const rect = wrapRef.current!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const t = transformRef.current;
      const x = (localX - t.tx) / t.scale;
      const y = (localY - t.ty) / t.scale;
      onTap(x, y);
    }
    singleStart.current = null;
  }

  function onPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    if (customPointer.current === e.pointerId) {
      const img = toImage(e.clientX, e.clientY);
      onImagePointerCancel?.(img.x, img.y, e);
      customPointer.current = null;
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    singleStart.current = null;
  }

  // wheel zoom for desktop
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const t = transformRef.current;
    const newScale = Math.max(0.05, Math.min(20, t.scale * factor));
    const imgX = (localX - t.tx) / t.scale;
    const imgY = (localY - t.ty) / t.scale;
    const nt = { scale: newScale, tx: localX - imgX * newScale, ty: localY - imgY * newScale };
    applyTransform(nt);
  }

  return (
    <div className={className ?? "relative flex-1 min-h-0"}>
      {badge}
      <div
        ref={wrapRef}
        className="absolute inset-0 touch-none overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        style={{ cursor: "crosshair" }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
