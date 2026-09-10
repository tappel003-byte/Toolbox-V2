import { useMemo, useState } from "react";
import { X, StickyNote, ArrowUpDown } from "lucide-react";
import type { Floor, SurveyPoint } from "@/lib/types";
import { deletePoint, reindexFloorPoints, savePoint } from "@/lib/db";
import { PointDetail } from "@/components/PointDetail";

interface Props {
  floor: Floor;
  points: SurveyPoint[];
  correctedById?: Map<string, number>;
  zoneLabelById?: Map<string, string>;
  onPointsChange: (points: SurveyPoint[]) => void;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  onClose?: () => void;
  onCommit?: (points: SurveyPoint[]) => void;
}


export function ReviewTab({
  floor,
  points,
  correctedById,
  zoneLabelById,
  onPointsChange,
  selectedIds,
  setSelectedIds,
  onClose,
  onCommit,
}: Props) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"index" | "high" | "low">("index");

  const displayValue = (p: SurveyPoint) => correctedById?.get(p.id) ?? p.value;
  const zoneLabel = (p: SurveyPoint) => zoneLabelById?.get(p.id) ?? "";
  const isExcluded = (p: SurveyPoint) => !!zoneLabelById && zoneLabelById.has(p.id);

  // Stats exclude points inside an exclusion zone. Range/min/max reflect the
  // topo-visible surface, not readings that were intentionally dropped.
  const stats = useMemo(() => {
    const active = points.filter((p) => !isExcluded(p));
    if (active.length === 0) return null;
    const vals = active.map(displayValue);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    return { min, max, mean, std, range: max - min, count: active.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, correctedById, zoneLabelById]);

  const outliers = useMemo(() => {
    if (!stats || points.length < 4) return new Set<string>();
    const set = new Set<string>();
    for (const p of points) {
      if (Math.abs(displayValue(p) - stats.mean) > 2 * stats.std) set.add(p.id);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, stats, correctedById]);

  const sortedPoints = useMemo(() => {
    const arr = [...points];
    if (sortMode === "high") arr.sort((a, b) => displayValue(b) - displayValue(a));
    else if (sortMode === "low") arr.sort((a, b) => displayValue(a) - displayValue(b));
    else arr.sort((a, b) => a.index - b.index);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, sortMode, correctedById]);


  const detail = detailId ? (points.find((p) => p.id === detailId) ?? null) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-3 h-9">
        <span className="text-xs font-semibold">Review</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setSortMode((m) => (m === "index" ? "high" : m === "high" ? "low" : "index"))
            }
            className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Sort points"
          >
            <ArrowUpDown className="h-3 w-3" />
            {sortMode === "index" ? "Pin #" : sortMode === "high" ? "High" : "Low"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="Close review"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {stats && (
        <div className="border-b p-3 grid grid-cols-4 gap-2 text-center text-xs">
          <Stat
            label="Points"
            value={
              points.length === stats.count
                ? points.length.toString()
                : `${stats.count} / ${points.length}`
            }
          />
          <Stat label="Range" value={stats.range.toFixed(2) + '"'} />
          <Stat label="Min" value={stats.min.toFixed(2) + '"'} />
          <Stat label="Max" value={stats.max.toFixed(2) + '"'} />
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {points.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No points captured yet. Switch to Data mode.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-medium px-3 py-2 w-10">Pin</th>
                <th className="text-right font-medium px-2 py-2">Elev</th>
                <th className="text-left font-medium px-2 py-2">Zone</th>
                <th className="text-right font-medium px-2 py-2">X</th>
                <th className="text-right font-medium px-3 py-2">Y</th>
              </tr>
            </thead>
            <tbody>
              {sortedPoints.map((p) => {
                const selected = selectedIds.has(p.id);
                const isOutlier = outliers.has(p.id);
                const excluded = isExcluded(p);
                return (
                  <tr
                    key={p.id}
                    onClick={(e) => {
                      if (e.shiftKey || e.metaKey) {
                        const next = new Set(selectedIds);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        setSelectedIds(next);
                        return;
                      }
                      setSelectedIds(new Set([p.id]));
                      setDetailId(p.id);
                    }}
                    className={
                      "border-b cursor-pointer " +
                      (selected ? "bg-primary/10" : "hover:bg-muted/30")
                    }
                    title={isOutlier ? "Outlier" : undefined}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground tabular-nums align-top">
                      {p.index}
                    </td>
                    <td
                      className={
                        "px-2 py-2 text-right font-mono font-semibold tabular-nums align-top " +
                        (isOutlier ? "text-amber-600" : "")
                      }
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        {p.isBasePoint && (
                          <span className="rounded bg-green-100 text-green-800 px-1.5 py-0.5 text-[10px] font-medium">
                            {p.label ?? "BP"}
                          </span>
                        )}
                        {p.notes && (
                          <StickyNote className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span>{displayValue(p).toFixed(2)}"</span>
                      </div>
                      {p.notes && (
                        <p className="text-[11px] font-sans font-normal text-muted-foreground mt-0.5 whitespace-pre-wrap break-words text-left">
                          {p.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-left text-xs text-muted-foreground align-top">
                      {excluded ? (
                        <span className="inline-flex items-center rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-medium">
                          {zoneLabel(p) || "Excluded"}
                        </span>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-muted-foreground tabular-nums align-top">
                      {Math.round(p.x)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground tabular-nums align-top">
                      {Math.round(p.y)}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={5} className="h-24" />
              </tr>
            </tbody>
          </table>
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="font-mono text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}
