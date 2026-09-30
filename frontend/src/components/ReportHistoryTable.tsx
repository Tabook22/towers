import { tr, useLanguage, locale } from '../i18n';
import { useMemo, useState } from 'react';
import { Alert, Autocomplete, Badge, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, LinearProgress, MenuItem, Paper, Skeleton, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TableSortLabel, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import { Link } from 'react-router-dom';
import { useAreas, useDeleteOetcReport, useOetcReportHistory } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { apiClient, mediaUrl } from '../api/client';
import { getPermissionLevel, type LineInspectionReportOut } from '../api/types';
import { emptyReportFilters, reportError, reportFilterAvailability, reportTimestamp, reportTowers, reportTypes, selectReports, updateReportFilter, type ReportFilters, type ReportSortKey } from '../utils/reportLibrary';
import { DocxViewerDialog } from './DocxViewerDialog';
import { ReportCommentsSection } from './ReportCommentsSection';

const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const sortOptions = [ ['created_at:desc', 'Newest first'], ['created_at:asc', 'Oldest first'], ['team_name:asc', 'Team A–Z'], ['tower_name:asc', 'Tower A–Z'], ['start_date:desc', 'Inspection date'], ['report_number:asc', 'Report number'] ];

export function ReportHistoryTable() {
  useLanguage();
  const { data: rows = [], isLoading, isError, isFetching, refetch } = useOetcReportHistory();
  const { data: areas } = useAreas();
  const { user } = useAuth();
  const remove = useDeleteOetcReport();
  const [filters, setFilters] = useState<ReportFilters>(emptyReportFilters);
  const enabled = reportFilterAvailability(filters.type);
  const lines = useMemo(() => Array.from(new Set([
    ...(areas || ['Ashoor-Saada', 'Ittin-Thumrait', 'Saada-Shahaon']),
    ...rows.filter(r => r.report_type === 'area').map(r => r.line_sector).filter((line): line is string => !!line),
  ])).sort((a, b) => a.localeCompare(b)), [areas, rows]);
  const [sortKey, setSortKey] = useState<ReportSortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [viewing, setViewing] = useState<LineInspectionReportOut | null>(null);
  const [deleting, setDeleting] = useState<LineInspectionReportOut | null>(null);
  const [commentingId, setCommentingId] = useState<number | null>(null);
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const commenting = rows.find((r) => r.id === commentingId);
  const canDelete = (r: LineInspectionReportOut) => user?.role === 'reviewer'
    || (user?.role === 'admin' && (user.is_super_admin || getPermissionLevel(user.permissions, 'generate_reports') === 'full'))
    || (user?.role === 'team_leader' && user.team_id === r.team_id);
  const teams = useMemo(() => Array.from(new Map(rows.map((r) => [r.team_id, { id: r.team_id, name: r.team_name || `Team ${r.team_id}` }])).values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rows]);
  const towers = useMemo(() => Array.from(new Map(rows.flatMap(reportTowers).map((t) => [t.id, t])).values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rows]);
  const invalidDates = !!(filters.from && filters.to && filters.from > filters.to);
  const sorted = useMemo(() => invalidDates ? [] : selectReports(rows, filters, sortKey, sortDir), [rows, filters, sortKey, sortDir, invalidDates]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(sorted.length / pageSize) - 1));
  const activeFilters = Object.values(filters).some(Boolean);
  const setFilter = (key: keyof ReportFilters, value: string) => { setFilters((old) => updateReportFilter(old, key, value)); setPage(0); };
  const clearFilters = () => { setFilters(emptyReportFilters); setPage(0); };
  const filePath = (r: LineInspectionReportOut) => `/api/reports/oetc-line-report/${r.id}/${r.has_file ? 'file' : 'redownload'}`;
  const download = async (r: LineInspectionReportOut) => {
    setDownloadId(r.id); setActionError(null);
    try {
      const response = await apiClient.get(filePath(r), { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = `${r.report_number.replace(/[^\w.-]/g, '-')}.docx`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setActionError(await reportError(error, tr("Could not download this report. Please try again."))); }
    finally { setDownloadId(null); }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null); setNotice('Report deleted. Inspection data has been retained.');
    } catch (error) { setDeleteError(await reportError(error, tr("Could not delete this report. Please try again."))); }
  };
  const sort = (key: ReportSortKey) => {
    setSortKey(key); setSortDir(sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : key === 'created_at' ? 'desc' : 'asc'); setPage(0);
  };
  const sortHeading = (label: string, key: ReportSortKey) => (
    <TableCell sortDirection={sortKey === key ? sortDir : false}>
      <TableSortLabel active={sortKey === key} direction={sortKey === key ? sortDir : 'asc'} onClick={() => sort(key)}>{tr(label)}</TableSortLabel>
    </TableCell>
  );
  const actions = (r: LineInspectionReportOut) => <>
    <Tooltip title={tr("Review report images")}><IconButton component={Link} to={`/archive?report=${r.id}`} aria-label={tr("Images for {0}", [r.report_number])}><PhotoLibraryRoundedIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title={tr("View document")}><IconButton aria-label={tr("View {0}", [r.report_number])} onClick={() => setViewing(r)}><VisibilityRoundedIcon fontSize="small" /></IconButton></Tooltip>
    <Tooltip title={tr("Download Word document")}><span><IconButton aria-label={tr("Download {0}", [r.report_number])} onClick={() => void download(r)} disabled={downloadId !== null}><DownloadRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
    <Tooltip title={tr("Comments")}><IconButton aria-label={tr("Comments for {0}", [r.report_number])} onClick={() => setCommentingId(r.id)}><Badge badgeContent={r.comment_count} color="primary"><ChatBubbleOutlineRoundedIcon fontSize="small" /></Badge></IconButton></Tooltip>
    {canDelete(r) && <Tooltip title={tr("Delete report")}><IconButton color="error" aria-label={tr("Delete {0}", [r.report_number])} onClick={() => { setDeleting(r); setDeleteError(null); }}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>}
  </>;
  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        {[
          { label: tr("Reports in library"), value: rows.length, note: 'Official inspection documents' },
          { label: tr("Archived originals"), value: rows.filter((r) => r.has_file).length, note: 'Saved at generation time' },
          { label: tr("Teams represented"), value: teams.length, note: 'Across your accessible reports' },
          { label: tr("Matching reports"), value: sorted.length, note: activeFilters ? 'With your current filters' : 'Ready to browse' },
        ].map((stat) => (
          <Paper variant="outlined" key={stat.label} sx={{ p: { xs: 2, md: 2.5 }, borderRadius: '16px' }}>
            <Typography variant="body2" color="text.secondary">{tr(stat.label)}</Typography>
            {isLoading || isError ? <Skeleton width={65} height={48} /> : <Typography variant="h4" sx={{ my: 0.5, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</Typography>}
            <Typography variant="caption" color="text.secondary">{tr(stat.note)}</Typography>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined" sx={{ borderRadius: '16px', overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
            <Box><Typography variant="h6">{tr("Report library")}</Typography><Typography variant="body2" color="text.secondary">{tr("Find the inspection. Open the evidence. Share the report.")}</Typography></Box>
            <Tooltip title={tr("Refresh library")}><span><IconButton aria-label={tr("Refresh report library")} onClick={() => void refetch()} disabled={isFetching}><RefreshRoundedIcon /></IconButton></span></Tooltip>
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
            <TextField select label={tr("Report type")} size="small" value={filters.type} onChange={(e) => setFilter('type', e.target.value)}><MenuItem value="">{tr("All report types")}</MenuItem>{Object.entries(reportTypes).map(([key, name]) => <MenuItem key={key} value={key}>{tr(name)}</MenuItem>)}</TextField>
            <Autocomplete disabled={!enabled.line} options={lines} value={filters.line || null} onChange={(_, line) => setFilter('line', line || '')} renderInput={(params) => <TextField {...params} label={tr("Line section")} placeholder={tr("All lines")} size="small" />} />
            <Autocomplete disabled={!enabled.team} options={teams} getOptionLabel={(t) => t.name} isOptionEqualToValue={(a, b) => a.id === b.id} value={teams.find((t) => String(t.id) === filters.team) || null} onChange={(_, t) => setFilter('team', t ? String(t.id) : '')} renderInput={(params) => <TextField {...params} label={tr("Team")} placeholder={tr("All teams")} size="small" />} />
            <Autocomplete disabled={!enabled.tower} options={towers} getOptionLabel={(t) => t.name} isOptionEqualToValue={(a, b) => a.id === b.id} value={towers.find((t) => String(t.id) === filters.tower) || null} onChange={(_, t) => setFilter('tower', t ? String(t.id) : '')} renderInput={(params) => <TextField {...params} label={tr("Tower")} placeholder={tr("All towers")} size="small" />} />
            <Box sx={{ gridColumn: { xs: 'auto', sm: '1 / -1', lg: 'span 2' }, '& .MuiTextField-root': { width: '100%' } }}>
              <TextField label={tr("Search reports")} placeholder={tr("Report number, team, tower or line…")} size="small" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> } }} />
            </Box>
            <TextField type="date" label={tr("Inspection from")} size="small" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} error={invalidDates} />
            <TextField type="date" label={tr("Inspection to")} size="small" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} error={invalidDates} helperText={invalidDates ? tr("End date must be on or after start date.") : undefined} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }} aria-live="polite">
            {filters.type === 'area' ? tr("Line section selected: choose a line. Team and Tower filters are disabled.") : filters.type === 'team' ? tr("Team report selected: choose a team. Line section and Tower filters are disabled.") : filters.type === 'tower' ? tr("Tower report selected: choose a tower. Line section and Team filters are disabled.") : filters.type === 'consolidated' ? tr("Project sections cover the project. Line section, Team and Tower filters are disabled.") : tr("Choose a report type to enable its matching filter, or browse all report types.")}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary" aria-live="polite">{isLoading ? tr("Loading your reports…") : tr("{0} of {1} reports", [sorted.length, rows.length])}{tr(" · Dates filter inspection coverage")}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {activeFilters && <Button size="small" onClick={clearFilters}>{tr("Clear filters")}</Button>}
              <TextField select size="small" label={tr("Sort by")} value={`${sortKey}:${sortDir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSortKey(key as ReportSortKey); setSortDir(dir as 'asc' | 'desc'); setPage(0); }} sx={{ minWidth: 165 }}>
                {sortOptions.map(([value, label]) => <MenuItem key={value} value={value}>{tr(label)}</MenuItem>)}
                {!sortOptions.some(([value]) => value === `${sortKey}:${sortDir}`) && <MenuItem value={`${sortKey}:${sortDir}`}>{tr("Column ")}{sortDir === 'asc' ? tr("ascending") : tr("descending")}</MenuItem>}
              </TextField>
            </Stack>
          </Stack>
        </Box>
        {isFetching && <LinearProgress aria-label={tr("Loading report library")} />}
        {isError && <Alert severity="error" sx={{ mx: 3, mb: 2 }} action={<Button color="inherit" onClick={() => void refetch()}>{tr("Retry")}</Button>}>{tr("The report library could not be loaded. Please try again.")}</Alert>}
        {actionError && <Alert severity="error" sx={{ mx: 3, mb: 2 }} onClose={() => setActionError(null)}>{tr(actionError)}</Alert>}
        {!isLoading && !isError && sorted.length === 0 ? (
          <Box sx={{ textAlign: 'center', px: 3, py: 7 }}>
            <FolderOpenRoundedIcon sx={{ fontSize: 54, color: 'primary.main', mb: 1.5 }} />
            <Typography variant="h6">{rows.length ? tr("No reports match your filters") : tr("Your report library starts here")}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{rows.length ? tr("Try a different line, team, tower or inspection period.") : tr("Generate an official report to save a copy here for future viewing and downloads.")}</Typography>
            {activeFilters && <Button onClick={clearFilters} sx={{ mt: 2 }}>{tr("Clear all filters")}</Button>}
          </Box>
        ) : (
          <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}>
            <Table aria-label={tr("Saved inspection reports")} sx={{ minWidth: 900 }}>
              <TableHead><TableRow>{sortHeading('Report', 'report_number')}{sortHeading('Team', 'team_name')}{sortHeading('Towers / scope', 'tower_name')}{sortHeading('Inspection period', 'start_date')}{sortHeading('Created', 'created_at')}<TableCell align="right">{tr("Actions")}</TableCell></TableRow></TableHead>
              <TableBody>
                {isLoading ? Array.from({ length: 4 }, (_, i) => <TableRow key={i}>{Array.from({ length: 6 }, (_, j) => <TableCell key={j}><Skeleton /></TableCell>)}</TableRow>) : sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Box sx={{ p: 1, display: 'flex', borderRadius: 2, color: 'primary.main', bgcolor: (theme) => alpha(theme.palette.primary.main, 0.09) }}><DescriptionRoundedIcon /></Box>
                        <Box sx={{ minWidth: 0 }}><Button onClick={() => setViewing(r)} sx={{ p: 0, textAlign: 'left', justifyContent: 'flex-start', overflowWrap: 'anywhere' }}>{r.report_number}</Button><Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{reportTypes[r.report_type || ''] || tr("Inspection report")}</Typography></Box>
                      </Stack>
                    </TableCell>
                    <TableCell>{r.team_name || tr("Unassigned")}</TableCell>
                    <TableCell sx={{ maxWidth: 220 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{reportTowers(r).map((t) => t.name).join(', ') || tr("Team campaign")}</Typography><Typography variant="caption" color="text.secondary">{r.line_sector || (r.report_type === 'area' || r.report_type === 'consolidated' ? tr("Individual team section") : '')}</Typography></TableCell>
                    <TableCell><Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{dateLabel(r.start_date)}</Typography>{r.end_date !== r.start_date && <Typography variant="caption" color="text.secondary">{tr("to ")}{dateLabel(r.end_date)}</Typography>}</TableCell>
                    <TableCell><Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{reportTimestamp(r.created_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}</Typography><Tooltip title={r.has_file ? tr("The original document saved when this report was generated.") : tr("No archived original. Viewing or downloading regenerates this report from current inspection data.")}><Chip size="small" variant="outlined" label={r.has_file ? tr("Archived") : tr("Live regeneration")} color={r.has_file ? 'success' : 'warning'} sx={{ mt: 0.5, height: 22, fontSize: 11 }} /></Tooltip></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {actions(r)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          {isLoading ? <Box sx={{ p: 2 }}><Skeleton height={120} /><Skeleton height={120} /></Box> : sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((r) => (
            <Box key={r.id} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}><DescriptionRoundedIcon color="primary" /><Button onClick={() => setViewing(r)} sx={{ px: 0, overflowWrap: 'anywhere', textAlign: 'left' }}>{r.report_number}</Button></Stack>
              <Typography variant="body2">{r.team_name || tr("Unassigned")} · {reportTowers(r).map((t) => t.name).join(', ') || tr("Team campaign")}</Typography>
              <Typography variant="caption" color="text.secondary">{dateLabel(r.start_date)}{r.start_date !== r.end_date ? ` – ${dateLabel(r.end_date)}` : ''} · {reportTypes[r.report_type || ''] || tr("Inspection report")}</Typography>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 1 }}><Chip size="small" variant="outlined" label={r.has_file ? tr("Archived") : tr("Live regeneration")} color={r.has_file ? 'success' : 'warning'} /><Box>{actions(r)}</Box></Stack>
            </Box>
          ))}
        </Box>
        <TablePagination component="div" count={sorted.length} page={currentPage} rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50]} onPageChange={(_, next) => setPage(next)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} sx={{ '.MuiTablePagination-toolbar': { px: { xs: 1, sm: 2 }, flexWrap: 'wrap' }, '.MuiTablePagination-spacer': { display: { xs: 'none', sm: 'block' } } }} />
      </Paper>
      {viewing && <DocxViewerDialog open onClose={() => setViewing(null)} title={viewing.report_number} fileUrl={mediaUrl(filePath(viewing))} notice={!viewing.has_file ? 'This is a regenerated copy using current inspection data. An archived original is not available.' : undefined} />}
      <Dialog open={!!deleting} onClose={() => { if (!remove.isPending) setDeleting(null); }} maxWidth="xs" fullWidth aria-labelledby="delete-report-title">
        <DialogTitle id="delete-report-title">{tr("Delete this report?")}</DialogTitle>
        <DialogContent><Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere', mb: 1 }}>{deleting?.report_number}</Typography><Typography color="text.secondary">{tr("The saved document and its comments will be permanently removed. Tower inspections and original evidence images will be retained.")}</Typography>{deleteError && <Alert severity="error" sx={{ mt: 2 }}>{tr(deleteError)}</Alert>}</DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDeleting(null)} disabled={remove.isPending}>{tr("Cancel")}</Button><Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={remove.isPending}>{remove.isPending ? tr("Deleting…") : tr("Delete report")}</Button></DialogActions>
      </Dialog>
      <Dialog open={!!commenting} onClose={() => setCommentingId(null)} maxWidth="sm" fullWidth aria-labelledby="report-comments-title"><DialogTitle id="report-comments-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>{tr("Report comments")}<IconButton aria-label={tr("Close comments")} onClick={() => setCommentingId(null)}><CloseRoundedIcon /></IconButton></DialogTitle><DialogContent dividers>{commenting && <><Typography variant="subtitle2" sx={{ mb: 2 }}>{commenting.report_number}</Typography><ReportCommentsSection reportId={commenting.id} /></>}</DialogContent></Dialog>
      <Snackbar open={!!notice} autoHideDuration={5000} onClose={() => setNotice('')} message={notice} />
    </Stack>
  );
}
