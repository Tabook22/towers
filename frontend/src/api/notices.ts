import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { useAuth } from '../auth/AuthContext';

export type NoticeCategory = 'urgent' | 'action' | 'update';
export interface NoticeAppearance {
  language: 'auto' | 'en' | 'ar'; direction: 'auto' | 'ltr' | 'rtl';
  font: 'sans' | 'serif' | 'handwritten' | 'arabic'; font_size: number;
  paper: string | null; ink: string; marker: string;
}
export const defaultNoticeAppearance: NoticeAppearance = { language: 'auto', direction: 'auto', font: 'sans', font_size: 16, paper: null, ink: '#24343c', marker: '' };
export interface NoticeBody {
  title: string; body: string; category: NoticeCategory; team_id: number | null;
  tower_id: number | null; owner_id: number | null; due_on: string | null; expires_on: string | null;
  appearance: NoticeAppearance;
}
export interface FieldNotice extends NoticeBody {
  id: number; team_name: string | null; tower_name: string | null; owner_name: string | null;
  author_name: string; created_at: string; updated_at: string; completed_at: string | null;
  completed_by_name: string | null; version: number; revision: number;
  status: 'active' | 'archived' | 'completed' | 'expired'; acknowledged: boolean;
  acknowledgement_count: number; can_manage: boolean; can_complete: boolean;
}
export interface NoticePage { items: FieldNotice[]; total: number; active_count: number; urgent_unacknowledged: number; urgent: FieldNotice | null; can_publish: boolean }
export interface NoticeOptions {
  can_publish: boolean; can_broadcast: boolean; teams: { id: number; name: string }[];
  people: { id: number; name: string; team_id: number | null }[];
  towers: { id: number; name: string; team_id: number | null; team_ids: number[] }[];
}
export function useNotices(params: { state?: string; search?: string; category?: string; offset?: number; limit?: number } = {}, enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ['notices', user?.id, params], enabled: enabled && Boolean(user) && user?.role !== 'client',
    queryFn: async ({ signal }) => (await apiClient.get<NoticePage>('/api/notices', { params, signal })).data,
    refetchInterval: 30000 });
}
export function useNoticeOptions(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({ queryKey: ['notice-options', user?.id], enabled,
    queryFn: async ({ signal }) => (await apiClient.get<NoticeOptions>('/api/notices/options', { signal })).data });
}
export type NoticeAction = 'acknowledge' | 'complete' | 'archive' | 'restore' | 'reopen';
type Change = { kind: 'create'; body: NoticeBody } | { kind: 'edit'; notice: FieldNotice; body: NoticeBody } | { kind: NoticeAction; notice: FieldNotice };
export function useChangeNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change) => {
      if (change.kind === 'create') return (await apiClient.post<FieldNotice>('/api/notices', change.body)).data;
      const path = `/api/notices/${change.notice.id}`;
      if (change.kind === 'edit') return (await apiClient.put<FieldNotice>(path, { ...change.body, expected_version: change.notice.version })).data;
      if (change.kind === 'acknowledge') return (await apiClient.post<FieldNotice>(`${path}/acknowledge`, { revision: change.notice.revision })).data;
      return (await apiClient.post<FieldNotice>(`${path}/state`, { action: change.kind, expected_version: change.notice.version })).data;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notices'] }); void qc.invalidateQueries({ queryKey: ['notice-receipts'] }); },
  });
}
export function noticeError(error: unknown) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(x => x.msg || 'Check the notice details').join('. ');
  return 'Could not save this change. Check your connection and try again.';
}
