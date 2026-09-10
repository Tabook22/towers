import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSendLocationPing } from '../api/hooks';

// Don't ping more than this often even if the device reports movement constantly — keeps the
// pings table small and the map from jittering, while still giving a trail with plenty of detail
// for a walk between towers.
const MIN_INTERVAL_MS = 25_000;
// ...unless the crew has genuinely moved a meaningful distance, in which case send early so the
// trail doesn't skip a real jump (e.g. driving between two towers).
const MIN_MOVE_METERS = 15;
const STORAGE_KEY = 'iip_tracking_enabled';

export type TrackingStatus = 'idle' | 'watching' | 'denied' | 'unsupported';

export interface TrackingState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  status: TrackingStatus;
  lastSentAt: Date | null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function readStoredEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'; // default on
  } catch {
    return true;
  }
}

/** Watches the device's location while `active` (logged in) and the user hasn't turned tracking
 * off, throttling pings to the backend by time/distance. Meant to be called exactly once near the
 * app root (see TrackingProvider below) — mounting it per-page would restart the watch and lose
 * the throttle state on every navigation. */
export function useFieldTracking(active: boolean): TrackingState {
  const [enabled, setEnabledState] = useState(readStoredEnabled);
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const sendPing = useSendLocationPing();
  const lastSentRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? 'on' : 'off');
    } catch {
      /* private browsing etc. — just keep the in-memory state */
    }
  };

  useEffect(() => {
    if (!active || !enabled) {
      setStatus('idle');
      return;
    }
    if (!navigator.geolocation) {
      setStatus('unsupported');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('watching');
        const { latitude, longitude, accuracy } = pos.coords;
        const now = Date.now();
        const last = lastSentRef.current;
        const movedMeters = last ? haversineMeters(last.lat, last.lng, latitude, longitude) : Infinity;
        const elapsedMs = last ? now - last.time : Infinity;
        if (elapsedMs < MIN_INTERVAL_MS && movedMeters < MIN_MOVE_METERS) return;
        lastSentRef.current = { lat: latitude, lng: longitude, time: now };
        setLastSentAt(new Date());
        sendPing.mutate({ latitude, longitude, accuracy_m: accuracy });
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'idle');
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // sendPing is a react-query mutate function — stable enough per hook instance; re-running this
    // effect on every render would thrash the native watch for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled]);

  return { enabled, setEnabled, status, lastSentAt };
}

const TrackingContext = createContext<TrackingState | undefined>(undefined);

/** Mount once near the app root (inside AuthProvider, above the routed pages) so the watch
 * persists across navigation. `active` should be `isAuthenticated`. */
export function TrackingProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const tracking = useFieldTracking(active);
  return <TrackingContext.Provider value={tracking}>{children}</TrackingContext.Provider>;
}

export function useTracking(): TrackingState {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used within TrackingProvider');
  return ctx;
}
