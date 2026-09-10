import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type {
  AdminUser,
  Area,
  ChoiceLists,
  DashboardSummary,
  FieldExecutionPlanRequest,
  ImageRow,
  LineInspectionReportOut,
  LineInspectionReportRequest,
  LiveTeamMember,
  LoginResponse,
  OetcAreaReportRequest,
  OetcConsolidatedReportRequest,
  Position,
  ReportTemplate,
  ReportTemplatesActive,
  Team,
  TeamActivityTeam,
  TeamDailyLog,
  TeamDayProgress,
  TeamJobMap,
  TeamMember,
  Tower,
  TowerWithStats,
  TrailPoint,
  Visit,
  VisitDetail,
  VisitPhoto,
} from './types';

// ---------- Auth ----------
export function useLogin() {
  return useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const form = new URLSearchParams();
      form.set('username', creds.username);
      form.set('password', creds.password);
      const { data } = await apiClient.post<LoginResponse>('/api/auth/login', form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return data;
    },
  });
}

// ---------- Lists (choice enums) ----------
export function useChoiceLists() {
  return useQuery({
    queryKey: ['lists'],
    queryFn: async () => (await apiClient.get<ChoiceLists>('/api/lists')).data,
    staleTime: Infinity,
  });
}

// ---------- Towers ----------
export function useTowers(
  params: { search?: string; area?: string; assigned_team_id?: number; unassigned?: boolean; include_inactive?: boolean } = {},
) {
  return useQuery({
    queryKey: ['towers', params],
    queryFn: async () => (await apiClient.get<TowerWithStats[]>('/api/towers', { params })).data,
  });
}

export function useAreas() {
  return useQuery({
    queryKey: ['areas'],
    queryFn: async () => (await apiClient.get<string[]>('/api/towers/areas')).data,
  });
}

// Full CRUD on the Area catalog itself (add/rename/delete) — see backend routers/areas.py.
// Distinct from useAreas() above, which just lists names for filter/form dropdowns.
export function useAreasFull() {
  return useQuery({
    queryKey: ['areas-full'],
    queryFn: async () => (await apiClient.get<Area[]>('/api/areas')).data,
  });
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; notes?: string | null }) => (await apiClient.post<Area>('/api/areas', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['areas-full'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
    },
  });
}

export function useUpdateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: { name?: string; notes?: string | null } }) =>
      (await apiClient.patch<Area>(`/api/areas/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['areas-full'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
      qc.invalidateQueries({ queryKey: ['towers'] }); // a rename updates every tower carrying the old name
    },
  });
}

export function useDeleteArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/areas/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['areas-full'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
      qc.invalidateQueries({ queryKey: ['towers'] }); // deleting an in-use area clears it off those towers
    },
  });
}

export function useCreateTower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Tower>) => (await apiClient.post<Tower>('/api/towers', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateTower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<Tower> }) =>
      (await apiClient.patch<Tower>(`/api/towers/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// Bulk create/update towers from an uploaded Excel file — upserted by Tower ID. See backend
// services/tower_import.py for the exact column rules.
export interface TowerImportResult {
  created: number;
  updated: number;
  total_rows: number;
  warnings: string[];
}

export function useImportTowers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set('file', file);
      const { data } = await apiClient.post<TowerImportResult>('/api/towers/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// The core of "admin assigns towers to a team" — sets (or clears, with team_id: null)
// Tower.assigned_team_id on every tower id given, in one action.
export function useBulkAssignTowers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { tower_ids: number[]; team_id: number | null }) =>
      (await apiClient.post<Tower[]>('/api/towers/bulk-assign', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['team-job-map'] });
    },
  });
}

export function useDeactivateTower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/towers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUploadTowerPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const form = new FormData();
      form.set('file', file);
      const { data } = await apiClient.post<Tower>(`/api/towers/${id}/photo`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
    },
  });
}

export function useClearTowerPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await apiClient.delete<Tower>(`/api/towers/${id}/photo`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
    },
  });
}

// ---------- Visits ----------
export function useVisits(towerId?: number) {
  return useQuery({
    queryKey: ['visits', towerId],
    queryFn: async () => (await apiClient.get('/api/visits', { params: { tower_id: towerId } })).data,
    enabled: towerId !== undefined,
  });
}

// A team_member's own workspace — the backend already scopes GET /api/visits with no filters to
// "assigned to me" for that role (see routers/visits.py's list_visits), so this is just that.
export function useMyMissions() {
  return useQuery({
    queryKey: ['my-missions'],
    queryFn: async () => (await apiClient.get<Visit[]>('/api/visits')).data,
  });
}

export function useVisit(visitId?: number) {
  return useQuery({
    queryKey: ['visit', visitId],
    queryFn: async () => (await apiClient.get<VisitDetail>(`/api/visits/${visitId}`)).data,
    enabled: !!visitId,
  });
}

export function useCreateVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await apiClient.post<VisitDetail>('/api/visits', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['towers'] });
    },
  });
}

export function useUpdateVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      (await apiClient.patch<VisitDetail>(`/api/visits/${id}`, payload)).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['visit', vars.id] });
      qc.invalidateQueries({ queryKey: ['visits'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      // A visit can also be a team's mission (team_id set) — keep that view in sync too.
      qc.invalidateQueries({ queryKey: ['team-missions'] });
      qc.invalidateQueries({ queryKey: ['team-progress'] });
    },
  });
}

export function useDeleteVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/api/visits/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['team-missions'] });
      qc.invalidateQueries({ queryKey: ['team-progress'] });
    },
  });
}

// ---------- Positions ----------
export function useUpdatePosition(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<Position> }) =>
      (await apiClient.patch<Position>(`/api/positions/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['towers'] });
    },
  });
}

// ---------- Images ----------
export function useUploadImage(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      imageId,
      file,
      captureDate,
      captureTime,
      latitude,
      longitude,
    }: {
      imageId: number;
      file: File;
      captureDate?: string;
      captureTime?: string;
      latitude?: number;
      longitude?: number;
    }) => {
      const form = new FormData();
      form.set('file', file);
      if (captureDate) form.set('capture_date', captureDate);
      if (captureTime) form.set('capture_time', captureTime);
      if (latitude !== undefined) form.set('latitude', String(latitude));
      if (longitude !== undefined) form.set('longitude', String(longitude));
      const { data } = await apiClient.post<ImageRow>(`/api/images/${imageId}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useUpdateImage(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<ImageRow> }) =>
      (await apiClient.patch<ImageRow>(`/api/images/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useRetypeImage(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, newType }: { id: number; newType: string }) =>
      (await apiClient.post<ImageRow>(`/api/images/${id}/retype`, { new_type: newType })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useMakePrimaryImage(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: number) => (await apiClient.post<Position>(`/api/images/${imageId}/make-primary`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useAddExtraImage(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      positionId,
      imageType,
      file,
      captureDate,
      captureTime,
      latitude,
      longitude,
    }: {
      positionId: number;
      imageType: string;
      file: File;
      captureDate?: string;
      captureTime?: string;
      latitude?: number;
      longitude?: number;
    }) => {
      const form = new FormData();
      form.set('image_type', imageType);
      form.set('file', file);
      if (captureDate) form.set('capture_date', captureDate);
      if (captureTime) form.set('capture_time', captureTime);
      if (latitude !== undefined) form.set('latitude', String(latitude));
      if (longitude !== undefined) form.set('longitude', String(longitude));
      const { data } = await apiClient.post<ImageRow>(`/api/positions/${positionId}/images`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useDeleteImage(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: number) => apiClient.delete(`/api/images/${imageId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useClearImageFile(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: number) => (await apiClient.delete<ImageRow>(`/api/images/${imageId}/file`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useSaveAnnotation(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ imageId, blob }: { imageId: number; blob: Blob }) => {
      const form = new FormData();
      form.set('file', blob, 'annotation.jpg');
      const { data } = await apiClient.post<ImageRow>(`/api/images/${imageId}/annotation`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useClearAnnotation(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: number) => (await apiClient.delete<ImageRow>(`/api/images/${imageId}/annotation`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

// ---------- Dashboard ----------
export function useDashboardSummary(area?: string) {
  return useQuery({
    queryKey: ['dashboard', area],
    queryFn: async () => (await apiClient.get<DashboardSummary>('/api/dashboard/summary', { params: { area } })).data,
    refetchInterval: 30000,
  });
}

// ---------- Archive ----------
export function useArchive(filters: { year?: number; month?: number; day?: number; tower_id?: number }) {
  return useQuery({
    queryKey: ['archive', filters],
    queryFn: async () => (await apiClient.get<ImageRow[]>('/api/archive', { params: filters })).data,
  });
}

// ---------- Report templates ----------
// A docx (Word mail-merge) and a pdf (fillable-form) template can be active at the same time — they
// produce different output formats. Logo/colors/fonts/layout all come from the uploaded file itself
// (see backend/app/services/docx_reports.py and pdf_form_reports.py); this just tracks which one(s)
// are uploaded and their filenames.
export function useReportTemplate() {
  return useQuery({
    queryKey: ['report-template'],
    queryFn: async () => (await apiClient.get<ReportTemplatesActive>('/api/report-templates/active')).data,
  });
}

// The team/day/tower/position/image master report — every team's field work, grouped the way an
// admin actually thinks about progress. See backend services/team_activity_report.py.
export function useTeamActivityReport(filters: { teamId?: number; startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['team-activity', filters.teamId, filters.startDate, filters.endDate],
    queryFn: async () =>
      (
        await apiClient.get<TeamActivityTeam[]>('/api/reports/team-activity', {
          params: { team_id: filters.teamId, start_date: filters.startDate, end_date: filters.endDate },
        })
      ).data,
  });
}

// Generates the OETC-style field execution plan .docx and triggers a browser download — a POST
// (unlike the GET-based PDF/xlsx reports elsewhere) since it needs a form's worth of free-text
// inputs (client, reference letter, period, capacity assumption) that don't fit in query params.
export function useGenerateFieldExecutionPlan() {
  return useMutation({
    mutationFn: async (payload: FieldExecutionPlanRequest) => {
      const res = await apiClient.post('/api/reports/field-execution-plan.docx', payload, {
        responseType: 'blob',
      });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const match = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '');
      a.download = match ? match[1] : 'field-execution-plan.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

// Shared by every OETC-report download mutation below — triggers the browser's save dialog for a
// blob response, naming the file from the server's Content-Disposition header when it sends one.
function downloadBlobResponse(res: { data: unknown; headers: Record<string, unknown> }, fallbackName: string) {
  const blob = res.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const disposition = res.headers['content-disposition'];
  const match = /filename="([^"]+)"/.exec(typeof disposition === 'string' ? disposition : '');
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The official OETC-format report — a team's line campaign, rendered into the customer's exact
// template. Also persists a LineInspectionReport row server-side (see useOetcReportHistory below).
export function useGenerateOetcReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: LineInspectionReportRequest) => {
      const res = await apiClient.post('/api/reports/oetc-line-report.docx', payload, { responseType: 'blob' });
      downloadBlobResponse(res, `${payload.report_number}.docx`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oetc-report-history'] });
    },
  });
}

// Same official template, but one file covering every team working a given area — see
// backend services/oetc_grouped_report.py. Admin/reviewer only, same as the consolidated version.
export function useGenerateOetcAreaReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OetcAreaReportRequest) => {
      const res = await apiClient.post('/api/reports/oetc-area-report.docx', payload, { responseType: 'blob' });
      downloadBlobResponse(res, `${payload.report_number}-${payload.area}.docx`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oetc-report-history'] });
    },
  });
}

// The fully "collected" report — every area, every team, every mission, in one file.
export function useGenerateOetcConsolidatedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OetcConsolidatedReportRequest) => {
      const res = await apiClient.post('/api/reports/oetc-consolidated-report.docx', payload, { responseType: 'blob' });
      downloadBlobResponse(res, `${payload.report_number}-consolidated.docx`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oetc-report-history'] });
    },
  });
}

export function useOetcReportHistory(teamId?: number) {
  return useQuery({
    queryKey: ['oetc-report-history', teamId],
    queryFn: async () =>
      (await apiClient.get<LineInspectionReportOut[]>('/api/reports/oetc-line-report/history', { params: { team_id: teamId } })).data,
  });
}

export function useUploadReportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set('file', file);
      const { data } = await apiClient.post<ReportTemplate>('/api/report-templates', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-template'] });
    },
  });
}

export function useDeleteReportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: 'docx' | 'pdf') => apiClient.delete('/api/report-templates/active', { params: { kind } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-template'] });
    },
  });
}

// ---------- Field tracking ----------
export function useSendLocationPing() {
  return useMutation({
    mutationFn: async (payload: { latitude: number; longitude: number; accuracy_m?: number | null }) =>
      apiClient.post('/api/tracking/ping', payload),
  });
}

/** The dispatcher-facing board — who's out there right now and how their day is going. Polled, not
 * pushed: field team size is small enough that a plain interval is simpler than websockets and just
 * as timely for this use case (a supervisor glancing at a board, not a life-safety feed). */
export function useLiveTeams(onDate?: string) {
  return useQuery({
    queryKey: ['tracking', 'live', onDate],
    queryFn: async () =>
      (await apiClient.get<LiveTeamMember[]>('/api/tracking/live', { params: { on_date: onDate } })).data,
    refetchInterval: 20000,
  });
}

export function useUserTrail(userId: number | undefined, onDate?: string) {
  return useQuery({
    queryKey: ['tracking', 'trail', userId, onDate],
    queryFn: async () =>
      (await apiClient.get<TrailPoint[]>('/api/tracking/trail', { params: { user_id: userId, on_date: onDate } }))
        .data,
    enabled: userId !== undefined,
  });
}

// ---------- Users (admin — mainly to link a login to a team) ----------
export function useUsers(enabled = true) {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => (await apiClient.get<AdminUser[]>('/api/auth/users')).data,
    enabled,
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<
        Pick<AdminUser, 'team_id' | 'role' | 'is_active' | 'full_name' | 'email' | 'mobile' | 'address' | 'notes' | 'job_type'>
      > & { password?: string };
    }) => (await apiClient.patch<AdminUser>(`/api/auth/users/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      username: string;
      password: string;
      full_name?: string;
      mobile?: string;
      address?: string;
      notes?: string;
      job_type?: string;
      role: string;
      team_id?: number | null;
    }) => (await apiClient.post<AdminUser>('/api/auth/users', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

// Deletes a login outright — or, if it has real mission-assignment history, deactivates it instead
// (the backend decides; see routers/auth.py's delete_user).
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/auth/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

// Self-service password change — any signed-in account, no admin/leader involved.
export function useChangePassword() {
  return useMutation({
    mutationFn: async (payload: { current_password: string; new_password: string }) =>
      apiClient.post('/api/auth/change-password', payload),
  });
}

// ---------- Teams ----------
export function useTeams(includeInactive?: boolean) {
  return useQuery({
    queryKey: ['teams', includeInactive],
    queryFn: async () =>
      (await apiClient.get<Team[]>('/api/teams', { params: { include_inactive: includeInactive } })).data,
  });
}

export function useTeam(teamId: number | undefined) {
  return useQuery({
    queryKey: ['team', teamId],
    queryFn: async () => (await apiClient.get<Team>(`/api/teams/${teamId}`)).data,
    enabled: teamId !== undefined,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiClient.post<Team>('/api/teams', payload)).data,
    // Creating a team can link a leader_user_id, which moves that account's team_id server-side —
    // invalidate ['users'] too so the Team Leaders table's "assigned team" column stays in sync.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      (await apiClient.patch<Team>(`/api/teams/${id}`, payload)).data,
    // Same as above — a leader_user_id change here moves a User's team_id, and reassigning a leader
    // away from another team clears that team's leader_user_id too, so both caches need refreshing.
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['team', vars.id] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

// Deletes a team outright — every mission it ran and every login linked to it goes with it; towers
// assigned to it are only unassigned, not deleted (see routers/teams.py's delete_team).
export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/teams/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['towers'] }); // its assigned towers just became unassigned
      qc.invalidateQueries({ queryKey: ['dashboard'] }); // its missions are gone
      qc.invalidateQueries({ queryKey: ['archive'] });
    },
  });
}

export function useAddTeamMember(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<TeamMember>) =>
      (await apiClient.post<TeamMember>(`/api/teams/${teamId}/members`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team', teamId] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useUpdateTeamMember(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<TeamMember> }) =>
      (await apiClient.patch<TeamMember>(`/api/teams/${teamId}/members/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team', teamId] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useRemoveTeamMember(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/teams/${teamId}/members/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team', teamId] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useAddTeamNote(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { log_date: string; note: string }) =>
      (await apiClient.post<TeamDailyLog>(`/api/teams/${teamId}/notes`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-progress', teamId] }),
  });
}

export function useDeleteTeamNote(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: number) => apiClient.delete(`/api/teams/${teamId}/notes/${noteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-progress', teamId] }),
  });
}

// A "mission" is just a Visit with team_id/mission_seq set — these hooks are thin, team-scoped
// wrappers; once you have the visit's id, edit/delete/photos all go through the Visit hooks below
// (useUpdateVisit, useDeleteVisit, useVisitPhotos, ...) exactly like any other visit.
export function useTeamMissions(teamId: number | undefined) {
  return useQuery({
    queryKey: ['team-missions', teamId],
    queryFn: async () => (await apiClient.get<Visit[]>(`/api/teams/${teamId}/missions`)).data,
    enabled: teamId !== undefined,
  });
}

// The team's whole assigned job — every tower in its sector, done vs. pending — not just the
// missions it already has. See backend routers/teams.py's team_job_map.
export function useTeamJobMap(teamId: number | undefined) {
  return useQuery({
    queryKey: ['team-job-map', teamId],
    queryFn: async () => (await apiClient.get<TeamJobMap>(`/api/teams/${teamId}/job-map`)).data,
    enabled: teamId !== undefined,
  });
}

export function useCreateTeamMission(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await apiClient.post<VisitDetail>(`/api/teams/${teamId}/missions`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-missions', teamId] });
      qc.invalidateQueries({ queryKey: ['team-progress', teamId] });
    },
  });
}

export function useVisitPhotos(visitId: number | undefined) {
  return useQuery({
    queryKey: ['visit-photos', visitId],
    queryFn: async () => (await apiClient.get<VisitPhoto[]>(`/api/visits/${visitId}/photos`)).data,
    enabled: visitId !== undefined,
  });
}

export function useUploadVisitPhoto(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, caption, positionId }: { file: File; caption?: string; positionId?: number }) => {
      const form = new FormData();
      form.set('file', file);
      if (caption) form.set('caption', caption);
      if (positionId) form.set('position_id', String(positionId));
      const { data } = await apiClient.post<VisitPhoto>(`/api/visits/${visitId}/photos`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-photos', visitId] });
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
    },
  });
}

export function useDeleteVisitPhoto(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photoId: number) => apiClient.delete(`/api/visits/${visitId}/photos/${photoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-photos', visitId] });
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
    },
  });
}

export function usePromoteVisitPhoto(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ photoId, imageId }: { photoId: number; imageId: number }) =>
      (
        await apiClient.post<ImageRow>(`/api/visits/${visitId}/photos/${photoId}/promote`, {
          image_id: imageId,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit-photos', visitId] });
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
    },
  });
}

export function useTeamProgress(teamId: number | undefined, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['team-progress', teamId, startDate, endDate],
    queryFn: async () =>
      (
        await apiClient.get<TeamDayProgress[]>(`/api/teams/${teamId}/progress`, {
          params: { start_date: startDate, end_date: endDate },
        })
      ).data,
    enabled: teamId !== undefined,
  });
}

export function useTeamLive(teamId: number | undefined) {
  return useQuery({
    queryKey: ['team-live', teamId],
    queryFn: async () => (await apiClient.get<LiveTeamMember[]>(`/api/teams/${teamId}/live`)).data,
    enabled: teamId !== undefined,
    refetchInterval: 20000,
  });
}
