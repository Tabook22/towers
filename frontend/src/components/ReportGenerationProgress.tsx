import { useEffect, useState } from 'react';
import { Alert, Box, LinearProgress, Stack, Typography } from '@mui/material';
import { tr, useLanguage } from '../i18n';
import { estimateRemaining, type ReportGenerationProgress as Progress } from '../api/reportGeneration';

export function ReportGenerationProgress({ progress, reconnecting = false }: { progress: Progress | null; reconnecting?: boolean }) {
  useLanguage();
  const [now, setNow] = useState(() => Date.now());
  const active = progress?.status === 'queued' || progress?.status === 'running' || Boolean(progress?.downloading);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!progress) return null;
  const elapsed = Math.floor(progress.elapsed_seconds + (progress.downloading ? Math.max(0, now - (progress.download_started_at || now)) / 1000 : active ? Math.max(0, now - (progress.received_at || now)) / 1000 : 0));
  const duration = `${Math.floor(elapsed / 3600).toString().padStart(2, '0')}:${Math.floor(elapsed / 60 % 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const transferElapsed = Math.max(0, (now - (progress.download_started_at || now)) / 1000);
  const workElapsed = Math.max(0, elapsed - (progress.started_at && progress.created_at ? progress.started_at - progress.created_at : 0));
  const remaining = reconnecting ? null : progress.downloading
    ? estimateRemaining(progress.download_loaded || 0, progress.download_total || 0, transferElapsed)
    : progress.status === 'running' ? estimateRemaining(progress.completed, progress.total, workElapsed) : null;
  const remainingLabel = remaining === null ? tr('Estimating remaining time…') : tr('Estimated remaining: about {0}', [remaining < 60 ? tr('{0} seconds', [remaining]) : tr('{0} minutes', [Math.ceil(remaining / 60)])]);
  const percent = progress.downloading ? (progress.download_total ? Math.min(100, Math.floor((progress.download_loaded || 0) / progress.download_total * 100)) : null) : progress.percent;
  const determinate = progress.downloading ? Boolean(progress.download_total) : Boolean(progress.total);
  const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  const failed = progress.status === 'failed' || progress.status === 'interrupted';
  return <Box role="status" aria-live="polite" sx={{ my: 2, p: 2, border: '1px solid', borderColor: failed ? 'error.main' : 'primary.main', borderRadius: 2 }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, mb: 1 }}>
      <Typography sx={{ fontWeight: 700 }}>{tr(progress.downloading ? 'Downloading report file' : progress.stage)}</Typography>
      <Typography sx={{ fontWeight: 700 }}>{percent === null ? tr('Receiving file…') : `${percent}%`}</Typography>
    </Stack>
    <LinearProgress variant={determinate ? 'determinate' : 'indeterminate'} value={percent ?? 0} aria-label={tr('Report creation progress')} sx={{ height: 10, borderRadius: 5, mb: 1.5 }} />
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
      <Typography variant="body2">{tr('Elapsed time: {0}', [duration])}</Typography>
      <Typography variant="body2">{progress.downloading ? tr('Received: {0} MB{1}', [megabytes(progress.download_loaded || 0), progress.download_total ? ` / ${megabytes(progress.download_total)} MB` : '']) : progress.total ? tr('Completed work: {0} / {1}', [progress.completed, progress.total]) : tr('Counting report contents…')}</Typography>
    </Stack>
    {active && <Typography variant="body2" sx={{ mt: 1, fontWeight: 650 }}>{remainingLabel}</Typography>}
    {progress.total > 0 && <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, mt: 1 }}>
      <Typography variant="body2">{tr('Findings: {0} / {1}', [progress.findings_done, progress.findings_total])}</Typography>
      <Typography variant="body2">{tr('Photos: {0} / {1}', [progress.photos_done, progress.photos_total])}</Typography>
      <Typography variant="body2">{tr('Saved sections: {0} / {1}', [progress.sections_done, progress.sections_total])}</Typography>
    </Stack>}
    {active && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{tr('Remaining time is approximate and updates as work finishes. Large photos, document assembly and connection speed can change it.')}</Typography>}
    {reconnecting && <Alert severity="warning" sx={{ mt: 1 }}>{tr('Reconnecting to report progress. Your report continues on the server.')}</Alert>}
    {failed && <Alert severity="error" sx={{ mt: 1 }}>{tr(progress.error || 'Report generation failed')}</Alert>}
    {progress.status === 'complete' && !progress.downloading && <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>{tr(progress.download_started ? 'File received. Your browser is saving the download.' : 'Report ready. Preparing download…')}</Typography>}
  </Box>;
}
