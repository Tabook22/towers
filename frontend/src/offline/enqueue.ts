import { deleteOutbox, getOutbox, listOutbox, newOutboxId, putOutbox } from './db';
import { isBrowserOnline, isRetryableError } from './network';
import { QUEUED, type OutboxFile, type OutboxItem, type QueuedResult } from './types';

export function asOutboxFile(file: File | Blob, name?: string): OutboxFile {
  const named = file as File;
  return {
    blob: file,
    name: name || named.name || 'file',
    type: file.type || 'application/octet-stream',
  };
}

type NewItem = Omit<OutboxItem, 'id' | 'createdAt' | 'attempts'>;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lon2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function samePath(a: OutboxItem, b: NewItem, key: string): boolean {
  return a.kind === b.kind && String(a.path[key]) === String(b.path[key]);
}

/** Merge or replace a pending item so the same photo/field isn't queued twice. */
export async function enqueue(draft: NewItem): Promise<OutboxItem> {
  const existing = await listOutbox();

  if (draft.kind === 'ping' && draft.json) {
    const last = [...existing].reverse().find((i) => i.kind === 'ping' && i.json);
    if (last?.json) {
      const age = Date.now() - last.createdAt;
      const moved = haversineMeters(
        Number(last.json.latitude),
        Number(last.json.longitude),
        Number(draft.json.latitude),
        Number(draft.json.longitude),
      );
      if (age < 50_000 && moved < 8) {
        const updated: OutboxItem = { ...last, json: draft.json, createdAt: Date.now(), lastError: undefined };
        await putOutbox(updated);
        return updated;
      }
    }
  }

  if (draft.kind === 'position-update') {
    const prev = existing.find((i) => samePath(i, draft, 'positionId'));
    if (prev) {
      const updated: OutboxItem = {
        ...prev,
        json: { ...(prev.json || {}), ...(draft.json || {}) },
        createdAt: Date.now(),
        lastError: undefined,
      };
      await putOutbox(updated);
      return updated;
    }
  }

  if (draft.kind === 'visit-update') {
    const prev = existing.find((i) => samePath(i, draft, 'visitId'));
    if (prev) {
      const updated: OutboxItem = {
        ...prev,
        json: { ...(prev.json || {}), ...(draft.json || {}) },
        createdAt: Date.now(),
        lastError: undefined,
      };
      await putOutbox(updated);
      return updated;
    }
  }

  if (draft.kind === 'image-upload' || draft.kind === 'annotation') {
    const prev = existing.find((i) => samePath(i, draft, 'imageId'));
    if (prev) {
      await deleteOutbox(prev.id);
    }
  }

  const item: OutboxItem = {
    ...draft,
    id: newOutboxId(),
    createdAt: Date.now(),
    attempts: 0,
  };
  await putOutbox(item);
  return item;
}

export async function sendOrQueue<T>(send: () => Promise<T>, draft: NewItem): Promise<T | QueuedResult> {
  if (!isBrowserOnline()) {
    await enqueue(draft);
    return QUEUED;
  }
  try {
    return await send();
  } catch (err) {
    if (isRetryableError(err)) {
      await enqueue(draft);
      return QUEUED;
    }
    throw err;
  }
}

export async function markAttempt(id: string, error?: string): Promise<void> {
  const item = await getOutbox(id);
  if (!item) return;
  await putOutbox({
    ...item,
    attempts: item.attempts + 1,
    lastError: error,
  });
}
