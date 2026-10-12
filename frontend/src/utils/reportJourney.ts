import type { DigitalFinding } from './digitalReport';
import { severityRank } from './digitalReport';

export const severityBands = [
  { label: 'High / Critical', color: '#e53935', textColor: '#bb3030' },
  { label: 'Medium', color: '#ed8c26', textColor: '#a65a0c' },
  { label: 'Low', color: '#f2c744', textColor: '#866500' },
  { label: 'Normal', color: '#299e50', textColor: '#247941' },
  { label: 'Severity not recorded', color: '#778692', textColor: '#667582' },
] as const;

export function reportMetricTotals(rows: DigitalFinding[]) {
  return [rows.length, new Set(rows.map(row => String(row.fields.tower || '')).filter(Boolean)).size,
    rows.filter(row => severityRank(row.fields.severity) === 0).length,
    rows.reduce((sum, row) => sum + row.evidence.length, 0)];
}

export function priorityFindings(rows: DigitalFinding[]) {
  return [...rows].sort((a, b) => severityRank(a.fields.severity) - severityRank(b.fields.severity)
    || (numericReading(b.fields.delta_t) ?? -Infinity) - (numericReading(a.fields.delta_t) ?? -Infinity)
    || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export function numericReading(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function journeyTowers(rows: DigitalFinding[]) {
  const towers = new Map<string, DigitalFinding[]>();
  for (const row of rows) {
    const tower = String(row.fields.tower ?? '').trim();
    if (tower) towers.set(tower, [...(towers.get(tower) || []), row]);
  }
  return [...towers].map(([tower, findings]) => ({ tower, findings: priorityFindings(findings), rank: Math.min(...findings.map(row => severityRank(row.fields.severity))) }))
    .sort((a, b) => a.rank - b.rank || a.tower.localeCompare(b.tower, undefined, { numeric: true }));
}

export function thermalEvidenceIndex(row: DigitalFinding) {
  return row.evidence.findIndex(item => /^(th\b|thermal)/i.test(item.image_type));
}

export function comparisonEvidence(row: DigitalFinding) {
  const order = (type: string) => (/full/i.test(type) ? 0 : /close/i.test(type) ? 2 : 4) + (/^(th\b|thermal)/i.test(type) ? 0 : 1);
  return row.evidence.map((item, index) => ({ item, index }))
    .sort((a, b) => order(a.item.image_type) - order(b.item.image_type) || a.index - b.index);
}
