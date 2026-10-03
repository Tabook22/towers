import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { requireConfirmedPositionWrite } from './hooks';
import type { Position, VisitDetail } from './types';
import { compareLatestEntry, emptyEntry, entryHasChanges, type VisitEntry } from '../utils/visitEntry';
import { positionError } from '../utils/positionChanges';
import { restorePositionDrafts } from '../utils/visitWorkflow';
import { reconcileDraft } from '../utils/reconcileDraft';

export interface DraftImage { id: number; position_key: number; image_type: string; filename: string; checksum?: string }
interface DraftResponse { revision: number; payload: Partial<VisitEntry>; images: DraftImage[] }
interface CachedDraft { entry: VisitEntry; revision: number; synced: string; commitToken?: string; commitImageIds?: number[] }
export function useVisitEntry(visitId: number, username: string) {
  const key = `iip-visit-entry:${username}:${visitId}`;
  const scope = useMemo(() => ({ key }), [key]);
  const qc = useQueryClient();
  const [entry, setEntryState] = useState<VisitEntry>(emptyEntry);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [readyScope, setReadyScope] = useState<typeof scope | null>(null);
  const [status, setStatus] = useState('Loading draft…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const state = useRef<CachedDraft>({ entry: emptyEntry(), revision: 0, synced: JSON.stringify(emptyEntry()) });
  const saving = useRef<Promise<void> | null>(null);
  const blocked = useRef(false);
  const loaded = useRef(false);
  const active = useRef(true);
  const currentScope = useRef(scope);
  useEffect(() => { currentScope.current = scope; active.current = true; return () => { active.current = false; }; }, [scope]);
  const isCurrent = useCallback(() => currentScope.current === scope && active.current, [scope]);
  const ensureCurrent = () => { if (!isCurrent()) throw new Error('The inspection workspace changed. Reopen the intended visit.'); };
  const persist = useCallback(() => {
    try { localStorage.setItem(key, JSON.stringify(state.current)); }
    catch { setError('Device storage is unavailable. Keep this page open until the server draft is saved.'); }
  }, [key, state]);
  const change = useCallback((value: VisitEntry | ((current: VisitEntry) => VisitEntry)) => {
    if (!isCurrent() || !loaded.current) throw new Error('Wait for this visit draft to finish loading.');
    if (state.current.commitToken) throw new Error('Retry the pending confirmation before editing this draft.');
    const next = typeof value === 'function' ? value(state.current.entry) : value;
    state.current.entry = next; setEntryState(next); persist(); setStatus('Draft saved on this device · syncing…');
  }, [persist, isCurrent]);
  const load = useCallback(async (preferServer = false) => {
    let cached: CachedDraft | null = null;
    try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* use server copy */ }
    try {
      const { data } = await apiClient.get<DraftResponse>(`/api/visits/${visitId}/entry`);
      if (!isCurrent()) return;
      const remote = { ...emptyEntry(), ...data.payload };
      const localDirty = cached && JSON.stringify(cached.entry) !== cached.synced;
      const useLocal = !preferServer && cached && (localDirty || cached.commitToken) && cached.revision <= data.revision;
      blocked.current = !!(useLocal && cached!.revision !== data.revision && JSON.stringify(cached!.entry) !== JSON.stringify(remote) && !cached!.commitToken);
      state.current = useLocal ? cached! : { entry: remote, revision: data.revision, synced: JSON.stringify(remote) };
      if (!useLocal && !Object.keys(data.payload).length) {
        const legacy = restorePositionDrafts(sessionStorage.getItem(`iip-visit-drafts:${username}:${visitId}`), visitId);
        if (Object.keys(legacy).length) state.current.entry = { ...remote, drafts: legacy };
      }
      loaded.current = true;
      setEntryState(state.current.entry); setImages(data.images); setUncertain(!!state.current.commitToken); persist(); setReadyScope(scope);
      setStatus(blocked.current ? 'Draft conflict · local copy retained' : entryHasChanges(state.current.entry) || data.images.length ? 'Draft restored' : 'No unconfirmed changes');
      setError(blocked.current ? 'The server draft changed on another device. Copy any local notes you need, then use Reload server draft.' : '');
    } catch (err) {
      if (!isCurrent()) return;
      if (cached?.entry) { loaded.current = true; state.current = cached; setEntryState(cached.entry); setUncertain(!!cached.commitToken); setReadyScope(scope); setStatus('Offline · draft retained on this device'); }
      setError(positionError(err, 'Cannot reach the server draft. Your local entries are retained.'));
    }
  }, [key, persist, username, visitId, isCurrent, scope]);
  useEffect(() => {
    loaded.current = false; blocked.current = false; saving.current = null;
    state.current = { entry: emptyEntry(), revision: 0, synced: JSON.stringify(emptyEntry()) };
    setBusy(false); setUncertain(false); setEntryState(emptyEntry()); setImages([]); void load();
  }, [load]);
  const flush = useCallback(async () => {
    if (!isCurrent() || !loaded.current) throw new Error('Wait for this visit draft to finish loading.');
    if (blocked.current) throw new Error('Resolve the draft conflict before saving.');
    if (state.current.commitToken) return; // preserve the exact payload of an ambiguous commit
    if (saving.current) await saving.current;
    if (!isCurrent()) throw new Error('The inspection workspace changed.');
    if (JSON.stringify(state.current.entry) === state.current.synced) return;
    const task = async () => {
      while (JSON.stringify(state.current.entry) !== state.current.synced) {
        const payload = state.current.entry;
        const serialized = JSON.stringify(payload);
        const { data } = await apiClient.put<DraftResponse>(`/api/visits/${visitId}/entry`, { revision: state.current.revision, payload });
        if (!isCurrent()) return;
        state.current.revision = data.revision; state.current.synced = serialized; setImages(data.images); persist();
      }
      setStatus('Draft saved · not yet submitted'); setError('');
      void qc.invalidateQueries({ queryKey: ['team-missions'] });
    };
    const request = task(); saving.current = request;
    try { await request; }
    catch (err) {
      if (!isCurrent()) throw err;
      if ((err as { response?: { status?: number } }).response?.status === 409) blocked.current = true;
      setError(positionError(err, 'Server draft not saved. Entries remain on this device; retry when connected.'));
      setStatus('Draft saved on this device only'); throw err;
    } finally { if (saving.current === request) saving.current = null; }
  }, [persist, visitId, qc, isCurrent]);
  useEffect(() => {
    if (readyScope !== scope || busy) return;
    const timer = window.setTimeout(() => { void flush().catch(() => {}); }, 800);
    const online = () => { void flush().catch(() => {}); };
    window.addEventListener('online', online);
    return () => { clearTimeout(timer); window.removeEventListener('online', online); };
  }, [entry, readyScope, scope, busy, flush]);
  const upload = async (position: Position, type: string, file: File, token: string, durationSeconds?: number) => {
    await flush();
    ensureCurrent();
    const form = new FormData(); form.set('file', file); form.set('position_key', String(position.id));
    form.set('image_type', type); form.set('token', token);
    form.set('revision', String(state.current.revision));
    if (durationSeconds != null) form.set('duration_seconds', String(durationSeconds));
    if (position.id > 0) form.set('expected_updated_at', state.current.entry.drafts[position.id]?.before.updated_at || position.updated_at);
    const { data } = await apiClient.post<DraftResponse>(`/api/visits/${visitId}/entry/images`, form, { timeout: 120_000 });
    ensureCurrent();
    setImages(data.images);
    void qc.invalidateQueries({ queryKey: ['team-missions'] });
  };
  const discard = async () => {
    if (state.current.commitToken) throw new Error('Retry confirmation first to resolve the pending save.');
    await flush();
    ensureCurrent();
    const { data } = await apiClient.post<DraftResponse>(`/api/visits/${visitId}/entry/discard`, { revision: state.current.revision });
    ensureCurrent();
    state.current = { entry: emptyEntry(), revision: data.revision, synced: JSON.stringify(emptyEntry()) };
    setEntryState(state.current.entry); setImages(data.images); persist(); setError(''); setStatus('Working draft discarded');
    void qc.invalidateQueries({ queryKey: ['team-missions'] });
    sessionStorage.removeItem(`iip-visit-drafts:${username}:${visitId}`);
  };
  const compareLatest = async () => {
    if (state.current.commitToken) throw new Error('Retry the pending confirmation first.');
    if (blocked.current) {
      const { data: remote } = await apiClient.get<DraftResponse>(`/api/visits/${visitId}/entry`);
      ensureCurrent();
      const remoteEntry = { ...emptyEntry(), ...remote.payload };
      const merged = reconcileDraft(state.current.entry, remoteEntry, JSON.parse(state.current.synced) as VisitEntry);
      state.current = { entry: merged, revision: remote.revision, synced: JSON.stringify(remoteEntry) };
      blocked.current = false; setImages(remote.images); persist();
    } else await flush();
    ensureCurrent();
    const { data } = await apiClient.get<VisitDetail>(`/api/visits/${visitId}`);
    ensureCurrent();
    const next = compareLatestEntry(state.current.entry, data);
    change(next); qc.setQueryData(['visit', visitId], data);
    setError('Latest saved values are shown beside your proposals. Review them before confirming. If staged evidence has a revision conflict, remove it from the draft and upload it again against the current position.');
  };
  const commit = async (reviewedImageIds?: number[]) => {
    ensureCurrent();
    setBusy(true);
    try {
      await requireConfirmedPositionWrite(visitId); await flush();
      ensureCurrent();
      if (!state.current.commitToken) { state.current.commitToken = crypto.randomUUID(); state.current.commitImageIds = reviewedImageIds; }
      setUncertain(true); persist();
      const { data } = await apiClient.post<VisitDetail>(`/api/visits/${visitId}/entry/commit`, { revision: state.current.revision, token: state.current.commitToken, reviewed_image_ids: state.current.commitImageIds }, { timeout: 120_000 });
      ensureCurrent();
      const remote = await apiClient.get<DraftResponse>(`/api/visits/${visitId}/entry`);
      ensureCurrent();
      const nextEntry = { ...emptyEntry(), ...remote.data.payload };
      state.current = { entry: nextEntry, revision: remote.data.revision, synced: JSON.stringify(nextEntry) };
      setEntryState(state.current.entry); setImages(remote.data.images); setUncertain(false); persist();
      sessionStorage.removeItem(`iip-visit-drafts:${username}:${visitId}`);
      qc.setQueryData(['visit', visitId], data);
      await Promise.all(['visit', 'visits', 'towers', 'dashboard', 'team-missions', 'team-progress', 'archive', 'oetc-preview'].map(k => qc.invalidateQueries({ queryKey: k === 'visit' ? [k, visitId] : [k] })));
      ensureCurrent();
      setStatus(entryHasChanges(nextEntry) || remote.data.images.length ? 'Visit confirmed · a newer working draft is available' : 'Visit saved and confirmed'); setError('');
    } catch (err) {
      if (!isCurrent()) throw err;
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status && status < 500) { delete state.current.commitToken; delete state.current.commitImageIds; setUncertain(false); persist(); }
      if (status === 409) {
        try {
          const latest = await apiClient.get<DraftResponse>(`/api/visits/${visitId}/entry`);
          if (isCurrent()) setImages(latest.data.images);
        } catch { /* Keep local proposals and the original conflict, even when offline. */ }
      }
      if (!isCurrent()) throw err;
      setError(positionError(err, 'Confirmation not received. Your draft is retained. Retry confirmation to verify the result.')); throw err;
    } finally { if (isCurrent()) setBusy(false); }
  };
  return { entry, change, images, ready: readyScope === scope, status, error, busy, flush, commit, upload, discard, compareLatest, reload: () => load(true), uncertain };
}
