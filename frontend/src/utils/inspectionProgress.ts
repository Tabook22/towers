import type { Position } from '../api/types';
import { evidenceStatusForPosition } from './positionChanges';

export type StagedEvidence = { position_key: number; image_type: string };

/** Draft evidence is counted separately from confirmed images; no records are changed. */
export function evidenceProgress(position: Position, types: string[], staged: StagedEvidence[]) {
  const missing = types.filter(type => !staged.some(i => i.position_key === position.id && i.image_type === type)
    && !['COMPLETE', 'NOT REQUIRED'].includes(evidenceStatusForPosition(position, type, position.images.find(i => i.image_type === type && i.sequence === 1))));
  return { missing, complete: types.length - missing.length, total: types.length };
}

export function needsInspectionWork(position: Position, types: string[], staged: StagedEvidence[]) {
  return position.in_scope !== false && (
    (position.installed && position.screening_result === 'Not inspected')
    || (position.hotspot === 'Yes' && (position.tmax_c == null || position.tref_c == null))
    || evidenceProgress(position, types, staged).missing.length > 0);
}

export function nextIncompletePosition(positions: Position[], currentId: number | undefined, types: string[], staged: StagedEvidence[]) {
  const index = positions.findIndex(p => p.id === currentId);
  return [...positions.slice(index + 1), ...positions.slice(0, index + 1)]
    .find(p => p.id !== currentId && needsInspectionWork(p, types, staged));
}
