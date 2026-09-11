import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteOutbox, listOutbox, subscribeOutbox } from './db';
import { flushOutbox, queryKeysTouched } from './flush';
import { isBrowserOnline } from './network';
import type { OutboxItem } from './types';

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

interface OfflineState {
  online: boolean;
  items: OutboxItem[];
  pendingCount: number;
  syncing: boolean;
  lastFlushError: string | null;
  previewUrl: (itemId: string) => string | null;
  previewUrlForImage: (imageId: number) => string | null;
  flushNow: () => Promise<void>;
  discard: (id: string) => Promise<void>;
}

const OfflineContext = createContext<OfflineState | undefined>(undefined);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const online = useSyncExternalStore(subscribeOnline, isBrowserOnline, () => true);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastFlushError, setLastFlushError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const previewMap = useRef(new Map<string, string>());
  const flushing = useRef(false);

  const refresh = useCallback(async () => {
    const next = await listOutbox();
    const keep = new Set(next.map((i) => i.id));
    for (const [id, url] of previewMap.current) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(url);
        previewMap.current.delete(id);
      }
    }
    for (const item of next) {
      if (previewMap.current.has(item.id)) continue;
      const blob = item.file?.blob || item.files?.[0]?.blob;
      if (blob && (blob.type.startsWith('image/') || item.kind === 'visit-photo' || item.kind === 'image-upload' || item.kind === 'extra-image' || item.kind === 'annotation')) {
        previewMap.current.set(item.id, URL.createObjectURL(blob));
      } else if (blob && item.kind === 'team-voice') {
        previewMap.current.set(item.id, URL.createObjectURL(blob));
      }
    }
    setItems(next);
  }, []);

  useEffect(() => subscribeOutbox(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    void refresh();
  }, [tick, refresh]);

  const flushNow = useCallback(async () => {
    if (flushing.current || !isBrowserOnline()) return;
    if (!localStorage.getItem('iip_token')) return;
    const before = await listOutbox();
    if (before.length === 0) return;
    flushing.current = true;
    setSyncing(true);
    setLastFlushError(null);
    try {
      const result = await flushOutbox();
      if (result.failed > 0 && result.sent === 0) {
        const leftover = await listOutbox();
        setLastFlushError(leftover[0]?.lastError || 'Could not send saved work');
      }
      const keys = queryKeysTouched(before);
      keys.forEach((key) => {
        void qc.invalidateQueries({ queryKey: key });
      });
      await refresh();
    } catch (err) {
      setLastFlushError(err instanceof Error ? err.message : 'Could not send saved work');
    } finally {
      flushing.current = false;
      setSyncing(false);
    }
  }, [qc, refresh]);

  useEffect(() => {
    if (!online) return;
    const t = window.setTimeout(() => void flushNow(), 800);
    return () => window.clearTimeout(t);
  }, [online, tick, flushNow]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && isBrowserOnline()) void flushNow();
    };
    document.addEventListener('visibilitychange', onVis);
    const interval = window.setInterval(() => {
      if (isBrowserOnline()) void flushNow();
    }, 20_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(interval);
    };
  }, [flushNow]);

  const previewUrl = useCallback((itemId: string) => previewMap.current.get(itemId) || null, []);

  const previewUrlForImage = useCallback(
    (imageId: number) => {
      const item = items.find(
        (i) =>
          (i.kind === 'image-upload' || i.kind === 'annotation' || i.kind === 'extra-image') &&
          Number(i.path.imageId) === imageId,
      );
      return item ? previewMap.current.get(item.id) || null : null;
    },
    [items],
  );

  const discard = useCallback(async (id: string) => {
    await deleteOutbox(id);
    await refresh();
  }, [refresh]);

  const value = useMemo<OfflineState>(
    () => ({
      online,
      items,
      pendingCount: items.length,
      syncing,
      lastFlushError,
      previewUrl,
      previewUrlForImage,
      flushNow,
      discard,
    }),
    [online, items, syncing, lastFlushError, previewUrl, previewUrlForImage, flushNow, discard],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineState {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
