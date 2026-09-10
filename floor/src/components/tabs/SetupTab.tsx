import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, Upload, Undo2, ArrowRight, ArrowLeft, Check, X } from "lucide-react";
import { PlanCanvas } from "../PlanCanvas";
import { AddressGpsButtons } from "../AddressGpsButtons";
import { saveFloor, saveProject, deleteFloor, uid, listFloors } from "@/lib/db";
import { drawExclusionShape } from "@/lib/exclusions";
import type { Floor, Exclusion, ProjectMeta, TopoArea } from "@/lib/types";
import { getAreas, withAreas, areaCentroid } from "@/lib/areas";

interface Props {
  project: ProjectMeta;
  floors: Floor[];
  activeFloor: Floor;
  onProjectChange: (p: ProjectMeta) => void;
  onFloorsChange: (floors: Floor[]) => void;
  onActiveFloorChange: (id: string) => void;
  onStartSurveying?: () => void;

}

export function SetupTab({
  project,
  floors,
  activeFloor,
  onProjectChange,
  onFloorsChange,
  onActiveFloorChange,
  onStartSurveying,
}: Props) {
  const [tab, setTab] = useState<"details" | "plan" | "areas" | "excluded">("details");
  const hasPlan = !!activeFloor?.planDataUrl;
  const anyAreaClosed = getAreas(activeFloor).some((a) => a.polygon.length >= 3);

  type StepKey = "details" | "plan" | "areas" | "excluded";
  const steps: Array<{ key: StepKey; label: string; disabled?: boolean; title?: string }> = [
    { key: "details", label: "1. Details" },
    { key: "plan", label: "2. Plan" },
    { key: "areas", label: "3. Topo boundary" },
    {
      key: "excluded",
      label: "4. Excluded",
      disabled: !anyAreaClosed,
      title: anyAreaClosed ? undefined : "Draw a topo boundary first",
    },
  ];
  const stepIndex = steps.findIndex((s) => s.key === tab);
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;

  // Next / Start conditions
  const nextDisabled =
    (tab === "plan" && !hasPlan) || (tab === "areas" && !anyAreaClosed);
  const startDisabled = !hasPlan;
  const stepNames: Record<StepKey, string> = {
    details: "Details",
    plan: "Plan",
    areas: "Topo boundary",
    excluded: "Excluded",
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b flex overflow-x-auto overscroll-x-contain">
        {steps.map(({ key, label, disabled, title }) => (
          <button
            key={key}
            onClick={() => !disabled && setTab(key)}
            disabled={disabled}
            title={title}
            className={
              "shrink-0 px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px " +
              (tab === key
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground") +
              (disabled ? " opacity-40 cursor-not-allowed" : "")
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className={tab === "areas" || tab === "excluded" ? "flex-1 min-h-0 overflow-hidden" : "flex-1 min-h-0 overflow-auto"}>
        {tab === "details" && <DetailsPanel project={project} onChange={onProjectChange} />}
        {tab === "plan" && (
          <PlanPanel
            projectId={project.id}
            floors={floors}
            activeFloor={activeFloor}
            onFloorsChange={onFloorsChange}
            onActiveFloorChange={onActiveFloorChange}
          />
        )}
        {tab === "areas" && (
          <AreasPanel
            floor={activeFloor}
            onChange={async (f) => {
              await saveFloor(f);
              onFloorsChange(await listFloors(project.id));
            }}
          />
        )}
        {tab === "excluded" && (
          <ExcludedPanel
            floor={activeFloor}
            onChange={async (f) => {
              await saveFloor(f);
              onFloorsChange(await listFloors(project.id));
            }}
          />
        )}
      </div>

      <div className="shrink-0 border-t bg-background/95 backdrop-blur px-3 py-2 flex items-center gap-3 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {prevStep ? (
          <Button variant="ghost" size="sm" onClick={() => setTab(prevStep.key)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        ) : (
          <div />
        )}
        <div className="ml-auto flex items-center gap-3">
          {tab === "plan" && !hasPlan && (
            <span className="text-xs text-muted-foreground">Upload a plan first</span>
          )}
          {tab === "areas" && !hasPlan && (
            <span className="text-xs text-muted-foreground">Upload a plan first</span>
          )}
          {tab === "areas" && hasPlan && !anyAreaClosed && (
            <span className="text-xs text-muted-foreground">Draw a topo boundary first</span>
          )}
          {nextStep ? (
            <Button onClick={() => setTab(nextStep.key)} disabled={nextDisabled}>
              Next: {stepNames[nextStep.key]}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            onStartSurveying && (
              <Button onClick={onStartSurveying} disabled={startDisabled}>
                Start surveying
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )
          )}
        </div>
      </div>
    </div>
  );
}


function DetailsPanel({
  project,
  onChange,
}: {
  project: ProjectMeta;
  onChange: (p: ProjectMeta) => void;
}) {
  const [local, setLocal] = useState(project);
  const [saved, setSaved] = useState(false);
  useEffect(() => setLocal(project), [project.id]);

  const latest = useRef(local);
  latest.current = local;
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    const snapshot = latest.current;
    await saveProject(snapshot);
    onChange(snapshot);
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }, [onChange]);

  // Autosave a short moment after typing stops, so navigating away never
  // silently drops an edit. The manual button remains as an explicit action.
  useEffect(() => {
    if (local === project) return;
    const t = setTimeout(() => {
      void save();
    }, 800);
    return () => clearTimeout(t);
  }, [local, project, save]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );


  return (
    <div className="max-w-2xl mx-auto p-4 space-y-3">
      <div>
        <Label className="label-micro">Inspection date</Label>
        <Input
          type="date"
          value={local.inspectionDate}
          onChange={(e) => setLocal({ ...local, inspectionDate: e.target.value })}
        />
      </div>
      <div>
        <Label className="label-micro">Project name</Label>
        <Input value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} />
      </div>
      <div>
        <Label className="label-micro">Address</Label>
        <Input
          value={local.address}
          onChange={(e) => setLocal({ ...local, address: e.target.value })}
        />
        <AddressGpsButtons
          onAddress={(addr) => setLocal((prev) => ({ ...prev, address: addr }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="label-micro">Client</Label>
          <Input
            value={local.client}
            onChange={(e) => setLocal({ ...local, client: e.target.value })}
          />
        </div>
        <div>
          <Label className="label-micro">Inspector</Label>
          <Input
            value={local.inspector}
            onChange={(e) => setLocal({ ...local, inspector: e.target.value })}
          />
        </div>
      </div>
      <div>
        <Label className="label-micro">Notes</Label>
        <Textarea
          rows={3}
          value={local.notes}
          onChange={(e) => setLocal({ ...local, notes: e.target.value })}
        />
      </div>
      <Button onClick={() => void save()} variant={saved ? "secondary" : "default"}>
        {saved ? (
          <>
            <Check className="h-4 w-4 mr-1" />
            Saved
          </>
        ) : (
          "Save details"
        )}
      </Button>
    </div>
  );
}




function PlanPanel({
  projectId,
  floors,
  activeFloor,
  onFloorsChange,
  onActiveFloorChange,
}: {
  projectId: string;
  floors: Floor[];
  activeFloor: Floor;
  onFloorsChange: (f: Floor[]) => void;
  onActiveFloorChange: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    onFloorsChange(await listFloors(projectId));
  }

  async function addFloor() {
    const name = prompt("Floor name", `Floor ${floors.length + 1}`);
    if (!name) return;
    const now = Date.now();
    await saveFloor({
      id: uid(),
      projectId,
      name,
      order: floors.length,
      boundary: [],
      createdAt: now,
      updatedAt: now,
    });
    refresh();
  }

  async function removeFloor(id: string) {
    if (floors.length <= 1) return alert("Keep at least one floor.");
    if (!confirm("Delete this floor and its points?")) return;
    await deleteFloor(id);
    refresh();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    // Get image dimensions
    const dims = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = dataUrl;
    });
    await saveFloor({
      ...activeFloor,
      planDataUrl: dataUrl,
      planWidth: dims.w,
      planHeight: dims.h,
    });
    e.target.value = "";
    refresh();
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">Floors</div>
          <Button size="sm" variant="outline" onClick={addFloor}>
            <Plus className="h-4 w-4 mr-1" /> Add floor
          </Button>
        </div>
        <div className="space-y-2">
          {floors.map((f) => (
            <div
              key={f.id}
              className={
                "flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer " +
                (f.id === activeFloor.id ? "bg-secondary border-primary" : "bg-background")
              }
              onClick={() => onActiveFloorChange(f.id)}
            >
              <div>
                <div className="text-sm font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground">
                  {f.planDataUrl ? "Plan uploaded" : "No plan"} · {f.boundary.length} boundary pts
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFloor(f.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3">
        <div className="text-sm font-medium mb-1">Plan image · {activeFloor.name}</div>
        <div className="text-xs text-muted-foreground mb-3">
          Upload a floor plan for this floor. Any image (photo, PDF export, sketch).
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <Button onClick={() => fileRef.current?.click()} variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          {activeFloor.planDataUrl ? "Replace plan" : "Upload plan"}
        </Button>
      </Card>
    </div>
  );
}

function AreasPanel(props: { floor: Floor; onChange: (f: Floor) => void }) {
  return <DrawingPanel {...props} mode="areas" />;
}

function ExcludedPanel(props: { floor: Floor; onChange: (f: Floor) => void }) {
  return <DrawingPanel {...props} mode="excluded" />;
}

function DrawingPanel({
  floor,
  onChange,
  mode,
}: {
  floor: Floor;
  onChange: (f: Floor) => void;
  mode: "areas" | "excluded";
}) {
  const areas = getAreas(floor);
  const exclusions = floor.exclusions ?? [];
  const anyAreaClosed = areas.some((a) => a.polygon.length >= 3);

  // The Areas step edits areas only; the Excluded step edits exclusions only.
  const tool: "area" | "exclusion" = mode === "areas" ? "area" : "exclusion";
  const [activeAreaId, setActiveAreaId] = useState<string>(areas[0]?.id ?? "");
  const [draft, setDraft] = useState<{ x: number; y: number }[] | null>(null);
  const [draftKind, setDraftKind] = useState<"area" | "exclusion">("exclusion");

  const activeArea = areas.find((a) => a.id === activeAreaId) ?? areas[0];
  const activeAreaPoly = activeArea?.polygon ?? [];

  const dragRef = useRef<{
    target: "area" | "draft" | { exclusionId: string };
    index: number;
    original: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const [, force] = useState(0);

  const HIT_RADIUS = 26;

  function setAreas(next: TopoArea[]) {
    onChange(withAreas(floor, next));
  }

  function patchActiveArea(polygon: { x: number; y: number }[]) {
    if (!activeArea) return;
    setAreas(areas.map((a) => (a.id === activeArea.id ? { ...a, polygon } : a)));
  }

  function findVertexAt(x: number, y: number):
    | { target: "area"; index: number }
    | { target: "draft"; index: number }
    | { target: { exclusionId: string }; index: number }
    | null {
    let best:
      | { target: "area" | "draft" | { exclusionId: string }; index: number }
      | null = null;
    let bestD2 = HIT_RADIUS * HIT_RADIUS;
    if (tool === "area") {
      if (!draft) {
        for (let i = 0; i < activeAreaPoly.length; i++) {
          const dx = activeAreaPoly[i].x - x;
          const dy = activeAreaPoly[i].y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD2) {
            bestD2 = d2;
            best = { target: "area", index: i };
          }
        }
      }
    }
    if (tool === "exclusion") {
      for (const ex of exclusions) {
        for (let i = 0; i < ex.polygon.length; i++) {
          const dx = ex.polygon[i].x - x;
          const dy = ex.polygon[i].y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD2) {
            bestD2 = d2;
            best = { target: { exclusionId: ex.id }, index: i };
          }
        }
      }
    }
    if (draft) {
      for (let i = 0; i < draft.length; i++) {
        const dx = draft[i].x - x;
        const dy = draft[i].y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = { target: "draft", index: i };
        }
      }
    }
    return best as ReturnType<typeof findVertexAt>;
  }

  function saveDraft() {
    if (!draft || draft.length < 3) return;
    if (draftKind === "area") {
      const area: TopoArea = {
        id: uid(),
        name: `Boundary ${areas.length + 1}`,
        polygon: draft,
        createdAt: Date.now(),
      };
      setAreas([...areas, area]);
      setActiveAreaId(area.id);
    } else {
      const ex: Exclusion = {
        id: uid(),
        polygon: draft,
        label: `Excluded ${exclusions.length + 1}`,
        createdAt: Date.now(),
      };
      onChange({ ...floor, exclusions: [...exclusions, ex] });
    }
    setDraft(null);
  }

  function updateExclusion(id: string, patch: Partial<Exclusion>) {
    onChange({
      ...floor,
      exclusions: exclusions.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  function deleteExclusion(id: string) {
    if (!confirm("Delete this excluded area?")) return;
    onChange({ ...floor, exclusions: exclusions.filter((e) => e.id !== id) });
  }

  function deleteArea(id: string) {
    if (areas.length <= 1) return;
    if (!confirm("Delete this boundary? Its contour surface will be removed.")) return;
    const next = areas.filter((a) => a.id !== id);
    setAreas(next);
    if (activeAreaId === id) setActiveAreaId(next[0].id);
  }

  const drafting = !!draft;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b bg-background/70 px-2 py-1.5 flex items-center gap-2 overflow-x-auto overscroll-x-contain [&_button]:shrink-0">
          {tool === "area" && !drafting && (
            <>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Tap to add · drag a vertex to move
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => patchActiveArea(activeAreaPoly.slice(0, -1))}
                disabled={activeAreaPoly.length === 0}
              >
                <Undo2 className="h-4 w-4 mr-1" /> Undo
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => patchActiveArea([])}
                disabled={activeAreaPoly.length === 0}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraftKind("area");
                  setDraft([]);
                }}
                disabled={!anyAreaClosed}
              >
                <Plus className="h-4 w-4 mr-1" /> Add boundary
              </Button>
            </>
          )}
          {tool === "exclusion" && !drafting && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraftKind("exclusion");
                setDraft([]);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> New excluded area
            </Button>
          )}
          {drafting && (
            <>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Tap to add corners · at least 3
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDraft((d) => (d ? d.slice(0, -1) : d))}
                disabled={!draft || draft.length === 0}
              >
                <Undo2 className="h-4 w-4 mr-1" /> Undo
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={saveDraft}
                disabled={!draft || draft.length < 3}
              >
                <Check className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
      </div>

      {/* Area list */}
      {tool === "area" && (
        <div className="shrink-0 border-b px-2 py-1.5 flex flex-nowrap gap-1.5 overflow-x-auto bg-muted/30 overscroll-x-contain">
          {areas.map((a) => {
            const active = a.id === activeArea?.id;
            return (
              <div
                key={a.id}
                onPointerDown={() => setActiveAreaId(a.id)}
                className={
                  "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs " +
                  (active ? "border-primary bg-background" : "bg-background/60")
                }
              >
                <input
                  value={a.name}
                  onChange={(e) =>
                    setAreas(areas.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  size={Math.max(8, a.name.length + 1)}
                  className="w-auto min-w-0 bg-transparent text-base outline-none border-b border-transparent focus:border-primary"
                  placeholder="Boundary"
                  enterKeyHint="done"
                />
                <button
                  type="button"
                  onClick={() => deleteArea(a.id)}
                  disabled={areas.length <= 1}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                  aria-label="Delete area"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Exclusion list */}
      {tool === "exclusion" && exclusions.length > 0 && (
        <div className="shrink-0 border-b px-2 py-1.5 flex flex-nowrap gap-1.5 overflow-x-auto bg-muted/30 overscroll-x-contain">
          {exclusions.map((ex) => (
            <div
              key={ex.id}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
            >
              <input
                value={ex.label ?? ""}
                onChange={(e) => updateExclusion(ex.id, { label: e.target.value })}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className="w-28 bg-transparent text-base outline-none border-b border-transparent focus:border-primary sm:w-24"
                placeholder="Label"
                enterKeyHint="done"
              />
              <button
                type="button"
                onClick={() => deleteExclusion(ex.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete excluded area"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <PlanCanvas
        planDataUrl={floor.planDataUrl}
        planWidth={floor.planWidth}
        planHeight={floor.planHeight}
        onTap={(x, y) => {
          const hit = findVertexAt(x, y);
          if (hit) return; // handled as drag
          if (drafting && draft) {
            setDraft([...draft, { x, y }]);
          } else if (tool === "area") {
            patchActiveArea([...activeAreaPoly, { x, y }]);
          }
        }}
        onImagePointerDown={(x, y) => {
          const hit = findVertexAt(x, y);
          if (!hit) return false;
          if (hit.target === "area") {
            dragRef.current = {
              target: "area",
              index: hit.index,
              original: { ...activeAreaPoly[hit.index] },
              moved: false,
            };
          } else if (hit.target === "draft") {
            if (!draft) return false;
            dragRef.current = {
              target: "draft",
              index: hit.index,
              original: { ...draft[hit.index] },
              moved: false,
            };
          } else {
            const eid = hit.target.exclusionId;
            const ex = exclusions.find((e) => e.id === eid)!;
            dragRef.current = {
              target: { exclusionId: eid },
              index: hit.index,
              original: { ...ex.polygon[hit.index] },
              moved: false,
            };
          }
          force((n) => n + 1);
          return true;
        }}
        onImagePointerMove={(x, y) => {
          const drag = dragRef.current;
          if (!drag) return;
          drag.moved = true;
          if (drag.target === "area") {
            const next = activeAreaPoly.slice();
            next[drag.index] = { x, y };
            patchActiveArea(next);
          } else if (drag.target === "draft") {
            setDraft((d) => {
              if (!d) return d;
              const next = d.slice();
              next[drag.index] = { x, y };
              return next;
            });
          } else {
            const eid = drag.target.exclusionId;
            onChange({
              ...floor,
              exclusions: exclusions.map((e) => {
                if (e.id !== eid) return e;
                const poly = e.polygon.slice();
                poly[drag.index] = { x, y };
                return { ...e, polygon: poly };
              }),
            });
          }
        }}
        onImagePointerUp={() => {
          dragRef.current = null;
          force((n) => n + 1);
        }}
        onImagePointerCancel={() => {
          const drag = dragRef.current;
          if (drag && drag.moved) {
            if (drag.target === "area") {
              const next = activeAreaPoly.slice();
              next[drag.index] = drag.original;
              patchActiveArea(next);
            } else if (drag.target === "draft") {
              setDraft((d) => {
                if (!d) return d;
                const next = d.slice();
                next[drag.index] = drag.original;
                return next;
              });
            } else {
              const eid = drag.target.exclusionId;
              onChange({
                ...floor,
                exclusions: exclusions.map((e) => {
                  if (e.id !== eid) return e;
                  const poly = e.polygon.slice();
                  poly[drag.index] = drag.original;
                  return { ...e, polygon: poly };
                }),
              });
            }
          }
          dragRef.current = null;
          force((n) => n + 1);
        }}
        drawOverlay={(ctx) => {
          // Areas
          for (const a of areas) {
            const poly = a.polygon;
            if (poly.length === 0) continue;
            const isActive = tool === "area" && a.id === activeArea?.id && !drafting;
            ctx.beginPath();
            poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            if (poly.length > 2) ctx.closePath();
            ctx.fillStyle = isActive ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.07)";
            if (poly.length > 2) ctx.fill();
            ctx.strokeStyle = isActive ? "#2563eb" : "#93b4f5";
            ctx.lineWidth = 3;
            ctx.stroke();

            if (isActive) {
              const dragging =
                dragRef.current && dragRef.current.target === "area" ? dragRef.current.index : -1;
              poly.forEach((p, i) => {
                const act = i === dragging;
                ctx.beginPath();
                ctx.arc(p.x, p.y, act ? 12 : 9, 0, Math.PI * 2);
                ctx.fillStyle = act ? "#f59e0b" : "#2563eb";
                ctx.fill();
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.stroke();
              });
            }

            if (poly.length > 2 && a.name) {
              const c = areaCentroid(a);
              ctx.font = "bold 12px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              const tw = ctx.measureText(a.name).width;
              ctx.fillStyle = "rgba(255,255,255,0.9)";
              ctx.fillRect(c.x - tw / 2 - 4, c.y - 9, tw + 8, 18);
              ctx.fillStyle = isActive ? "#1d4ed8" : "#64748b";
              ctx.fillText(a.name, c.x, c.y);
            }
          }

          // Saved exclusions
          for (const ex of exclusions) {
            drawExclusionShape(ctx, ex.polygon, {
              closed: true,
              muted: tool !== "exclusion",
              hatched: true,
            });
            if (tool === "exclusion") {
              const dragging =
                dragRef.current &&
                typeof dragRef.current.target === "object" &&
                dragRef.current.target.exclusionId === ex.id
                  ? dragRef.current.index
                  : -1;
              ex.polygon.forEach((p, i) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, i === dragging ? 11 : 8, 0, Math.PI * 2);
                ctx.fillStyle = i === dragging ? "#f59e0b" : "#4b5563";
                ctx.fill();
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.stroke();
              });
              if (ex.polygon.length > 0 && ex.label) {
                const cx = ex.polygon.reduce((s, p) => s + p.x, 0) / ex.polygon.length;
                const cy = ex.polygon.reduce((s, p) => s + p.y, 0) / ex.polygon.length;
                ctx.font = "bold 12px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const tw = ctx.measureText(ex.label).width;
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                ctx.fillRect(cx - tw / 2 - 4, cy - 9, tw + 8, 18);
                ctx.fillStyle = "#374151";
                ctx.fillText(ex.label, cx, cy);
              }
            }
          }

          // Draft polygon (new area or new exclusion)
          if (drafting && draft) {
            if (draftKind === "area") {
              ctx.beginPath();
              draft.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
              if (draft.length > 2) ctx.closePath();
              ctx.fillStyle = "rgba(59,130,246,0.15)";
              if (draft.length > 2) ctx.fill();
              ctx.strokeStyle = "#2563eb";
              ctx.lineWidth = 3;
              ctx.stroke();
            } else {
              drawExclusionShape(ctx, draft, {
                closed: draft.length >= 3,
                muted: false,
                hatched: true,
              });
            }
            draft.forEach((p, i) => {
              ctx.beginPath();
              ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
              ctx.fillStyle = draftKind === "area" ? "#2563eb" : "#4b5563";
              ctx.fill();
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.fillStyle = "#111827";
              ctx.font = "bold 10px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(String(i + 1), p.x, p.y - 12);
            });
          }
        }}
        refitOnResize={false}
      />
    </div>
  );
}
