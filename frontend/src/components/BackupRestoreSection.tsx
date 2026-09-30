import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { apiClient, mediaUrl } from '../api/client';
import { locale, tr, useLanguage } from '../i18n';

type Visit = { id: number; tower_id: string; line: string; inspection_date: string; positions: number; images: number };
type Summary = { created_at: string; counts: Record<string, number>; visits: Visit[]; file_count: number; missing_files: unknown[] };
type Job = { id: string; kind: string; status: string; stage: string; created_at: string; size: number; processed_files: number; error?: string; summary?: Summary; recovery_id?: string };
type Plan = { records_to_import: Record<string, number>; reused_parent_records: Record<string, number>; omitted_cross_visit_reports: number[]; replaces_existing_data: boolean };
const busy = (j: Job) => ['queued', 'running'].includes(j.status);
const sizeLabel = (bytes: number) => `${(bytes / 1024 ** 2).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB`;
const errorText = (error: any) => typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : 'The operation failed. Check your connection and try again.';
const countLabels = { towers: 'Towers', visits: 'Visits', positions: 'Positions', images: 'Image records', line_inspection_reports: 'Saved reports' };
const kindLabels: Record<string, string> = { backup: 'Backup', upload: 'Uploaded backup', restore: 'Restore', recovery: 'Recovery backup' };
const statusLabels: Record<string, string> = { queued: 'Waiting', running: 'In progress', uploading: 'Uploading', validated: 'Validated', complete: 'Complete', failed: 'Failed', interrupted: 'Interrupted' };

function Counts({ counts }: { counts: Record<string, number> }) {
  return <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>{Object.entries(countLabels).map(([key, label]) => <Chip key={key} variant="outlined" label={`${tr(label)}: ${(counts[key] || 0).toLocaleString(locale())}`} />)}</Stack>;
}

export function BackupRestoreSection() {
  useLanguage();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState(false);
  const [upload, setUpload] = useState<number | null>(null);
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<'selective' | 'full'>('selective');
  const [ids, setIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [word, setWord] = useState('');
  const [ack, setAck] = useState(false);
  const [removing, setRemoving] = useState<Job | null>(null);
  const query = useQuery({ queryKey: ['backup-jobs'], queryFn: async () => (await apiClient.get<Job[]>('/api/backups')).data, refetchInterval: 3000, refetchIntervalInBackground: false });
  const jobs = query.data || [];
  const active = jobs.some(busy);
  const source = jobs.find(j => j.id === selected && j.status === 'validated');
  const refresh = () => client.invalidateQueries({ queryKey: ['backup-jobs'] });
  async function perform(fn: () => Promise<void>) {
    setAction(true); setError('');
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setAction(false); void refresh(); }
  }
  function choose(id: string) { setSelected(id); setIds([]); setPlan(null); setSearch(''); }
  async function uploadFile(file?: File) {
    if (!file) return;
    setUpload(0);
    await perform(async () => {
      const { data } = await apiClient.post<Job>('/api/backups/uploads', { size: file.size });
      const id = data.id;
      let offset = 0;
      while (offset < file.size) {
        let success = false;
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          try {
            const end = Math.min(offset + 8 * 1024 ** 2, file.size);
            const response = await apiClient.put(`/api/backups/${id}/upload`, file.slice(offset, end), {
              params: { offset }, headers: { 'Content-Type': 'application/octet-stream' },
              onUploadProgress: p => setUpload(Math.min(100, (offset + p.loaded) / file.size * 100)),
            });
            offset = response.data.size; success = true;
          } catch (e) {
            if (attempt === 2) throw e;
            const current = await apiClient.get<Job>(`/api/backups/${id}`);
            offset = current.data.size;
            if (offset >= file.size) success = true;
          }
        }
        setUpload(offset / file.size * 100);
      }
      await apiClient.post(`/api/backups/${id}/validate`);
      choose(id);
    });
    setUpload(null);
    if (input.current) input.current.value = '';
  }
  return <Card variant="outlined" id="backup-restore"><CardContent>
    <Stack spacing={2}>
      <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>{tr('Backup & Restore')}</Typography>
        <Typography color="text.secondary">{tr('Portable inspection backups for this computer or your VPS. Full administrators only.')}</Typography></Box>
      <Alert severity="info">{tr('Includes inspection records, original evidence, attachments, saved reports and uploaded templates. Passwords, login tokens and server secrets are excluded. Keep downloaded ZIP files private; they are not encrypted.')}</Alert>
      <Typography variant="body2">{tr('The application pauses during the consistent snapshot and final restore. Large backups may take several minutes. Server copies expire after the configured retention period (default: 7 days); download them promptly.')}</Typography>
      {(error || query.isError) && <Alert severity="error" onClose={() => setError('')}>{tr(error || errorText(query.error))}</Alert>}
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" disabled={action || active} onClick={() => void perform(async () => { await apiClient.post('/api/backups'); })}>{tr('Create complete backup')}</Button>
        <Button variant="outlined" disabled={action || active} onClick={() => input.current?.click()}>{tr('Upload and validate ZIP')}</Button>
        <input ref={input} hidden type="file" accept=".zip,application/zip" onChange={e => void uploadFile(e.target.files?.[0])} />
      </Stack>
      {upload !== null && <Box><Typography variant="body2">{tr('Uploading backup: {0}%', [Math.floor(upload)])}</Typography><LinearProgress variant="determinate" value={upload} /><Typography variant="caption">{tr('Keep this page open until the upload finishes. Validation and backup jobs continue on the server.')}</Typography></Box>}
      <Typography sx={{ fontWeight: 700 }}>{tr('Recent backup and restore jobs')}</Typography>
      {query.isLoading && <LinearProgress />}
      {!query.isLoading && !jobs.length && <Typography color="text.secondary">{tr('No backups yet. Create your first recovery copy here.')}</Typography>}
      {jobs.map(j => <Box key={j.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <Box><Typography sx={{ fontWeight: 700 }}>{tr(kindLabels[j.kind] || j.kind)} · {new Date(j.created_at).toLocaleString(locale())}</Typography><Typography variant="caption">{sizeLabel(j.size)} · {tr(j.stage)}{busy(j) && j.processed_files > 0 ? ` · ${tr('Files processed: {0}', [j.processed_files])}` : ''}</Typography></Box>
          <Chip size="small" label={tr(statusLabels[j.status] || j.status)} color={j.status === 'failed' || j.status === 'interrupted' ? 'error' : j.status === 'complete' || j.status === 'validated' ? 'success' : 'default'} />
        </Stack>
        {busy(j) && <LinearProgress sx={{ my: 1 }} />}
        {j.error && <Alert severity="error" sx={{ mt: 1 }}>{tr(j.error)}</Alert>}
        {j.summary && <Box sx={{ mt: 1 }}><Counts counts={j.summary.counts} /><Typography variant="caption">{tr('Uploaded files: {0}', [j.summary.file_count])}</Typography></Box>}
        {!!j.summary?.missing_files?.length && <Alert severity="warning">{tr('This recovery copy records files that were already missing. Keep it for manual recovery; it cannot be imported as a complete backup.')}</Alert>}
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {j.status === 'complete' && ['backup', 'recovery'].includes(j.kind) && <Button component="a" href={mediaUrl(`/api/backups/${j.id}/download`)}>{tr('Download ZIP')}</Button>}
          {j.status === 'validated' && <Button variant={selected === j.id ? 'contained' : 'text'} disabled={action || active} onClick={() => choose(j.id)}>{tr('Preview recovery')}</Button>}
          {j.recovery_id && <Button component="a" href={mediaUrl(`/api/backups/${j.recovery_id}/download`)}>{tr('Download pre-restore backup')}</Button>}
          {j.kind === 'restore' && j.status === 'complete' && <Button onClick={() => window.location.reload()}>{tr('Reload restored application')}</Button>}
          {!busy(j) && <Button color="inherit" disabled={action || active} onClick={() => setRemoving(j)}>{tr('Remove server copy')}</Button>}
        </Stack>
      </Box>)}
      {source?.summary && <Box sx={{ border: 2, borderColor: 'primary.main', borderRadius: 2, p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">{tr('Review recovery contents')}</Typography>
          <Typography>{tr('Backup created: {0}', [new Date(source.summary.created_at).toLocaleString(locale())])}</Typography>
          <Counts counts={source.summary.counts} />
          <TextField select label={tr('Recovery mode')} value={mode} disabled={action || active} onChange={e => { setMode(e.target.value as typeof mode); setPlan(null); }}>
            <MenuItem value="selective">{tr('Recover selected missing visits')}</MenuItem><MenuItem value="full">{tr('Full recovery — replace all business data')}</MenuItem>
          </TextField>
          <Alert severity={mode === 'full' ? 'warning' : 'info'}>{mode === 'full'
            ? tr('Full recovery replaces all business records. Your administrator login is retained; other imported accounts are disabled and require password resets. A recovery ZIP is created automatically before changes.')
            : tr('Only whole missing visits are imported. Existing visits and conflicting identifiers are rejected, never overwritten. This does not repair individual missing images inside an existing visit. Shared parent records are reused only when their identifiers and identities match.')}</Alert>
          <TextField label={tr('Find a tower or line')} value={search} onChange={e => setSearch(e.target.value)} size="small" />
          <TableContainer sx={{ maxHeight: 330 }}><Table size="small" stickyHeader><TableHead><TableRow>
            {mode === 'selective' && <TableCell>{tr('Select')}</TableCell>}{['Tower', 'Visit', 'Date', 'Positions', 'Image records'].map(label => <TableCell key={label}>{tr(label)}</TableCell>)}
          </TableRow></TableHead><TableBody>{source.summary.visits.filter(v => `${v.tower_id} ${v.line} ${v.id}`.toLowerCase().includes(search.toLowerCase())).map(v => <TableRow key={v.id}>
            {mode === 'selective' && <TableCell><Checkbox disabled={action || active} checked={ids.includes(v.id)} slotProps={{ input: { 'aria-label': tr('Select visit {0}', [v.id]) } }} onChange={(_, checked) => { setIds(old => checked ? [...old, v.id] : old.filter(id => id !== v.id)); setPlan(null); }} /></TableCell>}
            <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>{v.tower_id}</Typography><Typography variant="caption">{v.line}</Typography></TableCell><TableCell>#{v.id}</TableCell><TableCell>{v.inspection_date}</TableCell><TableCell>{v.positions}</TableCell><TableCell>{v.images}</TableCell>
          </TableRow>)}</TableBody></Table></TableContainer>
          <Button variant="outlined" disabled={action || active || mode === 'selective' && !ids.length} onClick={() => void perform(async () => { setPlan(null); setPlan((await apiClient.post(`/api/backups/${source.id}/preview`, { mode, visit_ids: ids })).data); })}>{tr('Check conflicts and preview restore')}</Button>
          {plan && <><Typography sx={{ fontWeight: 700 }}>{tr('Records to restore')}</Typography><Counts counts={plan.records_to_import} />
            <Typography variant="body2">{tr('Shared parent records reused: {0}', [Object.values(plan.reused_parent_records).reduce((a, b) => a + b, 0)])}</Typography>
            {!!plan.omitted_cross_visit_reports.length && <Alert severity="warning">{tr('Reports spanning unselected visits will be omitted: {0}', [plan.omitted_cross_visit_reports.join(', ')])}</Alert>}
            <Button variant="contained" color={mode === 'full' ? 'error' : 'primary'} disabled={action || active} onClick={() => { setWord(''); setAck(false); setConfirm(true); }}>{tr('Continue to confirmation')}</Button></>}
        </Stack>
      </Box>}
    </Stack>
    <Dialog open={confirm} onClose={() => !action && setConfirm(false)} maxWidth="sm" fullWidth><DialogTitle>{tr('Confirm recovery')}</DialogTitle><DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
      <Alert severity="warning">{mode === 'full' ? tr('Replace all business data with this backup? This affects every tower and user profile.') : tr('Import the selected missing visits and their dependent records?')}</Alert>
      <Typography>{tr('The application will pause, revalidate conflicts and create a recovery backup before restoring. If any step fails, the restore is stopped.')}</Typography>
      <FormControlLabel control={<Checkbox checked={ack} onChange={(_, value) => setAck(value)} />} label={tr('I reviewed the backup and recovery mode and understand the account and data changes.')} />
      <TextField label={tr('Type RESTORE to confirm')} value={word} onChange={e => setWord(e.target.value)} autoComplete="off" slotProps={{ htmlInput: { dir: 'ltr' } }} />
    </Stack></DialogContent><DialogActions><Button disabled={action} onClick={() => setConfirm(false)}>{tr('Cancel')}</Button><Button color="error" variant="contained" disabled={!ack || word !== 'RESTORE' || action || active} onClick={() => void perform(async () => { await apiClient.post(`/api/backups/${source!.id}/restore`, { mode, visit_ids: ids, confirmation: word }); setConfirm(false); setPlan(null); setSelected(''); })}>{tr('Create recovery backup and restore')}</Button></DialogActions></Dialog>
    <Dialog open={!!removing} onClose={() => setRemoving(null)}><DialogTitle>{tr('Remove server copy?')}</DialogTitle><DialogContent>{tr('This removes only this backup job and its temporary files. Downloaded copies and application inspections are unchanged.')}</DialogContent><DialogActions><Button onClick={() => setRemoving(null)}>{tr('Cancel')}</Button><Button color="error" disabled={action} onClick={() => void perform(async () => { await apiClient.delete(`/api/backups/${removing!.id}`); if (selected === removing!.id) choose(''); setRemoving(null); })}>{tr('Remove')}</Button></DialogActions></Dialog>
  </CardContent></Card>;
}
