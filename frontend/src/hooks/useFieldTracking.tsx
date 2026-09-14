import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSendLocationPing } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

// Refresh cadence the user asked for: a new point on the path at least every 10s, moving or not.
const MIN_INTERVAL_MS = 10_000;
const MIN_MOVE_METERS = 12;
const HEARTBEAT_MS = 10_000;
const STORAGE_KEY = 'iip_tracking_enabled';
export const PENDING_PING_KEY = 'iip_pending_ping';

export function isFieldTrackingRole(role?: string | null): boolean {
  return role === 'team_leader' || role === 'team_member' || role === 'inspector';
}

export type TrackingStatus = 'idle' | 'locating' | 'watching' | 'denied' | 'unsupported';

export interface TrackingState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  status: TrackingStatus;
  lastSentAt: Date | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  /** Call only from a tap — that tap is what opens the phone's Allow popup. */
  requestNow: () => void;
  required: boolean;
  needsAllow: boolean;
  insecure: boolean;
  /** User just tapped Allow GPS; the OS popup should be visible at the top of the screen. */
  waitingForPrompt: boolean;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lon2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function readStoredEnabled(required: boolean): boolean {
  if (required) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function stashPendingPing(latitude: number, longitude: number, accuracy_m?: number | null) {
  try {
    sessionStorage.setItem(PENDING_PING_KEY, JSON.stringify({ latitude, longitude, accuracy_m: accuracy_m ?? null }));
  } catch {
    /* private browsing */
  }
}

function isInsecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false;
}

/**
 * Exactly one getCurrentPosition, called in the same tick as a tap (Sign in / Allow GPS).
 * A second delayed request is outside the user-gesture window and makes Safari/Chrome
 * hide or auto-block the Allow popup.
 */
export function requestBrowserLocation(
  onOk: (lat: number, lng: number, accuracy?: number | null) => void,
  onDenied?: () => void,
  _fresh = true,
) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onDenied?.();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onOk(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) onDenied?.();
    },
    { enableHighAccuracy: true, timeout: 45_000, maximumAge: 0 },
  );
}

async function geoAlreadyAllowed(): Promise<boolean> {
  try {
    const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return perm.state === 'granted';
  } catch {
    return false;
  }
}

export function useFieldTracking(active: boolean, required = false): TrackingState {
  const [enabled, setEnabledState] = useState(() => readStoredEnabled(required));
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [lastLatitude, setLastLatitude] = useState<number | null>(null);
  const [lastLongitude, setLastLongitude] = useState<number | null>(null);
  const [waitingForPrompt, setWaitingForPrompt] = useState(false);
  const sendPing = useSendLocationPing();
  const sendPingRef = useRef(sendPing);
  sendPingRef.current = sendPing;
  const lastSentRef = useRef<{ lat: number; lng: number; time: number; acc: number } | null>(null);
  const deniedRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const askAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const insecure = isInsecureContext();

  const consider = useCallback((latitude: number, longitude: number, accuracy?: number | null, force = false) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const now = Date.now();
    const acc = Number.isFinite(accuracy) ? (accuracy as number) : 50;
    if (acc > 50_000) return;
    const last = lastSentRef.current;
    const movedMeters = last ? haversineMeters(last.lat, last.lng, latitude, longitude) : Infinity;
    const elapsedMs = last ? now - last.time : Infinity;

    if (last && acc > last.acc * 1.8 && acc > 80 && elapsedMs < 5 * 60_000) {
      if (force) {
        lastSentRef.current = { ...last, time: now };
        setLastSentAt(new Date());
        setLastLatitude(last.lat);
        setLastLongitude(last.lng);
        setStatus('watching');
        setWaitingForPrompt(false);
        sendPingRef.current.mutate({ latitude: last.lat, longitude: last.lng, accuracy_m: last.acc });
      } else {
        setStatus('watching');
        setWaitingForPrompt(false);
      }
      return;
    }

    const heartbeatDue = elapsedMs >= HEARTBEAT_MS;
    if (!force && !heartbeatDue && elapsedMs < MIN_INTERVAL_MS) {
      setStatus('watching');
      setWaitingForPrompt(false);
      return;
    }
    if (!force && !heartbeatDue && movedMeters < MIN_MOVE_METERS) {
      setStatus('watching');
      setWaitingForPrompt(false);
      return;
    }
    lastSentRef.current = { lat: latitude, lng: longitude, time: now, acc };
    setLastSentAt(new Date());
    setLastLatitude(latitude);
    setLastLongitude(longitude);
    setStatus('watching');
    setWaitingForPrompt(false);
    deniedRef.current = false;
    sendPingRef.current.mutate({ latitude, longitude, accuracy_m: acc });
  }, []);

  // Keeps the screen from auto-locking while tracking is on — the single biggest real-world cause
  // of "tracking stopped": the phone's own screen timeout, not the OS killing the page outright.
  // Only ever mitigates that one case: the spec releases the lock the instant the tab is hidden
  // (a call taking over the screen, or the crew switching apps), and no web API can override that
  // or a manual power-button lock — those need a native app with real background-location
  // permission, which this browser-only tracker cannot grant itself.
  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null;
      });
    } catch {
      /* refused (e.g. low battery mode) or unsupported — tracking still runs, screen may sleep */
    }
  }, []);

  const startWatch = useCallback(() => {
    void acquireWakeLock();
    if (watchIdRef.current != null || !navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => consider(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          deniedRef.current = true;
          setStatus('denied');
          setWaitingForPrompt(false);
        }
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
  }, [consider, acquireWakeLock]);

  // iOS Safari in particular can leave a watchPosition subscription silently dead after the page
  // was backgrounded for a while (screen lock, a call, switching apps) — it never fires an error,
  // it just stops delivering. Tearing down and re-registering on the way back to foreground is the
  // known workaround, so the crew doesn't have to reopen the app for tracking to resume.
  const restartWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    startWatch();
  }, [startWatch]);

  const requestNow = useCallback(() => {
    if (isInsecureContext()) {
      setStatus('unsupported');
      return;
    }
    if (!navigator.geolocation) {
      setStatus('unsupported');
      return;
    }
    const now = Date.now();
    if (now - askAtRef.current < 800) return;
    askAtRef.current = now;
    deniedRef.current = false;
    setWaitingForPrompt(true);
    setStatus('locating');
    // Must run in this tap. Do not setTimeout / await before getCurrentPosition.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        consider(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
        startWatch();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          deniedRef.current = true;
          setStatus('denied');
          setWaitingForPrompt(false);
        } else {
          setWaitingForPrompt(false);
          setStatus((prev) => (prev === 'watching' ? prev : 'locating'));
        }
      },
      { enableHighAccuracy: true, timeout: 45_000, maximumAge: 0 },
    );
  }, [consider, startWatch]);

  const setEnabled = (v: boolean) => {
    if (required && !v) return;
    setEnabledState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? 'on' : 'off');
    } catch {
      /* private browsing */
    }
    if (v) requestNow();
  };

  useEffect(() => {
    if (required && !enabled) setEnabledState(true);
  }, [required, enabled]);

  useEffect(() => {
    if (!active || !enabled) {
      setStatus('idle');
      return;
    }
    if (isInsecureContext()) {
      setStatus('unsupported');
      return;
    }

    try {
      const raw = sessionStorage.getItem(PENDING_PING_KEY);
      if (raw) {
        sessionStorage.removeItem(PENDING_PING_KEY);
        const pending = JSON.parse(raw) as { latitude: number; longitude: number; accuracy_m?: number | null };
        consider(pending.latitude, pending.longitude, pending.accuracy_m, true);
        startWatch();
      }
    } catch {
      /* ignore */
    }

    // Field crews: start the GPS watch as soon as they are logged in. If the browser already
    // allowed Location at Sign in, pings go out immediately. If not, status stays locating and
    // the Allow banner still appears — we cannot open the OS popup without a tap.
    startWatch();
    void geoAlreadyAllowed().then((allowed) => {
      if (deniedRef.current) return;
      if (allowed) {
        requestNow();
        startWatch();
      } else if (!lastSentRef.current) {
        setStatus('locating');
      }
    });

    const interval = window.setInterval(() => {
      if (deniedRef.current || !lastSentRef.current) return;
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => consider(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true),
        () => undefined,
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 20_000 },
      );
    }, HEARTBEAT_MS);

    const onVis = () => {
      if (document.visibilityState === 'visible' && lastSentRef.current && !deniedRef.current) {
        // Re-arm the watch itself, not just take one reading — see restartWatch's comment on why
        // a stale watchPosition subscription needs replacing, not just topping up.
        restartWatch();
        navigator.geolocation?.getCurrentPosition(
          (pos) => consider(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true),
          () => undefined,
          { enableHighAccuracy: false, timeout: 15_000, maximumAge: 20_000 },
        );
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [active, enabled, consider, requestNow, startWatch, restartWatch]);

  const needsAllow = Boolean(
    active && enabled && !insecure && !lastSentAt && status !== 'watching' && status !== 'unsupported',
  );

  return {
    enabled,
    setEnabled,
    status,
    lastSentAt,
    lastLatitude,
    lastLongitude,
    requestNow,
    required,
    needsAllow,
    insecure,
    waitingForPrompt,
  };
}

const TrackingContext = createContext<TrackingState | undefined>(undefined);

export function TrackingProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const required = isFieldTrackingRole(user?.role) || user?.team_id != null;
  const tracking = useFieldTracking(active && !!user, required);
  return <TrackingContext.Provider value={tracking}>{children}</TrackingContext.Provider>;
}

export function useTracking(): TrackingState {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used within TrackingProvider');
  return ctx;
}
