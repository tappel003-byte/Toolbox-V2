import { createFileRoute } from "@tanstack/react-router";
import { ProjectList } from "@/components/ProjectList";

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
  return <ProjectList />;
}
