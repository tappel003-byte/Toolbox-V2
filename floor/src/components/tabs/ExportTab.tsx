import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import type { Floor, ProjectMeta, RenderSettings, SurveyPoint } from "@/lib/types";
import { zoneOfXY } from "@/lib/exclusions";
import { buildAreaTopos, renderTopo, resolveSettings } from "./TopoTab";
import { canvasToPdfBlob } from "@/lib/pdf";

interface Props {
  project: ProjectMeta;
  floor: Floor;
  points: SurveyPoint[];
  settings: RenderSettings;
}

const DPIS = [150, 300, 600] as const;
const FORMATS = ["png", "jpeg", "pdf", "csv"] as const;

export function ExportTab({ project, floor, points, settings }: Props) {
  const [dpi, setDpi] = useState<(typeof DPIS)[number]>(150);
  const [format, setFormat] = useState<(typeof FORMATS)[number]>("png");
  const [status, setStatus] = useState<string>("");
  const [pointsOnly, setPointsOnly] = useState(false);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const resolved = resolveSettings(settings);
  const exportSettings = pointsOnly
    ? resolveSettings({
        ...resolved,
        mode: "points-only",
        showContours: false,
        showLegend: false,
        showHighLow: false,
        showPoints: true,
        showLabels: false,
      })
    : resolved;

  // One contour surface per drawn area (falls back to the legacy boundary).
  const areaTopos = useMemo(
    () => buildAreaTopos(floor, points, resolved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      floor,
      points,
      resolved.firstContour,
      resolved.contourStep,
      resolved.contourCount,
      resolved.minClamp,
      resolved.maxClamp,
    ],
  );

  const imgW = floor.planWidth ?? 1000;
  const imgH = floor.planHeight ?? 750;

  function renderTo(canvas: HTMLCanvasElement, targetDpi: number) {
    // 1 image px = 1/96 in at 96dpi. Multiply pixel size by (targetDpi/96)
    const scale = targetDpi / 96;
    canvas.width = Math.round(imgW * scale);
    canvas.height = Math.round(imgH * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, imgW, imgH);

    // plan image
    if (exportSettings.showPlan && floor.planDataUrl) {
      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          ctx.globalAlpha = exportSettings.planOpacity;
          ctx.drawImage(img, 0, 0, imgW, imgH);
          ctx.globalAlpha = 1;
          renderTopo(ctx, floor, points, exportSettings, areaTopos);
          drawTitleBlock(ctx, imgW, imgH, project, floor, points);
          resolve();
        };
        img.onerror = reject;
        img.src = floor.planDataUrl!;
      });
    } else {
      renderTopo(ctx, floor, points, exportSettings, areaTopos);
      drawTitleBlock(ctx, imgW, imgH, project, floor, points);
      return Promise.resolve();
    }
  }

  function downloadCsv() {
    const safe = project.name.replace(/[^a-z0-9-]+/gi, "_");
    const rows: string[] = [];
    rows.push(["index", "label", "x", "y", "value", "role", "zone", "notes"].join(","));
    for (const p of points) {
      const role = p.isBasePoint ? "base-point" : "normal";
      const zone = zoneOfXY(p.x, p.y, floor.exclusions);
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      rows.push(
        [
          p.index,
          esc(p.label ?? ""),
          p.x.toFixed(2),
          p.y.toFixed(2),
          p.value.toFixed(3),
          role,
          esc(zone?.label ?? ""),
          esc(p.notes ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safe}_${floor.name.replace(/\s+/g, "_")}_points.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus("CSV exported.");
  }

  async function doExport() {
    if (format === "csv") {
      downloadCsv();
      return;
    }
    setStatus("Rendering…");
    const canvas = document.createElement("canvas");
    await renderTo(canvas, dpi);
    const safe = project.name.replace(/[^a-z0-9-]+/gi, "_");
    const suffix = `${floor.name.replace(/\s+/g, "_")}_${pointsOnly ? "points" : "topo"}_${dpi}dpi`;
    if (format === "pdf") {
      const blob = canvasToPdfBlob(canvas);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${safe}_${suffix}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setStatus("Exported.");
      return;
    }
    const mime = format === "png" ? "image/png" : "image/jpeg";
    canvas.toBlob(
      (blob) => {
        if (!blob) return setStatus("Export failed");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${safe}_${suffix}.${format}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        setStatus("Exported.");
      },
      mime,
      0.92,
    );
  }

  async function updatePreview() {
    if (!previewRef.current) return;
    setStatus("Rendering preview…");
    await renderTo(previewRef.current, 96);
    setStatus("");
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Format</Label>
          <div className="mt-1 flex rounded-md border overflow-hidden">
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={
                  "px-3 py-1.5 text-sm uppercase " +
                  (format === f ? "bg-primary text-primary-foreground" : "bg-background")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs">DPI</Label>
          <div className="mt-1 flex rounded-md border overflow-hidden">
            {DPIS.map((d) => (
              <button
                key={d}
                onClick={() => setDpi(d)}
                className={
                  "px-3 py-1.5 text-sm " +
                  (dpi === d ? "bg-primary text-primary-foreground" : "bg-background")
                }
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm rounded-md border px-3 h-9">
          <input
            type="checkbox"
            checked={pointsOnly}
            onChange={(e) => setPointsOnly(e.target.checked)}
          />
          Points only
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={updatePreview}>
            Refresh preview
          </Button>
          <Button onClick={doExport}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-muted/30 p-4 flex justify-center items-start">
        <canvas
          ref={previewRef}
          className="border shadow-md bg-white max-w-full h-auto"
          style={{ width: Math.min(imgW, 900), height: "auto" }}
        />
      </div>
      {status && <div className="border-t px-3 py-2 text-xs text-muted-foreground">{status}</div>}
    </div>
  );
}

function drawTitleBlock(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: ProjectMeta,
  floor: Floor,
  points: SurveyPoint[],
) {
  const pad = 12;
  const boxW = 280;
  const boxH = 88;
  const x = w - boxW - pad;
  const y = h - boxH - pad;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeRect(x, y, boxW, boxH);
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(project.name, x + 10, y + 8);
  ctx.font = "11px sans-serif";
  ctx.fillText(project.address, x + 10, y + 26);
  ctx.fillText(`${floor.name} · ${points.length} points`, x + 10, y + 40);
  ctx.fillText(`Inspected: ${project.inspectionDate}`, x + 10, y + 54);
  ctx.fillText(`Inspector: ${project.inspector || "—"}`, x + 10, y + 68);
}
