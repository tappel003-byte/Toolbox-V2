import { Pointer, Layers3 } from "lucide-react";

type Mode = "data" | "topo";

/**
 * Horizontal Data/Topo pill anchored to the lower-left corner.
 * Matches Notes pill and Tag chip: h-9, white/95 bg, gray-300 border, rounded-full.
 */
export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      className="fixed z-10 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-[calc(env(safe-area-inset-left)+0.75rem)] h-9 flex items-stretch rounded-full bg-white/95 backdrop-blur shadow-md border border-gray-300 overflow-hidden text-xs font-medium"
      role="tablist"
      aria-label="Mode"
    >
      <Btn
        active={mode === "data"}
        onClick={() => onChange("data")}
        icon={<Pointer className="w-3.5 h-3.5" />}
        label="Data"
      />
      <Btn
        active={mode === "topo"}
        onClick={() => onChange("topo")}
        icon={<Layers3 className="w-3.5 h-3.5" />}
        label="Topo"
        borderLeft
      />
    </div>
  );
}

function Btn({
  active,
  onClick,
  icon,
  label,
  borderLeft,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  borderLeft?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "px-3 py-2 flex items-center gap-1.5 transition-colors " +
        (borderLeft ? "border-l border-gray-200 " : "") +
        (active ? "bg-primary text-primary-foreground" : "text-gray-700 hover:bg-gray-50")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
