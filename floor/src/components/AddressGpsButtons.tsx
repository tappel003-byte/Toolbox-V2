import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  onAddress: (addr: string) => void;
}

export function AddressGpsButtons({ onAddress }: Props) {
  const [busy, setBusy] = useState<null | "addr" | "coords">(null);
  const [msg, setMsg] = useState<string | null>(null);

  function getPos(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("GPS not supported on this device"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
  }

  function geoError(e: unknown): string {
    const err = e as GeolocationPositionError & { message?: string };
    if (err && typeof err.code === "number") {
      if (err.code === 1) return "Location permission denied";
      if (err.code === 2) return "Location unavailable";
      if (err.code === 3) return "Location request timed out";
    }
    return err?.message || "Could not get location";
  }

  async function fillAddress() {
    setBusy("addr");
    setMsg(null);
    try {
      const pos = await getPos();
      const { latitude, longitude } = pos.coords;
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
        const data = await res.json();
        const display: string | undefined = data?.display_name;
        if (display) {
          onAddress(display);
          setMsg(null);
        } else {
          onAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
          setMsg("No address found — filled coordinates instead");
        }
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      try {
        const pos = await getPos();
        const { latitude, longitude, accuracy } = pos.coords;
        onAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`);
        setMsg("Address lookup failed — filled coordinates instead");
      } catch {
        setMsg(geoError(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function fillCoords() {
    setBusy("coords");
    setMsg(null);
    try {
      const pos = await getPos();
      const { latitude, longitude, accuracy } = pos.coords;
      onAddress(`${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`);
    } catch (e) {
      setMsg(geoError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={fillAddress} disabled={busy !== null}>
        {busy === "addr" ? "Locating…" : "Auto-fill address"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={fillCoords} disabled={busy !== null}>
        {busy === "coords" ? "Locating…" : "Use GPS coords only"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
