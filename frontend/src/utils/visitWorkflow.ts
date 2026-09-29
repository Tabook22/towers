import type { Position, PositionSlot, VisitDetail } from '../api/types';
import { positionPatch } from './positionChanges';

export interface PositionDraft { before: Position; changes: Partial<Position> }
export type PositionDrafts = Record<number, PositionDraft>;

export function restorePositionDrafts(raw: string | null, visitId: number): PositionDrafts {
  try {
    const entries = JSON.parse(raw || '{}');
    return Object.fromEntries(Object.entries(entries).filter(([id, value]) => {
      const item = value as PositionDraft;
      return item?.before?.id === Number(id) && item.before.visit_id === visitId
        && typeof item.before.updated_at === 'string' && item.changes && typeof item.changes === 'object';
    })) as PositionDrafts;
  } catch { return {}; }
}
export const sharedAssetFields = ['manufacturer', 'year_installed', 'insulator_type'] as const;

export function mergePositionDraft(drafts: PositionDrafts, position: Position, changes: Partial<Position>): PositionDrafts {
  const current = drafts[position.id];
  const before = current?.before || position;
  const merged = positionPatch(before, { ...current?.changes, ...changes });
  const result = { ...drafts };
  if (Object.keys(merged).length) result[position.id] = { before, changes: merged };
  else delete result[position.id];
  return result;
}

export function applySharedAssets(drafts: PositionDrafts, positions: Position[], ids: number[], values: Partial<Position>, fillEmpty: boolean) {
  let next = drafts;
  for (const position of positions.filter(p => ids.includes(p.id))) {
    const current = { ...position, ...drafts[position.id]?.changes };
    const patch: Partial<Position> = {};
    for (const key of sharedAssetFields) {
      const value = values[key];
      if (value == null || value === '' || (fillEmpty && current[key] != null && current[key] !== '')) continue;
      Object.assign(patch, { [key]: value });
    }
    next = mergePositionDraft(next, position, patch);
  }
  return next;
}

export function layoutSlots(mount: string, circuits: string[], phases: string[], count: string, directions: string[]): PositionSlot[] {
  return circuits.flatMap(ohl => phases.flatMap(phase => (count === 'Double' ? ['S1', 'S2'] : ['S1'])
    .flatMap(string => directions.map(direction => ({ ohl, phase, string, direction, mount_type: mount, string_count: count })))));
}

export function visitReviewIssues(visit: VisitDetail) {
  const issues: string[] = [];
  const positions = visit.positions.filter(p => p.in_scope !== false);
  const uninspected = positions.filter(p => p.installed && p.screening_result === 'Not inspected').length;
  if (uninspected) issues.push(`${uninspected} installed position(s) still need an inspection result.`);
  const missing = positions.flatMap(p => p.images).filter(i => i.sequence === 1 && !['COMPLETE', 'NOT REQUIRED'].includes(i.evidence_status)).length;
  if (missing) issues.push(`${missing} evidence category slot(s) are pending or require recapture.`);
  const dates = positions.flatMap(p => p.images).filter(i => i.file_path && i.capture_date && visit.inspection_date && i.capture_date !== visit.inspection_date).length;
  if (dates) issues.push(`${dates} image(s) have a capture date different from the visit date. Check the dates; originals are preserved.`);
  if (!visit.inspector_name) issues.push('Inspector name is missing.');
  if (!visit.inspection_date) issues.push('Inspection date is missing.');
  const measurements = positions.filter(p => p.hotspot === 'Yes' && (p.tmax_c == null || p.tref_c == null)).length;
  if (measurements) issues.push(`${measurements} hotspot position(s) have incomplete temperature measurements.`);
  return issues;
}
