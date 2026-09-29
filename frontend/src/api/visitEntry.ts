import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { requireConfirmedPositionWrite } from './hooks';
import type { Position, VisitDetail } from './types';
import { compareLatestEntry, emptyEntry, entryHasChanges, type VisitEntry } from '../utils/visitEntry';
import { positionError } from '../utils/positionChanges';
import { restorePositionDrafts } from '../utils/visitWorkflow';

export interface DraftImage { id: number; position_key: number; image_type: string; filename: string }
interface DraftResponse { revision: number; payload: Partial<VisitEntry>; images: DraftImage[] }
interface CachedDraft { entry: VisitEntry; revision: number; synced: string; commitToken?: string }
export function useVisitEntry(visitId: number, username: string) {
  const key = `iip-visit-entry:${username}:${visitId}`;
  const qc = useQueryClient();
  const [entry, setEntryState] = useState<VisitEntry>(emptyEntry);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading draft…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const state = useRef<CachedDraft>({ entry: emptyEntry(), revision: 0, synced: JSON.stringify(emptyEntry()) });
  const saving = useRef<Promise<void> | null>(null);
  const blocked = useRef(false);
  const persist = useCallback(() => {
    try { localStorage.setItem(key, JSON.stringify(state.current)); }
    catch { setError('Device storage is unavailable. Keep this page open until the server draft is saved.'); }
  }, [key]);
  const change = useCallback((value: VisitEntry | ((current: VisitEntry) => VisitEntry)) => {
    if (state.current.commitToken) throw new Error('Retry the pending confirmation before editing this draft.');
    const next = typeof value === 'function' ? value(state.current.entry) : value;
    state.current.entry = next; setEntryState(next); persist(); setStatus('Draft saved on this device · syncing…');
  }, [persist]);
  const load = useCallback(async (preferServer = false) => {
    let cached: CachedDraft | null = null;
    try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* use server copy */ }
    try {
      const { data } = await apiClient.get<DraftResponse>(`/api/visits/${visitId}/entry`);
      const remote = { ...emptyEntry(), ...data.payload };
      const localDirty = cached && JSON.stringify(cached.entry) !== cached.synced;
      const useLocal = !preferServer && cached && (localDirty || cached.commitToken) && cached.revision <= data.revision;
      blocked.current = !!(useLocal && cached!.revision !== data.revision && JSON.stringify(cached!.entry) !== JSON.stringify(remote) && !cached!.commitToken);
      state.current = useLocal ? cached! : { entry: remote, revision: data.revision, synced: JSON.stringify(remote) };
      if (!useLocal && !Object.keys(data.payload).length) {
        const legacy = restorePositionDrafts(sessionStorage.getItem(`iip-visit-drafts:${username}:${visitId}`), visitId);
        if (Object.keys(legacy).length) state.current.entry = { ...remote, drafts: legacy };
      }
      setEntryState(state.current.entry); setImages(data.images); setUncertain(!!state.current.commitToken); persist(); setReady(true);
      setStatus(blocked.current ? 'Draft conflict · local copy retained' : entryHasChanges(state.current.entry) || data.images.length ? 'Draft restored' : 'No unconfirmed changes');
      setError(blocked.current ? 'The server draft changed on another device. Copy any local notes you need, then use Reload server draft.' : '');
    } catch (err) {
      if (cached?.entry) { state.current = cached; setEntryState(cached.entry); setUncertain(!!cached.commitToken); setReady(true); setStatus('Offline · draft retained on this device'); }
      setError(positionError(err, 'Cannot reach the server draft. Your local entries are retained.'));
    }
  }, [key, persist, username, visitId]);
  useEffect(() => { void load(); }, [load]);
  const flush = useCallback(async () => {
    if (blocked.current) throw new Error('Resolve the draft conflict before saving.');
    if (state.current.commitToken) return; // preserve the exact payload of an ambiguous commit
    if (saving.current) await saving.current;
    if (JSON.stringify(state.current.entry) === state.current.synced) return;
    const task = async () => {
      while (JSON.stringify(state.current.entry) !== state.current.synced) {
        const payload = state.current.entry;
        const serialized = JSON.stringify(payload);
        const { data } = await apiClient.put<DraftResponse>(`/api/visits/${visitId}/entry`, { revision: state.current.revision, payload });
        state.current.revision = data.revision; state.current.synced = serialized; setImages(data.images); persist();
      }
      setStatus('Draft saved · not yet submitted'); setError('');
    };
    saving.current = task();
    try { await saving.current; }
    catch (err) {
      if ((err as { response?: { status?: number } }).response?.status === 409) blocked.current = true;
      setError(positionError(err, 'Server draft not saved. Entries remain on this device; retry when connected.'));
      setStatus('Draft saved on this device only'); throw err;
    } finally { saving.current = null; }
  }, [persist, visitId]);
  useEffect(() => {
    if (!ready || busy) return;
    const timer = window.setTimeout(() => { void flush().catch(() => {}); }, 800);
    const online = () => { void flush().catch(() => {}); };
    window.addEventListener('online', online);
    return () => { clearTimeout(timer); window.removeEventListener('online', online); };
  }, [entry, ready, busy, flush]);
  const upload = async (position: Position, type: string, file: File, token: string, durationSeconds?: number) => {
    await flush();
    const form = new FormData(); form.set('file', file); form.set('position_key', String(position.id));
    form.set('image_type', type); form.set('token', token);
    form.set('revision', String(state.current.revision));
    if (durationSeconds != null) form.set('duration_seconds', String(durationSeconds));
    if (position.id > 0) form.set('expected_updated_at', state.current.entry.drafts[position.id]?.before.updated_at || position.updated_at);
    const { data } = await apiClient.post<DraftResponse>(`/api/visits/${visitId}/entry/images`, form, { timeout: 120_000 });
    setImages(data.images);
  };
  const discard = async () => {
    if (state.current.commitToken) throw new Error('Retry confirmation first to resolve the pending save.');
    await flush();
    const { data } = await apiClient.post<DraftResponse>(`/api/visits/${visitId}/entry/discard`, { revision: state.current.revision });
    state.current = { entry: emptyEntry(), revision: data.revision, synced: JSON.stringify(emptyEntry()) };
    setEntryState(state.current.entry); setImages(data.images); persist(); setError(''); setStatus('Working draft discarded');
    sessionStorage.removeItem(`iip-visit-drafts:${username}:${visitId}`);
  };
  const compareLatest = async () => {
    if (state.current.commitToken) throw new Error('Retry the pending confirmation first.');
    await flush();
    const { data } = await apiClient.get<VisitDetail>(`/api/visits/${visitId}`);
    const next = compareLatestEntry(state.current.entry, data);
    change(next); qc.setQueryData(['visit', visitId], data);
    setError('Latest saved values are shown beside your proposals. Review them before confirming. If staged evidence has a revision conflict, remove it from the draft and upload it again against the current position.');
  };
  const commit = async () => {
    setBusy(true);
    try {
      await requireConfirmedPositionWrite(visitId); await flush();
      state.current.commitToken ||= crypto.randomUUID(); setUncertain(true); persist();
      const { data } = await apiClient.post<VisitDetail>(`/api/visits/${visitId}/entry/commit`, { revision: state.current.revision, token: state.current.commitToken }, { timeout: 120_000 });
      const remote = await apiClient.get<DraftResponse>(`/api/visits/${visitId}/entry`);
      const nextEntry = { ...emptyEntry(), ...remote.data.payload };
      state.current = { entry: nextEntry, revision: remote.data.revision, synced: JSON.stringify(nextEntry) };
      setEntryState(state.current.entry); setImages(remote.data.images); setUncertain(false); persist();
      sessionStorage.removeItem(`iip-visit-drafts:${username}:${visitId}`);
      qc.setQueryData(['visit', visitId], data);
      await Promise.all(['visit', 'visits', 'towers', 'dashboard', 'team-missions', 'team-progress', 'archive', 'oetc-preview'].map(k => qc.invalidateQueries({ queryKey: k === 'visit' ? [k, visitId] : [k] })));
      setStatus(entryHasChanges(nextEntry) || remote.data.images.length ? 'Visit confirmed · a newer working draft is available' : 'Visit saved and confirmed'); setError('');
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status && status < 500) { delete state.current.commitToken; setUncertain(false); persist(); }
      setError(positionError(err, 'Confirmation not received. Your draft is retained. Retry confirmation to verify the result.')); throw err;
    } finally { setBusy(false); }
  };
  return { entry, change, images, ready, status, error, busy, flush, commit, upload, discard, compareLatest, reload: () => load(true), uncertain };
}
