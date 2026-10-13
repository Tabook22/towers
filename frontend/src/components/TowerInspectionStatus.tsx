import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useChoiceLists, useVisit } from '../api/hooks';
import type { Visit } from '../api/types';
import { latestInspection, missingPositionEvidence, unfinishedScreening } from '../utils/inspectionFollowUp';
import { positionLabel } from '../utils/positionChanges';
import { tr, useLanguage } from '../i18n';
import { VisitStatusChip } from './Badges';

export function TowerInspectionStatus({ status, towerId, towerName }: { status?: string | null; towerId: number; towerName: string }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  if (status !== 'Inspection incomplete') return <VisitStatusChip status={status} />;
  return <><Chip size="small" label={tr('Inspection incomplete')} onClick={() => setOpen(true)}
    aria-label={`${tr('Show incomplete inspection checks')}: ${towerName}`}
    sx={{ color: '#bd5700', bgcolor: '#fff0df', border: '1px solid #ffc995', fontWeight: 700,
      '&:hover': { bgcolor: '#ffe2bc', boxShadow: '0 2px 8px #c66a0025' } }} />
    {open && <InspectionFollowUp towerId={towerId} towerName={towerName} onClose={() => setOpen(false)} />}
  </>;
}

function InspectionFollowUp({ towerId, towerName, onClose }: { towerId: number; towerName: string; onClose: () => void }) {
  const visits = useQuery({ queryKey: ['inspection-follow-up', towerId],
    queryFn: async () => (await apiClient.get<Visit[]>('/api/visits', { params: { tower_id: towerId, limit: 1 } })).data });
  const latest = latestInspection(visits.data || []);
  const detail = useVisit(latest?.id);
  const lists = useChoiceLists();
  const visit = detail.data;
  const blockers = unfinishedScreening(visit?.positions || []);
  const pending = (visit?.positions || []).map(position => ({ position, types: missingPositionEvidence(position, lists.data?.image_type || []) })).filter(p => p.types.length);
  const temperatures = (visit?.positions || []).filter(p => p.in_scope !== false && p.hotspot === 'Yes' && (p.tmax_c == null || p.tref_c == null));
  const captureDates = (visit?.positions || []).filter(p => p.in_scope !== false && p.images.some(i => i.file_path && i.capture_date && visit?.inspection_date && i.capture_date !== visit.inspection_date));
  const loading = visits.isPending || (!!latest && detail.isPending) || lists.isPending;
  const error = visits.isError || detail.isError || lists.isError;
  const link = (positionId?: number, check = 'screening') => `/visits/${latest?.id}?${new URLSearchParams({ check, ...(positionId ? { position: String(positionId) } : {}) })}`;
  const positionRow = (id: number, label: string, message: string, target: string) => <Paper key={`${target}-${id}`} variant="outlined" sx={{ p: 1.75, borderRadius: 3 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
      <Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 700 }}><bdi>{label}</bdi></Typography><Typography variant="body2" color="text.secondary">{message}</Typography></Box>
      <Button component={Link} to={link(id, target)} endIcon={<ArrowForwardRounded />} onClick={onClose}>{tr('Open position')}</Button>
    </Stack></Paper>;
  return <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="inspection-follow-up-title">
    <DialogTitle id="inspection-follow-up-title" sx={{ background: 'linear-gradient(115deg,#113c4d,#167583)', color: 'white', py: 3 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><ChecklistRounded /><Box><Typography variant="h6" sx={{ fontWeight: 800 }}>{tr('Inspection follow-up')}</Typography><Typography variant="body2">{towerName}</Typography></Box></Stack>
    </DialogTitle>
    <DialogContent dividers><Stack spacing={2}>
      {loading && <><LinearProgress /><Typography>{tr('Loading saved inspection checks…')}</Typography></>}
      {error && <Alert severity="error" action={<Button onClick={() => { void visits.refetch(); void detail.refetch(); void lists.refetch(); }}>{tr('Retry')}</Button>}>{tr('Could not load inspection checks. Please try again.')}</Alert>}
      {!loading && !error && !visit && <Alert severity="info">{tr('No inspection visit is available to your account for this tower.')}</Alert>}
      {!loading && !error && visit && <>
        <Typography variant="body2" color="text.secondary">{tr('Latest accessible visit')} · {visit.inspection_date || tr('No date')} · {visit.team_name || tr('No team')}</Typography>
        <Alert severity={blockers.length ? 'warning' : 'success'}>{blockers.length ? tr('These installed positions need a screening result before this visit is ready for review.') : tr('This visit has no unfinished screening checks. The tower list may need refreshing, or its latest visit may belong to another team.')}</Alert>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{tr('Blocking review')} · {blockers.length}</Typography>
        {blockers.map(p => positionRow(p.id, positionLabel(p), tr('Screening result is missing'), 'screening'))}
        <Box sx={{ bgcolor: 'action.hover', borderRadius: 3, p: 2 }}><Typography sx={{ fontWeight: 800 }}>{tr('Other items to complete')}</Typography><Typography variant="body2" color="text.secondary">{tr('These improve the inspection record. Missing photos or visit details do not change the orange screening status.')}</Typography></Box>
        {pending.map(({ position, types }) => positionRow(position.id, positionLabel(position), `${tr('Required image missing')}: ${types.map(type => tr(type)).join(', ')}`, 'evidence'))}
        {temperatures.map(p => positionRow(p.id, positionLabel(p), tr('Hotspot temperature measurements are incomplete'), 'temperatures'))}
        {captureDates.map(p => positionRow(p.id, positionLabel(p), tr('Photo capture date differs from the inspection date. Check the saved dates.'), 'capture_dates'))}
        {(['inspector_name', 'inspection_date'] as const).filter(field => !visit[field]).map(field => <Alert key={field} severity="info" action={<Button component={Link} to={link(undefined, field)} onClick={onClose}>{tr('Open visit details')}</Button>}>{tr(field === 'inspector_name' ? 'Inspector name is missing.' : 'Inspection date is missing.')}</Alert>)}
        {!pending.length && !temperatures.length && !captureDates.length && visit.inspector_name && visit.inspection_date && <Typography color="text.secondary">{tr('No other missing items found.')}</Typography>}
        <Typography variant="caption" color="text.secondary">{tr('This checklist uses saved records. Confirm your draft changes to update the tower status. Access permissions still apply.')}</Typography>
      </>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>{tr('Close')}</Button>{latest && <Button component={Link} to={`/visits/${latest.id}`} variant="contained" onClick={onClose}>{tr('Open inspection visit')}</Button>}</DialogActions>
  </Dialog>;
}
