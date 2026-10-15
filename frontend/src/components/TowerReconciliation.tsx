import { TeamPerformanceCards } from './TeamPerformanceCards';
import { towerDataStatus, towerRemainingWork } from '../utils/teamPerformance';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import { tr, useLanguage, locale } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useTowerReconciliation, type ReconciliationTeam } from '../api/towerReconciliation';
import { matchesTowerCoverage, reconciliationCsv, type TowerCoverageFilter } from '../utils/towerReconciliation';
import { apiClient } from '../api/client';

const filterLabels: Record<TowerCoverageFilter, string> = {
  remaining: 'Remaining towers', in_progress: 'In progress', all: 'All assigned towers', without_evidence: 'No archived evidence', without_visit: 'No visit recorded',
  screening: 'Screening needs work', categories: 'Four-category gaps', ready: 'Screening + evidence ready',
};

export function TowerReconciliation({ teamId }: { teamId?: number }) {
  useLanguage();
  const { user } = useAuth();
  const enabled = ['admin', 'reviewer', 'team_leader'].includes(user?.role || '');
  const query = useTowerReconciliation(enabled);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<TowerCoverageFilter>('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  if (!enabled) return null;
  const data = query.isError ? undefined : query.data;
  const teams = data?.teams.filter(team => teamId === undefined || team.id === teamId) || [];
  const selected = teams.find(team => team.id === selectedId);
  const totals = teams.reduce((sum, team) => ({
    assigned: sum.assigned + team.counts.assigned,
    evidence: sum.evidence + team.counts.assigned_with_evidence,
    missing: sum.missing + team.counts.without_evidence,
    ready: sum.ready + team.counts.screening_and_evidence_ready,
  }), { assigned: 0, evidence: 0, missing: 0, ready: 0 });
  const openTeam = (team: ReconciliationTeam, initialFilter: TowerCoverageFilter = 'all') => {
    setSelectedId(team.id); setFilter(initialFilter); setSearch('');
  };
  const exportCsv = (scope: ReconciliationTeam[]) => {
    const url = URL.createObjectURL(new Blob([reconciliationCsv(scope)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'tower-reconciliation.csv'; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportExcel = async (id?: number) => {
    setExporting(true); setExportError(false);
    try {
      const response = await apiClient.get('/api/teams/tower-reconciliation.xlsx', { params: id === undefined ? {} : { team_id: id }, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a'); a.href = url; a.download = 'tower-reconciliation.xlsx'; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError(true); }
    finally { setExporting(false); }
  };
  const filtered = selected?.towers.filter(tower => matchesTowerCoverage(tower, filter) &&
    `${tower.tower_id} ${tower.area || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) || [];
  return <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
    <Stack direction="row" sx={{ p: 2.5, bgcolor: 'action.hover', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
      <FactCheckRounded color="primary" sx={{ mt: .5 }} />
      <Box sx={{ flex: 1, minWidth: 220 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{tr('Tower reconciliation')}</Typography>
        <Typography variant="body2" color="text.secondary">{tr('Current assignments compared with all-time uploaded evidence and the latest inspection by the assigned team. Archive filters do not change these counts.')}</Typography>
      </Box>
      <Button startIcon={<RefreshRounded />} disabled={query.isFetching} onClick={() => void query.refetch()}>{tr('Refresh')}</Button>
      <Button startIcon={<DownloadRounded />} disabled={!data || !teams.length || exporting} onClick={() => void exportExcel(teamId)}>{tr('Download coloured Excel')}</Button>
      <Button disabled={!data || !teams.length} onClick={() => exportCsv(teams)}>{tr('Download CSV')}</Button>
    </Stack>
    {query.isFetching && <LinearProgress aria-label={tr('Loading tower reconciliation')} />}
    {query.isError && <Alert severity="error" sx={{ m: 2 }}>{tr('Tower reconciliation could not be loaded. Refresh to try again.')}</Alert>}
    {exportError && <Alert severity="error" sx={{ m: 2 }}>{tr('Could not download the checklist. Please try again.')}</Alert>}
    {!data && !query.isError && <Typography role="status" sx={{ p: 2 }}>{tr('Loading tower reconciliation')}</Typography>}
    {data && <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2.5 } }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
        {[
          [tr('Assigned towers'), totals.assigned], [tr('Assigned towers with evidence'), totals.evidence],
          [tr('Assigned towers without evidence'), totals.missing], [tr('Screening + evidence ready'), totals.ready],
        ].map(([label, value]) => <Paper key={label} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, mt: .5 }}>{value}</Typography>
        </Paper>)}
      </Box>
      <TeamPerformanceCards teams={teams} onOpen={openTeam} />
      <Box component="details">
        <Typography variant="body2" color="text.secondary">{tr('Required image categories can be satisfied by saved photos or an explicit Not required decision with a recorded reason. Unreviewed empty defaults are not exemptions.')}</Typography>
        <Box component="summary" sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 700 }}>{tr('How these counts work')}</Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{tr('Evidence present means at least one image or field photo. Four-category coverage requires thermal full, thermal close, RGB full and RGB close for every installed position in the latest visit. Extra photos cannot fill a missing category; recapture requests are excluded. This coverage check does not certify approval or accept default “Not required” slots as reviewed exemptions.')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{tr('Coverage checks the recorded layout. Verify it matches the physical tower; documented evidence exceptions need separate review.')}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">{tr('Excel includes a colour key, the full checklist and separate status sheets: red = no evidence; amber = incomplete screening or categories; green = screening and evidence ready; grey = historical evidence. CSV does not preserve colours or sheets.')}</Typography>
      {teamId === undefined && <Typography variant="caption" color="text.secondary">{tr('Counts cover active teams. Historical uploads from archived teams remain available in the image library.')}</Typography>}
      {teamId === undefined && <Typography variant="body2" color="text.secondary">{tr('{0} unique archive towers · {1} team archive entries. A tower photographed by more than one team appears in each team’s archive.', [data.unique_archive_towers, data.archive_team_entries])}{data.inactive_inventory !== null && <> {tr('{0} inactive tower records and {1} active unassigned towers are outside the assigned scope above.', [data.inactive_inventory, data.unassigned_active])}</>}</Typography>}
      <TableContainer>
        <Table size="small" aria-label={tr('Tower reconciliation by team')} sx={{ minWidth: 790 }}>
          <TableHead><TableRow>{['Team', 'Assigned towers', 'With evidence', 'No archived evidence', 'No visit recorded', 'Screening ready', 'Four-category coverage', 'Screening + evidence ready'].map(label => <TableCell key={label} sx={{ fontWeight: 700 }}>{tr(label)}</TableCell>)}</TableRow></TableHead>
          <TableBody>{teams.map(team => <TableRow key={team.id}>
            <TableCell><Button onClick={() => openTeam(team)} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>{team.name}</Button></TableCell>
            <TableCell><Button onClick={() => openTeam(team, 'all')} aria-label={tr('View {0} assigned towers for {1}', [team.counts.assigned, team.name])} title={tr('View assigned towers')} sx={{ fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: '3px' }}>{team.counts.assigned}</Button></TableCell><TableCell>{team.counts.assigned_with_evidence}</TableCell>
            <TableCell><Button color={team.counts.without_evidence ? 'warning' : 'primary'} onClick={() => openTeam(team, 'without_evidence')}>{team.counts.without_evidence}</Button></TableCell>
            <TableCell><Button onClick={() => openTeam(team, 'without_visit')}>{team.counts.without_visit}</Button></TableCell>
            <TableCell>{team.counts.screening_ready}</TableCell><TableCell>{team.counts.four_category_coverage}</TableCell>
            <TableCell><Button onClick={() => openTeam(team, 'ready')}>{team.counts.screening_and_evidence_ready}</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </TableContainer>
      {!teams.length && <Typography>{tr('No active teams in this scope.')}</Typography>}
      {teams.filter(team => team.status_needs_review).map(team => <Alert key={team.id} severity="warning" action={<Button color="inherit" onClick={() => openTeam(team)}>{tr('Review towers')}</Button>}>
        {tr('{0} is manually marked Completed, but only {1} of {2} assigned towers have both screening and four-category evidence coverage. Review the team status and any documented evidence exceptions.', [team.name, team.counts.screening_and_evidence_ready, team.counts.assigned])}
      </Alert>)}
      {teams.filter(team => team.counts.outside_assignment > 0).map(team => <Alert key={team.id} severity="info" action={<Button color="inherit" onClick={() => openTeam(team)}>{tr('Review towers')}</Button>}>
        {tr('{0}: {1} archive towers include {2} outside the current assignment. {3} of {4} currently assigned towers have this team’s evidence.', [team.name, team.counts.archive_towers, team.counts.outside_assignment, team.counts.assigned_with_evidence, team.counts.assigned])}
      </Alert>)}
      <Typography variant="caption" color="text.secondary">{tr('Last checked: {0}', [new Date(query.dataUpdatedAt).toLocaleString(locale(), { timeZone: 'Asia/Muscat' })])}</Typography>
    </Stack>}
    <Dialog open={!!selected && !!data} onClose={() => setSelectedId(null)} maxWidth="lg" fullWidth>
      <DialogTitle>{tr('Tower checklist · {0}', [selected?.name])}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label={tr('Coverage filter')} size="small" value={filter} onChange={event => setFilter(event.target.value as TowerCoverageFilter)} sx={{ minWidth: 240 }}>{Object.entries(filterLabels).map(([key, label]) => <MenuItem key={key} value={key}>{tr(label)}</MenuItem>)}</TextField>
            <TextField size="small" label={tr('Find a tower or area')} value={search} onChange={event => setSearch(event.target.value)} sx={{ flex: 1 }} />
            <Chip label={tr('{0} matching towers', [filtered.length])} />
          </Stack>
          <Typography variant="body2" color="text.secondary">{tr('Image counts include every saved visit by this team. Screening and category slots use only its latest visit. A visit record alone does not prove a field visit; private drafts are excluded.')}</Typography>
          <TableContainer sx={{ maxHeight: 440 }}><Table stickyHeader size="small" aria-label={tr('Assigned tower checklist')} sx={{ minWidth: 850 }}>
            <TableHead><TableRow>{['Tower', 'Latest inspection', 'Images / field photos', 'Screened / installed', 'Covered / expected categories', 'Data status / remaining work', 'Next step'].map(label => <TableCell key={label}>{tr(label)}</TableCell>)}</TableRow></TableHead>
            <TableBody>{filtered.map(tower => <TableRow key={tower.id}>
              <TableCell><Button component={RouterLink} to={`/towers/${tower.id}`} sx={{ textTransform: 'none' }}>{tower.tower_id}</Button></TableCell>
              <TableCell>{tower.inspection_date || '—'}</TableCell><TableCell>{tower.archive_images}</TableCell>
              <TableCell>{tower.visit_id === null ? '—' : `${tower.screened_positions} / ${tower.installed_positions}`}</TableCell>
              <TableCell>{tower.visit_id === null ? '—' : `${tower.covered_categories} / ${tower.expected_categories}`}{tower.visit_id !== null && tower.installed_positions === 0 && <Typography variant="caption" sx={{ display: 'block' }}>{tr('No installed positions recorded')}</Typography>}</TableCell>
              <TableCell><Chip size="small" variant="outlined" color={towerDataStatus(tower) === 'complete' ? 'success' : towerDataStatus(tower) === 'in_progress' ? 'warning' : 'default'} label={tr(towerDataStatus(tower) === 'complete' ? 'Data complete' : towerDataStatus(tower) === 'in_progress' ? 'In progress' : 'No visit recorded')} />{towerRemainingWork(tower).filter(reason => reason !== 'No visit recorded').map(reason => <Typography key={reason} variant="caption" sx={{ display: 'block', mt: .5 }}>{tr(reason)}</Typography>)}</TableCell>
              <TableCell>{tower.visit_id !== null ? <Button component={RouterLink} to={`/visits/${tower.visit_id}`} color={tower.screening_and_evidence_ready ? 'success' : 'primary'}>{tr(tower.screening_and_evidence_ready ? 'Review inspection' : 'Continue inspection')}</Button> : <Button component={RouterLink} to={`/teams/${selected?.id}`}>{tr('Plan inspection')}</Button>}</TableCell>
            </TableRow>)}</TableBody>
          </Table></TableContainer>
          {!filtered.length && <Typography>{tr('No towers match this filter.')}</Typography>}
          {!!selected?.outside_assignment.length && <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{tr('Historical evidence outside current assignment')}</Typography>
            <Stack spacing={1}>{selected.outside_assignment.map(tower => <Paper variant="outlined" key={tower.id} sx={{ p: 1.5 }}>
              <Typography>{tower.tower_id} · {tr('{0} images / field photos', [tower.archive_images])}</Typography>
              <Typography variant="body2" color="text.secondary">{tr('Current assignment: {0}', [tower.assigned_team_name || tr('Outside this team')])}{!tower.is_active && <> · {tr('Inactive tower')}</>}</Typography>
            </Paper>)}</Stack>
          </Box>}
        </Stack>
      </DialogContent>
      {exportError && <Alert severity="error">{tr('Could not download the checklist. Please try again.')}</Alert>}
      <DialogActions sx={{ flexWrap: 'wrap' }}><Typography variant="caption" sx={{ px: 1, flex: 1 }}>{tr('Downloads include the full team checklist, regardless of the current filter.')}</Typography><Button startIcon={<DownloadRounded />} disabled={exporting} onClick={() => selected && void exportExcel(selected.id)}>{tr('Download coloured Excel')}</Button><Button onClick={() => selected && exportCsv([selected])}>{tr('Download CSV')}</Button><Button onClick={() => setSelectedId(null)}>{tr('Close')}</Button></DialogActions>
    </Dialog>
  </Paper>;
}
