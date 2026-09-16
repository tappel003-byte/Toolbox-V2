import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Floor, ProjectMeta, SurveyPoint } from "./types";

// Toolbox cabinet integration: when opened as .../index.html?job=<key>, this
// tags whichever project gets created/edited here to that Toolbox customer
// (so the same-origin, unscoped "floor-survey" project list only ever shows
// that customer's own project — the list/setup UI itself is untouched, it's
// just fed a filtered result), and mirrors that project's floors + points
// into the shared job record after every save, in the same shape the
// .floorsurvey.json importer already produces. This app's own "floor-survey"
// database remains the source of truth and keeps working standalone; the
// mirror is an additional write, never a replacement.
const TOOLBOX_JOB_KEY: string | null =
  typeof location !== "undefined" ? new URLSearchParams(location.search).get("job") : null;

type StoredProjectMeta = ProjectMeta & { toolboxJobKey?: string };
// Same origin-tagging convention js/drawer-import.js already uses for
// Distress Survey pins — 'import' rows come from a .floorsurvey.json import
// and are never touched by dual-write; 'native' rows are this drawer's own.
type Tagged<T> = T & { origin?: "import" | "native" };

interface FloorSurveyDB extends DBSchema {
  projects: {
    key: string;
    value: StoredProjectMeta;
    indexes: { updatedAt: number };
  };
  floors: {
    key: string;
    value: Floor;
    indexes: { projectId: string };
  };
  points: {
    key: string;
    value: SurveyPoint;
    indexes: { floorId: string };
  };
}

let dbPromise: Promise<IDBPDatabase<FloorSurveyDB>> | null = null;

const REQUIRED_STORES = ["projects", "floors", "points"] as const;

function hasRequiredStores(db: { objectStoreNames: DOMStringList }) {
  return REQUIRED_STORES.every((name) => db.objectStoreNames.contains(name));
}

function openFreshDB() {
  return openDB<FloorSurveyDB>("floor-survey", 3, {
    upgrade(db) {
      const p = db.createObjectStore("projects", { keyPath: "id" });
      p.createIndex("updatedAt", "updatedAt");
      const f = db.createObjectStore("floors", { keyPath: "id" });
      f.createIndex("projectId", "projectId");
      const pt = db.createObjectStore("points", { keyPath: "id" });
      pt.createIndex("floorId", "floorId");
    },
  });
}

function getDB() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB not available");
  }
  if (!dbPromise) {
    dbPromise = openDB<FloorSurveyDB>("floor-survey").then(async (db) => {
      if (hasRequiredStores(db)) return db as IDBPDatabase<FloorSurveyDB>;
      db.close();
      await indexedDB.deleteDatabase("floor-survey");
      return openFreshDB();
    });
  }
  return dbPromise;
}

// Projects
function forThisJob(p: StoredProjectMeta): boolean {
  // No ?job= (standalone use) — unfiltered, exactly as before.
  if (!TOOLBOX_JOB_KEY) return true;
  return p.toolboxJobKey === TOOLBOX_JOB_KEY;
}
export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await getDB();
  const all = await db.getAll("projects");
  return all.filter((p) => !p.deletedAt && forThisJob(p)).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function listTrashedProjects(): Promise<ProjectMeta[]> {
  const db = await getDB();
  const all = await db.getAll("projects");
  return all.filter((p) => !!p.deletedAt && forThisJob(p)).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}
export async function trashProject(id: string) {
  const db = await getDB();
  const p = await db.get("projects", id);
  if (!p) return;
  await db.put("projects", { ...p, deletedAt: Date.now(), updatedAt: Date.now() });
}
export async function restoreProject(id: string) {
  const db = await getDB();
  const p = await db.get("projects", id);
  if (!p) return;
  const { deletedAt: _d, ...rest } = p;
  void _d;
  await db.put("projects", { ...rest, updatedAt: Date.now() });
}
export async function getProject(id: string) {
  const db = await getDB();
  return db.get("projects", id);
}
export async function saveProject(p: ProjectMeta) {
  const db = await getDB();
  const existing = await db.get("projects", p.id);
  // First save while a Toolbox job is open adopts this project for that job;
  // once tagged, it stays tagged (never silently reassigned to another job).
  const toolboxJobKey = existing?.toolboxJobKey ?? (TOOLBOX_JOB_KEY || undefined);
  await db.put("projects", { ...p, toolboxJobKey, updatedAt: Date.now() });
  mirrorProjectToJobPocket(p.id);
}
export async function markProjectExported(id: string) {
  const db = await getDB();
  const p = await db.get("projects", id);
  if (!p) return;
  // Do NOT bump updatedAt — this is a backup event, not a data edit.
  await db.put("projects", { ...p, lastExportedAt: Date.now() });
}

export async function deleteProject(id: string) {
  const db = await getDB();
  const project = await db.get("projects", id);
  const floors = await listFloors(id);
  for (const f of floors) await deleteFloor(f.id);
  await db.delete("projects", id);
  // Each deleteFloor above queues its own mirror of the shrinking floor list,
  // but those are fire-and-forget and can still be pending once the project
  // row itself is gone (mirrorProjectToJobPocket would then find no project
  // and skip writing) — so explicitly, synchronously clear the job record
  // here rather than rely on that queue draining in time.
  if (project?.toolboxJobKey) await clearJobFloorSurvey(project.toolboxJobKey);
}

// Floors
export async function listFloors(projectId: string): Promise<Floor[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("floors", "projectId", projectId);
  return all.sort((a, b) => a.order - b.order);
}
export async function saveFloor(f: Floor) {
  const db = await getDB();
  await db.put("floors", { ...f, updatedAt: Date.now() });
  mirrorProjectToJobPocket(f.projectId);
}
export async function deleteFloor(id: string) {
  const db = await getDB();
  const floor = await db.get("floors", id);
  const points = await listPoints(id);
  for (const p of points) await db.delete("points", p.id);
  await db.delete("floors", id);
  if (floor) mirrorProjectToJobPocket(floor.projectId);
}

// Points
export async function listPoints(floorId: string): Promise<SurveyPoint[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("points", "floorId", floorId);
  return all.sort((a, b) => a.index - b.index);
}
export async function savePoint(p: SurveyPoint) {
  const db = await getDB();
  await db.put("points", p);
  const floor = await db.get("floors", p.floorId);
  if (floor) mirrorProjectToJobPocket(floor.projectId);
}
export async function deletePoint(id: string) {
  const db = await getDB();
  const point = await db.get("points", id);
  await db.delete("points", id);
  if (point) {
    const floor = await db.get("floors", point.floorId);
    if (floor) mirrorProjectToJobPocket(floor.projectId);
  }
}

/** Reassign sequential indexes (1..N) to points on a floor, ordered by current index. */
export async function reindexFloorPoints(floorId: string): Promise<SurveyPoint[]> {
  const db = await getDB();
  const all = (await db.getAllFromIndex("points", "floorId", floorId)).sort(
    (a, b) => a.index - b.index,
  );
  const tx = db.transaction("points", "readwrite");
  const updated: SurveyPoint[] = [];
  for (let i = 0; i < all.length; i++) {
    const next = { ...all[i], index: i + 1 };
    updated.push(next);
    await tx.store.put(next);
  }
  await tx.done;
  return updated;
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------- Toolbox cabinet integration (dual-write) ----------
// Same-origin access to Toolbox's shared job pocket (js/db.js:
// 'sandia-job-pocket' / store 'jobs' / keyPath 'addressKey'), reimplemented
// here against the raw IndexedDB API rather than importing that plain script
// as an ES module, so this file stays a self-contained module. Same DB name
// and version — this opens the exact same underlying browser database.
interface JobPocketDB extends DBSchema {
  jobs: { key: string; value: Record<string, unknown> };
}
let jobPocketPromise: Promise<IDBPDatabase<JobPocketDB>> | null = null;
function getJobPocket() {
  if (!jobPocketPromise) {
    jobPocketPromise = openDB<JobPocketDB>("sandia-job-pocket", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("jobs")) {
          db.createObjectStore("jobs", { keyPath: "addressKey" });
        }
      },
    });
  }
  return jobPocketPromise;
}

let mirrorChain: Promise<void> = Promise.resolve();
function mirrorProjectToJobPocket(projectId: string) {
  if (!TOOLBOX_JOB_KEY) return;
  mirrorChain = mirrorChain.then(async () => {
    try {
      const db = await getDB();
      const project = await db.get("projects", projectId);
      // Never mirror a project that belongs to a different job (or none) —
      // dual-write only applies to the project actually adopted by this job.
      if (!project || project.toolboxJobKey !== TOOLBOX_JOB_KEY) return;
      const floors = await listFloors(projectId);
      const points: SurveyPoint[] = [];
      for (const f of floors) points.push(...(await listPoints(f.id)));

      const pocket = await getJobPocket();
      const job = await pocket.get("jobs", TOOLBOX_JOB_KEY);
      if (!job) return;
      // Merge, never replace: imported floors/points (from a .floorsurvey.json
      // import) are never touched here — only the native side is recomputed
      // from this drawer's current state each save. A native floor id
      // colliding with an imported one gets a fresh id, same rule
      // js/customer.js's JSON import handler already uses in the other
      // direction, so import and native capture can't destroy each other.
      const existingFloorSurvey = (job.floorSurvey as Record<string, unknown>) || {};
      const existingFloors = ((existingFloorSurvey.floors as Tagged<Floor>[]) || []);
      const existingPoints = ((existingFloorSurvey.points as Tagged<SurveyPoint>[]) || []);
      const importedFloors = existingFloors.filter((f) => f.origin === "import");
      const importedFloorIds = new Set(importedFloors.map((f) => f.id));
      const importedPoints = existingPoints.filter((p) => p.origin === "import");

      let nativeFloors: Tagged<Floor>[] = floors.map((f) => ({ ...f, origin: "native" }));
      let nativePoints: Tagged<SurveyPoint>[] = points.map((p) => ({ ...p, origin: "native" }));
      nativeFloors = nativeFloors.map((f) => {
        if (!importedFloorIds.has(f.id)) return f;
        const newId = "floor_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        nativePoints = nativePoints.map((p) => (p.floorId === f.id ? { ...p, floorId: newId } : p));
        return { ...f, id: newId };
      });

      job.floorSurvey = {
        ...existingFloorSurvey,
        floors: importedFloors.concat(nativeFloors),
        points: importedPoints.concat(nativePoints),
        updatedAt: Date.now(),
      };
      job.updatedAt = Date.now();
      await pocket.put("jobs", job);
    } catch (e) {
      console.warn("Toolbox dual-write failed (local save is unaffected):", e);
    }
  });
}

// Chained onto the same queue as mirrorProjectToJobPocket so it always runs
// after any already-queued mirror for this job, and can never be clobbered
// by one that was still in flight when the project was deleted.
function clearJobFloorSurvey(jobKey: string): Promise<void> {
  mirrorChain = mirrorChain.then(async () => {
    try {
      const pocket = await getJobPocket();
      const job = await pocket.get("jobs", jobKey);
      if (!job) return;
      // Deleting the native project clears only the native side — imported
      // floors/points (from a .floorsurvey.json import) are a separate,
      // untouched source and must survive this drawer's project going away.
      const existingFloorSurvey = (job.floorSurvey as Record<string, unknown>) || {};
      const importedFloors = ((existingFloorSurvey.floors as Tagged<Floor>[]) || []).filter((f) => f.origin === "import");
      const importedPoints = ((existingFloorSurvey.points as Tagged<SurveyPoint>[]) || []).filter((p) => p.origin === "import");
      job.floorSurvey = { floors: importedFloors, points: importedPoints, updatedAt: Date.now() };
      job.updatedAt = Date.now();
      await pocket.put("jobs", job);
    } catch (e) {
      console.warn("Toolbox dual-write failed (local save is unaffected):", e);
    }
  });
  return mirrorChain;
}

// ---------- Toolbox cabinet integration (job-mode entry gate) ----------
// Approved freeze exception: when opened with ?job=<key>, skip this app's
// own new-project entry (name/address/client typed by hand) — the job
// already has that. getOrCreateJobProject() finds-or-makes the one project
// this job owns; syncFloorsFromJobLevels() finds-or-makes one Floor per
// folder level, named to match so re-opening never asks the user to
// recreate a level that already exists. Boundary + exclusions are left
// empty here on purpose — those stay something the user draws inside this
// app's own (untouched) Setup/Topo tools, per the freeze.
export async function getToolboxJob(): Promise<Record<string, unknown> | null> {
  if (!TOOLBOX_JOB_KEY) return null;
  const pocket = await getJobPocket();
  const job = await pocket.get("jobs", TOOLBOX_JOB_KEY);
  return job ?? null;
}

export async function getOrCreateJobProject(job: {
  address?: string;
  people?: { primaryName?: string };
}): Promise<ProjectMeta> {
  if (!TOOLBOX_JOB_KEY) throw new Error("Not opened as ?job=<key>");
  const existing = await listProjects(); // already filtered to this job
  if (existing.length) return existing[0];
  const now = Date.now();
  const meta: ProjectMeta = {
    id: uid(),
    name: job.address || "Survey",
    address: job.address || "",
    client: (job.people && job.people.primaryName) || "",
    inspector: "",
    inspectionDate: "",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(meta); // auto-tags toolboxJobKey on first save
  return meta;
}

// Reading job.planImage (a Blob out of IndexedDB) the same way the Distress
// drawer's equivalent bug was fixed: an object URL, not FileReader — it
// doesn't read the Blob's bytes up front, it just hands the browser a
// reference the <img> resolves lazily when it actually loads.
async function blobToDataUrl(blob: Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read the plan photo."));
      el.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function syncFloorsFromJobLevels(
  projectId: string,
  levels: Array<{ id: string; name: string }>,
  planImage: Blob | null,
): Promise<Floor[]> {
  const existingFloors = await listFloors(projectId);
  let planShape: { dataUrl: string; width: number; height: number } | null = null;
  const result: Floor[] = [];
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const match = existingFloors.find((f) => f.name === level.name);
    if (match) {
      result.push(match);
      continue;
    }
    if (!planShape && planImage) {
      planShape = await blobToDataUrl(planImage);
    }
    const now = Date.now();
    const floor: Floor = {
      id: uid(),
      projectId,
      name: level.name,
      order: i,
      planDataUrl: planShape?.dataUrl,
      planWidth: planShape?.width,
      planHeight: planShape?.height,
      boundary: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveFloor(floor);
    result.push(floor);
  }
  return result;
}
