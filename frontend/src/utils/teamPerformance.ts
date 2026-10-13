export interface PerformanceTower {
  visit_id: number | null;
  screening_and_evidence_ready: boolean;
  screening_ready: boolean;
  four_category_coverage: boolean;
  installed_positions: number;
  archive_images: number;
}

export function towerDataStatus(tower: PerformanceTower): 'complete' | 'in_progress' | 'no_visit' {
  if (tower.screening_and_evidence_ready) return 'complete';
  return tower.visit_id === null ? 'no_visit' : 'in_progress';
}

export function teamPerformance(towers: PerformanceTower[]) {
  const assigned = towers.length;
  const complete = towers.filter(t => towerDataStatus(t) === 'complete').length;
  const noVisit = towers.filter(t => towerDataStatus(t) === 'no_visit').length;
  return { assigned, complete, noVisit, inProgress: assigned - complete - noVisit, remaining: assigned - complete, percent: assigned ? Math.round(complete / assigned * 1000) / 10 : 0 };
}

export function towerRemainingWork(tower: PerformanceTower): string[] {
  if (towerDataStatus(tower) === 'complete') return [];
  if (tower.visit_id === null) return ['No visit recorded'];
  const reasons: string[] = [];
  if (!tower.installed_positions) reasons.push('No installed positions recorded');
  else {
    if (!tower.screening_ready) reasons.push('Screening needs work');
    if (!tower.four_category_coverage) reasons.push('Four-category gaps');
  }
  if (!tower.archive_images) reasons.push('No archived evidence');
  return reasons;
}
