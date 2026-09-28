import type { DashboardTowerHistory } from '../api/types';

export function filterTowerHistory(rows: DashboardTowerHistory[], scope: string, search: string) {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(row => {
    const visited = row.visits.some(visit => visit.has_field_activity);
    if ((scope === 'visited' && !visited) || (scope === 'unvisited' && visited)) return false;
    return [row.tower.tower_id, row.tower.area, ...row.visits.flatMap(visit => [visit.team_name, visit.inspector_name])]
      .some(value => value?.toLocaleLowerCase().includes(term));
  });
}

export function visitDateLabel(value: string | null) {
  if (!value) return 'Date not recorded';
  // Keep the inspection calendar day unchanged across browser timezones.
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
