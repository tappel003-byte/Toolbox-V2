import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ProjectList } from "@/components/ProjectList";
import { getToolboxJob, getOrCreateJobProject, syncFloorsFromJobLevels } from "@/lib/db";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Floor Survey — Foundation topo mapping" },
      {
        name: "description",
        content:
          "Offline-first floor elevation survey app for foundation inspectors. Capture points, generate topographical maps, export deliverables.",
      },
      { property: "og:title", content: "Floor Survey" },
      {
        property: "og:description",
        content: "Foundation topo mapping for field inspectors.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Index,
});

function Index() {
  const jobKey =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("job") : null;
  if (jobKey) return <JobModeBoot />;
  return <ProjectList />;
}

// Approved freeze exception: opened as .../?job=<key>, this skips the app's
// own new-project entry (typing a name/address/client by hand) entirely —
// finds or creates the one project this job owns, finds or creates one
// Floor per folder level (named to match, so a level already named in
// Toolbox is never recreated here), then hands off straight into the
// existing, unmodified project workspace. Boundary/exclusions are left for
// the user to draw inside that workspace's own Setup/Topo tools, same as
// any other project.
function JobModeBoot() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const job = await getToolboxJob();
        if (!job) {
          if (!cancelled) setError("Could not open this customer file.");
          return;
        }
        const rawLevels = job.levels as Array<{ id: string; name: string }> | undefined;
        const levels = Array.isArray(rawLevels) && rawLevels.length
          ? rawLevels
          : [{ id: "level-1", name: "Main" }];
        const project = await getOrCreateJobProject(
          job as { address?: string; people?: { primaryName?: string } },
        );
        await syncFloorsFromJobLevels(project.id, levels, (job.planImage as Blob) || null);
        if (!cancelled) navigate({ to: "/projects/$id", params: { id: project.id } });
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Could not open this customer file.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return <div className="p-6 text-sm text-muted-foreground">{error}</div>;
  }
  return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
}
