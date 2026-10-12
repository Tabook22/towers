import { useEffect, useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, Typography, type ButtonProps } from '@mui/material';
import { DownloadRounded, PictureAsPdfRounded, DescriptionRounded } from '@mui/icons-material';
import { apiClient } from '../api/client';
import type { LineInspectionReportOut } from '../api/types';
import { reportError } from '../utils/reportLibrary';
import { useAuth } from '../auth/AuthContext';
import { tr, useLanguage } from '../i18n';

interface PdfJob extends Options { status: 'idle' | 'unavailable' | 'queued' | 'running' | 'complete' | 'failed'; error: string | null }
interface Options { word_bytes: number | null; pdf_bytes: number | null; pdf_available: boolean }
const size = (bytes: number | null | undefined) => bytes == null ? tr('Size unavailable') : `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toFixed(1)} ${bytes < 1048576 ? 'KB' : 'MB'}`;

export function ReportDownloadButton({ report, iconOnly = false, sx, variant = 'outlined', pdfOnly = false }: { report: LineInspectionReportOut; iconOnly?: boolean; sx?: ButtonProps['sx']; variant?: ButtonProps['variant']; pdfOnly?: boolean }) {
  useLanguage();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'word' | 'preparing' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const autoPrepare = useRef(false);
  const base = `/api/reports/oetc-line-report/${report.id}`;
  const query = useQuery<Options>({ queryKey: ['report-download-options', user?.id, report.id], enabled: open, staleTime: 0, queryFn: async () => (await apiClient.get(`${base}/download-options`)).data });
  const prepare = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy('preparing'); setError('');
    try {
      let job = (await apiClient.post<PdfJob>(`${base}/start-pdf`, {}, { timeout: 30000 })).data;
      while (job.status === 'queued' || job.status === 'running') {
        await new Promise(resolve => window.setTimeout(resolve, 3000));
        job = (await apiClient.get<PdfJob>(`${base}/pdf-status`, { timeout: 30000 })).data;
      }
      if (job.status !== 'complete' || job.pdf_bytes == null) {
        setError(job.error || tr('Could not prepare the PDF. Please try again.'));
        return;
      }
      const refreshed = await query.refetch();
      if (refreshed.isError) throw new Error(tr('Could not load file sizes. Please try again.'));
    }
    catch (err) { setError(await reportError(err, tr('Could not prepare the PDF. Please try again.'))); }
    finally { lock.current = false; setBusy(null); }
  }, [base, query.refetch]);
  useEffect(() => {
    if (!open || !pdfOnly || autoPrepare.current || query.isFetching || !query.data || query.isError) return;
    autoPrepare.current = true;
    if (query.data.pdf_bytes == null && query.data.pdf_available) void prepare();
  }, [open, pdfOnly, query.isFetching, query.isError, query.data, prepare]);
  const launch = () => { autoPrepare.current = false; setOpen(true); setError(''); };
  const download = async (format: 'pdf' | 'word') => {
    if (lock.current) return;
    lock.current = true; setBusy(format); setProgress(0); setError('');
    try {
      const bytes = format === 'pdf' ? query.data?.pdf_bytes : query.data?.word_bytes;
      const response = await apiClient.get(`${base}/${format === 'pdf' ? 'file.pdf' : report.has_file ? 'file' : 'redownload'}`, { responseType: 'blob', timeout: 0, onDownloadProgress: event => { const total = event.total || bytes; setProgress(total ? Math.min(100, Math.round(event.loaded / total * 100)) : null); } });
      const url = URL.createObjectURL(response.data); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${report.report_number.replace(/[^\w.-]/g, '-')}.${format === 'pdf' ? 'pdf' : 'docx'}`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(await reportError(err, tr('Could not download this report. Please try again.'))); }
    finally { lock.current = false; setBusy(null); }
  };
  return <>
    {iconOnly ? <IconButton disabled={pdfOnly && !report.has_file} aria-label={tr(pdfOnly ? 'Convert to PDF' : 'Download PDF or Word')} onClick={launch}>{pdfOnly ? <PictureAsPdfRounded fontSize="small" /> : <DownloadRounded fontSize="small" />}</IconButton> : <Button variant={variant} sx={sx} disabled={pdfOnly && !report.has_file} startIcon={pdfOnly ? <PictureAsPdfRounded /> : <DownloadRounded />} onClick={launch}>{tr(pdfOnly ? 'Convert to PDF' : 'Download PDF or Word')}</Button>}
    <Dialog open={open} onClose={() => { if (!busy || busy === 'preparing') setOpen(false); }} maxWidth="sm" fullWidth>
      <DialogTitle>{tr(pdfOnly ? 'Convert Word report to PDF' : 'Choose download format')}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>{report.report_number}</Typography>
        {(error || query.isError) && <Alert severity="error" action={query.isError ? <Button onClick={() => void query.refetch()}>{tr('Retry')}</Button> : undefined}>{error || tr('Could not load file sizes. Please try again.')}</Alert>}
        {pdfOnly && <Typography variant="body2" color="text.secondary">{tr('Converts the saved Word report, including its tables and photographs. Both formats remain available.')}</Typography>}
        {query.isLoading && <LinearProgress aria-label={tr('Loading PDF conversion options')} />}
        {pdfOnly && query.data?.pdf_bytes != null && !busy && <Alert severity="success">{tr('PDF ready. Download your converted report below.')}</Alert>}
        <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><PictureAsPdfRounded color="error" /><Typography sx={{ fontWeight: 700 }}>PDF · {query.data?.pdf_bytes != null ? size(query.data.pdf_bytes) : tr(busy === 'preparing' ? 'Converting…' : 'Not prepared yet')}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{tr('A PDF copy of the issued report, ready to read and print. Its actual size appears after preparation.')}</Typography>
          <Button variant="contained" disabled={!!busy || !query.data || (!query.data.pdf_available && query.data.pdf_bytes == null)} onClick={() => void (query.data?.pdf_bytes != null ? download('pdf') : prepare())}>{tr(busy === 'preparing' ? 'Converting…' : query.data?.pdf_bytes != null ? 'Download PDF' : 'Convert to PDF')}</Button>
          {query.data && !query.data.pdf_available && query.data.pdf_bytes == null && <Typography variant="caption">{tr('PDF is unavailable for this report. You can download Word.')}</Typography>}
        </Box>
        {!pdfOnly && <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><DescriptionRounded color="primary" /><Typography sx={{ fontWeight: 700 }}>Word · {size(query.data?.word_bytes)}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{tr('The original Word document with full-resolution report photographs.')}</Typography><Button variant="outlined" disabled={!!busy || query.isLoading || query.isError} onClick={() => void download('word')}>{tr('Download Word')}</Button></Box>}
        {busy && <Box role="status" aria-live="polite"><Typography variant="body2" sx={{ mb: 1 }}>{busy === 'preparing' ? tr('Converting in the background… You can close this window and return to download the PDF when it is ready.') : tr('Downloading… {0}', [progress == null ? '' : `${progress}%`])}</Typography><LinearProgress variant={busy === 'preparing' || progress == null ? 'indeterminate' : 'determinate'} value={progress ?? 0} /></Box>}
      </Stack></DialogContent><DialogActions><Button disabled={!!busy && busy !== 'preparing'} onClick={() => setOpen(false)}>{tr('Close')}</Button></DialogActions>
    </Dialog>
  </>;
}
