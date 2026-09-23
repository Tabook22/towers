import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { collectArchivePages } from '../utils/archiveEvidence';
import { asOutboxFile, sendOrQueue } from '../offline/enqueue';
import { applyPositionPatch, applyQueuedExtraImage, applyQueuedImage, applyVisitPatch, patchVisitCache } from '../offline/optimistic';
import { isQueued } from '../offline/types';
import type {
  AdminUser,
  Area,
  BrandingSettings,
  ChannelKind,
  ChannelUnread,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  PublicBranding,
  ChannelMessage,
  ChoiceLists,
  DashboardSummary,
  FieldExecutionPlanRequest,
  ArchiveResponse,
  ImageRow,
  LineInspectionReportOut,
  LineInspectionReportRequest,
  LineInspectionReportUpdate,
  LiveTeamMember,
  LoginResponse,
  MovementDayReport,
  TeamProgress,
  TrackingMission,
  OetcAreaReportRequest,
  OetcConsolidatedReportRequest,
  OetcReportPreview,
  Position,
  ReportCommentOut,
  ReportImageOut,
  ReportTemplate,
  ReportTemplatesActive,
  Team,
  TeamActivityTeam,
  TeamDailyLog,
  TeamDayProgress,
  HelpChatTurn,
  TeamArchiveImage,
  OutingPlan,
  OutingPlanSummary,
  HandoverPack,
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

export function usePatchTowerLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      latitude,
      longitude,
      tower_id,
    }: {
      id: number;
      latitude?: number;
      longitude?: number;
      tower_id?: string;
    }) => {
      const payload: Partial<Tower> = {};
      if (latitude != null) payload.latitude = latitude;
      if (longitude != null) payload.longitude = longitude;
      if (tower_id != null) payload.tower_id = tower_id;
      return (await apiClient.patch<Tower>(`/api/towers/${id}`, payload)).data;
    },
    onSuccess: (updated) => {
      qc.setQueriesData({ queryKey: ['towers'] }, (old: unknown) => {
        if (!Array.isArray(old)) return old;
        return old.map((t: Tower) =>
          t.id === updated.id
            ? { ...t, latitude: updated.latitude, longitude: updated.longitude, tower_id: updated.tower_id }
            : t,
        );
      });
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
export function useClaimTowerForTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: number | { towerId: number; teamId?: number }) => {
      const towerId = typeof vars === 'number' ? vars : vars.towerId;
      const teamId = typeof vars === 'number' ? undefined : vars.teamId;
      return (
        await apiClient.post<Tower>(`/api/towers/${towerId}/claim`, {
          team_id: teamId ?? null,
        })
      ).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['team-job-map'] });
      qc.invalidateQueries({ queryKey: ['outing-plan'] });
      qc.invalidateQueries({ queryKey: ['team-handover'] });
      qc.invalidateQueries({ queryKey: ['team-next-towers'] });
    },
  });
}

export function useReleaseTower() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (towerId: number) => (await apiClient.post<Tower>(`/api/towers/${towerId}/release`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['team-job-map'] });
      qc.invalidateQueries({ queryKey: ['outing-plan'] });
      qc.invalidateQueries({ queryKey: ['team-handover'] });
      qc.invalidateQueries({ queryKey: ['team-next-towers'] });
    },
  });
}

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

export function useMatchPinIds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { area?: string }) =>
      (
        await apiClient.post<{
          updated: number;
          unchanged: number;
          changes: { id: number; old_id: string; new_id: string; pin_number: number }[];
        }>('/api/towers/match-pin-ids', payload || {})
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['team-job-map'] });
    },
  });
}

export function useBulkDeleteTowers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { tower_ids?: number[]; delete_all?: boolean }) =>
      (
        await apiClient.post<{ deleted: number; ids: number[] }>('/api/towers/bulk-delete', payload)
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['towers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['team-job-map'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
      qc.invalidateQueries({ queryKey: ['outing-plan'] });
      qc.invalidateQueries({ queryKey: ['team-handover'] });
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

// Adds a position beyond a visit's 12 baseline slots — only needed for a Tension-type tower
// carrying the same OHL/phase/string out toward a second line Direction (see AddPositionBar).
export function useCreatePosition(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { ohl: string; phase: string; string: string; direction: string; mount_type?: string }) =>
      (await apiClient.post<Position>(`/api/visits/${visitId}/positions`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visit', visitId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['towers'] });
    },
  });
}

// ---------- Images ----------
export function useReplaceArchiveImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ image, file }: { image: ImageRow; file: File }) => {
      const form = new FormData();
      form.set('file', file);
      if (image.checksum) form.set('expected_checksum', image.checksum);
      return (await apiClient.post<ImageRow>(`/api/images/${image.id}/replace`, form, { timeout: 120_000 })).data;
    },
    onSuccess: async (_, { image }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['archive'] }),
        qc.invalidateQueries({ queryKey: ['visit', image.visit_id] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['towers'] }),
      ]);
    },
  });
}

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

// This insulator's own voice note — recording, transcribing, or deleting always targets this one
// position_id, never the visit as a whole (see backend routers/positions.py). Not yet part of the
// offline outbox that photo/position-field edits use, so a recording needs a live connection to
// save — the blob stays in the recorder's own state on failure, so retrying doesn't mean recording
// again.
export function useAddPositionVoiceNote(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ positionId, file, durationSeconds }: { positionId: number; file: Blob; durationSeconds?: number }) => {
      const form = new FormData();
      const ext = file.type.includes('mp4') ? 'm4a' : file.type.includes('mpeg') ? 'mp3' : 'webm';
      form.set('file', file, `voice-note.${ext}`);
      if (durationSeconds != null) form.set('duration_seconds', String(durationSeconds));
      return (
        await apiClient.post<Position>(`/api/positions/${positionId}/voice`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120_000,
        })
      ).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visit', visitId] }),
  });
}

export function useTranscribePositionVoiceNote(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (positionId: number) =>
      (await apiClient.post<Position>(`/api/positions/${positionId}/voice/transcribe`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visit', visitId] }),
  });
}

export function useDeletePositionVoiceNote(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (positionId: number) =>
      (await apiClient.delete<Position>(`/api/positions/${positionId}/voice`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visit', visitId] }),
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

export interface SmartEnhanceResult {
  image_base64: string;
  direction_deg: number;
  pitch_px: number;
  confidence: 'estimated' | 'fallback';
}

// "Auto enhance selected insulator" — preview-only (nothing is saved server-side), so unlike
// useSaveAnnotation this has no offline outbox fallback; it needs a live connection, same as any
// other on-demand server computation in this app.
export function useSmartEnhanceImage() {
  return useMutation({
    mutationFn: async ({
      imageId,
      file,
      roi,
      strength,
    }: {
      imageId: number;
      file: Blob;
      roi: { x: number; y: number; w: number; h: number };
      strength: 'gentle' | 'balanced' | 'strong';
    }) => {
      const form = new FormData();
      form.set('file', file, 'photo.jpg');
      form.set('roi_x', String(Math.round(roi.x)));
      form.set('roi_y', String(Math.round(roi.y)));
      form.set('roi_w', String(Math.round(roi.w)));
      form.set('roi_h', String(Math.round(roi.h)));
      form.set('strength', strength);
      return (
        await apiClient.post<SmartEnhanceResult>(`/api/images/${imageId}/smart-enhance`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 60_000,
        })
      ).data;
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
export function useDashboardSummary(area?: string, enabled = true) {
  return useQuery({
    queryKey: ['dashboard', area],
    queryFn: async () => (await apiClient.get<DashboardSummary>('/api/dashboard/summary', { params: { area } })).data,
    refetchInterval: 30000,
    enabled,
  });
}

// ---------- Archive ----------
export function useArchive(filters: { year?: number; month?: number; day?: number; tower_id?: number; team_id?: number; report_id?: number }) {
  return useQuery({
    queryKey: ['archive', filters],
    queryFn: ({ signal }) => collectArchivePages(async (page) => (await apiClient.get<ArchiveResponse>('/api/archive', { params: { ...filters, ...page }, signal })).data),
  });
}

// ---------- Team archive images (general photos an admin uploads straight to a team's own
// archive — not tied to any tower/visit, unlike the per-position evidence above). ----------
export function useTeamArchiveImages(filters: { team_id?: number; year?: number; month?: number; day?: number }) {
  return useQuery({
    queryKey: ['team-archive-images', filters],
    queryFn: async () => (await apiClient.get<TeamArchiveImage[]>('/api/archive/team-images', { params: filters })).data,
  });
}

export function useUploadTeamArchiveImages(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, caption }: { files: File[]; caption?: string }) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      if (caption) form.set('caption', caption);
      return (
        await apiClient.post<TeamArchiveImage[]>(`/api/teams/${teamId}/archive-images`, form, { timeout: 180_000 })
      ).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-archive-images'] }),
  });
}

export function useDeleteTeamArchiveImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/archive/team-images/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-archive-images'] }),
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

export interface OetcReportHistoryFilters {
  team_id?: number;
  tower_id?: number;
  report_type?: string;
  line_sector?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
}

// `teamId` (a bare number) kept for existing call sites; pass an OetcReportHistoryFilters object
// instead for the fuller client-portal search (report number, tower, line, date range, type).
export function useOetcReportHistory(teamIdOrFilters?: number | OetcReportHistoryFilters) {
  const params: OetcReportHistoryFilters =
    typeof teamIdOrFilters === 'number' ? { team_id: teamIdOrFilters } : teamIdOrFilters || {};
  return useQuery({
    queryKey: ['oetc-report-history', params],
    queryFn: async () =>
      (await apiClient.get<LineInspectionReportOut[]>('/api/reports/oetc-line-report/history', { params })).data,
  });
}

export function useDeleteOetcReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/reports/oetc-line-report/${id}`),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ['oetc-report-images', id] });
      qc.removeQueries({ queryKey: ['oetc-report-comments', id] });
      return qc.invalidateQueries({ queryKey: ['oetc-report-history'] });
    },
  });
}

// Every image snapshotted into a report at generation time — the client portal's per-report image
// archive (see backend models.ReportImage). Stays fixed even if the field data changes later.
export function useReportImages(reportId?: number) {
  return useQuery({
    queryKey: ['oetc-report-images', reportId],
    queryFn: async () => (await apiClient.get<ReportImageOut[]>(`/api/reports/oetc-line-report/${reportId}/images`)).data,
    enabled: !!reportId,
  });
}

// Editing only the sign-off/assessment fields of an already-generated report — never the
// underlying readings/images. Admin (with permission) or a client account with can_edit_reports.
export function useUpdateOetcLineReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: LineInspectionReportUpdate }) =>
      (await apiClient.patch<LineInspectionReportOut>(`/api/reports/oetc-line-report/${id}`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oetc-report-history'] });
    },
  });
}

// Deleting an image from a report's own image archive — only ever the extra/supplementary kind
// (never a baseline evidence slot, see backend routers/images.py's delete_image), and only for a
// client account with can_delete_report_images. Distinct from useDeleteImage (a Visit-scoped
// hook) since this is invoked from the report-images view, with no Visit in scope to invalidate.
export function useDeleteReportImage(reportId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: number) => apiClient.delete(`/api/images/${imageId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oetc-report-images', reportId] });
    },
  });
}

// A report's comment thread, oldest first — how a client flags something for the internal team to
// act on, and how the team answers back (see backend models.ReportComment).
export function useReportComments(reportId?: number) {
  return useQuery({
    queryKey: ['oetc-report-comments', reportId],
    queryFn: async () => (await apiClient.get<ReportCommentOut[]>(`/api/reports/oetc-line-report/${reportId}/comments`)).data,
    enabled: !!reportId,
  });
}

export function useAddReportComment(reportId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) =>
      (await apiClient.post<ReportCommentOut>(`/api/reports/oetc-line-report/${reportId}/comments`, { body })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oetc-report-comments', reportId] });
      qc.invalidateQueries({ queryKey: ['oetc-report-history'] });
    },
  });
}

// Live "what will this include" check for the report form — same scope params the generate
// endpoints take, but read-only and cheap (no rendering). `enabled` gates it on having picked
// enough of a scope plus both dates, so it doesn't fire on every keystroke of an empty form.
export function useOetcReportPreview(params: {
  team_id?: number;
  tower_id?: number;
  area?: string;
  start_date?: string;
  end_date?: string;
  enabled: boolean;
}) {
  const { enabled, ...query } = params;
  return useQuery({
    queryKey: ['oetc-report-preview', query],
    queryFn: async () => (await apiClient.get<OetcReportPreview>('/api/reports/oetc-preview', { params: query })).data,
    enabled,
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
        Pick<
          AdminUser,
          | 'username'
          | 'team_id'
          | 'role'
          | 'is_active'
          | 'is_approved'
          | 'full_name'
          | 'email'
          | 'mobile'
          | 'address'
          | 'notes'
          | 'job_type'
          | 'is_super_admin'
          | 'permissions'
          | 'can_edit_reports'
          | 'can_delete_report_images'
          | 'menu_permissions'
        >
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
      is_super_admin?: boolean;
      permissions?: string[];
      can_edit_reports?: boolean;
      can_delete_report_images?: boolean;
      menu_permissions?: Record<string, string>;
    }) => (await apiClient.post<AdminUser>('/api/auth/users', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

// ---------- Branding (admin-controlled splash-screen logos/title — see routers/app_settings.py) ----------
export function useBrandingSettings(enabled = true) {
  return useQuery({
    queryKey: ['branding'],
    queryFn: async () => (await apiClient.get<BrandingSettings>('/api/settings/branding')).data,
    enabled,
  });
}

// Unauthenticated — safe to call from the login page, before a token exists (see
// app_settings.get_public_branding on the backend).
export function usePublicBranding() {
  return useQuery({
    queryKey: ['public-branding'],
    queryFn: async () => (await apiClient.get<PublicBranding>('/api/settings/public-branding')).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateBrandingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      app_title?: string;
      app_version?: string;
      splash_header?: string;
      splash_subtitle?: string;
      oetc_logo_width?: number | null;
      oetc_logo_height?: number | null;
      sky_green_line_logo_width?: number | null;
      sky_green_line_logo_height?: number | null;
      oetc_logo_pos_x?: number | null;
      oetc_logo_pos_y?: number | null;
      sky_green_line_logo_pos_x?: number | null;
      sky_green_line_logo_pos_y?: number | null;
      app_title_pos_x?: number | null;
      app_title_pos_y?: number | null;
      org_name_en?: string;
      org_name_ar?: string;
      org_footer_text?: string;
      org_report_footer?: string;
      org_contact?: string;
      reset_org_logo?: boolean;
      reset_login_background?: boolean;
      oetc_logo?: File;
      sky_green_line_logo?: File;
      hero_image?: File;
      org_logo?: File;
      login_background?: File;
    }) => {
      const form = new FormData();
      if (payload.app_title !== undefined) form.append('app_title', payload.app_title);
      if (payload.app_version !== undefined) form.append('app_version', payload.app_version);
      if (payload.splash_header !== undefined) form.append('splash_header', payload.splash_header);
      if (payload.splash_subtitle !== undefined) form.append('splash_subtitle', payload.splash_subtitle);
      if (payload.oetc_logo_width != null) form.append('oetc_logo_width', String(payload.oetc_logo_width));
      if (payload.oetc_logo_height != null) form.append('oetc_logo_height', String(payload.oetc_logo_height));
      if (payload.sky_green_line_logo_width != null)
        form.append('sky_green_line_logo_width', String(payload.sky_green_line_logo_width));
      if (payload.sky_green_line_logo_height != null)
        form.append('sky_green_line_logo_height', String(payload.sky_green_line_logo_height));
      if (payload.oetc_logo_pos_x != null) form.append('oetc_logo_pos_x', String(payload.oetc_logo_pos_x));
      if (payload.oetc_logo_pos_y != null) form.append('oetc_logo_pos_y', String(payload.oetc_logo_pos_y));
      if (payload.sky_green_line_logo_pos_x != null)
        form.append('sky_green_line_logo_pos_x', String(payload.sky_green_line_logo_pos_x));
      if (payload.sky_green_line_logo_pos_y != null)
        form.append('sky_green_line_logo_pos_y', String(payload.sky_green_line_logo_pos_y));
      if (payload.app_title_pos_x != null) form.append('app_title_pos_x', String(payload.app_title_pos_x));
      if (payload.app_title_pos_y != null) form.append('app_title_pos_y', String(payload.app_title_pos_y));
      if (payload.org_name_en !== undefined) form.append('org_name_en', payload.org_name_en);
      if (payload.org_name_ar !== undefined) form.append('org_name_ar', payload.org_name_ar);
      if (payload.org_footer_text !== undefined) form.append('org_footer_text', payload.org_footer_text);
      if (payload.org_report_footer !== undefined) form.append('org_report_footer', payload.org_report_footer);
      if (payload.org_contact !== undefined) form.append('org_contact', payload.org_contact);
      if (payload.reset_org_logo) form.append('reset_org_logo', 'true');
      if (payload.reset_login_background) form.append('reset_login_background', 'true');
      if (payload.oetc_logo) form.append('oetc_logo', payload.oetc_logo);
      if (payload.sky_green_line_logo) form.append('sky_green_line_logo', payload.sky_green_line_logo);
      if (payload.hero_image) form.append('hero_image', payload.hero_image);
      if (payload.org_logo) form.append('org_logo', payload.org_logo);
      if (payload.login_background) form.append('login_background', payload.login_background);
      return (await apiClient.put<BrandingSettings>('/api/settings/branding', form)).data;
    },
    onSuccess: (data) => {
      qc.setQueryData(['branding'], data);
    },
  });
}

// ---------- Knowledge base (field reports/incident write-ups the help chat can search) ----------
export function useKnowledgeDocuments() {
  return useQuery({
    queryKey: ['knowledge-base'],
    queryFn: async () => (await apiClient.get<KnowledgeDocument[]>('/api/knowledge-base')).data,
  });
}

export function useUploadKnowledgeDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      title: string;
      description?: string;
      team_id?: number | null;
      // A file upload, typed/transcribed plain text, or the rich-text editor's HTML — exactly one.
      file?: File;
      text_content?: string;
      body_html?: string;
      save_as?: 'txt' | 'pdf';
      // The original recording, kept alongside voice-composed text/rich content — see GET .../voice.
      voice?: Blob;
      voice_duration_seconds?: number;
    }) => {
      const form = new FormData();
      form.append('title', payload.title);
      if (payload.description) form.append('description', payload.description);
      if (payload.team_id != null) form.append('team_id', String(payload.team_id));
      if (payload.file) form.append('file', payload.file);
      if (payload.body_html) {
        form.append('body_html', payload.body_html);
        form.append('save_as', payload.save_as || 'txt');
        if (payload.voice) form.append('voice', payload.voice, 'recording.webm');
        if (payload.voice_duration_seconds != null) form.append('voice_duration_seconds', String(payload.voice_duration_seconds));
      } else if (payload.text_content) {
        form.append('text_content', payload.text_content);
        form.append('save_as', payload.save_as || 'txt');
        if (payload.voice) form.append('voice', payload.voice, 'recording.webm');
        if (payload.voice_duration_seconds != null) form.append('voice_duration_seconds', String(payload.voice_duration_seconds));
      }
      return (await apiClient.post<KnowledgeDocument>('/api/knowledge-base', form)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-base'] }),
  });
}

// Uploads one image dropped into the knowledge-base rich-text editor — returns its URL right
// away so the editor can insert it before the surrounding document has even been saved yet.
export function useUploadInlineKnowledgeImage() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('image', file);
      return (await apiClient.post<{ url: string }>('/api/knowledge-base/inline-images', form)).data;
    },
  });
}

export function useKnowledgeDocumentDetail(id: number | null) {
  return useQuery({
    queryKey: ['knowledge-base', id],
    queryFn: async () => (await apiClient.get<KnowledgeDocumentDetail>(`/api/knowledge-base/${id}`)).data,
    enabled: id != null,
  });
}

export function useUpdateKnowledgeDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        title?: string;
        description?: string;
        team_id?: number | null;
        body_text?: string;
        body_html?: string;
        save_as?: 'txt' | 'pdf';
      };
    }) => (await apiClient.patch<KnowledgeDocument>(`/api/knowledge-base/${id}`, payload)).data,
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['knowledge-base'] });
      qc.invalidateQueries({ queryKey: ['knowledge-base', id] });
    },
  });
}

// Turns a voice recording into text for the "record instead of typing" option in the upload
// dialog — the transcript comes back for the admin/team leader to review/edit before it's
// actually saved as a document (a separate useUploadKnowledgeDocument call).
export function useTranscribeForKnowledgeBase() {
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const form = new FormData();
      form.append('file', blob, 'recording.webm');
      return (await apiClient.post<{ transcript: string }>('/api/knowledge-base/transcribe', form)).data;
    },
  });
}

export function useDeleteKnowledgeDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/api/knowledge-base/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-base'] }),
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
    mutationFn: async (payload: {
      field_date?: string;
      name?: string;
      start_time?: string | null;
      end_time?: string | null;
      tower_ids: number[];
      notes?: string;
    }) =>
      (await apiClient.put<OutingPlan>(`/api/teams/${teamId}/outing-plan`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outing-plan', teamId] });
      qc.invalidateQueries({ queryKey: ['outing-plans', teamId] });
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
      qc.invalidateQueries({ queryKey: ['team-job-map', teamId] });
      qc.invalidateQueries({ queryKey: ['team-handover', teamId] });
      // A tower picked from the free catalog gets auto-assigned to this team on save (see
      // save_outing_plan) — refresh the towers catalog so that shows up everywhere else too
      // (Towers page, other teams' "free towers" lists, etc.).
      qc.invalidateQueries({ queryKey: ['towers'] });
    },
  });
}

// Every mission this team has ever planned — the leader's mission history: list, sort, pick one
// to edit, or delete. See GET /api/teams/{id}/outing-plans.
export function useOutingPlans(teamId: number | undefined) {
  return useQuery({
    queryKey: ['outing-plans', teamId],
    queryFn: async () =>
      (await apiClient.get<OutingPlanSummary[]>(`/api/teams/${teamId}/outing-plans`)).data,
    enabled: teamId !== undefined,
  });
}

export function useDeleteOutingPlan(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fieldDate: string) =>
      apiClient.delete(`/api/teams/${teamId}/outing-plan`, { params: { field_date: fieldDate } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outing-plans', teamId] });
      qc.invalidateQueries({ queryKey: ['outing-plan', teamId] });
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
      qc.invalidateQueries({ queryKey: ['team-handover', teamId] });
    },
  });
}

export function useTeamHandover(teamId: number | undefined, fieldDate?: string) {
  return useQuery({
    queryKey: ['team-handover', teamId, fieldDate],
    queryFn: async () =>
      (
        await apiClient.get<HandoverPack>(`/api/teams/${teamId}/handover`, {
          params: { field_date: fieldDate },
        })
      ).data,
    enabled: teamId !== undefined,
    refetchInterval: 30_000,
  });
}

export function useEndOuting(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { note?: string; field_date?: string }) =>
      (await apiClient.post<HandoverPack>(`/api/teams/${teamId}/handover/end`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-handover', teamId] });
      qc.invalidateQueries({ queryKey: ['outing-plan', teamId] });
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
      qc.invalidateQueries({ queryKey: ['team-channel', teamId] });
      qc.invalidateQueries({ queryKey: ['tracking-channel'] });
    },
  });
}

export function useContinueLastNight(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { field_date?: string; from_date?: string; replace?: boolean }) =>
      (await apiClient.post<HandoverPack>(`/api/teams/${teamId}/handover/continue`, payload || {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-handover', teamId] });
      qc.invalidateQueries({ queryKey: ['outing-plan', teamId] });
      qc.invalidateQueries({ queryKey: ['team-next-towers', teamId] });
      qc.invalidateQueries({ queryKey: ['team-job-map', teamId] });
      qc.invalidateQueries({ queryKey: ['team-channel', teamId] });
      qc.invalidateQueries({ queryKey: ['tracking-channel'] });
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
    video: useMutation({
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
        const named = payload.file as File;
        const name = named.name || `channel-video.${payload.file.type.includes('webm') ? 'webm' : 'mp4'}`;
        form.set('file', payload.file, name);
        if (payload.duration_seconds != null) form.set('duration_seconds', String(payload.duration_seconds));
        if (payload.kind) form.set('kind', payload.kind);
        if (payload.body) form.set('body', payload.body);
        if (payload.tower_id) form.set('tower_id', String(payload.tower_id));
        if (payload.latitude != null) form.set('latitude', String(payload.latitude));
        if (payload.longitude != null) form.set('longitude', String(payload.longitude));
        const result = await sendOrQueue(
          async () =>
            (await apiClient.post<ChannelMessage>(`/api/teams/${teamId}/channel/video`, form, { timeout: 180_000 })).data,
          {
            kind: 'channel-video',
            label: `Channel video · ${name}`,
            path: { teamId },
            json: {
              kind: payload.kind,
              body: payload.body,
              duration_seconds: payload.duration_seconds,
              tower_id: payload.tower_id,
              latitude: payload.latitude,
              longitude: payload.longitude,
            },
            file: asOutboxFile(payload.file, name),
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
    file: useMutation({
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
            (await apiClient.post<ChannelMessage>(`/api/teams/${teamId}/channel/file`, form, { timeout: 180_000 })).data,
          {
            kind: 'channel-file',
            label: `Channel file · ${payload.file.name}`,
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
  };
}

// A lightweight poll target for the Messages nav badge — counts only, not full message bodies, so
// it's cheap enough to run everywhere the app shell is mounted (see Layout.tsx).
export function useChannelUnread(afterId: number, fieldDate?: string) {
  return useQuery({
    queryKey: ['channel-unread', afterId, fieldDate],
    queryFn: async () =>
      (
        await apiClient.get<ChannelUnread>('/api/tracking/channel/unread-count', {
          params: { after_id: afterId, field_date: fieldDate },
        })
      ).data,
    refetchInterval: 15_000,
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

export type HelpChatSearchMode = 'local' | 'internet' | 'both';

// The Help page's chat assistant (see components/HelpChatWidget.tsx). Stateless like the
// underlying Claude API — the widget resends the whole conversation's history each turn.
export function useHelpChat() {
  return useMutation({
    mutationFn: async ({
      message,
      history,
      searchMode,
    }: {
      message: string;
      history: HelpChatTurn[];
      searchMode?: HelpChatSearchMode;
    }) =>
      (await apiClient.post<{ reply: string }>('/api/help/chat', { message, history, search_mode: searchMode || 'local' })).data,
  });
}
