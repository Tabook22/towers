import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';

export interface ReconciliationCounts {
  assigned: number;
  assigned_with_evidence: number;
  without_evidence: number;
  without_visit: number;
  screening_ready: number;
  four_category_coverage: number;
  screening_and_evidence_ready: number;
}
export interface ReconciliationTower {
  id: number;
  tower_id: string;
  area: string | null;
  visit_id: number | null;
  inspection_date: string | null;
  archive_images: number;
  installed_positions: number;
  screened_positions: number;
  expected_categories: number;
  covered_categories: number;
  missing_categories: number;
  screening_ready: boolean;
  four_category_coverage: boolean;
  screening_and_evidence_ready: boolean;
}
export interface ReconciliationTeam {
  id: number;
  name: string;
  declared_status: string;
  status_needs_review: boolean;
  counts: ReconciliationCounts & { archive_towers: number; outside_assignment: number };
  towers: ReconciliationTower[];
  outside_assignment: { id: number; tower_id: string; is_active: boolean; assigned_team_name: string | null; archive_images: number }[];
}
export interface TowerReconciliationResponse {
  teams: ReconciliationTeam[];
  totals: ReconciliationCounts;
  unique_archive_towers: number;
  archive_team_entries: number;
  inactive_inventory: number | null;
  unassigned_active: number | null;
}
export function useTowerReconciliation(enabled = true) {
  return useQuery({
    queryKey: ['teams', 'tower-reconciliation'],
    queryFn: async () => (await apiClient.get<TowerReconciliationResponse>('/api/teams/tower-reconciliation')).data,
    enabled,
    refetchInterval: 30_000,
  });
}
