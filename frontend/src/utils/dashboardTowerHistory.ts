import type { DashboardTowerHistory, DashboardVisitRecord } from '../api/types';

export const UNRECORDED = '__unrecorded__';
const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const teamKey = (visit: DashboardVisitRecord) => visit.team_id == null ? UNRECORDED : String(visit.team_id);

export function towerHistoryOptions(rows: DashboardTowerHistory[]) {
  const lines = [...new Set(rows.map(row => row.tower.area).filter((line): line is string => !!line))]
    .sort(compare).map(line => ({ value: line, label: line }));
  if (rows.some(row => !row.tower.area)) lines.push({ value: UNRECORDED, label: 'Line not recorded' });
  const teams = new Map<string, string>();
  rows.forEach(row => row.visits.forEach(visit => teams.set(teamKey(visit), visit.team_name || 'Team not recorded')));
  const teamOptions = [...teams].map(([value, name]) => ({
    value,
    label: [...teams.values()].filter(label => label === name).length > 1 && value !== UNRECORDED ? `${name} (#${value})` : name,
  })).sort((a, b) => a.value === b.value ? 0 : a.value === UNRECORDED ? 1 : b.value === UNRECORDED ? -1 : compare(a.label, b.label));
  return { lines, teams: teamOptions };
}

export function filterTowerHistory(rows: DashboardTowerHistory[], scope: string, search: string, line = '', team = '') {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(row => !line || (row.tower.area || UNRECORDED) === line)
    .map(row => team ? { ...row, visits: row.visits.filter(visit => teamKey(visit) === team) } : row)
    .filter(row => {
    if (team && row.visits.length === 0) return false;
    const visited = row.visits.some(visit => visit.has_field_activity);
    if ((scope === 'visited' && !visited) || (scope === 'unvisited' && visited)) return false;
    if (!term) return true;
    return [row.tower.tower_id, row.tower.area, ...row.visits.flatMap(visit => [visit.team_name, visit.inspector_name])]
      .some(value => value?.toLocaleLowerCase().includes(term));
  });
}

export function sortTowerHistory(rows: DashboardTowerHistory[], sort: string) {
  const entries = rows.flatMap(row => (row.visits.length ? row.visits : [null]).map(visit => ({ tower: row.tower, visit })));
  const missingLast = (a: string | null | undefined, b: string | null | undefined) => a && b ? compare(a, b) : a ? -1 : b ? 1 : 0;
  return entries.sort((a, b) => {
    const lineOrder = missingLast(a.tower.area, b.tower.area);
    const teamOrder = missingLast(a.visit?.team_name, b.visit?.team_name)
      || (a.visit?.team_id ?? Number.MAX_SAFE_INTEGER) - (b.visit?.team_id ?? Number.MAX_SAFE_INTEGER);
    const towerOrder = compare(a.tower.tower_id, b.tower.tower_id) || a.tower.id - b.tower.id;
    const dateOrder = missingLast(b.visit?.inspection_date, a.visit?.inspection_date);
    // Keep unknown dates last even though known dates sort newest first.
    const visitOrder = !a.visit?.inspection_date ? (b.visit?.inspection_date ? 1 : 0)
      : !b.visit?.inspection_date ? -1 : dateOrder;
    return (sort === 'team' ? teamOrder || lineOrder || towerOrder : sort === 'line' ? lineOrder || towerOrder : towerOrder)
      || visitOrder || (b.visit?.id ?? 0) - (a.visit?.id ?? 0);
  });
}

export function visitDateLabel(value: string | null) {
  if (!value) return 'Date not recorded';
  // Keep the inspection calendar day unchanged across browser timezones.
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
