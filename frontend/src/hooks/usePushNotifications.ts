import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';

/** Converts the VAPID public key (URL-safe base64, as returned by GET /api/push/vapid-public-key)
 * into the Uint8Array the Push API's `applicationServerKey` option requires — standard Web Push
 * boilerplate, no library needed for just this. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type PushStatus = 'unsupported' | 'default' | 'denied' | 'subscribed' | 'not-subscribed';

/** Web Push enable/disable for this browser — see backend/app/services/push.py and public/sw.js.
 * `status` reflects THIS browser/device only (a phone and a desktop are separate subscriptions,
 * same as WhatsApp Web vs. the phone app). */
export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

  const refresh = useCallback(async () => {
    if (!supported) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    setStatus(sub ? 'subscribed' : 'not-subscribed');
  }, [supported]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        return;
      }
      const { data } = await apiClient.get<{ public_key: string }>('/api/push/vapid-public-key');
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.public_key),
      });
      const json = sub.toJSON();
      await apiClient.post('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        user_agent: navigator.userAgent,
      });
      setStatus('subscribed');
    } catch {
      setError("Couldn't turn on notifications — try again, or check your browser's site settings.");
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await apiClient.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setStatus('not-subscribed');
    } catch {
      setError("Couldn't turn off notifications — try again.");
    } finally {
      setBusy(false);
    }
  }, [supported]);

  return { status, busy, error, enable, disable };
}
