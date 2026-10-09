import { useEffect, useState } from 'react';
import { Alert, Box, LinearProgress, Stack, Typography } from '@mui/material';
import { tr, useLanguage } from '../i18n';
import type { ReportGenerationProgress as Progress } from '../api/reportGeneration';

export function ReportGenerationProgress({ progress, reconnecting = false }: { progress: Progress | null; reconnecting?: boolean }) {
  useLanguage();
  const [now, setNow] = useState(() => Date.now());
  const active = progress?.status === 'queued' || progress?.status === 'running';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!progress) return null;
  const elapsed = Math.floor(progress.elapsed_seconds + (active ? Math.max(0, now - (progress.received_at || now)) / 1000 : 0));
  const duration = `${Math.floor(elapsed / 3600).toString().padStart(2, '0')}:${Math.floor(elapsed / 60 % 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const failed = progress.status === 'failed' || progress.status === 'interrupted';
  return <Box sx={{ my: 2, p: 2, border: '1px solid', borderColor: failed ? 'error.main' : 'primary.main', borderRadius: 2 }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, mb: 1 }}>
      <Typography sx={{ fontWeight: 700 }}>{tr(progress.stage)}</Typography>
      <Typography sx={{ fontWeight: 700 }}>{progress.percent}%</Typography>
    </Stack>
    <LinearProgress variant={progress.total ? 'determinate' : 'indeterminate'} value={progress.percent} aria-label={tr('Report creation progress')} sx={{ height: 10, borderRadius: 5, mb: 1.5 }} />
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
      <Typography variant="body2">{tr('Elapsed time: {0}', [duration])}</Typography>
      <Typography variant="body2">{progress.total ? tr('Completed work: {0} / {1}', [progress.completed, progress.total]) : tr('Counting report contents…')}</Typography>
    </Stack>
    {progress.total > 0 && <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, mt: 1 }}>
      <Typography variant="body2">{tr('Findings: {0} / {1}', [progress.findings_done, progress.findings_total])}</Typography>
      <Typography variant="body2">{tr('Photos: {0} / {1}', [progress.photos_done, progress.photos_total])}</Typography>
      <Typography variant="body2">{tr('Saved sections: {0} / {1}', [progress.sections_done, progress.sections_total])}</Typography>
    </Stack>}
    {active && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{tr('Progress follows completed work. Large photos and document assembly can take longer; elapsed time continues updating.')}</Typography>}
    {reconnecting && <Alert severity="warning" sx={{ mt: 1 }}>{tr('Reconnecting to report progress. Your report continues on the server.')}</Alert>}
    {failed && <Alert severity="error" sx={{ mt: 1 }}>{tr(progress.error || 'Report generation failed')}</Alert>}
    {progress.status === 'complete' && <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>{tr(progress.download_started ? 'Report ready. Download started.' : 'Report ready. Preparing download…')}</Typography>}
  </Box>;
}
