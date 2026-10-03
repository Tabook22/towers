import type { TeamJobMap, Visit } from '../api/types';

export type GuideReason = 'loading' | 'unavailable' | 'assign' | 'draft' | 'unknown' | 'screening' | 'evidence' | 'start' | 'review';

/** Uses the exact current visit from the job map; history never masks unfinished work. */
export function teamGuidance(map: TeamJobMap | undefined, visits: Visit[] | undefined, failed: boolean, deviceDrafts: Set<number> = new Set()) {
  const rows = (map?.towers || []).map(tower => {
    const visit = visits?.find(v => v.id === tower.visit_id && v.tower_id === tower.id);
    const draft = !!visit && (!!visit.has_working_draft || deviceDrafts.has(visit.id));
    const reason: GuideReason = tower.visit_id == null ? 'start' : draft ? 'draft' : !visit?.rollup ? 'unknown'
      : visit.rollup.visit_status !== 'Ready for review' ? 'screening'
      : visit.rollup.images_pending > 0 ? 'evidence' : 'review';
    return { tower, visit, draft, reason };
  });
  const rank: Record<GuideReason, number> = { loading: 0, unavailable: 0, assign: 0, draft: 1, unknown: 2, screening: 3, evidence: 4, start: 5, review: 6 };
  const ordered = [...rows].sort((a, b) => rank[a.reason] - rank[b.reason] || a.tower.tower_id.localeCompare(b.tower.tower_id, undefined, { numeric: true }));
  const reason: GuideReason = failed ? 'unavailable' : !map || !visits ? 'loading' : !rows.length ? 'assign' : ordered[0].reason;
  return {
    reason, next: ordered[0], rows,
    assigned: rows.length, visits: visits?.length || 0,
    screened: rows.reduce((sum, r) => sum + (r.visit?.rollup?.screened || 0), 0),
    installed: rows.reduce((sum, r) => sum + (r.visit?.rollup?.installed || 0), 0),
    missingResults: rows.reduce((sum, r) => sum + Math.max(0, (r.visit?.rollup?.installed || 0) - (r.visit?.rollup?.screened || 0)), 0),
    missingEvidence: rows.reduce((sum, r) => sum + (r.visit?.rollup?.images_pending || 0), 0),
    drafts: rows.filter(r => r.draft).length,
    unstarted: rows.filter(r => r.reason === 'start').length,
    unknown: rows.filter(r => r.reason === 'unknown').length,
    screeningReady: rows.filter(r => r.visit?.rollup?.visit_status === 'Ready for review').length,
  };
}
export type TeamGuidance = ReturnType<typeof teamGuidance>;

/** Advice only: older reports and partial report selection remain legitimate actions. */
export function teamGuidanceWarning(guide: TeamGuidance, target: string): string | null {
  if (['loading', 'unavailable'].includes(guide.reason)) return target === 'report' ? 'I cannot verify progress yet. Refresh the team data before relying on this summary.' : null;
  if (target === 'work' && !guide.assigned) return 'Assign towers first so the team has a clear inspection list. You can still open this section.';
  if (target === 'history' && !guide.visits) return 'There are no recorded visits yet. Assign a tower and start its inspection first. You can still open the history section.';
  if (target === 'report') {
    if (!guide.visits) return 'There are no recorded visits yet. Start an inspection and confirm its data before preparing a report.';
    if (guide.drafts) return 'Your working drafts are not included in reports. Review and confirm the relevant visit first, or continue to select other confirmed work.';
    if (guide.missingResults || guide.missingEvidence || guide.unknown || guide.rows.some(r => r.reason === 'screening')) return 'Some current visits still need inspection results, evidence, or verification. Complete the relevant visit first, or continue to select other confirmed work.';
  }
  return null;
}
