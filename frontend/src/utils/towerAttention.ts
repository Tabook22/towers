import type { DashboardTowerRow, Team } from '../api/types';

export type AttentionStage = 'planned' | 'progress' | 'review';

/** Latest open work only. Screening readiness does not mean the mission is completed. */
export function towerAttentionItems(rows: DashboardTowerRow[], teams: Pick<Team, 'id' | 'name'>[]) {
  return rows.filter(({ tower, latest_visit: visit }) => visit
    ? ['planned', 'in_progress'].includes(visit.mission_status) && visit.status !== 'closed'
    : tower.assigned_team_id != null
  ).map(row => {
    const visit = row.latest_visit;
    const ready = row.rollup?.visit_status === 'Ready for review';
    const stage: AttentionStage = ready ? 'review'
      : visit?.mission_status === 'in_progress' || (row.rollup?.screened ?? 0) > 0 ? 'progress' : 'planned';
    const teamId = visit?.team_id ?? row.tower.assigned_team_id;
    const teamName = (visit?.team_id != null ? visit.team_name : row.tower.assigned_team_name)
      || teams.find(team => team.id === teamId)?.name || null;
    const assignedId = row.tower.assigned_team_id;
    const reassigned = visit?.team_id != null && assignedId != null && visit.team_id !== assignedId;
    const assignedName = row.tower.assigned_team_name || teams.find(team => team.id === assignedId)?.name || null;
    const action = !visit ? 'Start inspection' : !row.rollup ? 'Open visit'
      : !ready ? 'Continue inspection' : row.rollup.images_pending > 0 ? 'Add evidence' : 'Review visit';
    return { ...row, stage, teamId, teamName, reassigned, assignedName, action,
      href: visit ? `/visits/${visit.id}` : `/towers/${row.tower.id}` };
  }).sort((a, b) => (b.rollup?.hotspots ?? 0) - (a.rollup?.hotspots ?? 0)
    || a.tower.tower_id.localeCompare(b.tower.tower_id, undefined, { numeric: true }));
}
