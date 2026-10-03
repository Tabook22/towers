import type { OutingPlan, Visit } from '../api/types';

export type PlanStep = 'planning' | 'work' | 'history';
export type PlanBlock = 'plan' | 'inspection' | 'unavailable' | null;

/** Plans have no visit foreign key: match by team, calendar day and planned tower IDs. */
export function planStepBlock(step: PlanStep, teamId: number, day: string, plan: OutingPlan | undefined, visits: Visit[] | undefined, failed = false): PlanBlock {
  if (step === 'planning') return null;
  if (failed || !plan || !day || plan.team_id !== teamId || plan.field_date !== day) return 'unavailable';
  if (!plan.tower_ids.length) return 'plan';
  if (step === 'work') return null;
  if (!visits) return 'unavailable';
  const relevant = visits.filter(visit => visit.team_id === teamId && visit.inspection_date === day && plan.tower_ids.includes(visit.tower_id));
  if (relevant.some(visit => (visit.rollup?.screened ?? 0) > 0)) return null;
  if (relevant.some(visit => !visit.rollup)) return 'unavailable';
  return 'inspection';
}
