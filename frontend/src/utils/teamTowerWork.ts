import type { TeamJobMapTower, Visit } from '../api/types';

export type WorkStatus = 'pending' | 'in_progress' | 'ready' | 'unknown';

/** Use the job map's exact visit ID; never silently open a different historical visit. */
export function towerWorkState(tower: TeamJobMapTower, visits: Visit[]) {
  const visit = visits.find(v => v.id === tower.visit_id && v.tower_id === tower.id);
  const status: WorkStatus = tower.visit_id == null ? 'pending'
    : !visit?.rollup ? 'unknown'
    : visit.has_working_draft ? 'in_progress'
    : visit.rollup.visit_status === 'Ready for review' ? 'ready' : 'in_progress';
  return { visit, status };
}

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  pending: 'Not started', in_progress: 'In progress', ready: 'Ready for review', unknown: 'Open inspection',
};

export function localInspectionDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dailyVisitProgress(visits: Visit[], date: string) {
  const daily = visits.filter(visit => !!date && visit.inspection_date === date);
  return {
    total: daily.length,
    ready: daily.filter(visit => visit.rollup?.visit_status === 'Ready for review').length,
    incomplete: daily.filter(visit => visit.rollup && visit.rollup.visit_status !== 'Ready for review').length,
    unknown: daily.filter(visit => !visit.rollup).length,
    imagesPending: daily.reduce((sum, visit) => sum + (visit.rollup?.images_pending || 0), 0),
  };
}


/** A device copy is a separate indicator, never a substitute for confirmed progress. */
export function hasDeviceVisitDraft(raw: string | null) {
  try {
    const value = JSON.parse(raw || 'null');
    const entry = value?.entry;
    return !!(entry && (Object.keys(entry.drafts || {}).length || entry.additions?.length || entry.headerDraft
      || entry.layoutIds || entry.excludedImages?.length || value.commitToken));
  } catch { return false; }
}
