import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, LinearProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useAuth } from '../auth/AuthContext';
import { useNavigate } from 'react-router-dom';
import type { TeamJobMap, Visit } from '../api/types';
import { useCreateTeamMission } from '../api/hooks';
import { tr, useLanguage } from '../i18n';
import { towerWorkState, WORK_STATUS_LABELS, hasDeviceVisitDraft } from '../utils/teamTowerWork';
import { positionError } from '../utils/positionChanges';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import { DashboardSection } from './DashboardSection';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';

export function TeamTowerWork({ teamId, jobMap, visits, canStart, loadError, onRefresh, onHistory, onPlanning, plannedIds = [], planDate, inspectionDate, onRepeat }: {
  teamId: number; jobMap?: TeamJobMap; visits?: Visit[]; canStart: boolean; loadError: boolean;
  onRefresh: () => Promise<boolean>;
  plannedIds?: number[]; planDate?: string; inspectionDate: string; onRepeat: (towerId: number) => void;
  onHistory: () => void; onPlanning: () => void;
}) {
  useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const create = useCreateTeamMission(teamId);
  const starting = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const storageKey = `team-tower-work:${teamId}`;
  const [filters, setFilters] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
      return { search: typeof saved.search === 'string' ? saved.search : '',
        status: ['all', 'pending', 'in_progress', 'ready'].includes(saved.status) ? saved.status : 'all' };
    } catch { return { search: '', status: 'all' }; }
  });
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(filters)); } catch { /* storage optional */ } }, [storageKey, filters]);
  const rows = (jobMap?.towers || []).map(tower => {
    let deviceDraft = false;
    try { if (user && tower.visit_id != null) deviceDraft = hasDeviceVisitDraft(localStorage.getItem(`iip-visit-entry:${user.username}:${tower.visit_id}`)); } catch { /* private storage is optional */ }
    const state = towerWorkState(tower, visits || []);
    return { tower, ...state, status: deviceDraft && state.visit ? 'in_progress' as const : state.status, deviceDraft };
  });
  rows.sort((a, b) => {
    const aPlan = plannedIds.indexOf(a.tower.id), bPlan = plannedIds.indexOf(b.tower.id);
    if (aPlan >= 0 || bPlan >= 0) return (aPlan < 0 ? Infinity : aPlan) - (bPlan < 0 ? Infinity : bPlan);
    const rank = { in_progress: 0, pending: 1, unknown: 2, ready: 3 };
    return rank[a.status] - rank[b.status] || a.tower.tower_id.localeCompare(b.tower.tower_id, undefined, { numeric: true });
  });
  const visible = rows.filter(row => (filters.status === 'all' || row.status === filters.status)
    && `${row.tower.tower_id} ${row.tower.area || ''}`.toLocaleLowerCase().includes(filters.search.trim().toLocaleLowerCase()));
  const actionLabel = (status: string) => tr(status === 'pending' ? 'Start inspection' : status === 'ready' ? 'Review inspection' : status === 'unknown' ? 'Open inspection' : 'Continue inspection');
  const actionIcon = (status: string) => status === 'pending' ? <PlayArrowRounded /> : status === 'ready' ? <FactCheckRounded /> : status === 'unknown' ? <VisibilityRounded /> : <EditNoteRounded />;
  const actionDisabled = (tower: TeamJobMap['towers'][number]) => create.isPending || refreshing || (tower.visit_id == null && (!canStart || !inspectionDate || create.isError || loadError));
  const openTower = async (tower: TeamJobMap['towers'][number]) => {
    if (tower.visit_id != null) { navigate(`/visits/${tower.visit_id}?entry=visual`); return; }
    if (!canStart || !inspectionDate || starting.current || create.isError || loadError) return;
    starting.current = true;
    try {
      const visit = await create.mutateAsync({ tower_id: tower.id, inspection_date: inspectionDate, resume_existing: true });
      navigate(`/visits/${visit.id}?entry=visual`);
    } catch { /* mutation error shown below; no silent retry */ }
    finally { starting.current = false; }
  };
  return <Stack spacing={2}>
    {jobMap && visits && <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Chip icon={<TransmissionTowerIcon />} label={tr('Assigned towers: {0}', [rows.length])} />
      <Chip icon={<ScheduleRounded />} label={tr('{0} not started', [rows.filter(r => r.status === 'pending').length])} />
      <Chip icon={<EditNoteRounded />} color="info" variant="outlined" label={tr('{0} in progress', [rows.filter(r => r.status === 'in_progress').length])} />
      <Chip icon={<FactCheckRounded />} color="success" variant="outlined" label={tr('{0} ready for review', [rows.filter(r => r.status === 'ready').length])} />
    </Stack>}
    <DashboardSection icon={<EngineeringRounded />} tone="green" eyebrow={tr("READINGS & EVIDENCE")} title={tr('Tower work')}
      description={tr('Continue the existing visit, or start the first inspection. Use New repeat visit only when inspecting this tower again.')}>
      <Stack spacing={2}>
        {plannedIds.length > 0 && <Alert severity="info">{tr('Plan for {0}: planned towers appear first, followed by unfinished work.', [planDate || '—'])}</Alert>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <TextField size="small" label={tr('Search tower or area')} value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} sx={{ flex: 1, minWidth: 200 }} />
          <TextField select size="small" label={tr('Inspection progress')} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} sx={{ minWidth: 200 }}>
            <MenuItem value="all">{tr('All assigned towers')}</MenuItem>
            {(['pending', 'in_progress', 'ready'] as const).map(status => <MenuItem key={status} value={status}>{tr(WORK_STATUS_LABELS[status])}</MenuItem>)}
          </TextField>
          <Button variant="outlined" onClick={onPlanning}>{tr('Plan / assign towers')}</Button>
          <Button disabled={refreshing || create.isPending} onClick={async () => {
            setRefreshing(true);
            try { if (await onRefresh()) create.reset(); } finally { setRefreshing(false); }
          }}>{tr('Refresh tower list')}</Button>
        </Stack>
        {create.isError && <Alert severity="error">{tr(positionError(create.error, 'Could not start the inspection. Refresh the tower list before trying again to avoid a duplicate visit.'))}</Alert>}
        {loadError && <Alert severity="error">{tr('Could not load the tower list. Refresh to try again.')}</Alert>}
        {(!jobMap || !visits) && !loadError ? <LinearProgress aria-label={tr('Loading towers…')} /> : jobMap && visits ? <>
          <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
            {visible.map(({ tower, visit, status, deviceDraft }) => <Paper key={tower.id} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Typography sx={{ fontWeight: 700 }}>{tower.tower_id}</Typography>
                {plannedIds.includes(tower.id) && <Chip size="small" label={tr('Plan stop {0}', [plannedIds.indexOf(tower.id) + 1])} />}
                {(visit?.has_working_draft || deviceDraft) && <Chip size="small" color="warning" label={tr(visit?.has_working_draft ? 'Your draft is waiting' : 'Draft on this device')} />}
                <Typography variant="caption" color="text.secondary">{tower.area}{visit?.inspection_date ? ` · ${visit.inspection_date}` : ''}</Typography>
                <Chip sx={{ alignSelf: 'flex-start' }} size="small" label={tr(WORK_STATUS_LABELS[status])} color={status === 'ready' ? 'success' : status === 'in_progress' ? 'info' : 'default'} variant="outlined" />
                {visit?.rollup && <Typography variant="body2">{tr('Confirmed screening')}: {visit.rollup.screened}/{visit.rollup.installed} · {tr('Images pending: {0}', [visit.rollup.images_pending])}</Typography>}
                {!!visit?.rollup?.hotspots && <Typography variant="body2" color="error">{tr('Hotspots: {0}', [visit.rollup.hotspots])}</Typography>}
                <Button startIcon={actionIcon(status)} variant="contained" disabled={actionDisabled(tower)} onClick={() => void openTower(tower)}>{actionLabel(status)}</Button>
                {canStart && tower.visit_id != null && <Button size="small" disabled={actionDisabled(tower)} onClick={() => onRepeat(tower.id)}>{tr('New repeat visit')}</Button>}
              </Stack>
            </Paper>)}
            {!visible.length && <Typography>{tr(rows.length ? 'No towers match these filters.' : 'No towers assigned yet. Use Planning & tracking to select towers for this team.')}</Typography>}
          </Stack>
          <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
            <Table size="small" aria-label={tr('Assigned tower work')}>
              <TableHead><TableRow>
                {['Tower', 'Inspection progress', 'Confirmed screening', 'Confirmed evidence', 'Action'].map(label => <TableCell key={label}>{tr(label)}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>{visible.map(({ tower, visit, status, deviceDraft }) => <TableRow key={tower.id} hover>
                <TableCell><Button sx={{ textTransform: 'none', fontWeight: 700, p: 0 }} disabled={actionDisabled(tower)} onClick={() => void openTower(tower)}>{tower.tower_id}</Button>
                  {plannedIds.includes(tower.id) && <Chip size="small" sx={{ mx: 1 }} label={tr('Plan stop {0}', [plannedIds.indexOf(tower.id) + 1])} />}
                  <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{tower.area}{visit?.inspection_date ? ` · ${visit.inspection_date}` : ''}</Typography>
                </TableCell>
                <TableCell><Chip size="small" label={tr(WORK_STATUS_LABELS[status])} color={status === 'ready' ? 'success' : status === 'in_progress' ? 'info' : 'default'} variant="outlined" />{(visit?.has_working_draft || deviceDraft) && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: .5 }}>{tr(visit?.has_working_draft ? 'Your draft is waiting' : 'Draft on this device')}</Typography>}</TableCell>
                <TableCell>{visit?.rollup ? `${visit.rollup.screened}/${visit.rollup.installed}` : '—'}
                  {!!visit?.rollup?.hotspots && <Typography variant="caption" sx={{ display: 'block' }} color="error">{tr('Hotspots: {0}', [visit.rollup.hotspots])}</Typography>}
                </TableCell>
                <TableCell>{visit?.rollup ? tr('Images pending: {0}', [visit.rollup.images_pending]) : '—'}</TableCell>
                <TableCell><Button startIcon={actionIcon(status)} variant="contained" size="small" disabled={actionDisabled(tower)} onClick={() => void openTower(tower)} sx={{ whiteSpace: 'nowrap' }}>{actionLabel(status)}</Button>
                  {canStart && tower.visit_id != null && <Button size="small" disabled={actionDisabled(tower)} onClick={() => onRepeat(tower.id)}>{tr('New repeat visit')}</Button>}
                </TableCell>
              </TableRow>)}
                {visible.length === 0 && <TableRow><TableCell colSpan={5}>{tr(rows.length ? 'No towers match these filters.' : 'No towers assigned yet. Use Planning & tracking to select towers for this team.')}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary">{tr('Counts show confirmed data. Your private working draft is shown separately. Evidence and report approval remain separate checks.')}</Typography>
        </> : null}
        <Button onClick={onHistory} sx={{ alignSelf: 'flex-start' }}>{tr('Visit history and reports')}</Button>
      </Stack>
    </DashboardSection>
  </Stack>;
}
