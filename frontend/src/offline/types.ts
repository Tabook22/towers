/** Field work that must survive a dropped 4G link — stored on the phone until it can be sent. */

export type OutboxKind =
  | 'community-message'
  | 'ping'
  | 'visit-update'
  | 'position-update'
  | 'image-upload'
  | 'extra-image'
  | 'annotation'
  | 'visit-photo'
  | 'team-note'
  | 'team-voice'
  | 'team-files'
  | 'channel-note'
  | 'channel-photo'
  | 'channel-voice'
  | 'channel-video'
  | 'channel-file';

export interface OutboxFile {
  blob: Blob;
  name: string;
  type: string;
}

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  createdAt: number;
  attempts: number;
  lastError?: string;
  label: string;
  path: Record<string, number | string>;
  json?: Record<string, unknown>;
  file?: OutboxFile;
  files?: OutboxFile[];
}

export const QUEUED = { queued: true as const };
export type QueuedResult = typeof QUEUED;

export function isQueued(value: unknown): value is QueuedResult {
  return !!value && typeof value === 'object' && (value as QueuedResult).queued === true;
}

export const LOCAL_FILE_SENTINEL = '__queued__';
