import { useEffect, useState } from "react";
import { onWaitingWorker } from "../lib/register-sw";

export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    return onWaitingWorker((worker) => setWaiting(worker));
  }, []);

  if (!waiting) return null;

  const handleTap = () => {
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        onControllerChange,
        { once: true },
      );
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      className="fixed inset-x-0 top-0 z-[9999] bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground shadow-md"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
    >
      Update available — tap to refresh
    </button>
  );
}
