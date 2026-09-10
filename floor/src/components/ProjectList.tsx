import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Plus,
  Trash2,
  FileText,
  Download,
  Upload,
  Copy,
  MoreVertical,
  RotateCcw,
  ImagePlus,
  Share,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  listProjects,
  listTrashedProjects,
  saveProject,
  deleteProject,
  trashProject,
  restoreProject,
  uid,
  listFloors,
  listPoints,
  saveFloor,
  markProjectExported,
} from "@/lib/db";
import { exportProject, bundleFilename, downloadBundle, importProject, duplicateProject } from "@/lib/bundle";
import { OfflineModeToggle } from "@/components/OfflineModeToggle";
import { AddressGpsButtons } from "@/components/AddressGpsButtons";
import type { ProjectMeta } from "@/lib/types";

interface Row extends ProjectMeta {
  floorCount: number;
  pointCount: number;
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function isUnbackedUp(p: ProjectMeta): boolean {
  if (!p.lastExportedAt) return true;
  return p.updatedAt > p.lastExportedAt + 1000; // small tolerance
}


export function ProjectList() {
  const [projects, setProjects] = useState<Row[]>([]);
  const [trashed, setTrashed] = useState<ProjectMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nagDismissed, setNagDismissed] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [sharingAll, setSharingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();


  async function refresh() {
    const list = await listProjects();
    const enriched: Row[] = [];
    for (const p of list) {
      const floors = await listFloors(p.id);
      let pts = 0;
      for (const f of floors) pts += (await listPoints(f.id)).length;
      enriched.push({ ...p, floorCount: floors.length, pointCount: pts });
    }
    setProjects(enriched);
    setTrashed(await listTrashedProjects());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(data: Omit<ProjectMeta, "id" | "createdAt" | "updatedAt">) {
    const id = uid();
    const now = Date.now();
    await saveProject({ ...data, id, createdAt: now, updatedAt: now });
    await saveFloor({
      id: uid(),
      projectId: id,
      name: "1st Floor",
      order: 0,
      boundary: [],
      createdAt: now,
      updatedAt: now,
    });
    setOpen(false);
    navigate({ to: "/projects/$id", params: { id } });
  }

  async function handleTrash(p: Row) {
    if (!confirm(`Move "${p.name}" to trash? You can restore it later.`)) return;
    await trashProject(p.id);
    await refresh();
    toast.success("Moved to trash");
  }

  async function handleRestore(p: ProjectMeta) {
    await restoreProject(p.id);
    await refresh();
    toast.success("Restored");
  }

  async function handleDeleteForever(p: ProjectMeta) {
    if (!confirm(`Permanently delete "${p.name}"? This cannot be undone.`)) return;
    await deleteProject(p.id);
    await refresh();
    toast.success("Deleted");
  }

  async function handleExport(p: Row) {
    try {
      const blob = await exportProject(p.id);
      downloadBundle(blob, bundleFilename(p.name));
      await markProjectExported(p.id);
      await refresh();
      toast.success("Project exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  }

  async function handleExportAll() {
    const unsaved = projects.filter(isUnbackedUp);
    const targets = unsaved.length > 0 ? unsaved : projects;
    if (targets.length === 0) {
      toast("Nothing to export");
      return;
    }
    setExportingAll(true);
    let ok = 0;
    let failed = 0;
    for (const p of targets) {
      try {
        const blob = await exportProject(p.id);
        downloadBundle(blob, bundleFilename(p.name));
        await markProjectExported(p.id);
        ok++;
        // Small delay so iOS Safari doesn't drop back-to-back downloads.
        await new Promise((r) => setTimeout(r, 400));
      } catch {
        failed++;
      }
    }
    setExportingAll(false);
    await refresh();
    if (failed === 0) toast.success(`Exported ${ok} project${ok === 1 ? "" : "s"}`);
    else toast.error(`Exported ${ok}, failed ${failed}`);
  }

  async function handleShare(p: Row) {
    try {
      const blob = await exportProject(p.id);
      const filename = bundleFilename(p.name);
      const file = new File([blob], filename, { type: "application/json" });

      const shareable =
        typeof navigator !== "undefined" &&
        !!navigator.share &&
        !!navigator.canShare &&
        navigator.canShare({ files: [file] });

      if (shareable) {
        await navigator.share({ files: [file], title: p.name });
      } else {
        downloadBundle(blob, filename);
      }

      await markProjectExported(p.id);
      await refresh();
      toast.success(shareable ? "Project shared" : "Project exported");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled the share sheet.
        return;
      }
      toast.error(err instanceof Error ? err.message : "Share failed");
    }
  }

  async function handleShareAll() {
    const unsaved = projects.filter(isUnbackedUp);
    const targets = unsaved.length > 0 ? unsaved : projects;
    if (targets.length === 0) {
      toast("Nothing to share");
      return;
    }
    setSharingAll(true);
    try {
      const files: File[] = [];
      for (const p of targets) {
        const blob = await exportProject(p.id);
        files.push(new File([blob], bundleFilename(p.name), { type: "application/json" }));
      }

      const shareable =
        typeof navigator !== "undefined" &&
        !!navigator.share &&
        !!navigator.canShare &&
        navigator.canShare({ files });

      if (shareable) {
        await navigator.share({ files, title: "Floor Survey projects" });
      } else {
        for (const f of files) {
          downloadBundle(f, f.name);
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      for (const p of targets) {
        await markProjectExported(p.id);
      }
      await refresh();
      toast.success(
        shareable
          ? `Shared ${files.length} project${files.length === 1 ? "" : "s"}`
          : `Exported ${files.length} project${files.length === 1 ? "" : "s"}`,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Share failed");
    } finally {
      setSharingAll(false);
    }
  }

  async function handleDuplicate(p: Row) {
    try {
      await duplicateProject(p.id);
      await refresh();
      toast.success("Project duplicated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Duplicate failed");
    }
  }

  async function handleImportFile(file: File) {
    try {
      const newId = await importProject(file);
      toast.success("Project imported");
      await refresh();
      navigate({ to: "/projects/$id", params: { id: newId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8 flex flex-col items-center gap-4">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Floor Survey</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Topographical mapping for foundation inspection
          </p>
          <OfflineModeToggle />
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="lg" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Import
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="lg">
                <Plus className="mr-2 h-4 w-4" /> New project
              </Button>
            </DialogTrigger>
            <NewProjectDialog onCreate={handleCreate} />
          </Dialog>
        </div>
      </header>

      {(() => {
        const unsaved = projects.filter(isUnbackedUp);
        if (nagDismissed || unsaved.length === 0) return null;
        return (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-3">
            <div className="flex-1">
              <div className="font-medium">
                {unsaved.length} project{unsaved.length === 1 ? "" : "s"} not exported
              </div>
              <div className="text-xs mt-0.5 text-amber-800">
                Export saves a .json file you can re-import if the app icon is removed.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="default"
                onClick={handleExportAll}
                disabled={exportingAll || sharingAll}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {exportingAll ? "Exporting…" : "Export all"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleShareAll}
                disabled={exportingAll || sharingAll}
              >
                <Share className="mr-1 h-3.5 w-3.5" />
                {sharingAll ? "Sharing…" : "Share all"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-amber-900 hover:text-amber-900"
                onClick={() => setNagDismissed(true)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        );
      })()}


      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <Card className="p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-medium">No projects yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a project or import a bundle from another device.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <Card key={p.id} className="flex items-center justify-between p-4">
              <Link to="/projects/$id" params={{ id: p.id }} className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.name}</div>
                <div className="mt-1 text-xs text-muted-foreground break-words">
                  {p.address || "No address"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {p.inspectionDate || "no date"}
                </div>
                <div className="mt-1">
                  {isUnbackedUp(p) ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[11px] font-medium">
                      {p.lastExportedAt ? "Unsaved changes" : "Not exported"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-800 px-2 py-0.5 text-[11px] font-medium">
                      Exported {formatAgo(p.lastExportedAt!)}
                    </span>
                  )}
                </div>

              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Project actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleDuplicate(p)}>
                    <Copy className="mr-2 h-4 w-4" /> Duplicate
                  </DropdownMenuItem>
                  {p.parentProjectId && (
                    <DropdownMenuItem
                      onClick={() =>
                        navigate({
                          to: "/projects/$id",
                          params: { id: p.id },
                          hash: "align",
                        })
                      }
                    >
                      <ImagePlus className="mr-2 h-4 w-4" /> Replace plan image…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleExport(p)}>
                    <Download className="mr-2 h-4 w-4" /> Export
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleShare(p)}>
                    <Share className="mr-2 h-4 w-4" /> Share
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleTrash(p)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Move to trash
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Trash</DialogTitle>
          </DialogHeader>
          {trashed.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Trash is empty.</p>
          ) : (
            <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
              {trashed.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.address || "No address"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Trashed {p.deletedAt ? new Date(p.deletedAt).toLocaleDateString() : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => handleRestore(p)}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteForever(p)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <button
        onClick={() => {
          if (trashed.length === 0) {
            toast("Trash is empty");
            return;
          }
          setTrashOpen(true);
        }}
        aria-label={trashed.length > 0 ? `Trash (${trashed.length})` : "Trash"}
        className={`fixed right-[18px] bottom-[calc(18px+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${
          trashed.length === 0 ? "cursor-default opacity-[0.35]" : "cursor-pointer opacity-100"
        }`}
      >
        <span className="text-[24px] leading-none" aria-hidden>🗑</span>
        {trashed.length > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold">
            {trashed.length}
          </span>
        )}
      </button>
    </div>
  );
}

function NewProjectDialog({
  onCreate,
}: {
  onCreate: (p: Omit<ProjectMeta, "id" | "createdAt" | "updatedAt">) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [client, setClient] = useState("");
  const [inspector, setInspector] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div>
          <Label htmlFor="np-date" className="label-micro">
            Inspection date
          </Label>
          <Input id="np-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="np-name" className="label-micro">
            Project name
          </Label>
          <Input
            id="np-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Smith Residence"
          />
        </div>
        <div>
          <Label htmlFor="np-addr" className="label-micro">
            Address
          </Label>
          <Input id="np-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          <AddressGpsButtons onAddress={setAddress} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="np-client" className="label-micro">
              Client
            </Label>
            <Input id="np-client" value={client} onChange={(e) => setClient(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="np-insp" className="label-micro">
              Inspector
            </Label>
            <Input id="np-insp" value={inspector} onChange={(e) => setInspector(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="np-notes" className="label-micro">
            Notes
          </Label>
          <Textarea
            id="np-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() =>
            onCreate({
              name: name.trim() || "Untitled project",
              address,
              client,
              inspector,
              inspectionDate: date,
              notes,
            })
          }
        >
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}


