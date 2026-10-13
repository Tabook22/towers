import type { Position, Visit } from '../api/types';

export function latestInspection(visits: Visit[]) {
  return [...visits].sort((a, b) => (b.inspection_date || '').localeCompare(a.inspection_date || '') || b.id - a.id)[0];
}

export function unfinishedScreening(positions: Position[]) {
  return positions.filter(p => p.in_scope !== false && p.installed && (!p.screening_result || p.screening_result === 'Not inspected'));
}

export function missingPositionEvidence(position: Position, types: string[]) {
  if (position.in_scope === false || !position.installed) return [];
  return types.filter(type => !position.images.some(i => i.image_type === type &&
    ((!!i.file_path && i.evidence_status !== 'RECAPTURE REQUIRED') ||
      (i.sequence === 1 && i.evidence_status === 'NOT REQUIRED' && !!i.exemption_reason))));
}
