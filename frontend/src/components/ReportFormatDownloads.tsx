import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { CheckCircleOutlineRounded, DescriptionRounded, DownloadRounded, PictureAsPdfRounded, RefreshRounded } from '@mui/icons-material';
import { apiClient } from '../api/client';
import type { LineInspectionReportOut } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { reportError } from '../utils/reportLibrary';
import { tr, useLanguage } from '../i18n';

import type { ReportDocumentStatus as PdfStatus } from '../utils/reportDocuments';

const fileSize = (bytes: number | null | undefined) => bytes == null ? '' : `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toFixed(1)} ${bytes < 1048576 ? 'KB' : 'MB'}`;

export function ReportFormatDownloads({ report, compact = false, onDark = false, initialStatus, fileRows = false }: { report: LineInspectionReportOut; compact?: boolean; onDark?: boolean; initialStatus?: PdfStatus; fileRows?: boolean }) {
  useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => { if (initialStatus) queryClient.setQueryData(['report-pdf-status', user?.id, report.id], initialStatus); }, [initialStatus, queryClient, user?.id, report.id]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [transfer, setTransfer] = useState<'word' | 'pdf' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const lock = useRef(false);
  const base = `/api/reports/oetc-line-report/${report.id}`;
  const query = useQuery<PdfStatus>({ queryKey: ['report-pdf-status', user?.id, report.id], enabled: report.has_file, initialData: initialStatus, staleTime: initialStatus ? 15000 : 0, queryFn: async () => (await apiClient.get(`${base}/pdf-status`)).data,
    refetchInterval: q => q.state.data?.status === 'queued' || q.state.data?.status === 'running' ? 3000 : false });
  const previousPdfStatus = useRef(initialStatus?.status);
  useEffect(() => {
    if (['queued', 'running'].includes(previousPdfStatus.current || '') && query.data?.status === 'complete') void queryClient.invalidateQueries({ queryKey: ['report-document-library', user?.id] });
    previousPdfStatus.current = query.data?.status;
  }, [query.data?.status, queryClient, user?.id]);
  const preparing = starting || query.data?.status === 'queued' || query.data?.status === 'running';
  const ready = query.data?.pdf_bytes != null;
  const unavailable = !report.has_file || !!query.data && !ready && !query.data.pdf_available;
  const prepare = async () => {
    if (starting) return;
    setStarting(true); setError('');
    try { await apiClient.post(`${base}/start-pdf`, {}, { timeout: 30000 }); void queryClient.invalidateQueries({ queryKey: ['report-document-library', user?.id] }); await query.refetch(); }
    catch (err) { setError(await reportError(err, tr('Could not prepare the PDF. Please try again.'))); }
    finally { setStarting(false); }
  };
  const download = async (format: 'word' | 'pdf') => {
    if (lock.current) return;
    lock.current = true; setTransfer(format); setProgress(0); setError('');
    try {
      const response = await apiClient.get(`${base}/${format === 'pdf' ? 'file.pdf' : report.has_file ? 'file' : 'redownload'}`, { responseType: 'blob', timeout: 0,
        onDownloadProgress: event => { const total = event.total || (format === 'pdf' ? query.data?.pdf_bytes : query.data?.word_bytes); setProgress(total ? Math.min(100, Math.round(event.loaded / total * 100)) : null); } });
      const url = URL.createObjectURL(response.data); const link = document.createElement('a'); link.href = url;
      link.download = `${report.report_number.replace(/[^\w.-]/g, '-')}.${format === 'pdf' ? 'pdf' : 'docx'}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(await reportError(err, tr('Could not download this report. Please try again.'))); }
    finally { lock.current = false; setTransfer(null); }
  };
  const pdfLabel = unavailable ? tr('PDF unavailable') : preparing ? tr('Preparing PDF…') : ready ? tr('Download PDF') : query.data?.status === 'failed' ? tr('Retry PDF') : tr('Prepare PDF');
  const stageLabel = starting || query.data?.status === 'queued' ? tr('Waiting for PDF conversion') : query.data?.stage === 'preparing' ? tr('Preparing the Word document') : query.data?.stage === 'combining' ? tr('Combining PDF sections') : query.data?.stage === 'saving' ? tr('Saving the PDF') : tr('Converting report sections');
  const measured = query.data?.stage === 'converting' && (query.data.total || 0) > 1 && query.data.percent != null;
  const conversionProgress = preparing && <Box sx={{ mt: 1, minWidth: compact ? 250 : undefined }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, mb: .75 }}><Typography variant="caption" role="status" sx={{ color: onDark ? '#d8edf1' : 'text.secondary' }}>{stageLabel}</Typography>{measured && <Typography variant="caption" sx={{ fontWeight: 750, color: onDark ? '#fff' : 'primary.main' }}>{query.data?.percent}%</Typography>}</Stack>
    <LinearProgress aria-label={tr('PDF conversion progress')} variant={measured ? 'determinate' : 'indeterminate'} value={query.data?.percent ?? 0} sx={{ height: 6, borderRadius: 3, ...(onDark ? { bgcolor: '#ffffff22', '& .MuiLinearProgress-bar': { bgcolor: '#8fe0d5' } } : {}) }} />
    {(query.data?.total || 0) > 1 && <Typography variant="caption" sx={{ display: 'block', mt: .5, color: onDark ? '#c0dbe2' : 'text.secondary' }}>{tr('{0} of {1} sections converted', [query.data?.completed || 0, query.data?.total || 0])}</Typography>}
  </Box>;
  const wordButton = <Button size={compact || fileRows ? 'small' : 'medium'} variant="contained" startIcon={<DownloadRounded />} disabled={!!transfer || (!!initialStatus && initialStatus.word_bytes == null)} onClick={() => void download('word')} sx={{ boxShadow: 'none', ...(onDark ? { bgcolor: '#fff', color: '#0d475c', '&:hover': { bgcolor: '#e4f1f4' } } : {}) }}>{tr('Download Word')}</Button>;
  const pdfButton = <Button size={compact || fileRows ? 'small' : 'medium'} variant={ready ? 'contained' : 'outlined'} startIcon={preparing ? <CircularProgress size={16} color="inherit" /> : query.data?.status === 'failed' ? <RefreshRounded /> : <PictureAsPdfRounded />} disabled={!!transfer || preparing || !report.has_file || query.isLoading || query.isError || (!ready && !query.data?.pdf_available)} onClick={() => void (ready ? download('pdf') : prepare())} sx={onDark ? { color: '#fff', bgcolor: ready ? '#ffffff22' : undefined, borderColor: '#ffffff66', '&.Mui-disabled': { color: '#c0dbe2', borderColor: '#ffffff33' } } : { boxShadow: 'none' }}>{pdfLabel}</Button>;
  return <Box sx={{ width: compact ? 'auto' : '100%' }}>
    {compact ? <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>{wordButton}{pdfButton}</Stack> : fileRows ? <Stack spacing={1.25}>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, bgcolor: theme => theme.palette.mode === 'dark' ? 'action.hover' : '#f4f9fd' }}><Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}><DescriptionRounded sx={{ color: '#2876aa', fontSize: 28, flexShrink: 0 }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 750 }}>{tr('Word document')}</Typography><Typography variant="caption" color="text.secondary">{tr(report.has_file ? 'Saved original' : 'No saved Word file')} · {fileSize(query.data?.word_bytes)}</Typography></Box>{wordButton}</Stack></Paper>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, bgcolor: theme => theme.palette.mode === 'dark' ? 'action.hover' : ready ? '#f2faf7' : '#fff8f5' }}><Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}><PictureAsPdfRounded sx={{ color: '#bb5448', fontSize: 28, flexShrink: 0 }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 750 }}>{tr('PDF report')}</Typography><Typography variant="caption" color="text.secondary">{ready ? `${tr('Saved PDF')} · ${fileSize(query.data?.pdf_bytes)}` : unavailable ? tr('PDF unavailable') : preparing ? tr('Preparing PDF…') : query.data?.status === 'failed' ? tr('Retry PDF') : tr('Not prepared yet')}</Typography></Box>{pdfButton}</Stack>{conversionProgress}</Paper>
    </Stack> : <Box sx={{ display: 'grid' , gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, bgcolor: theme => theme.palette.mode === 'dark' ? 'action.hover' : '#f4f9fd' }}><Stack spacing={1.5}><DescriptionRounded sx={{ color: '#2876aa', fontSize: 32 }} /><Typography sx={{ fontWeight: 750 }}>{tr('Word document')}</Typography><Typography variant="body2" color="text.secondary">{tr(report.has_file ? 'Saved original' : 'No saved Word file')}</Typography><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>{report.has_file && <CheckCircleOutlineRounded color="success" fontSize="small" />}<Typography variant="caption">{tr(report.has_file ? 'Ready to download' : 'Original not archived')} {fileSize(query.data?.word_bytes)}</Typography></Stack>{wordButton}</Stack></Paper>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, bgcolor: theme => theme.palette.mode === 'dark' ? 'action.hover' : ready ? '#f2faf7' : '#fff8f5' }}><Stack spacing={1.5}><PictureAsPdfRounded sx={{ color: '#bb5448', fontSize: 32 }} /><Typography sx={{ fontWeight: 750 }}>{tr('PDF report')}</Typography><Typography variant="body2" color="text.secondary">{tr('Ready to read and share')}</Typography><Typography variant="caption" role="status">{unavailable ? tr('PDF preparation is temporarily unavailable. Your Word report is ready.') : preparing ? tr('Preparing automatically in the background') : ready ? `${tr('Ready to download')} ${fileSize(query.data?.pdf_bytes)}` : query.data?.status === 'failed' ? tr('PDF preparation needs a retry. Your Word report is ready.') : tr('Prepare a PDF copy of this saved report.')}</Typography>{conversionProgress}{pdfButton}</Stack></Paper>
    </Box>}
    {compact && conversionProgress}
    {!compact && preparing && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{tr('Your Word report is ready. We are preparing your PDF—you can leave this page and return later.')}</Typography>}
    {(error || query.isError) && <Alert severity="error" sx={{ mt: 1 }} action={query.isError ? <Button onClick={() => void query.refetch()}>{tr('Retry')}</Button> : undefined}>{error || tr('Could not load file sizes. Please try again.')}</Alert>}
    {!compact && query.data?.status === 'failed' && <Alert severity="warning" sx={{ mt: 1 }}>{tr('PDF preparation needs a retry. Your Word report is ready.')}</Alert>}
    <Dialog open={!!transfer} maxWidth="xs" fullWidth><DialogTitle>{tr(transfer === 'pdf' ? 'Download PDF' : 'Download Word')}</DialogTitle><DialogContent><Typography variant="body2" sx={{ mb: 2 }}>{tr('Downloading… {0}', [progress == null ? '' : `${progress}%`])}</Typography><LinearProgress variant={progress == null ? 'indeterminate' : 'determinate'} value={progress ?? 0} /></DialogContent><DialogActions><Button disabled>{tr('Close')}</Button></DialogActions></Dialog>
  </Box>;
}
