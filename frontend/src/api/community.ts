import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ChannelMessage } from './types';
import { asOutboxFile, sendOrQueue } from '../offline/enqueue';
import { isQueued } from '../offline/types';
export interface ConversationPage { messages: ChannelMessage[]; has_more: boolean; before_id: number | null }
export function useCommunityMessages(teamId: number | undefined, search: string, includeOps: boolean) {
  return useInfiniteQuery({
    queryKey: ['community-chat', teamId, search, includeOps],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => (await apiClient.get<ConversationPage>('/api/community/channel', { params: { before_id: pageParam, team_id: teamId, search, include_ops: includeOps }, signal })).data,
    getNextPageParam: page => page.has_more ? page.before_id ?? undefined : undefined,
    refetchInterval: 8000,
  });
}
export function useSendCommunityMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: FormData) => {
      const json: Record<string,string> = {};
      for (const [key,value] of form.entries()) if (typeof value === 'string') json[key] = value;
      const file = form.get('file');
      return sendOrQueue(async () => (await apiClient.post<ChannelMessage>('/api/community/channel', form, { timeout: 180000 })).data,
        { kind: 'community-message', path: {}, json, label: json.body || 'Shared chat attachment', file: file instanceof File ? asOutboxFile(file) : undefined });
    },
    onSuccess: (result) => {
      if (isQueued(result)) return;
      void qc.invalidateQueries({ queryKey: ['community-chat'] });
      void qc.invalidateQueries({ queryKey: ['tracking-channel'] });
      void qc.invalidateQueries({ queryKey: ['team-channel'] });
      void qc.invalidateQueries({ queryKey: ['channel-unread'] });
    },
  });
}
