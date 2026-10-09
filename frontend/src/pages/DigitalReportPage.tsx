import { ReportDownloadButton } from '../components/ReportDownloadButton';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Checkbox, Chip, Collapse, InputAdornment, LinearProgress, MenuItem, Paper, Stack, Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import { ArrowBackRounded, DownloadRounded, SearchRounded, TuneRounded, DescriptionRounded, GridViewRounded, ThermostatRounded, TableChartRounded, LocationOnOutlined, FactCheckOutlined, PhotoLibraryOutlined, WarningAmberRounded } from '@mui/icons-material';
import { apiClient, mediaUrl } from '../api/client';
import { useOetcReportHistory } from '../api/hooks';
import type { InspectionSnapshot, ReportValue } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DocxViewerDialog } from '../components/DocxViewerDialog';
import { WordReportReplica } from '../components/WordReportReplica';
import { digitalFindings, filterFields, filterFindings, groupFindings, severityRank, type DigitalFinding } from '../utils/digitalReport';
import { reportError } from '../utils/reportLibrary';
import { formatDate, tr, useLanguage } from '../i18n';

const label = (key: string) => tr(key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
const value = (v: ReportValue | undefined) => v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? tr(v ? 'Yes' : 'No') : String(v);
const columns = ['finding_number', 'tower', 'inspection_date', 'position_code', 'ohl', 'phase', 'string', 'view_side', 'screening_result', 'severity', 'tmax_c', 'tref_c', 'delta_t', 'inspector_notes'];

export function DigitalReportPage() {
  useLanguage();
  const { reportId } = useParams();
  const { user } = useAuth();
  const id = Number(reportId);
  const { data: reports = [], isLoading: loadingReport, isError: reportFailed } = useOetcReportHistory();
  const report = reports.find(row => row.id === id);
  const query = useQuery({
    queryKey: ['digital-report-snapshot', user?.id, id],
    queryFn: async () => (await apiClient.get<{ snapshot: InspectionSnapshot | null }>(`/api/reports/oetc-line-report/${id}/inspection-data`)).data.snapshot,
    enabled: Number.isSafeInteger(id) && id > 0,
  });
  const layoutQuery = useQuery({
    queryKey: ['digital-report-layout', user?.id, id],
    queryFn: async () => (await apiClient.get<{ findings: { key: string | null; number: number; tower: string; text: string; measurement?: Record<string, string> }[] }>(`/api/reports/oetc-line-report/${id}/digital-layout`)).data.findings,
    enabled: Number.isSafeInteger(id) && id > 0,
  });
  const [jumpKey, setJumpKey] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState('finding_number');
  const [descending, setDescending] = useState(false);
  const [group, setGroup] = useState('tower');
  const [view, setView] = useState('report');
  const [page, setPage] = useState(0);
  const [measurementPage, setMeasurementPage] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [wordOpen, setWordOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo<DigitalFinding[]>(() => query.data ? digitalFindings(query.data).map(row => {
    const original = layoutQuery.data?.find(item => item.key === row.key);
    return { ...row, fields: { ...row.fields, ...original?.measurement, finding_number: original?.number ?? null, report_text: original?.text ?? '' } };
  }) : [], [query.data, layoutQuery.data]);
  const matching = useMemo(() => {
    const filtered = filterFindings(rows, search, filters, sort, descending);
    return group === 'severity' ? groupFindings(filtered, group).flatMap(([, findings]) => findings) : filtered;
  }, [rows, search, filters, sort, descending, group]);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const urgentCount = rows.filter(row => severityRank(row.fields.severity) === 0).length;
  const dateLabel = (date: string) => date ? formatDate(date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / pageSize) - 1));
  const visible = matching.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const groups = groupFindings(visible, group);
  const selectedMatching = matching.filter(row => selected.includes(row.key));
  const exportRows = selectedMatching.length ? selectedMatching : matching;
  const openFinding = (key: string) => {
    const index = matching.findIndex(row => row.key === key);
    if (index < 0) return;
    setMeasurementPage(currentPage);
    setView('report');
    setPage(Math.floor(index / pageSize));
    setJumpKey(key);
  };
  const base = `/api/reports/oetc-line-report/${id}`;
  const back = user?.role === 'client' ? '/client-reports' : '/reports';
  const change = () => { setPage(0); setSelected([]); };
  const toggle = (key: string, checked: boolean) => setSelected(old => checked ? [...new Set([...old, key])] : old.filter(item => item !== key));
  const download = async (kind: 'xlsx' | 'docx') => {
    setExporting(true); setError('');
    try {
      const response = await apiClient.post(`${base}/digital-export`, { kind, finding_keys: exportRows.map(row => row.key) }, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `${(report?.report_number || `report-${id}`).replace(/[^\w.-]/g, '-')}-filtered-extract.${kind}`;
      anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(await reportError(err, tr('Could not export this report. Please try again.'))); }
    finally { setExporting(false); }
  };
  if (!Number.isSafeInteger(id) || id <= 0) return <Alert severity="error">{tr('Report not found')}</Alert>;
  if (query.isLoading || layoutQuery.isLoading || loadingReport) return <LinearProgress aria-label={tr('Loading digital report')} />;
  if (query.isError || reportFailed || !report) return <Stack spacing={2}><Button component={Link} to={back}>{tr('Back to reports')}</Button><Alert severity="error">{tr('Could not open this report. Check your access and try again.')}</Alert><Button onClick={() => void query.refetch()}>{tr('Try again')}</Button></Stack>;
  return <Stack spacing={3} sx={{ minWidth: 0, pb: 4, '& .MuiPaper-root': { backgroundImage: 'none' } }}>
    <Button component={Link} to={back} startIcon={<ArrowBackRounded sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />} sx={{ alignSelf: 'flex-start', px: 0 }}>{tr('Back to reports')}</Button>
    <Box component="header" sx={{ position: 'relative', overflow: 'hidden', borderRadius: 4, p: { xs: 3, md: 4 }, color: '#fff', background: 'linear-gradient(120deg, #082a39 0%, #104b60 65%, #176e79 100%)', boxShadow: '0 12px 32px rgba(8,42,57,.16)', '&::after': { content: '\"\"', position: 'absolute', width: 320, height: 320, border: '1px solid rgba(255,255,255,.1)', borderRadius: '50%', top: -160, right: -60, pointerEvents: 'none' } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}><Box sx={{ width: 28, height: 3, bgcolor: '#f0b429', borderRadius: 2 }} /><Typography variant="overline" sx={{ letterSpacing: '.16em', color: '#c2e3e8' }}>{tr('Digital inspection report')}</Typography></Stack>
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.75rem', md: '2.3rem' }, fontWeight: 750, overflowWrap: 'anywhere', mb: 1 }}>{report.report_number}</Typography>
          <Typography sx={{ color: '#d0e5eb', fontSize: '1.05rem' }}>{report.team_name}</Typography>
        </Box>
        <Stack spacing={1.5} sx={{ alignItems: { xs: 'flex-start', md: 'flex-end' }, justifyContent: 'center' }}>
          <ReportDownloadButton report={report} variant="contained" sx={{ bgcolor: '#fff', color: '#0d475c', '&:hover': { bgcolor: '#e4f1f4' } }} />
          <Button size="small" startIcon={<DescriptionRounded />} disabled={!report.has_file} onClick={() => setWordOpen(true)} sx={{ color: '#e0f0f4', '&.Mui-disabled': { color: '#adc1c9' } }}>{tr('View issued Word')}</Button>
        </Stack>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 4 }} sx={{ borderTop: '1px solid rgba(255,255,255,.18)', mt: 3, pt: 2.5 }}>
        <Box><Typography variant="caption" sx={{ color: '#b2cdd7', display: 'block', mb: .5 }}>{tr('Inspection period')}</Typography><Typography variant="body2">{dateLabel(report.start_date)} — {dateLabel(report.end_date)}</Typography></Box>
        <Box><Typography variant="caption" sx={{ color: '#b2cdd7', display: 'block', mb: .5 }}>{tr('Issued')}</Typography><Typography variant="body2">{dateLabel(report.created_at)}</Typography></Box>
      </Stack>
    </Box>
    {layoutQuery.isError && <Alert severity="warning">{tr('Could not load finding navigation. Please refresh the page.')}</Alert>}
    {!query.data ? <Alert severity="warning">{tr('This older report has no saved inspection snapshot. Use the archived Word document; current inspection data will not be substituted.')}</Alert> : <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
        {[
          { title: 'Recorded findings', count: rows.length, icon: <FactCheckOutlined />, color: 'primary.main' },
          { title: 'Towers covered', count: new Set(rows.map(row => row.fields.tower).filter(Boolean)).size, icon: <LocationOnOutlined />, color: 'primary.main' },
          { title: 'High / Critical', count: urgentCount, icon: <WarningAmberRounded />, color: urgentCount ? 'error.main' : 'text.secondary' },
          { title: 'Evidence images', count: rows.reduce((total, row) => total + row.evidence.length, 0), icon: <PhotoLibraryOutlined />, color: 'primary.main' },
        ].map(metric => <Paper key={metric.title} variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}><Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>{metric.count}</Typography><Box sx={{ color: metric.color, display: 'flex' }}>{metric.icon}</Box></Stack><Typography variant="body2" color="text.secondary">{tr(metric.title)}</Typography></Paper>)}
      </Box>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Tabs value={view} onChange={(_, next: string) => { setView(next); setPage(0); if (next === 'measurements') { setSort('severity'); setDescending(false); setGroup('severity'); } }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label={tr('Report sections')} sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="overview" icon={<GridViewRounded fontSize="small" />} iconPosition="start" label={tr('Report overview')} />
          <Tab value="report" icon={<DescriptionRounded fontSize="small" />} iconPosition="start" label={tr('Report view')} />
          <Tab value="measurements" icon={<ThermostatRounded fontSize="small" />} iconPosition="start" label={tr('Thermal Inspection Measurements')} />
          <Tab value="table" icon={<TableChartRounded fontSize="small" />} iconPosition="start" label={tr('Table view')} />
        </Tabs>
        <Stack spacing={2} sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" label={tr('Search within this report')} placeholder={tr('Tower, readings, notes or any keyword')} value={search} onChange={e => { setSearch(e.target.value); change(); }} fullWidth slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }} />
            <Button variant={filtersOpen || activeFilters ? 'contained' : 'outlined'} startIcon={<TuneRounded />} aria-expanded={filtersOpen} aria-controls="digital-report-filters" onClick={() => setFiltersOpen(old => !old)} sx={{ flexShrink: 0 }}>{tr('Filters')}{activeFilters ? ` (${activeFilters})` : ''}</Button>
          </Stack>
          <Collapse in={filtersOpen} id="digital-report-filters">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
            {filterFields.map(field => <TextField key={field} select size="small" label={label(field)} value={filters[field] || ''} onChange={e => { setFilters(old => ({ ...old, [field]: e.target.value })); change(); }}>
              <MenuItem value="">{tr('All')}</MenuItem>
              {[...new Set(rows.map(row => String(row.fields[field] ?? '')).filter(Boolean))].sort((a, b) => field === 'severity' ? severityRank(a) - severityRank(b) : a.localeCompare(b, undefined, { numeric: true })).map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
            </TextField>)}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 2 }}>
            <TextField select size="small" label={tr('Group by')} value={group} onChange={e => { setGroup(e.target.value); setPage(0); }} sx={{ minWidth: 150 }}><MenuItem value="">{tr('No grouping')}</MenuItem>{filterFields.map(field => <MenuItem key={field} value={field}>{label(field)}</MenuItem>)}</TextField>
            <TextField select size="small" label={tr('Sort by')} value={sort} onChange={e => { setSort(e.target.value); setPage(0); }} sx={{ minWidth: 150 }}>{columns.filter(field => field !== 'inspector_notes').map(field => <MenuItem key={field} value={field}>{label(field)}</MenuItem>)}</TextField>
            <Button onClick={() => { setDescending(old => !old); setPage(0); }}>{tr(descending ? 'Descending' : 'Ascending')}</Button>
            <Button onClick={() => { setSearch(''); setFilters({}); change(); }}>{tr('Clear filters')}</Button>
          </Stack>
          </Collapse>
          {(search || activeFilters > 0) && <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>{search && <Chip size="small" label={search} onDelete={() => { setSearch(''); change(); }} />}{Object.entries(filters).filter(([, option]) => option).map(([field, option]) => <Chip key={field} size="small" label={`${label(field)}: ${option}`} onDelete={() => { setFilters(old => ({ ...old, [field]: '' })); change(); }} />)}<Button size="small" onClick={() => { setSearch(''); setFilters({}); change(); }}>{tr('Clear filters')}</Button></Stack>}
        </Stack>
      </Paper>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ mr: 1 }}>{tr('{0} of {1} findings', [matching.length, rows.length])}</Typography>
        <Chip label={tr('{0} towers', [new Set(matching.map(row => row.fields.tower).filter(Boolean)).size])} />
        <Chip label={tr('{0} selected', [selectedMatching.length])} />
        <Button disabled={!matching.length} onClick={() => setSelected(matching.map(row => row.key))}>{tr('Select all matching')}</Button>
        <Button disabled={!selected.length} onClick={() => setSelected([])}>{tr('Clear selection')}</Button>
        <Button size="small" startIcon={<DownloadRounded />} variant="outlined" disabled={exporting || !exportRows.length} onClick={() => void download('xlsx')}>{tr('Export Excel')}</Button>
        <Button size="small" startIcon={<DownloadRounded />} variant="outlined" disabled={exporting || !exportRows.length} onClick={() => void download('docx')}>{tr('Export Word extract')}</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">{tr('Exports include selected findings, or all matching findings when none are selected. Filtered extracts are labelled separately from the issued report.')}</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {exporting && <LinearProgress />}
      {!matching.length && <Alert severity="info">{tr('No findings match your search. Try another keyword or clear the filters.')}</Alert>}
      {view === 'overview' && <Alert severity="info">{tr('The overview shows the complete issued report summary. Choose Report view to browse filtered findings.')}</Alert>}
      {view === 'measurements' && <Stack spacing={1}><Typography variant="h6">{tr('Thermal Inspection Measurements')}</Typography><Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>{['High / Critical', 'Medium', 'Low', 'Normal'].map((severity, rank) => <Chip key={severity} color={rank === 0 ? 'error' : rank === 1 ? 'warning' : rank === 3 ? 'success' : 'default'} variant={filters.severity === severity ? 'filled' : 'outlined'} label={`${tr(severity)}: ${new Set(rows.filter(row => severityRank(row.fields.severity) === rank).map(row => row.fields.tower)).size} ${tr('towers')}`} onClick={() => { setFilters(old => ({ ...old, severity: old.severity === severity ? '' : severity })); change(); }} />)}</Stack></Stack>}
      {view === 'report' && measurementPage !== null && <Button startIcon={<ArrowBackRounded />} sx={{ alignSelf: 'flex-start' }} onClick={() => { setView('measurements'); setPage(measurementPage); setMeasurementPage(null); setJumpKey(''); }}>{tr('Back to thermal measurements')}</Button>}
      {view === 'measurements' && <Typography variant="body2" color="text.secondary">{tr('Click a tower or measurement row to view that insulator finding. Click a photograph to enlarge it.')}</Typography>}
      {view === 'measurements' ? (matching.length > 0 && <WordReportReplica reportId={id} section="measurements" onOpenFinding={openFinding} groups={groups.map(([name, findings]) => ({ name: group ? `${label(group)}: ${name || '—'}` : '', keys: findings.map(row => row.key) }))} selected={selected} onSelect={toggle} />) : view === 'overview' ? <WordReportReplica reportId={id} section="overview" groups={[]} selected={selected} onSelect={toggle} /> : view === 'report' ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '240px minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
        <Paper component="nav" aria-label={tr('Finding navigation')} variant="outlined" sx={{ p: 1.5, borderRadius: 3, position: { lg: 'sticky' }, top: 80, maxHeight: { xs: 240, lg: '70vh' }, overflowY: 'auto' }}>
          <Typography variant="subtitle2" sx={{ p: 1 }}>{tr('Jump to finding')}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pb: 1.5 }}>{tr('Browse inspection evidence')}</Typography>
          {matching.map((row, index) => <Button key={row.key} fullWidth size="small" aria-current={jumpKey === row.key ? 'location' : undefined} sx={{ justifyContent: 'flex-start', textAlign: 'start', my: .5, py: 1, bgcolor: jumpKey === row.key ? 'action.selected' : undefined, border: 1, borderColor: jumpKey === row.key ? 'primary.main' : 'transparent' }} onClick={() => { setPage(Math.floor(index / pageSize)); setJumpKey(row.key); }}>
            <Stack sx={{ width: '100%' }}><Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}><Typography variant="body2" sx={{ fontWeight: 650 }}>{value(row.fields.tower)}</Typography><Typography variant="caption" color="text.secondary">{tr('No. {0}', [row.fields.finding_number || index + 1])}</Typography></Stack><Typography variant="caption" color="text.secondary">{tr('Phase')}: {value(row.fields.phase)} · {value(row.fields.severity)}</Typography></Stack>
          </Button>)}
        </Paper>
        {matching.length > 0 ? (report.has_file ? <WordReportReplica reportId={id} groups={groups.map(([name, findings]) => ({ name: group ? `${label(group)}: ${name || '—'}` : '', keys: findings.map(row => row.key) }))} selected={selected} onSelect={toggle} jumpKey={jumpKey} /> : <Alert severity="warning">{tr('The archived Word document is unavailable. The saved data is available in Table view.')}</Alert>) : null}
      </Box> : groups.map(([name, findings]) => <Stack key={name} spacing={1}>
        {group && <Typography variant="h6">{label(group)}: {name || '—'}</Typography>}
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}><Table size="small" aria-label={tr('Recorded findings')}><TableHead><TableRow><TableCell>{tr('Select')}</TableCell>{columns.map(field => <TableCell key={field}>{label(field)}</TableCell>)}</TableRow></TableHead><TableBody>{findings.map(row => <TableRow key={row.key} hover selected={selected.includes(row.key)}><TableCell><Checkbox checked={selected.includes(row.key)} onChange={(_, checked) => toggle(row.key, checked)} slotProps={{ input: { 'aria-label': `${tr('Select finding')} ${row.key}` } }} /></TableCell>{columns.map(field => <TableCell key={field} sx={{ whiteSpace: field === 'inspector_notes' ? 'pre-wrap' : 'nowrap' }}>{value(row.fields[field])}</TableCell>)}</TableRow>)}</TableBody></Table></TableContainer>
      </Stack>)}
      {view !== 'overview' && <TablePagination component="div" count={matching.length} page={currentPage} rowsPerPage={pageSize} rowsPerPageOptions={[5, 10, 20, 50]} onPageChange={(_, next) => setPage(next)} onRowsPerPageChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} />}
      {view === 'table' && Object.keys(query.data.assessment).length > 0 && <Paper sx={{ p: 3 }}><Typography variant="h6" gutterBottom>{tr('Assessment at issue time')}</Typography>{Object.entries(query.data.assessment).filter(([, v]) => v !== null && v !== '').map(([field, v]) => <Box key={field} sx={{ mb: 1 }}><Typography variant="caption" color="text.secondary">{label(field)}</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{value(v)}</Typography></Box>)}</Paper>}
    </>}
    <DocxViewerDialog open={wordOpen} onClose={() => setWordOpen(false)} title={report.report_number} fileUrl={mediaUrl(`${base}/file`)} />
  </Stack>;
}

