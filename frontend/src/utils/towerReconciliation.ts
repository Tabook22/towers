import type { ReconciliationTeam, ReconciliationTower } from '../api/towerReconciliation';

export type TowerCoverageFilter = 'all' | 'without_evidence' | 'without_visit' | 'screening' | 'categories' | 'ready' | 'remaining' | 'in_progress';
export function matchesTowerCoverage(tower: ReconciliationTower, filter: TowerCoverageFilter) {
  switch (filter) {
    case 'without_evidence': return tower.archive_images === 0;
    case 'without_visit': return tower.visit_id === null;
    case 'screening': return tower.visit_id !== null && !tower.screening_ready;
    case 'categories': return tower.visit_id !== null && !tower.four_category_coverage;
    case 'remaining': return !tower.screening_and_evidence_ready;
    case 'in_progress': return tower.visit_id !== null && !tower.screening_and_evidence_ready;
    case 'ready': return tower.screening_and_evidence_ready;
    default: return true;
  }
}

// Protect spreadsheet applications from evaluating tower/team names as formulas.
const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export function reconciliationCsv(teams: ReconciliationTeam[]) {
  const rows: unknown[][] = [['Team', 'Tower', 'Scope', 'Latest inspection date', 'Visit ID', 'All-time images and field photos', 'Installed positions', 'Screened positions', 'Expected category slots', 'Covered category slots', 'Missing category slots', 'Screening ready', 'Four-category coverage', 'Screening and evidence ready']];
  for (const team of teams) {
    for (const tower of team.towers) rows.push([team.name, tower.tower_id, 'Current assignment', tower.inspection_date, tower.visit_id, tower.archive_images, tower.installed_positions, tower.screened_positions, tower.expected_categories, tower.covered_categories, tower.missing_categories, tower.screening_ready, tower.four_category_coverage, tower.screening_and_evidence_ready]);
    for (const tower of team.outside_assignment) rows.push([team.name, tower.tower_id, 'Historical evidence outside current assignment', '', '', tower.archive_images]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
