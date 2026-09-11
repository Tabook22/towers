import type { OutboxItem } from './types';

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

export async function listOutbox(): Promise<OutboxItem[]> {
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

export async function getOutbox(id: string): Promise<OutboxItem | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as OutboxItem | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putOutbox(item: OutboxItem): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
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

export async function deleteOutbox(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
  notify();
}

export function newOutboxId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
