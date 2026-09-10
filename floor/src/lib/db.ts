import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Floor, ProjectMeta, SurveyPoint } from "./types";

interface FloorSurveyDB extends DBSchema {
  projects: {
    key: string;
    value: ProjectMeta;
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
export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await getDB();
  const all = await db.getAll("projects");
  return all.filter((p) => !p.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function listTrashedProjects(): Promise<ProjectMeta[]> {
  const db = await getDB();
  const all = await db.getAll("projects");
  return all.filter((p) => !!p.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
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
  await db.put("projects", { ...p, updatedAt: Date.now() });
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
  const floors = await listFloors(id);
  for (const f of floors) await deleteFloor(f.id);
  await db.delete("projects", id);
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
}
export async function deleteFloor(id: string) {
  const db = await getDB();
  const points = await listPoints(id);
  for (const p of points) await db.delete("points", p.id);
  await db.delete("floors", id);
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
}
export async function deletePoint(id: string) {
  const db = await getDB();
  await db.delete("points", id);
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
