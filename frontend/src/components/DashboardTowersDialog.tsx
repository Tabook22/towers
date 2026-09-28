import { useState } from 'react';
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useDashboardTowerHistory } from '../api/hooks';
import type { DashboardTowerHistory } from '../api/types';
import { filterTowerHistory, visitDateLabel } from '../utils/dashboardTowerHistory';

export function DashboardTowersDialog({ open, area, onClose }: { open: boolean; area?: string; onClose: () => void }) {
  const query = useDashboardTowerHistory(area, open);
  const navigate = useNavigate();
  return <DashboardTowersContent open={open} area={area} onClose={onClose} rows={query.data || []}
    loading={query.isLoading} error={query.isError} onRetry={() => void query.refetch()}
    onOpen={path => { onClose(); navigate(path); }} />;
}

export function DashboardTowersContent({ open, area, onClose, rows, loading, error, onRetry, onOpen }: {
  open: boolean; area?: string; onClose: () => void; rows: DashboardTowerHistory[];
  loading: boolean; error: boolean; onRetry: () => void; onOpen: (path: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('visited');
  const [page, setPage] = useState(0);
  const filtered = filterTowerHistory(rows, scope, search);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const visited = rows.filter(row => row.visits.some(v => v.has_field_activity)).length;
  return <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth aria-labelledby="tower-history-title">
    <DialogTitle id="tower-history-title">Towers &amp; visit history</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        {!loading && !error && <Typography color="text.secondary">{area || 'All areas'} · {rows.length} towers · {visited} visited · {rows.length - visited} without recorded field activity</Typography>}
        <Typography variant="body2" color="text.secondary">Visited means work has started or inspection activity is recorded. Planned missions alone do not count. Dates and teams come from each visit record; missing dates are never guessed.</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Search tower, area, team or inspector" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} fullWidth size="small" />
          <TextField select label="Show towers" value={scope} onChange={e => { setScope(e.target.value); setPage(0); }} size="small" sx={{ minWidth: 240 }}>
            <MenuItem value="visited">Visited towers</MenuItem>
            <MenuItem value="all">All towers</MenuItem>
            <MenuItem value="unvisited">No recorded field activity</MenuItem>
          </TextField>
        </Stack>
        {loading && <LinearProgress aria-label="Loading tower history" />}
        {error && <Alert severity="error" action={<Button onClick={onRetry}>Retry</Button>}>Tower history could not be refreshed. Any displayed records may be out of date.</Alert>}
        {!loading && <>
          <Typography variant="body2">{filtered.length} matching {filtered.length === 1 ? 'tower' : 'towers'}. Each visit appears separately, newest dated visit first within each tower.</Typography>
          <TableContainer sx={{ maxHeight: '55vh' }}>
            <Table size="small" stickyHeader aria-label="Tower visit history" sx={{ minWidth: 980 }}>
              <TableHead><TableRow>{['Tower / area', 'Visiting team / inspector', 'Visit date', 'Field activity', 'Inspection', 'Hotspots', 'Images pending', 'Details'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {filtered.slice(currentPage * 25, (currentPage + 1) * 25).flatMap(row => (row.visits.length ? row.visits : [null]).map((visit, index) => <TableRow key={`${row.tower.id}-${visit?.id || 'none'}`} hover>
                  <TableCell><Button onClick={() => onOpen(`/towers/${row.tower.id}`)} sx={{ p: 0, justifyContent: 'flex-start', fontWeight: 700 }}>{row.tower.tower_id}</Button><Typography variant="caption" sx={{ display: 'block' }}>{row.tower.area || 'Area not recorded'}</Typography>{index === 0 && <Typography variant="caption" color="text.secondary">{row.visits.length} visit record(s)</Typography>}</TableCell>
                  <TableCell>{visit?.team_name || (visit ? 'Team not recorded' : '—')}<Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{visit?.inspector_name || ''}</Typography></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{visit ? visitDateLabel(visit.inspection_date) : '—'}{visit && !visit.has_field_activity && visit.inspection_date && <Typography variant="caption" sx={{ display: 'block' }}>Scheduled date</Typography>}</TableCell>
                  <TableCell><Chip size="small" color={visit?.has_field_activity ? 'success' : 'default'} variant="outlined" label={!visit ? 'No visit record' : visit.has_field_activity ? (visit.mission_status === 'completed' ? 'Completed' : 'Work recorded') : 'Planned only'} /></TableCell>
                  <TableCell>{visit?.has_field_activity ? `${visit.rollup.screened}/${visit.rollup.installed} screened` : '—'}</TableCell>
                  <TableCell>{visit?.has_field_activity ? visit.rollup.hotspots : '—'}</TableCell>
                  <TableCell>{visit?.has_field_activity ? visit.rollup.images_pending : '—'}</TableCell>
                  <TableCell>{visit && <Button size="small" onClick={() => onOpen(`/visits/${visit.id}`)} aria-label={`Open visit ${visit.id} for ${row.tower.tower_id}`}>Open visit</Button>}</TableCell>
                </TableRow>))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={8} align="center">{error ? 'Tower history is unavailable.' : 'No towers match these filters. Try All towers or clear the search.'}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" count={filtered.length} page={currentPage} rowsPerPage={25} rowsPerPageOptions={[25]} onPageChange={(_, next) => setPage(next)} labelRowsPerPage="Towers per page" />
        </>}
      </Stack>
    </DialogContent>
    <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
  </Dialog>;
}
