import { useCallback, useEffect, useRef, useState } from "react";
import type { SurveyPoint } from "./types";

export type FloorSnapshot = {
  points: SurveyPoint[];
};

type Stack = {
  entries: FloorSnapshot[];
  index: number; // pointer to current snapshot
};

/**
 * Per-floor undo/redo history. Stacks are stored per floorId in a ref so
 * switching floors preserves each floor's own history.
 */
export function useFloorHistory(floorId: string | null) {
  const stacksRef = useRef<Map<string, Stack>>(new Map());
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const getStack = useCallback((): Stack | null => {
    if (!floorId) return null;
    return stacksRef.current.get(floorId) ?? null;
  }, [floorId]);

  /** Seed history for a floor with its initial snapshot. Idempotent per floor. */
  const seed = useCallback(
    (snap: FloorSnapshot) => {
      if (!floorId) return;
      if (stacksRef.current.has(floorId)) return;
      stacksRef.current.set(floorId, { entries: [cloneSnap(snap)], index: 0 });
      rerender();
    },
    [floorId, rerender],
  );

  /** Push a new snapshot after a user action. Truncates redo tail. */
  const commit = useCallback(
    (snap: FloorSnapshot) => {
      if (!floorId) return;
      const stack = stacksRef.current.get(floorId) ?? { entries: [], index: -1 };
      const truncated = stack.entries.slice(0, stack.index + 1);
      truncated.push(cloneSnap(snap));
      stacksRef.current.set(floorId, { entries: truncated, index: truncated.length - 1 });
      rerender();
    },
    [floorId, rerender],
  );

  const undo = useCallback((): FloorSnapshot | null => {
    const stack = getStack();
    if (!stack || stack.index <= 0) return null;
    stack.index -= 1;
    rerender();
    return cloneSnap(stack.entries[stack.index]);
  }, [getStack, rerender]);

  const redo = useCallback((): FloorSnapshot | null => {
    const stack = getStack();
    if (!stack || stack.index >= stack.entries.length - 1) return null;
    stack.index += 1;
    rerender();
    return cloneSnap(stack.entries[stack.index]);
  }, [getStack, rerender]);

  const stack = getStack();
  const canUndo = !!stack && stack.index > 0;
  const canRedo = !!stack && stack.index < stack.entries.length - 1;

  return { seed, commit, undo, redo, canUndo, canRedo };
}

function cloneSnap(s: FloorSnapshot): FloorSnapshot {
  return {
    points: s.points.map((p) => ({ ...p })),
  };
}

/** Convenience: subscribe to app:undo / app:redo events. */
export function useUndoRedoEvents(onUndo: () => void, onRedo: () => void) {
  useEffect(() => {
    const u = () => onUndo();
    const r = () => onRedo();
    window.addEventListener("app:undo", u);
    window.addEventListener("app:redo", r);
    return () => {
      window.removeEventListener("app:undo", u);
      window.removeEventListener("app:redo", r);
    };
  }, [onUndo, onRedo]);
}
