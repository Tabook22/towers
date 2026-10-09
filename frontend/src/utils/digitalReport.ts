import type { InspectionSnapshot, ReportValue, SnapshotEvidence } from '../api/types';

export interface DigitalFinding {
  key: string;
  fields: Record<string, ReportValue>;
  evidence: SnapshotEvidence[];
}
export const filterFields = ['tower', 'area', 'line_sector', 'phase', 'string', 'view_side', 'severity', 'screening_result'] as const;
export function digitalFindings(snapshot: InspectionSnapshot): DigitalFinding[] {
  return snapshot.visits.flatMap(visit => visit.positions.map(position => ({
    key: `${visit.id}:${position.id}`,
    fields: Object.fromEntries([...Object.entries(visit), ...Object.entries(position)].filter(([key, value]) => key !== 'id' && !Array.isArray(value))) as Record<string, ReportValue>,
    evidence: position.evidence || [],
  })));
}
export function severityRank(value: ReportValue | undefined): number {
  const severity = String(value ?? '').toLowerCase().replace(/\s/g, '');
  if (severity.includes('high') || severity.includes('critical')) return 0;
  return ({ medium: 1, low: 2, normal: 3 } as Record<string, number>)[severity] ?? 4;
}
export function filterFindings(rows: DigitalFinding[], search: string, filters: Record<string, string>, sort: string, descending: boolean): DigitalFinding[] {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const text = Object.values(row.fields).map(v => String(v ?? '')).join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term)) && Object.entries(filters).every(([key, value]) => {
      if (!value) return true;
      // The issued measurement table combines High and Critical into one category.
      if (key === 'severity' && value === 'High / Critical') return severityRank(row.fields.severity) === 0;
      return String(row.fields[key] ?? '') === value;
    });
  }).sort((a, b) => {
    const left = a.fields[sort], right = b.fields[sort];
    const difference = sort === 'severity' ? severityRank(left) - severityRank(right) : typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true });
    return difference * (descending ? -1 : 1) || a.key.localeCompare(b.key, undefined, { numeric: true });
  });
}
export function groupFindings(rows: DigitalFinding[], field: string): [string, DigitalFinding[]][] {
  if (!field) return [['', rows]];
  const groups = new Map<string, DigitalFinding[]>();
  for (const row of rows) {
    const key = String(row.fields[field] ?? '');
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups].sort((a, b) => field === 'severity' ? severityRank(a[0]) - severityRank(b[0]) : 0);
}
