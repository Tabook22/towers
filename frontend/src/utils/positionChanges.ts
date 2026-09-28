import type { Position } from '../api/types';

export const positionFieldLabels: Partial<Record<keyof Position, string>> = {
  ohl: 'OHL', phase: 'Phase', string: 'String', direction: 'Direction', mount_type: 'Tower type',
  string_count: 'Number of strings', tower_proximity: 'Inner / Outer', installed: 'Installed',
  screening_result: 'Screening result', hotspot: 'Hotspot', tmax_c: 'Tmax (°C)', tref_c: 'Tref (°C)',
  severity: 'Severity', confidence: 'Confidence', inspector_notes: 'Inspector notes',
  manufacturer: 'Manufacturer', year_installed: 'Year installed', insulator_type: 'Insulator type',
  gs_side: 'GS side', pollution_condition: 'Pollution condition', thermal_indication: 'Thermal indication',
  visual_indications: 'Visual indications',
};

export function positionLabel(position: Pick<Position, 'ohl' | 'phase' | 'string' | 'direction'>) {
  return [position.ohl, position.phase, position.string, position.direction].filter(Boolean).join(' · ');
}

export function displayPositionValue(value: unknown): string {
  if (value == null || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === 'Single') return '1 string';
  if (value === 'Double') return '2 strings';
  return String(value);
}

/** Include the server's dependent screening/proximity changes in the review. */
export function positionPatch(saved: Position, draft: Partial<Position>): Partial<Position> {
  if (!Object.keys(draft).length) return {};
  const next = { ...saved, ...draft };
  if (!next.installed) next.screening_result = 'Not installed';
  else if (next.screening_result === 'Not installed') next.screening_result = 'Not inspected';
  if (next.installed && next.screening_result === 'Not inspected' && next.hotspot) {
    next.screening_result = ({ No: 'Normal', Yes: 'Hotspot detected', Unconfirmed: 'Inconclusive' } as Record<string, string>)[next.hotspot] || next.screening_result;
  }
  if ('string' in draft || 'string_count' in draft) {
    next.tower_proximity = next.string_count === 'Double' ? (next.string === 'S1' ? 'Outer' : 'Inner') : null;
  }
  return Object.fromEntries(Object.keys(positionFieldLabels)
    .filter(key => (saved[key as keyof Position] ?? '') !== (next[key as keyof Position] ?? ''))
    .map(key => [key, next[key as keyof Position]]));
}

export function positionChangeRows(saved: Position, patch: Partial<Position>) {
  return Object.entries(patch).map(([key, value]) => ({
    key, label: positionFieldLabels[key as keyof Position] || key,
    before: displayPositionValue(saved[key as keyof Position]), after: displayPositionValue(value),
  }));
}

export function positionError(error: unknown, fallback: string): string {
  const err = error as { userMessage?: string; response?: { data?: { detail?: unknown } } };
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : err?.userMessage || fallback;
}
