// Project bundle export/import. Self-contained JSON file with plan image,
// floors, points, transitions, notes. Imports always create a new project
// with fresh IDs and an auto-versioned name (V2, V3, …) so nothing is ever
// silently overwritten.

import type { Floor, ProjectMeta, SurveyPoint } from "./types";
import {
  listProjects,
  listFloors,
  listPoints,
  getProject,
  saveProject,
  saveFloor,
  savePoint,
  uid,
} from "./db";

const BUNDLE_VERSION = 1;
const BUNDLE_KIND = "floor-survey-bundle";

interface Bundle {
  kind: typeof BUNDLE_KIND;
  bundleVersion: number;
  exportedAt: number;
  project: ProjectMeta;
  floors: Floor[];
  points: SurveyPoint[];
}

export async function exportProject(projectId: string): Promise<Blob> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  const floors = await listFloors(projectId);
  const points: SurveyPoint[] = [];
  for (const f of floors) points.push(...(await listPoints(f.id)));
  const bundle: Bundle = {
    kind: BUNDLE_KIND,
    bundleVersion: BUNDLE_VERSION,
    exportedAt: Date.now(),
    project,
    floors,
    points,
  };
  return new Blob([JSON.stringify(bundle)], { type: "application/json" });
}

export function bundleFilename(projectName: string): string {
  const safe = projectName.replace(/[^a-z0-9-]+/gi, "_").replace(/^_+|_+$/g, "") || "project";
  const date = new Date().toISOString().slice(0, 10);
  return `${safe}_${date}.floorsurvey.json`;
}

export function downloadBundle(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Returns the new project's ID. Throws on malformed / unsupported bundles. */
export async function importProject(file: File): Promise<string> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like a Floor Survey bundle.");
  }
  const bundle = parsed as Partial<Bundle>;
  if (
    !bundle ||
    bundle.kind !== BUNDLE_KIND ||
    typeof bundle.bundleVersion !== "number" ||
    !bundle.project ||
    !Array.isArray(bundle.floors) ||
    !Array.isArray(bundle.points)
  ) {
    throw new Error("That doesn't look like a Floor Survey bundle.");
  }
  if (bundle.bundleVersion > BUNDLE_VERSION) {
    throw new Error("This bundle was made with a newer version. Update the app to import it.");
  }

  // Regenerate all IDs and rewrite internal references.
  const now = Date.now();
  const newProjectId = uid();

  const floorIdMap = new Map<string, string>();
  for (const f of bundle.floors) floorIdMap.set(f.id, uid());

  const pointIdMap = new Map<string, string>();
  for (const p of bundle.points) pointIdMap.set(p.id, uid());

  // Transitions get new IDs too — they're referenced by anchor points via
  // transitionId, and downstream points via transitionId, plus chained via
  // parentId. Rewrite all of those in one pass.
  const transitionIdMap = new Map<string, string>();
  for (const f of bundle.floors) {
    for (const t of f.transitions ?? []) transitionIdMap.set(t.id, uid());
  }
  const noteIdMap = new Map<string, string>();
  for (const f of bundle.floors) {
    for (const n of f.notes ?? []) noteIdMap.set(n.id, uid());
  }

  const versionedName = await nextVersionedName(bundle.project.name);

  const newProject: ProjectMeta = {
    ...bundle.project,
    id: newProjectId,
    name: versionedName,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(newProject);

  for (const f of bundle.floors) {
    const newFloorId = floorIdMap.get(f.id)!;
    const newFloor: Floor = {
      ...f,
      id: newFloorId,
      projectId: newProjectId,
      createdAt: now,
      updatedAt: now,
      notes: (f.notes ?? []).map((n) => ({ ...n, id: noteIdMap.get(n.id)! })),
      transitions: (f.transitions ?? []).map((t) => ({
        ...t,
        id: transitionIdMap.get(t.id)!,
        parentId: t.parentId ? transitionIdMap.get(t.parentId) : undefined,
      })),
    };
    await saveFloor(newFloor);
  }

  for (const p of bundle.points) {
    const newPoint: SurveyPoint = {
      ...p,
      id: pointIdMap.get(p.id)!,
      floorId: floorIdMap.get(p.floorId) ?? p.floorId,
      transitionId: p.transitionId ? transitionIdMap.get(p.transitionId) : undefined,
      createdAt: now,
    };
    await savePoint(newPoint);
  }

  return newProjectId;
}

/**
 * Duplicate an existing project in place: creates a fully independent copy
 * with fresh IDs, the plan image and all floors/points/notes/transitions
 * cloned, and a versioned name ("<name> V2", V3, …). Returns the new ID.
 */
export async function duplicateProject(projectId: string): Promise<string> {
  const blob = await exportProject(projectId);
  const file = new File([blob], "duplicate.floorsurvey.json", {
    type: "application/json",
  });
  const newId = await importProject(file);
  // Tag the copy so Align mode ("Replace plan image…") is only reachable
  // on duplicates. Never on the original survey.
  const newProject = await getProject(newId);
  if (newProject) {
    await saveProject({ ...newProject, parentProjectId: projectId });
  }
  return newId;
}

/**
 * Strip a trailing " V<number>" from a name to get its base, then find the
 * next free "Base V<n>" among existing projects. If nothing collides, keep
 * the original name.
 */
async function nextVersionedName(rawName: string): Promise<string> {
  const existing = await listProjects();
  const names = new Set(existing.map((p) => p.name));
  const base = rawName.replace(/\s+V\d+$/i, "").trim() || "Untitled project";
  if (!names.has(base) && !names.has(rawName)) return rawName;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} V${n}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} V${Date.now()}`;
}
