import type { ChannelKind, ChannelMessage } from '../api/types';

export type OpsFilter = 'all' | 'access' | 'weather' | 'skip' | 'hotspot' | 'help';

export const OPS_FILTERS: { kind: Exclude<OpsFilter, 'all'>; label: string; color: string }[] = [
  { kind: 'access', label: 'Access', color: '#f57c00' },
  { kind: 'weather', label: 'Hold', color: '#ef6c00' },
  { kind: 'skip', label: 'Skip', color: '#546e7a' },
  { kind: 'hotspot', label: 'Hotspot', color: '#d32f2f' },
  { kind: 'help', label: 'Help', color: '#b71c1c' },
];

/** On the unfiltered map we still overlay these so dispatch sees trouble without clicking a chip. */
const URGENT_KINDS: ChannelKind[] = ['help', 'hotspot', 'access'];

export function kindsForFilter(filter: OpsFilter): ChannelKind[] {
  if (filter === 'all') return URGENT_KINDS;
  return [filter];
}

export function countByKind(messages: ChannelMessage[]): Record<Exclude<OpsFilter, 'all'>, number> {
  const counts = { access: 0, weather: 0, skip: 0, hotspot: 0, help: 0 };
  for (const m of messages) {
    if (m.kind in counts) counts[m.kind as Exclude<OpsFilter, 'all'>] += 1;
  }
  return counts;
}

export function matchingMessages(messages: ChannelMessage[], filter: OpsFilter): ChannelMessage[] {
  if (filter === 'all') return messages;
  return messages.filter((m) => m.kind === filter);
}

/** Latest matching event per tower (or per GPS cluster if untagged). */
export function latestOpsPins(messages: ChannelMessage[], filter: OpsFilter): ChannelMessage[] {
  const kinds = new Set(kindsForFilter(filter));
  const byKey = new Map<string, ChannelMessage>();
  for (const m of messages) {
    if (!kinds.has(m.kind)) continue;
    if (m.latitude == null || m.longitude == null) continue;
    const key = m.tower_id != null ? `t:${m.tower_id}` : `g:${m.team_id}:${m.latitude.toFixed(4)}:${m.longitude.toFixed(4)}`;
    const prev = byKey.get(key);
    if (!prev || m.id > prev.id) byKey.set(key, m);
  }
  return [...byKey.values()];
}

export function teamIdsWithKind(messages: ChannelMessage[], filter: OpsFilter): Set<number> | null {
  if (filter === 'all') return null;
  const ids = new Set<number>();
  for (const m of messages) {
    if (m.kind === filter) ids.add(m.team_id);
  }
  return ids;
}

export function opsColor(kind: string): string {
  return OPS_FILTERS.find((f) => f.kind === kind)?.color || '#0d475c';
}

export function opsLabel(kind: string): string {
  return OPS_FILTERS.find((f) => f.kind === kind)?.label || kind;
}
