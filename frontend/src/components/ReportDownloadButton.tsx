import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, Typography, type ButtonProps } from '@mui/material';
import { DownloadRounded, PictureAsPdfRounded, DescriptionRounded } from '@mui/icons-material';
import { apiClient } from '../api/client';
import type { LineInspectionReportOut } from '../api/types';
import { reportError } from '../utils/reportLibrary';
import { tr, useLanguage } from '../i18n';

interface Options { word_bytes: number | null; pdf_bytes: number | null; pdf_available: boolean }
const size = (bytes: number | null | undefined) => bytes == null ? tr('Size unavailable') : `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toFixed(1)} ${bytes < 1048576 ? 'KB' : 'MB'}`;

export function ReportDownloadButton({ report, iconOnly = false, sx, variant = 'outlined' }: { report: LineInspectionReportOut; iconOnly?: boolean; sx?: ButtonProps['sx']; variant?: ButtonProps['variant'] }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'word' | 'preparing' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const base = `/api/reports/oetc-line-report/${report.id}`;
  const query = useQuery<Options>({ queryKey: ['report-download-options', report.id], enabled: open, staleTime: 0, queryFn: async () => (await apiClient.get(`${base}/download-options`)).data });
  const prepare = async () => {
    if (lock.current) return;
    lock.current = true; setBusy('preparing'); setError('');
    try { await apiClient.post(`${base}/prepare-pdf`, {}, { timeout: 0 }); await query.refetch(); }
    catch (err) { setError(await reportError(err, tr('Could not prepare the PDF. Please try again.'))); }
    finally { lock.current = false; setBusy(null); }
  };
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
    {iconOnly ? <IconButton aria-label={tr('Download PDF or Word')} onClick={() => { setOpen(true); setError(''); }}><DownloadRounded fontSize="small" /></IconButton> : <Button variant={variant} sx={sx} startIcon={<DownloadRounded />} onClick={() => { setOpen(true); setError(''); }}>{tr('Download PDF or Word')}</Button>}
    <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} maxWidth="sm" fullWidth>
      <DialogTitle>{tr('Choose download format')}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>{report.report_number}</Typography>
        {(error || query.isError) && <Alert severity="error" action={query.isError ? <Button onClick={() => void query.refetch()}>{tr('Retry')}</Button> : undefined}>{error || tr('Could not load file sizes. Please try again.')}</Alert>}
        {query.isLoading && <LinearProgress />}
        <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><PictureAsPdfRounded color="error" /><Typography sx={{ fontWeight: 700 }}>PDF · {query.data?.pdf_bytes != null ? size(query.data.pdf_bytes) : tr('Not prepared yet')}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{tr('A PDF copy of the issued report, ready to read and print. Its actual size appears after preparation.')}</Typography>
          <Button variant="contained" disabled={!!busy || !query.data || (!query.data.pdf_available && query.data.pdf_bytes == null)} onClick={() => void (query.data?.pdf_bytes != null ? download('pdf') : prepare())}>{tr(query.data?.pdf_bytes != null ? 'Download PDF' : 'Prepare PDF')}</Button>
          {query.data && !query.data.pdf_available && query.data.pdf_bytes == null && <Typography variant="caption">{tr('PDF is unavailable for this report. You can download Word.')}</Typography>}
        </Box>
        <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><DescriptionRounded color="primary" /><Typography sx={{ fontWeight: 700 }}>Word · {size(query.data?.word_bytes)}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>{tr('The original Word document with full-resolution report photographs.')}</Typography><Button variant="outlined" disabled={!!busy || query.isLoading || query.isError} onClick={() => void download('word')}>{tr('Download Word')}</Button></Box>
        {busy && <Box role="status"><Typography variant="body2" sx={{ mb: 1 }}>{busy === 'preparing' ? tr('Preparing PDF… Large reports may take a few minutes. Keep this window open.') : tr('Downloading… {0}', [progress == null ? '' : `${progress}%`])}</Typography><LinearProgress variant={busy === 'preparing' || progress == null ? 'indeterminate' : 'determinate'} value={progress ?? 0} /></Box>}
      </Stack></DialogContent><DialogActions><Button disabled={!!busy} onClick={() => setOpen(false)}>{tr('Close')}</Button></DialogActions>
    </Dialog>
  </>;
}
