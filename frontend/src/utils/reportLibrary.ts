import type { LineInspectionReportOut } from '../api/types';

export const reportTypes: Record<string, string> = {
  tower: 'Tower report', team: 'Team report', area: 'Line section', consolidated: 'Project section',
};
export type ReportSortKey = 'created_at' | 'report_number' | 'team_name' | 'tower_name' | 'start_date';
export interface ReportFilters { search: string; team: string; tower: string; type: string; from: string; to: string }
export const emptyReportFilters: ReportFilters = { search: '', team: '', tower: '', type: '', from: '', to: '' };

// The API stores naive UTC timestamps; do not interpret them in the browser's local timezone.
export function reportTimestamp(value: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
}
export function reportTowers(report: LineInspectionReportOut) {
  return report.scope_towers?.length ? report.scope_towers : report.tower_id && report.tower_name
    ? [{ id: report.tower_id, name: report.tower_name }] : [];
}
export function selectReports(rows: LineInspectionReportOut[], filters: ReportFilters, key: ReportSortKey, direction: 'asc' | 'desc') {
  const query = filters.search.trim().toLocaleLowerCase();
  return rows.filter((r) => {
    const towers = reportTowers(r);
    if (filters.team && String(r.team_id) !== filters.team) return false;
    if (filters.tower && !towers.some((t) => String(t.id) === filters.tower)) return false;
    if (filters.type && r.report_type !== filters.type) return false;
    // Date range means inspection coverage, including reports which overlap either boundary.
    if (filters.from && r.end_date < filters.from) return false;
    if (filters.to && r.start_date > filters.to) return false;
    return !query || [r.report_number, r.team_name, r.line_sector, ...towers.map((t) => t.name)]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  }).sort((a, b) => {
    const value = (r: LineInspectionReportOut) => key === 'tower_name'
      ? reportTowers(r).map((t) => t.name).join(', ') : r[key] || '';
    const comparison = key === 'created_at'
      ? reportTimestamp(a.created_at).getTime() - reportTimestamp(b.created_at).getTime()
      : value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: 'base' });
    return (direction === 'asc' ? 1 : -1) * (comparison || a.id - b.id);
  });
}

export async function reportError(error: unknown, fallback: string): Promise<string> {
  let data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try { data = JSON.parse(await data.text()); } catch { return fallback; }
  }
  const detail = (data as { detail?: unknown })?.detail;
  return typeof detail === 'string' ? detail : fallback;
}
