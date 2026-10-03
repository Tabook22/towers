import type { Position, PositionSlot, VisitDetail } from '../api/types';
import { evidenceStatusForPosition, positionPatch } from './positionChanges';

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
  if (mount === 'Suspension') directions = ['NA'];
  return circuits.flatMap(ohl => phases.flatMap(phase => (count === 'Double' ? ['S1', 'S2'] : ['S1'])
    .flatMap(string => directions.map(direction => ({ ohl, phase, string, direction, mount_type: mount, string_count: count })))));
}

export type VisitCheckTarget = 'screening' | 'evidence' | 'capture_dates' | 'temperatures' | 'inspector_name' | 'inspection_date';
export interface VisitReviewCheck {
  target: VisitCheckTarget;
  message: string;
  positionIds: number[];
}

export function visitReviewChecks(visit: VisitDetail, options: {
  imageTypes?: string[];
  stagedEvidence?: { position_key: number; image_type: string }[];
} = {}): VisitReviewCheck[] {
  const issues: VisitReviewCheck[] = [];
  const positions = visit.positions.filter(p => p.in_scope !== false);
  const add = (target: VisitCheckTarget, message: string, affected: Position[]) => issues.push({ target, message, positionIds: affected.map(p => p.id) });
  const uninspected = positions.filter(p => p.installed && p.screening_result === 'Not inspected');
  if (uninspected.length) add('screening', `${uninspected.length} installed position(s) still need an inspection result.`, uninspected);
  const missingFor = (p: Position) => {
    const types = options.imageTypes ?? p.images.filter(i => i.sequence === 1).map(i => i.image_type);
    return types.filter(type => !options.stagedEvidence?.some(i => i.position_key === p.id && i.image_type === type)
      && !['COMPLETE', 'NOT REQUIRED'].includes(evidenceStatusForPosition(p, type, p.images.find(i => i.image_type === type && i.sequence === 1)))).length;
  };
  const missing = positions.reduce((sum, p) => sum + missingFor(p), 0);
  if (missing) add('evidence', `${missing} evidence category slot(s) are pending or require recapture.`, positions.filter(missingFor));
  const datesFor = (p: Position) => p.images.filter(i => i.file_path && i.capture_date && visit.inspection_date && i.capture_date !== visit.inspection_date).length;
  const dates = positions.reduce((sum, p) => sum + datesFor(p), 0);
  if (dates) add('capture_dates', `${dates} image(s) have a capture date different from the visit date. Check the dates; originals are preserved.`, positions.filter(datesFor));
  if (!visit.inspector_name) add('inspector_name', 'Inspector name is missing.', []);
  if (!visit.inspection_date) add('inspection_date', 'Inspection date is missing.', []);
  const measurements = positions.filter(p => p.hotspot === 'Yes' && (p.tmax_c == null || p.tref_c == null));
  if (measurements.length) add('temperatures', `${measurements.length} hotspot position(s) have incomplete temperature measurements.`, measurements);
  return issues;
}

export function visitReviewIssues(visit: VisitDetail) {
  return visitReviewChecks(visit).map(check => check.message);
}
