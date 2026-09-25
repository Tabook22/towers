export type CountKey = 'planned' | 'visited' | 'recorded' | 'finished' | 'reported';
export type Counts = Record<CountKey, number>;
export interface ActivityReport { id: number; number: string; start_date: string; end_date: string; has_file: boolean }
export interface ActivityTower { id: number; name: string; planned?: boolean; visited?: boolean; recorded?: boolean; finished?: boolean; reported?: boolean; visit_ids?: number[]; reports: ActivityReport[] }
export interface ActivityDay { date: string; mission_name: string | null; has_mission: boolean; mission_ended: boolean; counts: Counts; towers: ActivityTower[] }
export interface ActivityTeam { id: number; name: string; is_active: boolean; mission_count: number; counts: Counts; days: ActivityDay[]; reports: ActivityReport[]; report_towers: ActivityTower[]; undated_report_towers: number; unknown_scope_reports: number }
export interface TeamActivity { start_date: string; end_date: string; teams: ActivityTeam[] }
