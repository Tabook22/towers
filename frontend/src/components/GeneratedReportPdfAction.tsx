import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { DescriptionRounded, CheckCircleOutlineRounded } from '@mui/icons-material';
import type { LineInspectionReportOut } from '../api/types';
import { apiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { tr, useLanguage } from '../i18n';
import { generatedWordReport } from '../utils/reportPdf';
import { ReportDownloadButton } from './ReportDownloadButton';

export function GeneratedReportPdfAction({ filename }: { filename: string }) {
  useLanguage();
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['oetc-report-history', 'generated-pdf', user?.id, filename], queryFn: async () => (await apiClient.get<LineInspectionReportOut[]>('/api/reports/oetc-line-report/history')).data });
  const report = generatedWordReport(query.data || [], filename);
  return <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mt: 2 }}>
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CheckCircleOutlineRounded color="success" /><Typography sx={{ fontWeight: 750 }}>{tr('Word report saved. Create your PDF copy.')}</Typography></Stack>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{filename}</Typography>
      {report ? <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}><ReportDownloadButton report={report} pdfOnly variant="contained" /><ReportDownloadButton report={report} /></Stack> : query.isLoading ? <Typography variant="body2" color="text.secondary">{tr('Locating the saved Word report…')}</Typography> : <Alert severity={query.isError ? 'error' : 'info'} icon={<DescriptionRounded />} action={<Button onClick={() => void query.refetch()}>{tr('Retry')}</Button>}>{tr('The Word file is saved. Refresh to locate its PDF conversion action, or open it from the report library.')}</Alert>}
    </Stack>
  </Paper>;
}
