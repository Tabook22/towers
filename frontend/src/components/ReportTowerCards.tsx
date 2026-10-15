import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, ButtonBase, Chip, Dialog, DialogContent, DialogTitle, IconButton, InputAdornment, Pagination, Paper, Stack, TextField, Typography } from '@mui/material';
import { ArrowForwardRounded, CloseRounded, LocationOnOutlined, MapOutlined, WarningAmberRounded, SearchRounded } from '@mui/icons-material';
import { apiClient } from '../api/client';
import type { InspectionSnapshot, LineInspectionReportOut } from '../api/types';
import { reportTowers } from '../utils/reportLibrary';
import { reportTowerSummary, type TowerMapMetadata } from '../utils/reportTowerCards';
import { formatDate, tr, useLanguage } from '../i18n';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import { MapPicker } from './MapPicker';
import { useAuth } from '../auth/AuthContext';

const count = (value: number | null) => value === null ? '—' : value;
const date = (value: string) => formatDate(`${value}T12:00:00`, { day: 'numeric', month: 'short', year: 'numeric' });

export function ReportTowerCards({ report, snapshot }: { report: LineInspectionReportOut; snapshot: InspectionSnapshot | null | undefined }) {
  useLanguage();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const locations = useQuery({ queryKey: ['report-tower-locations', user?.id, report.id], queryFn: async () => (await apiClient.get<{ towers: TowerMapMetadata[] }>(`/api/reports/oetc-line-report/${report.id}/tower-locations`)).data.towers });
  const towers = useMemo(() => [...new Map(reportTowers(report).map(tower => [tower.id, tower])).values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [report]);
  const matching = towers.filter(tower => tower.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(matching.length / 24));
  const currentPage = Math.min(page, pageCount);
  const visible = matching.slice((currentPage - 1) * 24, currentPage * 24);
  const tower = towers.find(item => item.id === selected);
  const metadata = locations.data?.find(item => item.id === selected);
  const summary = tower ? reportTowerSummary(tower.name, snapshot, metadata) : null;
  return <Paper component="section" variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
    <Box sx={{ p: { xs: 2, sm: 2.5 }, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ p: 1.1, bgcolor: 'background.paper', color: 'primary.main', borderRadius: 2, display: 'flex' }}><TransmissionTowerIcon /></Box>
        <Box sx={{ flex: 1 }}><Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800 }}>{tr('Towers in this report')}</Typography><Typography variant="body2" color="text.secondary">{tr('Select a tower to explore its location and inspection summary.')}</Typography></Box>
        <Chip label={towers.length} aria-label={tr('{0} towers', [towers.length])} sx={{ fontWeight: 800, bgcolor: 'background.paper' }} />
      </Stack>
      <TextField size="small" fullWidth label={tr('Find a tower')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }} />
    </Box>
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, maxHeight: { xs: 440, md: 420 }, overflowY: 'auto', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
      {visible.map(item => {
        const info = reportTowerSummary(item.name, snapshot, locations.data?.find(location => location.id === item.id));
        return <ButtonBase key={item.id} onClick={() => setSelected(item.id)} aria-label={tr('Explore tower {0}', [item.name])} sx={{ border: 1, borderColor: 'divider', borderRadius: 2.5, p: 1.75, textAlign: 'start', justifyContent: 'flex-start', gap: 1.25, bgcolor: 'background.paper', transition: 'border-color .15s, box-shadow .15s', '&:hover': { borderColor: 'primary.main', boxShadow: '0 5px 16px #16485b15', bgcolor: 'action.hover' }, '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
          <Box sx={{ color: 'primary.main', bgcolor: 'action.hover', p: 1, borderRadius: 2, display: 'flex', flexShrink: 0 }}><TransmissionTowerIcon sx={{ fontSize: 29 }} /></Box>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere', mb: .5 }}><bdi>{item.name}</bdi></Typography>
            <Typography variant="caption" color="text.secondary">{info.visits === null ? tr('View tower details') : tr('Visits: {0} · Positions: {1}', [info.visits, info.positions])}</Typography>
            <Stack direction="row" spacing={.5} sx={{ alignItems: 'center', color: info.latitude === null ? 'text.secondary' : 'primary.main', mt: .6 }}><LocationOnOutlined sx={{ fontSize: 14 }} /><Typography variant="caption">{tr(info.latitude === null ? 'Location not recorded' : 'View location')}</Typography></Stack>
          </Box><ArrowForwardRounded sx={{ fontSize: 17, color: 'text.secondary', transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />
        </ButtonBase>;
      })}
      {!matching.length && <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1', p: 2 }}>{tr(towers.length ? 'No towers match your search.' : 'No tower scope recorded for this report.')}</Typography>}
    </Box>
    {matching.length > 24 && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 2, pt: 0, alignItems: 'center', justifyContent: 'space-between' }}><Typography variant="caption" color="text.secondary">{tr('Showing {0}–{1} of {2} towers', [(currentPage - 1) * 24 + 1, Math.min(currentPage * 24, matching.length), matching.length])}</Typography><Pagination size="small" count={pageCount} page={currentPage} onChange={(_, next) => setPage(next)} aria-label={tr('Tower pages')} /></Stack>}
    <Dialog open={!!tower} onClose={() => setSelected(null)} fullWidth maxWidth="md" aria-labelledby="report-tower-title">
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', p: { xs: 2, sm: 3 } }}><Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><Box sx={{ bgcolor: 'action.hover', color: 'primary.main', p: 1.3, borderRadius: 2.5, display: 'flex' }}><TransmissionTowerIcon sx={{ fontSize: 32 }} /></Box><Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="overline" color="text.secondary">{tr('Tower profile')}</Typography><Typography id="report-tower-title" component="h2" variant="h6" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{tower?.name}</Typography></Box><IconButton aria-label={tr('Close tower details')} onClick={() => setSelected(null)}><CloseRounded /></IconButton></Stack></DialogTitle>
      {tower && summary && <DialogContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Box><Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', mb: 1 }}>{(summary.line || report.line_sector) && <Chip size="small" label={summary.line || report.line_sector} variant="outlined" />}{summary.area && <Chip size="small" label={summary.area} variant="outlined" />}{metadata?.voltage && <Chip size="small" label={metadata.voltage} variant="outlined" />}{metadata?.tower_type && <Chip size="small" label={metadata.tower_type} variant="outlined" />}</Stack>
            <Typography variant="body2" color="text.secondary">{tr('This tower is included in report {0}.', [report.report_number])} {summary.firstDate && summary.lastDate && tr('Recorded inspections: {0} to {1}.', [date(summary.firstDate), date(summary.lastDate)])}</Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>{[[summary.visits, 'Inspections'], [summary.positions, 'Recorded positions'], [summary.photographs, 'Photographs']].map(([number, text]) => <Paper key={String(text)} variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, bgcolor: 'action.hover' }}><Typography sx={{ fontSize: 24, fontWeight: 800 }}>{count(number as number | null)}</Typography><Typography variant="caption" color="text.secondary">{tr(String(text))}</Typography></Paper>)}</Box>
          {summary.urgent !== null && summary.urgent > 0 && <Chip icon={<WarningAmberRounded />} label={tr('{0} High / Critical positions recorded', [summary.urgent])} color="warning" variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: .5 } }} />}
          {locations.isError && <Alert severity="warning" action={<Button onClick={() => void locations.refetch()}>{tr('Retry')}</Button>}>{tr('Could not load tower map details.')}</Alert>}
          <Box><Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}><MapOutlined color="primary" /><Typography variant="subtitle2">{tr('Tower location')}</Typography></Stack>
            {summary.latitude !== null && summary.longitude !== null ? <>
              <Box sx={{ borderRadius: 2.5, overflow: 'hidden', border: 1, borderColor: 'divider' }}><MapPicker latitude={summary.latitude} longitude={summary.longitude} readOnly highlight label={tower.name} height={300} /></Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', mt: 1 }}><Typography variant="caption" color="text.secondary">{tr(summary.locationSource === 'catalog' ? 'Current tower catalog location' : 'Recorded inspection GPS location')}</Typography><Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}><bdi>{summary.latitude.toFixed(6)}, {summary.longitude.toFixed(6)}</bdi></Typography></Stack>
              {metadata?.location_name && <Typography variant="body2" sx={{ mt: 1 }}>{metadata.location_name}</Typography>}
            </> : <Box sx={{ py: 5, px: 2, textAlign: 'center', borderRadius: 2.5, border: '1px dashed', borderColor: 'divider', bgcolor: 'action.hover' }}><LocationOnOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} /><Typography variant="subtitle2">{tr(locations.isLoading ? 'Loading tower location…' : 'Location not recorded')}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{tr('The inspection summary is available. A map will appear when coordinates are recorded.')}</Typography></Box>}
          </Box>
          <Typography variant="caption" color="text.secondary">{tr('Inspection counts come from the saved report. Map and catalog details show the current tower record.')}</Typography>
        </Stack>
      </DialogContent>}
    </Dialog>
  </Paper>;
}
