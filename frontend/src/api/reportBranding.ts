import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export type ReportLogo = { logo_url: string | null };

export function useReportLogo() {
  return useQuery({ queryKey: ['report-logo'], queryFn: async () => (await apiClient.get<ReportLogo>('/api/settings/report-logo')).data });
}

export function useSaveReportLogo() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return (await apiClient.delete<ReportLogo>('/api/settings/report-logo')).data;
      const form = new FormData();
      form.append('logo', file);
      return (await apiClient.put<ReportLogo>('/api/settings/report-logo', form)).data;
    },
    onSuccess: (data) => {
      cache.setQueryData(['report-logo'], data);
      void cache.invalidateQueries({ queryKey: ['branding'] });
      void cache.invalidateQueries({ queryKey: ['public-branding'] });
    },
  });
}
