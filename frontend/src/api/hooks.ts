import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { asOutboxFile, sendOrQueue } from '../offline/enqueue';
import { applyPositionPatch, applyQueuedExtraImage, applyQueuedImage, applyVisitPatch, patchVisitCache } from '../offline/optimistic';
import { isQueued } from '../offline/types';
import type {
  AdminUser,
  Area,
  ChannelKind,
  ChannelMessage,
  ChoiceLists,
  DashboardSummary,
  FieldExecutionPlanRequest,
  ImageRow,
  LineInspectionReportOut,
  LineInspectionReportRequest,
  LiveTeamMember,
  LoginResponse,
  MovementDayReport,
  TeamProgress,
  TrackingMission,
  OetcAreaReportRequest,
  OetcConsolidatedReportRequest,
  Position,
  ReportTemplate,
  ReportTemplatesActive,
  Team,
  TeamActivityTeam,
  TeamDailyLog,
  TeamDayProgress,
  OutingPlan,
  TeamJobMap,
  NextTowersPlan,
  NightClaim,
  NightClaimStatus,
  TeamMember,
  Tower,
  TowerWithStats,
  TrailPoint,
  UserTrail,
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
  params: {
    search?: string;
    area?: string;
    assigned_team_id?: number;
    unassigned?: boolean;
    include_inactive?: boolean;
    limit?: number;
  } = {},
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
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) => {
      const result = await sendOrQueue(
        async () => (await apiClient.patch<VisitDetail>(`/api/visits/${id}`, payload)).data,
        { kind: 'visit-update', label: 'Visit details', path: { visitId: id }, json: payload },
      );
      if (isQueued(result)) {
        patchVisitCache(qc, id, (v) => applyVisitPatch(v, payload));
        return result;
      }
      return result;
    },
    onSuccess: (data, vars) => {
      if (isQueued(data)) return;
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
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<Position> }) => {
      const result = await sendOrQueue(
        async () => (await apiClient.patch<Position>(`/api/positions/${id}`, payload)).data,
        {
          kind: 'position-update',
          label: 'Screening / position fields',
          path: { positionId: id, visitId },
          json: payload as Record<string, unknown>,
        },
      );
      if (isQueued(result)) {
        patchVisitCache(qc, visitId, (v) => applyPositionPatch(v, id, payload));
        return result;
      }
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
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
      const result = await sendOrQueue(
        async () =>
          (
            await apiClient.post<ImageRow>(`/api/images/${imageId}/upload`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 120_000,
            })
          ).data,
        {
          kind: 'image-upload',
          label: `Photo · ${file.name}`,
          path: { imageId, visitId },
          json: { capture_date: captureDate, capture_time: captureTime, latitude, longitude },
          file: asOutboxFile(file),
        },
      );
      if (isQueued(result)) {
        patchVisitCache(qc, visitId, (v) => applyQueuedImage(v, imageId, file));
        return result;
      }
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
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
      const localId = -Math.floor(Date.now() % 1_000_000_000);
      const result = await sendOrQueue(
        async () =>
          (
            await apiClient.post<ImageRow>(`/api/positions/${positionId}/images`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 120_000,
            })
          ).data,
        {
          kind: 'extra-image',
          label: `Extra photo · ${imageType}`,
          path: { positionId, visitId, imageId: localId },
          json: { image_type: imageType, capture_date: captureDate, capture_time: captureTime, latitude, longitude },
          file: asOutboxFile(file),
        },
      );
      if (isQueued(result)) {
        patchVisitCache(qc, visitId, (v) => applyQueuedExtraImage(v, positionId, imageType, localId, file));
        return result;
      }
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
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
      const result = await sendOrQueue(
        async () =>
          (
            await apiClient.post<ImageRow>(`/api/images/${imageId}/annotation`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 120_000,
            })
          ).data,
        {
          kind: 'annotation',
          label: 'Photo markup',
          path: { imageId, visitId },
          file: asOutboxFile(blob, 'annotation.jpg'),
        },
      );
      if (isQueued(result)) return result;
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
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
      sendOrQueue(() => apiClient.post('/api/tracking/ping', payload), {
        kind: 'ping',
        label: 'GPS position',
        path: {},
        json: payload,
      }),
  });
}

/** The dispatcher-facing board — who's out there right now and how their day is going. Polled, not
 * pushed: field team size is small enough that a plain interval is simpler than websockets and just
 * as timely for this use case (a supervisor glancing at a board, not a life-safety feed). */
export function useLiveTeams(onDate?: string, enabled = true) {
  return useQuery({
    queryKey: ['tracking', 'live', onDate],
    queryFn: async () =>
      (await apiClient.get<LiveTeamMember[]>('/api/tracking/live', { params: { on_date: onDate } })).data,
    enabled: enabled && (onDate === undefined || Boolean(onDate)),
    refetchInterval: enabled ? 10_000 : false,
    refetchOnWindowFocus: true,
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

export function useAllTrails(onDate?: string) {
  return useQuery({
    queryKey: ['tracking', 'trails', onDate],
    queryFn: async () =>
      (await apiClient.get<UserTrail[]>('/api/tracking/trails', { params: { on_date: onDate } })).data,
    enabled: Boolean(onDate),
    refetchInterval: 15_000,
  });
}

export function useShiftInfo() {
  return useQuery({
    queryKey: ['tracking', 'shift-info'],
    queryFn: async () =>
      (
        await apiClient.get<{
          field_date: string;
          start: string;
          end: string;
          timezone: string;
          starts_at: string;
          label: string;
        }>('/api/tracking/shift-info')
      ).data,
  });
}

export function useTeamMissionProgress(
  onDate?: string,
  fromHour?: number,
  toHour?: number,
  teamId?: number,
) {
  return useQuery({
    queryKey: ['tracking', 'team-progress', onDate, fromHour, toHour, teamId],
    queryFn: async () =>
      (
        await apiClient.get<TeamProgress[]>('/api/tracking/team-progress', {
          params: { on_date: onDate, from_hour: fromHour, to_hour: toHour, team_id: teamId },
        })
      ).data,
    enabled: Boolean(onDate),
    refetchInterval: 20_000,
  });
}

export function useDayReport(
  onDate?: string,
  fromHour?: number,
  toHour?: number,
  teamId?: number,
  missionId?: number,
  fromTs?: string,
  toTs?: string,
) {
  return useQuery({
    queryKey: ['tracking', 'day-report', onDate, fromHour, toHour, teamId, missionId, fromTs, toTs],
    queryFn: async () =>
      (
        await apiClient.get<MovementDayReport[]>('/api/tracking/day-report', {
          params: {
            on_date: onDate,
            from_hour: fromHour,
            to_hour: toHour,
            team_id: teamId,
            mission_id: missionId,
            from_ts: fromTs,
            to_ts: toTs,
          },
        })
      ).data,
    enabled: Boolean(onDate || missionId || fromTs),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useTrackingMissions() {
  return useQuery({
    queryKey: ['tracking', 'missions'],
    queryFn: async () => (await apiClient.get<TrackingMission[]>('/api/tracking/missions')).data,
    refetchInterval: 20_000,
  });
}

export function useStartTrackingMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<TrackingMission>('/api/tracking/missions')).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracking'] });
    },
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
    mutationFn: async (payload: { log_date: string; note: string }) => {
      const result = await sendOrQueue(
        async () => (await apiClient.post<TeamDailyLog>(`/api/teams/${teamId}/notes`, payload)).data,
        { kind: 'team-note', label: 'Daily note', path: { teamId }, json: payload },
      );
      if (isQueued(result)) return result;
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
      qc.invalidateQueries({ queryKey: ['team-progress', teamId] });
    },
  });
}

export function useRenameTeamNoteFile(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, fileId, original_filename }: { noteId: number; fileId: number; original_filename: string }) =>
      (
        await apiClient.patch<TeamDailyLog>(`/api/teams/${teamId}/notes/${noteId}/files/${fileId}`, {
          original_filename,
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-progress', teamId] }),
  });
}

export function useReplaceTeamNoteFile(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, fileId, file }: { noteId: number; fileId: number; file: File }) => {
      const form = new FormData();
      form.set('file', file, file.name);
      return (await apiClient.put<TeamDailyLog>(`/api/teams/${teamId}/notes/${noteId}/files/${fileId}`, form)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-progress', teamId] }),
  });
}

export function useDeleteTeamNoteFile(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, fileId }: { noteId: number; fileId: number }) =>
      (await apiClient.delete<TeamDailyLog>(`/api/teams/${teamId}/notes/${noteId}/files/${fileId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-progress', teamId] }),
  });
}

export function useAddTeamNoteFiles(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { log_date: string; files: File[]; note?: string; noteId?: number }) => {
      const form = new FormData();
      payload.files.forEach((f) => form.append('files', f, f.name));
      const send = async () => {
        if (payload.noteId) {
          return (await apiClient.post<TeamDailyLog>(`/api/teams/${teamId}/notes/${payload.noteId}/files`, form, { timeout: 120_000 })).data;
        }
        form.set('log_date', payload.log_date);
        if (payload.note) form.set('note', payload.note);
        return (await apiClient.post<TeamDailyLog>(`/api/teams/${teamId}/notes/files`, form, { timeout: 120_000 })).data;
      };
      const result = await sendOrQueue(send, {
        kind: 'team-files',
        label: payload.files.length === 1 ? `Site file · ${payload.files[0].name}` : `${payload.files.length} site files`,
        path: { teamId, ...(payload.noteId ? { noteId: payload.noteId } : {}) },
        json: { log_date: payload.log_date, note: payload.note },
        files: payload.files.map((f) => asOutboxFile(f)),
      });
      if (isQueued(result)) return result;
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
      qc.invalidateQueries({ queryKey: ['team-progress', teamId] });
    },
  });
}

export function useAddTeamVoiceNote(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { log_date: string; file: Blob; duration_seconds?: number; note?: string }) => {
      const form = new FormData();
      form.set('log_date', payload.log_date);
      const ext = payload.file.type.includes('mp4') ? 'm4a' : payload.file.type.includes('mpeg') ? 'mp3' : 'webm';
      const filename = `voice-note.${ext}`;
      form.set('file', payload.file, filename);
      if (payload.duration_seconds != null) form.set('duration_seconds', String(payload.duration_seconds));
      if (payload.note) form.set('note', payload.note);
      const result = await sendOrQueue(
        async () => (await apiClient.post<TeamDailyLog>(`/api/teams/${teamId}/notes/voice`, form, { timeout: 120_000 })).data,
        {
          kind: 'team-voice',
          label: 'Voice note',
          path: { teamId },
          json: { log_date: payload.log_date, duration_seconds: payload.duration_seconds, note: payload.note },
          file: asOutboxFile(payload.file, filename),
        },
      );
      if (isQueued(result)) return result;
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
      qc.invalidateQueries({ queryKey: ['team-progress', teamId] });
    },
  });
}

export function useTranscribeTeamNote(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: number) =>
      (await apiClient.post<TeamDailyLog>(`/api/teams/${teamId}/notes/${noteId}/transcribe`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-progress', teamId] }),
  });
}

export function useUpdateTeamNote(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, note }: { noteId: number; note: string }) =>
      (await apiClient.patch<TeamDailyLog>(`/api/teams/${teamId}/notes/${noteId}`, { note })).data,
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
export function useOutingPlan(teamId: number | undefined, fieldDate?: string) {
  return useQuery({
    queryKey: ['outing-plan', teamId, fieldDate],
    queryFn: async () =>
      (
        await apiClient.get<OutingPlan>(`/api/teams/${teamId}/outing-plan`, {
          params: { field_date: fieldDate },
        })
      ).data,
    enabled: teamId !== undefined,
  });
}

export function useSaveOutingPlan(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { field_date?: string; tower_ids: number[]; notes?: string }) =>
      (await apiClient.put<OutingPlan>(`/api/teams/${teamId}/outing-plan`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outing-plan', teamId] });
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
      qc.invalidateQueries({ queryKey: ['team-job-map', teamId] });
    },
  });
}

export function useTeamJobMap(teamId: number | undefined) {
  return useQuery({
    queryKey: ['team-job-map', teamId],
    queryFn: async () => (await apiClient.get<TeamJobMap>(`/api/teams/${teamId}/job-map`)).data,
    enabled: teamId !== undefined,
  });
}

export function useTeamNextTowers(
  teamId: number | undefined,
  latitude?: number | null,
  longitude?: number | null,
) {
  const lat = typeof latitude === 'number' ? Math.round(latitude * 1000) / 1000 : undefined;
  const lng = typeof longitude === 'number' ? Math.round(longitude * 1000) / 1000 : undefined;
  return useQuery({
    queryKey: ['team-next-towers', teamId, lat, lng],
    queryFn: async () =>
      (
        await apiClient.get<NextTowersPlan>(`/api/teams/${teamId}/next-towers`, {
          params: { latitude: lat, longitude: lng },
        })
      ).data,
    enabled: teamId !== undefined,
    refetchInterval: 30_000,
  });
}

export function useClaimTower(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { tower_id: number; assigned_user_id?: number }) =>
      (await apiClient.post<NightClaim>(`/api/teams/${teamId}/claims`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
      qc.invalidateQueries({ queryKey: ['team-channel', teamId] });
      qc.invalidateQueries({ queryKey: ['tracking-channel'] });
    },
  });
}

export function useUpdateClaim(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      claimId,
      payload,
    }: {
      claimId: number;
      payload: { status?: NightClaimStatus; assigned_user_id?: number; skip_reason?: string; visit_id?: number };
    }) => (await apiClient.patch<NightClaim>(`/api/teams/${teamId}/claims/${claimId}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
      qc.invalidateQueries({ queryKey: ['team-channel', teamId] });
      qc.invalidateQueries({ queryKey: ['tracking-channel'] });
    },
  });
}

export function useTeamChannel(teamId: number | undefined, fieldDate?: string) {
  return useQuery({
    queryKey: ['team-channel', teamId, fieldDate],
    queryFn: async () =>
      (
        await apiClient.get<ChannelMessage[]>(`/api/teams/${teamId}/channel`, {
          params: { field_date: fieldDate },
        })
      ).data,
    enabled: teamId !== undefined,
    refetchInterval: 8_000,
  });
}

export function useTrackingChannel(fieldDate?: string, teamId?: number, enabled = true) {
  return useQuery({
    queryKey: ['tracking-channel', fieldDate, teamId],
    queryFn: async () =>
      (
        await apiClient.get<ChannelMessage[]>('/api/tracking/channel', {
          params: { field_date: fieldDate, team_id: teamId, limit: 150 },
        })
      ).data,
    enabled,
    refetchInterval: enabled ? 8_000 : false,
  });
}

export function usePostChannel(teamId: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['team-channel', teamId] });
    qc.invalidateQueries({ queryKey: ['tracking-channel'] });
  };
  return {
    invalidate,
    post: useMutation({
      mutationFn: async (payload: {
        kind?: ChannelKind;
        body?: string;
        tower_id?: number | null;
        latitude?: number | null;
        longitude?: number | null;
      }) => {
        const result = await sendOrQueue(
          async () => (await apiClient.post<ChannelMessage>(`/api/teams/${teamId}/channel`, payload)).data,
          {
            kind: 'channel-note',
            label: payload.body?.trim() || payload.kind || 'Night message',
            path: { teamId },
            json: payload as Record<string, unknown>,
          },
        );
        if (isQueued(result)) return result;
        return result;
      },
      onSuccess: (data) => {
        if (isQueued(data)) return;
        invalidate();
      },
    }),
    photo: useMutation({
      mutationFn: async (payload: {
        file: File;
        kind?: ChannelKind;
        body?: string;
        tower_id?: number | null;
        latitude?: number | null;
        longitude?: number | null;
      }) => {
        const form = new FormData();
        form.set('file', payload.file);
        if (payload.kind) form.set('kind', payload.kind);
        if (payload.body) form.set('body', payload.body);
        if (payload.tower_id) form.set('tower_id', String(payload.tower_id));
        if (payload.latitude != null) form.set('latitude', String(payload.latitude));
        if (payload.longitude != null) form.set('longitude', String(payload.longitude));
        const result = await sendOrQueue(
          async () =>
            (await apiClient.post<ChannelMessage>(`/api/teams/${teamId}/channel/photo`, form, { timeout: 120_000 })).data,
          {
            kind: 'channel-photo',
            label: `Channel photo · ${payload.file.name}`,
            path: { teamId },
            json: { kind: payload.kind, body: payload.body, tower_id: payload.tower_id, latitude: payload.latitude, longitude: payload.longitude },
            file: asOutboxFile(payload.file),
          },
        );
        if (isQueued(result)) return result;
        return result;
      },
      onSuccess: (data) => {
        if (isQueued(data)) return;
        invalidate();
      },
    }),
    voice: useMutation({
      mutationFn: async (payload: {
        file: Blob;
        duration_seconds?: number;
        kind?: ChannelKind;
        body?: string;
        tower_id?: number | null;
        latitude?: number | null;
        longitude?: number | null;
      }) => {
        const form = new FormData();
        const ext = payload.file.type.includes('mp4') ? 'm4a' : 'webm';
        form.set('file', payload.file, `channel-voice.${ext}`);
        if (payload.duration_seconds != null) form.set('duration_seconds', String(payload.duration_seconds));
        if (payload.kind) form.set('kind', payload.kind);
        if (payload.body) form.set('body', payload.body);
        if (payload.tower_id) form.set('tower_id', String(payload.tower_id));
        if (payload.latitude != null) form.set('latitude', String(payload.latitude));
        if (payload.longitude != null) form.set('longitude', String(payload.longitude));
        const result = await sendOrQueue(
          async () =>
            (await apiClient.post<ChannelMessage>(`/api/teams/${teamId}/channel/voice`, form, { timeout: 120_000 })).data,
          {
            kind: 'channel-voice',
            label: 'Channel voice note',
            path: { teamId },
            json: {
              kind: payload.kind,
              body: payload.body,
              duration_seconds: payload.duration_seconds,
              tower_id: payload.tower_id,
              latitude: payload.latitude,
              longitude: payload.longitude,
            },
            file: asOutboxFile(payload.file, `channel-voice.${ext}`),
          },
        );
        if (isQueued(result)) return result;
        return result;
      },
      onSuccess: (data) => {
        if (isQueued(data)) return;
        invalidate();
      },
    }),
  };
}

export function useCreateTeamMission(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await apiClient.post<VisitDetail>(`/api/teams/${teamId}/missions`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-missions', teamId] });
      qc.invalidateQueries({ queryKey: ['team-progress', teamId] });
      qc.invalidateQueries({ queryKey: ['team-job-map', teamId] });
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
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
      const result = await sendOrQueue(
        async () =>
          (
            await apiClient.post<VisitPhoto>(`/api/visits/${visitId}/photos`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 120_000,
            })
          ).data,
        {
          kind: 'visit-photo',
          label: `Visit photo · ${file.name}`,
          path: { visitId },
          json: { caption, position_id: positionId },
          file: asOutboxFile(file),
        },
      );
      if (isQueued(result)) return result;
      return result;
    },
    onSuccess: (data) => {
      if (isQueued(data)) return;
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
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useTeamTrails(teamId: number | undefined, onDate?: string) {
  return useQuery({
    queryKey: ['team-trails', teamId, onDate],
    queryFn: async () =>
      (await apiClient.get<UserTrail[]>(`/api/teams/${teamId}/trails`, { params: { on_date: onDate } })).data,
    enabled: teamId !== undefined,
    refetchInterval: 10_000,
  });
}

export function useTeamFieldHistory(teamId: number | undefined) {
  return useQuery({
    queryKey: ['team-field-history', teamId],
    queryFn: async () => (await apiClient.get<TrackingMission[]>(`/api/teams/${teamId}/field-history`)).data,
    enabled: teamId !== undefined,
    refetchInterval: 20_000,
  });
}

export function useTeamFieldTrack(
  teamId: number | undefined,
  onDate?: string,
  missionId?: number,
  fromHour?: number,
  toHour?: number,
) {
  return useQuery({
    queryKey: ['team-field-track', teamId, onDate, missionId, fromHour, toHour],
    queryFn: async () =>
      (
        await apiClient.get<TeamProgress[]>(`/api/teams/${teamId}/field-track`, {
          params: { on_date: onDate, mission_id: missionId, from_hour: fromHour, to_hour: toHour },
        })
      ).data,
    enabled: teamId !== undefined && Boolean(onDate || missionId),
    refetchInterval: 15_000,
  });
}
