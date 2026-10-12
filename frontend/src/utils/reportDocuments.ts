import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import type { LineInspectionReportOut } from '../api/types';
export type ReportDocumentStatus = { status: 'idle' | 'queued' | 'running' | 'complete' | 'failed' | 'unavailable'; word_bytes: number | null; pdf_bytes: number | null; pdf_available: boolean; error: string | null; stage?: string; completed?: number | null; total?: number | null; percent?: number | null };
export type ReportLibraryDocument = LineInspectionReportOut & { documents: ReportDocumentStatus };
export type DocumentFilter = 'all' | 'pdf' | 'word' | 'preparing';
export function documentMatches(report: ReportLibraryDocument, filter: DocumentFilter) {
  return filter === 'pdf' ? report.documents.pdf_bytes != null : filter === 'word' ? report.documents.word_bytes != null : filter === 'preparing' ? ['queued','running'].includes(report.documents.status) : true;
}
export function useReportDocumentLibrary() {
  const { user } = useAuth();
  return useQuery<ReportLibraryDocument[]>({ queryKey: ['report-document-library', user?.id], queryFn: async () => (await apiClient.get('/api/reports/oetc-line-report/library')).data,
    refetchInterval: query => query.state.data?.some(report => ['queued','running'].includes(report.documents.status)) ? 15000 : 30000 });
}
