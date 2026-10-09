import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { apiClient } from './client';
import { useAuth } from '../auth/AuthContext';

export interface ReportGenerationProgress {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'interrupted';
  stage: string;
  percent: number;
  completed: number;
  total: number;
  findings_done: number;
  findings_total: number;
  photos_done: number;
  photos_total: number;
  sections_done: number;
  sections_total: number;
  elapsed_seconds: number;
  filename?: string;
  error?: string;
  received_at?: number;
  download_started?: boolean;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function followReportJob(
  initial: ReportGenerationProgress,
  read: (id: string) => Promise<ReportGenerationProgress>,
  publish: (job: ReportGenerationProgress) => void,
  connection: (reconnecting: boolean) => void,
  pause: (ms: number) => Promise<unknown> = delay,
) {
  let job = initial;
  publish(job);
  while (job.status === 'queued' || job.status === 'running') {
    await pause(2000);
    try {
      job = await read(job.id);
      connection(false);
      publish(job);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status && status < 500 && status !== 429) throw error;
      connection(true);
      await pause(3000);
    }
  }
  return job;
}

export function useReportGeneration<T>(kind: 'team' | 'area' | 'consolidated', download: (response: { data: unknown; headers: Record<string, unknown> }, filename: string) => void) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<ReportGenerationProgress | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const saved = useRef<{ payload: T; request_token: string; id?: string } | null>(null);
  const resumed = useRef(false);
  const key = `iip_report_generation:${user?.id}:${kind}`;
  const remember = () => { try { sessionStorage.setItem(key, JSON.stringify(saved.current)); } catch { /* server job is still recoverable */ } };
  const update = (job: ReportGenerationProgress) => setProgress({ ...job, received_at: Date.now() });
  const mutation = useMutation({
    mutationFn: async (payload: T) => {
      const previous = saved.current;
      const request = previous && JSON.stringify(previous.payload) === JSON.stringify(payload)
        ? previous : { payload, request_token: crypto.randomUUID(), id: undefined as string | undefined };
      saved.current = request;
      remember();
      setReconnecting(false);
      let job: ReportGenerationProgress;
      if (request.id) {
        job = (await apiClient.get<ReportGenerationProgress>(`/api/reports/generation-jobs/${request.id}`, { timeout: 15000 })).data;
      } else {
        const response = await apiClient.post<ReportGenerationProgress>('/api/reports/generation-jobs', { kind, payload, request_token: request.request_token }, { timeout: 30000 });
        job = response.data;
        request.id = job.id;
        remember();
      }
      job = await followReportJob(job, async id =>
        (await apiClient.get<ReportGenerationProgress>(`/api/reports/generation-jobs/${id}`, { timeout: 15000 })).data,
      update, setReconnecting);
      if (job.status !== 'complete') {
        saved.current = null;
        try { sessionStorage.removeItem(key); } catch { /* optional */ }
        throw new Error(job.error || 'Report generation failed');
      }
      const response = await apiClient.get(`/api/reports/generation-jobs/${job.id}/file`, { responseType: 'blob' });
      download(response, job.filename || 'inspection-report.docx');
      update({ ...job, download_started: true });
      saved.current = null;
      try { sessionStorage.removeItem(key); } catch { /* optional */ }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oetc-report-history'] }); },
  });

  // A refresh follows the existing job; the same request token cannot create a second report.
  useEffect(() => {
    if (!user || resumed.current) return;
    resumed.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        saved.current = JSON.parse(raw);
        if (saved.current?.payload) mutation.mutate(saved.current.payload);
      }
    } catch { /* unusable device receipt */ }
  }, [key, user, mutation]);

  return { ...mutation, progress, reconnecting };
}
