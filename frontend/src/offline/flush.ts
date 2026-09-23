import { apiClient } from '../api/client';
import { deleteOutbox, listOutbox } from './db';
import { markAttempt } from './enqueue';
import { errorMessage, isRetryableError } from './network';
import type { OutboxFile, OutboxItem } from './types';

function appendFile(form: FormData, field: string, file: OutboxFile) {
  form.append(field, file.blob, file.name);
}

async function sendItem(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case 'community-message': {
      const form = new FormData();
      for (const [key, value] of Object.entries(item.json || {})) if (value != null) form.set(key, String(value));
      if (item.file) appendFile(form, 'file', item.file);
      await apiClient.post('/api/community/channel', form, { timeout: 180_000 });
      return;
    }
    case 'ping':
      await apiClient.post('/api/tracking/ping', item.json);
      return;
    case 'visit-update':
      await apiClient.patch(`/api/visits/${item.path.visitId}`, item.json);
      return;
    case 'position-update':
      await apiClient.patch(`/api/positions/${item.path.positionId}`, item.json);
      return;
    case 'image-upload': {
      if (!item.file) throw new Error('Queued photo is missing');
      const form = new FormData();
      appendFile(form, 'file', item.file);
      const json = item.json || {};
      if (json.capture_date) form.set('capture_date', String(json.capture_date));
      if (json.capture_time) form.set('capture_time', String(json.capture_time));
      if (json.latitude !== undefined && json.latitude !== null) form.set('latitude', String(json.latitude));
      if (json.longitude !== undefined && json.longitude !== null) form.set('longitude', String(json.longitude));
      await apiClient.post(`/api/images/${item.path.imageId}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      return;
    }
    case 'extra-image': {
      if (!item.file) throw new Error('Queued photo is missing');
      const form = new FormData();
      form.set('image_type', String(item.json?.image_type || ''));
      appendFile(form, 'file', item.file);
      const json = item.json || {};
      if (json.capture_date) form.set('capture_date', String(json.capture_date));
      if (json.capture_time) form.set('capture_time', String(json.capture_time));
      if (json.latitude !== undefined && json.latitude !== null) form.set('latitude', String(json.latitude));
      if (json.longitude !== undefined && json.longitude !== null) form.set('longitude', String(json.longitude));
      await apiClient.post(`/api/positions/${item.path.positionId}/images`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      return;
    }
    case 'annotation': {
      if (!item.file) throw new Error('Queued annotation is missing');
      const form = new FormData();
      appendFile(form, 'file', item.file);
      await apiClient.post(`/api/images/${item.path.imageId}/annotation`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      return;
    }
    case 'visit-photo': {
      if (!item.file) throw new Error('Queued photo is missing');
      const form = new FormData();
      appendFile(form, 'file', item.file);
      const json = item.json || {};
      if (json.caption) form.set('caption', String(json.caption));
      if (json.position_id) form.set('position_id', String(json.position_id));
      await apiClient.post(`/api/visits/${item.path.visitId}/photos`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      return;
    }
    case 'channel-note':
      await apiClient.post(`/api/teams/${item.path.teamId}/channel`, item.json);
      return;
    case 'channel-photo': {
      if (!item.file) throw new Error('Queued photo is missing');
      const form = new FormData();
      appendFile(form, 'file', item.file);
      const json = item.json || {};
      if (json.kind) form.set('kind', String(json.kind));
      if (json.body) form.set('body', String(json.body));
      if (json.tower_id) form.set('tower_id', String(json.tower_id));
      if (json.latitude != null) form.set('latitude', String(json.latitude));
      if (json.longitude != null) form.set('longitude', String(json.longitude));
      await apiClient.post(`/api/teams/${item.path.teamId}/channel/photo`, form, { timeout: 120_000 });
      return;
    }
    case 'channel-voice': {
      if (!item.file) throw new Error('Queued recording is missing');
      const form = new FormData();
      appendFile(form, 'file', item.file);
      const json = item.json || {};
      if (json.kind) form.set('kind', String(json.kind));
      if (json.body) form.set('body', String(json.body));
      if (json.duration_seconds != null) form.set('duration_seconds', String(json.duration_seconds));
      if (json.tower_id) form.set('tower_id', String(json.tower_id));
      if (json.latitude != null) form.set('latitude', String(json.latitude));
      if (json.longitude != null) form.set('longitude', String(json.longitude));
      await apiClient.post(`/api/teams/${item.path.teamId}/channel/voice`, form, { timeout: 120_000 });
      return;
    }
    case 'channel-video': {
      if (!item.file) throw new Error('Queued video is missing');
      const form = new FormData();
      appendFile(form, 'file', item.file);
      const json = item.json || {};
      if (json.kind) form.set('kind', String(json.kind));
      if (json.body) form.set('body', String(json.body));
      if (json.duration_seconds != null) form.set('duration_seconds', String(json.duration_seconds));
      if (json.tower_id) form.set('tower_id', String(json.tower_id));
      if (json.latitude != null) form.set('latitude', String(json.latitude));
      if (json.longitude != null) form.set('longitude', String(json.longitude));
      await apiClient.post(`/api/teams/${item.path.teamId}/channel/video`, form, { timeout: 180_000 });
      return;
    }
    case 'channel-file': {
      if (!item.file) throw new Error('Queued file is missing');
      const form = new FormData();
      appendFile(form, 'file', item.file);
      const json = item.json || {};
      if (json.kind) form.set('kind', String(json.kind));
      if (json.body) form.set('body', String(json.body));
      if (json.tower_id) form.set('tower_id', String(json.tower_id));
      if (json.latitude != null) form.set('latitude', String(json.latitude));
      if (json.longitude != null) form.set('longitude', String(json.longitude));
      await apiClient.post(`/api/teams/${item.path.teamId}/channel/file`, form, { timeout: 180_000 });
      return;
    }
    case 'team-note':
      await apiClient.post(`/api/teams/${item.path.teamId}/notes`, item.json);
      return;
    case 'team-voice': {
      if (!item.file) throw new Error('Queued recording is missing');
      const form = new FormData();
      form.set('log_date', String(item.json?.log_date || ''));
      appendFile(form, 'file', item.file);
      if (item.json?.duration_seconds != null) form.set('duration_seconds', String(item.json.duration_seconds));
      if (item.json?.note) form.set('note', String(item.json.note));
      await apiClient.post(`/api/teams/${item.path.teamId}/notes/voice`, form, {
        timeout: 120_000,
      });
      return;
    }
    case 'team-files': {
      const files = item.files || (item.file ? [item.file] : []);
      if (files.length === 0) throw new Error('Queued files are missing');
      const form = new FormData();
      files.forEach((f) => appendFile(form, 'files', f));
      if (item.path.noteId) {
        await apiClient.post(`/api/teams/${item.path.teamId}/notes/${item.path.noteId}/files`, form, {
          timeout: 120_000,
        });
        return;
      }
      form.set('log_date', String(item.json?.log_date || ''));
      if (item.json?.note) form.set('note', String(item.json.note));
      await apiClient.post(`/api/teams/${item.path.teamId}/notes/files`, form, {
        timeout: 120_000,
      });
      return;
    }
    default:
      throw new Error(`Unknown queued item: ${item.kind}`);
  }
}

export type FlushResult = { sent: number; remaining: number; failed: number };

export async function flushOutbox(): Promise<FlushResult> {
  const items = await listOutbox();
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await sendItem(item);
      await deleteOutbox(item.id);
      sent += 1;
    } catch (err) {
      failed += 1;
      const msg = errorMessage(err);
      await markAttempt(item.id, msg);
      if (isRetryableError(err)) {
        break;
      }
    }
  }
  const remaining = (await listOutbox()).length;
  return { sent, remaining, failed };
}

export function queryKeysTouched(items: OutboxItem[]): (string | number)[][] {
  const keys: (string | number)[][] = [];
  const seen = new Set<string>();
  const add = (key: (string | number)[]) => {
    const id = key.join('/');
    if (seen.has(id)) return;
    seen.add(id);
    keys.push(key);
  };
  for (const item of items) {
    if (item.kind === 'community-message') {
      add(['community-chat']); add(['team-channel']); add(['tracking-channel']); add(['channel-unread']);
      continue;
    }
    if (item.kind === 'ping') {
      add(['tracking']);
      continue;
    }
    if (item.kind === 'visit-update' || item.kind === 'position-update' || item.kind === 'image-upload' || item.kind === 'extra-image' || item.kind === 'annotation' || item.kind === 'visit-photo') {
      const visitId = item.path.visitId;
      if (visitId !== undefined) add(['visit', Number(visitId)]);
      add(['visits']);
      add(['dashboard']);
      add(['archive']);
      add(['team-missions']);
      if (item.kind === 'visit-photo' && visitId !== undefined) add(['visit-photos', Number(visitId)]);
    }
    if (item.kind === 'team-note' || item.kind === 'team-voice' || item.kind === 'team-files') {
      add(['team-progress']);
    }
    if (
      item.kind === 'channel-note' ||
      item.kind === 'channel-photo' ||
      item.kind === 'channel-voice' ||
      item.kind === 'channel-video' ||
      item.kind === 'channel-file'
    ) {
      add(['team-channel']);
      add(['tracking-channel']);
    }
  }
  return keys;
}
