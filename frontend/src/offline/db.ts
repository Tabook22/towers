import type { OutboxItem } from './types';
import { currentAccountKey } from '../auth/session';

const DB_NAME = 'iip-offline-v1';
const STORE = 'outbox';
const VERSION = 1;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((fn) => fn());
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open offline storage'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Offline storage transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Offline storage transaction aborted'));
  });
}

async function storedOutbox(): Promise<OutboxItem[]> {
  const db = await openDb();
  try {
    const items = await new Promise<OutboxItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as OutboxItem[]) || []);
      req.onerror = () => reject(req.error);
    });
    items.sort((a, b) => a.createdAt - b.createdAt);
    return items;
  } finally {
    db.close();
  }
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const owner = currentAccountKey();
  if (!owner) return [];
  const items = await storedOutbox();
  return owner === currentAccountKey() ? items.filter(item => item.ownerKey === owner) : [];
}

/** Legacy records have no trustworthy owner. Preserve them for explicit recovery. */
export async function unownedOutboxCount(): Promise<number> {
  return (await storedOutbox()).filter(item => !item.ownerKey).length;
}

export async function getOutbox(id: string): Promise<OutboxItem | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result?.ownerKey === currentAccountKey() ? req.result : undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putOutbox(item: OutboxItem): Promise<void> {
  if (!item.ownerKey || item.ownerKey !== currentAccountKey()) {
    throw new Error('Sign-in changed. Save this work again with the original account.');
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...item, revision: newOutboxId() });
    await txDone(tx);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error('This phone is out of space. Free some storage, or wait until you have signal to upload.');
    }
    throw err;
  } finally {
    db.close();
  }
  notify();
}

export async function deleteOutbox(id: string, expected?: OutboxItem): Promise<void> {
  const owner = currentAccountKey();
  if (!owner) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const stored = request.result as OutboxItem | undefined;
      if (owner === currentAccountKey() && stored?.ownerKey === owner &&
          (!expected || stored.revision === expected.revision)) store.delete(id);
    };
    await done;
  } finally {
    db.close();
  }
  notify();
}

export function newOutboxId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
