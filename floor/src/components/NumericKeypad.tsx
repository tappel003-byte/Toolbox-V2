import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Delete, Check, X, Repeat2, Trash2, ArrowLeftRight, Undo2 } from "lucide-react";

interface ActiveTransition {
  label: string; // e.g. "→ Carpet"
  delta: number; // signed
}

export interface SurfaceOption {
  /** Transition id to tag the point with. null = root anchor surface (no tag). */
  id: string | null;
  surface: string;
  delta: number; // signed, relative to root anchor (0 for root)
}

interface Props {
  open: boolean;
  initialValue?: number;
  repeatValue?: number;
  title?: string;
  subtitle?: string;
  onSubmit: (value: number) => void;
  onClose: () => void;
  onDelete?: () => void;
  onAddTransition?: () => void;
  activeTransition?: ActiveTransition | null;
  onRemoveTransition?: () => void;
  /** When ≥2, replaces the single Enter button with a horizontal row of surface-choice buttons. */
  surfaceOptions?: SurfaceOption[];
  /** Required when surfaceOptions is provided. Submits value + chosen surface. */
  onSubmitWithOption?: (value: number, opt: SurfaceOption) => void;
  /** Highlights the currently-selected option (e.g. the transition id this point is already tagged with). */
  selectedSurfaceId?: string | null;
  onUndo?: () => void;
  canUndo?: boolean;
  /** Ends the active transition chain without submitting a point. Shown when activeTransition is set. */
  onEndTransition?: () => void;
  /** Chain root's baseline surface — drives the "All corrections resolve back to X" caption. */
  baselineSurface?: string | null;

}


/** Large arm's-length numeric keypad (bottom sheet). */
export function NumericKeypad({
  open,
  initialValue,
  repeatValue,
  title = "Elevation",
  subtitle,
  onSubmit,
  onClose,
  onDelete,
  onAddTransition,
  activeTransition,
  onRemoveTransition,
  surfaceOptions,
  onSubmitWithOption,
  selectedSurfaceId,
  onUndo,
  canUndo,
  onEndTransition,
  baselineSurface,
}: Props) {


  void onRemoveTransition;


  const [text, setText] = useState<string>("");

  useEffect(() => {
    if (open) setText(initialValue != null ? String(initialValue) : "");
  }, [open, initialValue]);

  function push(ch: string) {
    setText((cur) => {
      if (ch === ".") {
        if (cur.includes(".")) return cur;
        return cur === "" || cur === "-" ? cur + "0." : cur + ".";
      }
      return cur + ch;
    });
  }
  function backspace() {
    setText((c) => c.slice(0, -1));
  }
  function toggleSign() {
    setText((c) => (c.startsWith("-") ? c.slice(1) : "-" + c));
  }
  function submit() {
    const n = parseFloat(text);
    if (isFinite(n)) onSubmit(n);
  }
  function repeatLast() {
    if (repeatValue != null && isFinite(repeatValue)) onSubmit(repeatValue);
  }

  // Hardware keyboard support (desktop numpad + main row)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const k = e.key;
      if (k >= "0" && k <= "9") {
        e.preventDefault();
        push(k);
        return;
      }
      if (k === "." || k === ",") {
        e.preventDefault();
        push(".");
        return;
      }
      if (k === "Backspace") {
        e.preventDefault();
        backspace();
        return;
      }
      if (k === "-") {
        e.preventDefault();
        toggleSign();
        return;
      }
      if (k === "Enter" || k === "=") {
        e.preventDefault();
        const n = parseFloat(text);
        if (isFinite(n)) onSubmit(n);
        else if (repeatValue != null && isFinite(repeatValue)) onSubmit(repeatValue);
        return;
      }
      if (k === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (k === "r" || k === "R") {
        if (repeatValue != null && isFinite(repeatValue)) {
          e.preventDefault();
          onSubmit(repeatValue);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, text, repeatValue, onSubmit, onClose]);

  if (!open) return null;

  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

  const hasSurfaceRow = !!(surfaceOptions && surfaceOptions.length >= 2 && onSubmitWithOption);
  const usesBottomCorrectionActions = hasSurfaceRow || !!activeTransition;
  const hasRepeat = repeatValue != null && isFinite(repeatValue);
  const showRepeat = hasRepeat && !activeTransition;
  const showShortcutRow = !!onAddTransition || showRepeat;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/30" onClick={onClose}>
      <div
        className="bg-background rounded-t-2xl shadow-2xl p-4 pb-6 landscape-short:p-3 landscape-short:pb-3 max-w-md landscape-short:max-w-2xl w-full mx-auto max-h-[95dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-1 mb-2">
          <div className="flex items-center gap-1">
            {onUndo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Undo"
                className="gap-1.5 h-9 px-2 text-muted-foreground disabled:opacity-40"
              >
                <Undo2 className="h-4 w-4" />
                <span className="text-xs">Undo</span>
              </Button>
            )}
            {activeTransition && onEndTransition && (
              <Button
                variant="outline"
                size="sm"
                onClick={onEndTransition}
                className="h-9 px-2.5 gap-1.5 border-amber-400 text-amber-700 hover:bg-amber-50"
              >
                <Check className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Done with this transition</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1">
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label="Delete point"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close keypad">
            <X className="h-5 w-5" />
          </Button>
          </div>
        </div>

        {(hasSurfaceRow || activeTransition) && baselineSurface && (
          <div className="mb-2 px-1 text-[11px] italic text-amber-800">
            All corrections resolve back to {baselineSurface}
          </div>
        )}



        <div className="landscape-short:grid landscape-short:grid-cols-[1fr_1.4fr] landscape-short:gap-3">
          <div className="landscape-short:flex landscape-short:flex-col landscape-short:justify-center">
            <div className="mb-1 landscape-short:mb-1 rounded-lg border bg-muted/40 px-4 py-3 text-right text-4xl landscape-short:text-3xl font-mono tabular-nums h-16 landscape-short:h-12 flex items-center justify-end">
              {text || (
                <span className="text-muted-foreground/25">0.0</span>
              )}
            </div>
            {showShortcutRow && (
              <div className="mb-3 landscape-short:mb-0 flex gap-2">
                {onAddTransition && (
                  <button
                    onClick={onAddTransition}
                    className="flex-1 h-11 landscape-short:h-9 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-primary text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.99]"
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                    {activeTransition ? "Add another" : "Correct for flooring"}
                  </button>
                )}
                {showRepeat && (
                  <button
                    onClick={repeatLast}
                    className="flex-1 h-11 landscape-short:h-9 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-primary text-sm font-medium flex items-center justify-center gap-1.5 active:scale-[0.99]"
                  >
                    <Repeat2 className="h-4 w-4" /> Repeat ({repeatValue!.toFixed(2)})
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 landscape-short:gap-1.5">
            {keys.map((k) => (
              <KeyBtn key={k} onClick={() => push(k)}>
                {k}
              </KeyBtn>
            ))}
            <KeyBtn onClick={toggleSign}>±</KeyBtn>
            <KeyBtn onClick={() => push("0")}>0</KeyBtn>
            <KeyBtn onClick={() => push(".")}>.</KeyBtn>
            {usesBottomCorrectionActions ? null : (
              <>
                <KeyBtn onClick={backspace} className="col-span-1">
                  <Delete className="h-6 w-6 mx-auto" />
                </KeyBtn>
                <button
                  onClick={submit}
                  disabled={!text || !isFinite(parseFloat(text))}
                  className="col-span-2 h-16 landscape-short:h-10 rounded-lg bg-primary text-primary-foreground text-xl landscape-short:text-base font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Check className="h-6 w-6 landscape-short:h-5 landscape-short:w-5" />
                  Enter
                </button>
              </>
            )}
          </div>
          {usesBottomCorrectionActions && (
            <div className="mt-2 landscape-short:mt-1.5 flex items-stretch gap-2 landscape-short:gap-1.5 col-span-full">
              <button
                onClick={backspace}
                aria-label="Backspace"
                className="h-14 landscape-short:h-10 w-14 landscape-short:w-12 shrink-0 rounded-lg bg-secondary hover:bg-secondary/80 flex items-center justify-center active:scale-95 transition-transform"
              >
                <Delete className="h-6 w-6" />
              </button>
              {hasSurfaceRow ? surfaceOptions!.map((opt) => {
                const sign = opt.delta > 0 ? "+" : opt.delta < 0 ? "−" : "";
                const deltaText = opt.delta === 0 ? "0.0" : `${sign}${Math.abs(opt.delta).toFixed(1)}`;
                const disabled = !text || !isFinite(parseFloat(text));
                const isSelected =
                  selectedSurfaceId !== undefined &&
                  (opt.id ?? null) === (selectedSurfaceId ?? null);
                return (
                  <button
                    key={opt.id ?? "root"}
                    onClick={() => {
                      const n = parseFloat(text);
                      if (isFinite(n)) onSubmitWithOption?.(n, opt);
                    }}
                    disabled={disabled}
                    className={
                      "flex-1 min-w-0 h-14 landscape-short:h-10 rounded-lg font-semibold disabled:opacity-40 flex flex-col items-center justify-center leading-tight px-1 " +
                      (isSelected
                        ? "bg-amber-500 text-white ring-2 ring-amber-300"
                        : "bg-primary text-primary-foreground")
                    }
                  >
                    <span className="text-sm landscape-short:text-xs truncate max-w-full">
                      {opt.surface}
                    </span>
                    <span className="font-mono text-xs landscape-short:text-[10px] opacity-90 tabular-nums">
                      {deltaText}
                    </span>
                  </button>
                );
              }) : (

                <button
                  onClick={submit}
                  disabled={!text || !isFinite(parseFloat(text))}
                  className="flex-1 min-w-0 h-14 landscape-short:h-10 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40 flex items-center justify-center gap-2 px-2"
                >
                  <Check className="h-5 w-5" />
                  Enter
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function KeyBtn({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "h-16 landscape-short:h-10 rounded-lg bg-secondary hover:bg-secondary/80 text-2xl landscape-short:text-lg font-semibold active:scale-95 transition-transform " +
        className
      }
    >
      {children}
    </button>
  );
}
