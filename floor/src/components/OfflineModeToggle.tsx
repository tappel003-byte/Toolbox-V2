import { useEffect, useState } from "react";
import { getOfflineMode, setOfflineMode } from "@/lib/register-sw";

// Rare manual escape hatch — small text link, not a daily control.
// The app is offline-capable and auto-updates in the background whenever
// signal is available; users should almost never need this. The link is only
// shown when real connectivity is confirmed, so it can never clear the offline
// cache while the user has no signal.
export function OfflineModeToggle() {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasSignal, setHasSignal] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setMounted(true);
    getOfflineMode();
  }, []);

  useEffect(() => {
    async function checkSignal() {
      if (!navigator.onLine) {
        setHasSignal(false);
        return;
      }
      try {
        await fetch("/", {
          method: "HEAD",
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        });
        setHasSignal(true);
      } catch {
        setHasSignal(false);
      }
    }

    checkSignal();
    window.addEventListener("online", checkSignal);
    window.addEventListener("offline", checkSignal);

    return () => {
      window.removeEventListener("online", checkSignal);
      window.removeEventListener("offline", checkSignal);
    };
  }, []);

  if (!mounted) return null;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!hasSignal) return null;

  async function hasConnectivity(): Promise<boolean> {
    if (!navigator.onLine) return false;
    try {
      await fetch("/", {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch {
      return false;
    }
  }

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setErrored(false);

    if (!(await hasConnectivity())) {
      setBusy(false);
      return;
    }

    // Safety net: if the reload never happens within 6s (e.g. an internal
    // step hangs), force it ourselves. If even that fails, surface an
    // error state so the user isn't stuck on "Fetching latest…".
    const forceReload = setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        setErrored(true);
        setBusy(false);
      }
    }, 6000);

    const resetOnFailure = setTimeout(() => {
      setErrored(true);
      setBusy(false);
    }, 10000);

    const next = "off";
    try {
      await withTimeout(setOfflineMode(next), 5000);
    } catch {
      // Fall through — the forceReload timeout will kick in, or the
      // resetOnFailure timeout will surface an error.
    }
    clearTimeout(forceReload);
    clearTimeout(resetOnFailure);
    // If setOfflineMode returned without triggering a reload, do it now.
    try {
      window.location.reload();
    } catch {
      setErrored(true);
      setBusy(false);
    }
  }

  const label = errored ? "Couldn’t update — tap to retry" : busy ? "Fetching latest…" : "Update app";

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy && !errored}
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        title="Clears the cached app shell and reloads from the network. Does not touch project data."
      >
        {label}
      </button>
    </div>
  );
}
