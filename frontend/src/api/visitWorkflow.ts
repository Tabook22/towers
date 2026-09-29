import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { requireConfirmedPositionWrite } from './hooks';
import type { Position, PositionSlot, VisitDetail } from './types';

export interface BatchItem { id: number; expected_updated_at: string; changes: Partial<Position> }
export interface PrepareRequest { slots: PositionSlot[]; expected_versions: Record<number, string>; save_template: boolean }

export function useVisitWorkflow(visitId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (request: { kind: 'prepare'; payload: PrepareRequest } | { kind: 'batch'; payload: { items: BatchItem[] } }) => {
      await requireConfirmedPositionWrite(visitId);
      const url = `/api/visits/${visitId}/positions/${request.kind}`;
      const response = request.kind === 'prepare'
        ? await apiClient.post<VisitDetail>(url, request.payload, { timeout: 30_000 })
        : await apiClient.patch<VisitDetail>(url, request.payload, { timeout: 30_000 });
      return response.data;
    },
    onSuccess: async data => {
      qc.setQueryData(['visit', visitId], data);
      await Promise.all(['visit', 'visits', 'towers', 'dashboard', 'team-missions', 'team-progress', 'archive', 'oetc-preview']
        .map(key => qc.invalidateQueries({ queryKey: key === 'visit' ? [key, visitId] : [key] })));
    },
  });
}
