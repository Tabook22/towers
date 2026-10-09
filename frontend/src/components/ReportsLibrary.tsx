import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, LinearProgress, MenuItem, Paper, Skeleton, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import SearchRounded from '@mui/icons-material/SearchRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import { useDeleteOetcReport, useOetcReportHistory } from '../api/hooks';
import { apiClient } from '../api/client';
import { getPermissionLevel, type LineInspectionReportOut } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { locale, tr, useLanguage } from '../i18n';
import { deleteSelectedReports, emptyReportFilters, reportError, reportFilterAvailability, reportTimestamp, reportTowers, reportTypes, selectReports, updateReportFilter, type ReportFilters, type ReportSortKey } from '../utils/reportLibrary';
import { ReportReviewDialog, type ReviewTab } from './ReportReviewDialog';

const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const sortOptions = [['created_at:desc', 'Newest first'], ['created_at:asc', 'Oldest first'], ['team_name:asc', 'Team A–Z'], ['tower_name:asc', 'Tower A–Z'], ['start_date:desc', 'Inspection date'], ['report_number:asc', 'Report number']];

export function ReportsLibrary({ customer = false, onCreate }: { customer?: boolean; onCreate?: () => void }) {
  useLanguage();
  const { data: rows = [], isLoading, isError, isFetching, refetch } = useOetcReportHistory({ admin_only: true });
  const { user } = useAuth();
  const remove = useDeleteOetcReport();
  const [filters, setFilters] = useState<ReportFilters>(emptyReportFilters);
  const [moreFilters, setMoreFilters] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [sort, setSort] = useState('created_at:desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [review, setReview] = useState<{ id: number; tab: ReviewTab } | null>(null);
  const [deleting, setDeleting] = useState<LineInspectionReportOut[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const downloadLock = useRef(false);
  const deleteLock = useRef(false);
  const enabled = reportFilterAvailability(filters.type);
  const teams = useMemo(() => Array.from(new Map(rows.map((r) => [r.team_id, { id: r.team_id, name: r.team_name || `Team ${r.team_id}` }])).values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rows]);
  const towers = useMemo(() => Array.from(new Map(rows.flatMap(reportTowers).map((t) => [t.id, t])).values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rows]);
  // Use saved accessible scopes; customer accounts cannot query admin catalogs.
  const lines = useMemo(() => [...new Set(rows.map((r) => r.line_sector).filter((v): v is string => !!v))].sort(), [rows]);
  const lastReply = (r: LineInspectionReportOut) => customer ? !!r.last_comment_role && r.last_comment_role !== 'client' : r.last_comment_role === 'client';
  const followUpCount = rows.filter(lastReply).length;
  const invalidDates = !!(filters.from && filters.to && filters.from > filters.to);
  const [sortKey, sortDirection] = sort.split(':');
  const sorted = invalidDates ? [] : selectReports(rows, filters, sortKey as ReportSortKey, sortDirection as 'asc' | 'desc').filter((r) => !followUp || lastReply(r));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(sorted.length / pageSize) - 1));
  const activeFilters = Object.values(filters).some(Boolean) || followUp;
  const viewing = rows.find((r) => r.id === review?.id);
  const setFilter = (key: keyof ReportFilters, value: string) => { setFilters((old) => updateReportFilter(old, key, value)); setPage(0); setSelected([]); };
  const reset = () => { setFilters(emptyReportFilters); setFollowUp(false); setPage(0); setSelected([]); };
  const canDelete = (r: LineInspectionReportOut) => !customer && (user?.role === 'reviewer' || (user?.role === 'admin' && (user.is_super_admin || getPermissionLevel(user.permissions, 'generate_reports') === 'full')) || (user?.role === 'team_leader' && user.team_id === r.team_id));
  const download = async (r: LineInspectionReportOut) => {
    if (downloadLock.current) return;
    downloadLock.current = true; setDownloadId(r.id); setActionError('');
    try {
      const response = await apiClient.get(`/api/reports/oetc-line-report/${r.id}/${r.has_file ? 'file' : 'redownload'}`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data); const link = document.createElement('a');
      link.href = url; link.download = `${r.report_number.replace(/[^\w.-]/g, '-')}.docx`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setActionError(await reportError(err, tr('Could not download this report. Please try again.'))); }
    finally { setDownloadId(null); downloadLock.current = false; }
  };
  const pageRows = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectable = sorted.filter(canDelete);
  const pageSelectable = pageRows.filter(canDelete);
  const selectedRows = rows.filter(r => selected.includes(r.id) && canDelete(r));
  const showSelection = !customer && rows.some(canDelete);
  const toggle = (id: number, checked: boolean) => setSelected(old => checked ? [...new Set([...old, id])] : old.filter(value => value !== id));
  const selectedOnPage = pageSelectable.filter(r => selected.includes(r.id)).length;
  const selectionBox = (r: LineInspectionReportOut) => <Checkbox size="small" checked={selected.includes(r.id)} disabled={!canDelete(r) || deletingBusy} onChange={(_, checked) => toggle(r.id, checked)} slotProps={{ input: { 'aria-label': tr('Select report {0}', [r.report_number]) } }} />;
  const confirmDelete = async () => {
    if (!deleting.length || deleteLock.current) return;
    deleteLock.current = true; setDeletingBusy(true); setDeleteError('');
    try {
      const result = await deleteSelectedReports(deleting.map(r => r.id), id => remove.mutateAsync(id));
      setSelected(old => old.filter(id => !result.deleted.includes(id)));
      setReview(old => old && result.deleted.includes(old.id) ? null : old);
      setDeleting(deleting.filter(r => result.failed.some(item => item.id === r.id)));
      if (result.deleted.length) setNotice(result.deleted.length === 1 ? tr('Report deleted. Inspection data has been retained.') : tr('{0} reports deleted. Inspection data has been retained.', [result.deleted.length]));
      const errors = await Promise.all(result.failed.map(async item => {
        const report = deleting.find(r => r.id === item.id)!;
        return report.report_number + ': ' + await reportError(item.error, tr('Could not delete this report. Please try again.'));
      }));
      if (errors.length) setDeleteError(errors.join('\n'));
    } finally { deleteLock.current = false; setDeletingBusy(false); }
  };
  const actions = (r: LineInspectionReportOut) => <Stack direction="row" spacing={.5} sx={{ alignItems: 'center' }}>
    <Button component={Link} to={`/reports/${r.id}/digital`} size="small">{tr('Digital report')}</Button>
    <Button variant="outlined" size="small" onClick={() => setReview({ id: r.id, tab: 'overview' })}>{tr('Review')}</Button>
    <Tooltip title={tr('Download Word document')}><span><IconButton aria-label={tr('Download {0}', [r.report_number])} disabled={downloadId !== null} onClick={() => void download(r)}><DownloadRounded fontSize="small" /></IconButton></span></Tooltip>
    {canDelete(r) && <Tooltip title={tr('Delete report')}><IconButton color="error" aria-label={tr('Delete {0}', [r.report_number])} onClick={() => { setDeleting([r]); setDeleteError(''); }}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>}
  </Stack>;
  const discussion = (r: LineInspectionReportOut) => <Button size="small" startIcon={<ChatBubbleOutlineRounded sx={{ fontSize: '16px !important' }} />} onClick={() => setReview({ id: r.id, tab: 'discussion' })} sx={{ textAlign: 'start', minWidth: 0, color: lastReply(r) ? 'primary.main' : 'text.secondary', fontSize: 12 }}>
    {lastReply(r) ? tr(customer ? 'Latest reply: team' : 'Latest reply: customer') : tr('{0} comments', [r.comment_count])}
  </Button>;
  const creatorLabel = (r: LineInspectionReportOut) => <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: .5 }}>{tr('Created by admin: {0}', [r.created_by_name || r.created_by_username || tr('Administrator')])}{r.created_by_username && r.created_by_username !== r.created_by_name ? ` (@${r.created_by_username})` : ''}</Typography>;
  const scope = (r: LineInspectionReportOut) => {
    const names = reportTowers(r).map((t) => t.name);
    return names.length > 3 ? `${names.slice(0, 2).join(', ')} · ${tr('+{0} more towers', [names.length - 2])}` : names.join(', ') || tr('Team campaign');
  };
  return <Stack spacing={2}>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>
      {[[tr('Issued reports'), rows.length], [tr('Archived originals'), rows.filter((r) => r.has_file).length], [tr(customer ? 'Latest team replies' : 'Latest customer replies'), followUpCount], [tr('Matching reports'), sorted.length]].map(([text, value]) => <Paper key={text} variant="outlined" sx={{ p: 2, borderRadius: '16px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {isLoading || isError ? <Skeleton width={35} /> : <Typography sx={{ fontSize: 26, fontWeight: 800, color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>}<Typography variant="body2" color="text.secondary">{text}</Typography>
      </Paper>)}
    </Box>
    <Paper variant="outlined" sx={{ borderRadius: '16px', overflow: 'hidden' }}>
      <Box sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}><Box><Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>{tr('Report library')}</Typography><Typography variant="body2" color="text.secondary">{tr('Only reports created by administrators appear here.')}</Typography></Box><Tooltip title={tr('Refresh report library')}><span><IconButton disabled={isFetching} aria-label={tr('Refresh report library')} onClick={() => void refetch()}><RefreshRounded /></IconButton></span></Tooltip></Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
          <TextField fullWidth label={tr('Search reports')} placeholder={tr('Report number, team, tower or line…')} size="small" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded color="action" /></InputAdornment> } }} />
          <TextField select size="small" label={tr('Sort by')} value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); setSelected([]); }} sx={{ minWidth: 180 }}>{sortOptions.map(([value, text]) => <MenuItem key={value} value={value}>{tr(text)}</MenuItem>)}</TextField>
          <Button startIcon={<TuneRounded />} variant={moreFilters ? 'contained' : 'outlined'} onClick={() => setMoreFilters((old) => !old)} aria-expanded={moreFilters} aria-controls="report-library-filters" sx={{ flexShrink: 0 }}>{tr('Filters')}</Button>
        </Stack>
        <Collapse in={moreFilters}><Box id="report-library-filters" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 2, pt: 2.5 }}>
          <TextField select size="small" label={tr('Report type')} value={filters.type} onChange={(e) => setFilter('type', e.target.value)}><MenuItem value="">{tr('All report types')}</MenuItem>{Object.entries(reportTypes).map(([value, text]) => <MenuItem key={value} value={value}>{tr(text)}</MenuItem>)}</TextField>
          <Autocomplete disabled={!enabled.line} options={lines} value={filters.line || null} onChange={(_, value) => setFilter('line', value || '')} renderInput={(params) => <TextField {...params} size="small" label={tr('Line section')} />} />
          <Autocomplete disabled={!enabled.team} options={teams} getOptionLabel={(t) => t.name} isOptionEqualToValue={(a, b) => a.id === b.id} value={teams.find((t) => String(t.id) === filters.team) || null} onChange={(_, value) => setFilter('team', value ? String(value.id) : '')} renderInput={(params) => <TextField {...params} size="small" label={tr('Team')} />} />
          <Autocomplete disabled={!enabled.tower} options={towers} getOptionLabel={(t) => t.name} isOptionEqualToValue={(a, b) => a.id === b.id} value={towers.find((t) => String(t.id) === filters.tower) || null} onChange={(_, value) => setFilter('tower', value ? String(value.id) : '')} renderInput={(params) => <TextField {...params} size="small" label={tr('Tower')} />} />
          <TextField type="date" size="small" label={tr('Inspection from')} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} error={invalidDates} />
          <TextField type="date" size="small" label={tr('Inspection to')} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} error={invalidDates} helperText={invalidDates ? tr('End date must be on or after start date.') : undefined} />
          <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>{tr('Select a report type to narrow its matching scope filter. Dates match overlapping inspection periods.')}</Typography>
        </Box></Collapse>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 2 }}><Typography variant="caption" color="text.secondary" aria-live="polite">{tr('{0} of {1} reports', [sorted.length, rows.length])}</Typography><Box sx={{ flex: 1 }} /><Chip size="small" variant={followUp ? 'filled' : 'outlined'} color={followUp ? 'primary' : 'default'} label={tr(customer ? 'Latest team replies · {0}' : 'Latest customer replies · {0}', [followUpCount])} onClick={() => { setFollowUp((old) => !old); setPage(0); setSelected([]); }} />{activeFilters && <Button size="small" onClick={reset}>{tr('Clear filters')}</Button>}</Stack>
      </Box>
      {showSelection && <Stack direction="row" useFlexGap sx={{ p: 1.5, px: 2.5, gap: 1, flexWrap: 'wrap', alignItems: 'center', bgcolor: selectedRows.length ? 'action.selected' : 'action.hover', borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }} aria-live="polite">{tr('{0} selected', [selectedRows.length])}</Typography>
        <Button size="small" disabled={deletingBusy || !selectable.length} onClick={() => setSelected(selectable.map(r => r.id))}>{tr('Select all matching reports')}</Button>
        {!!selectedRows.length && <Button size="small" disabled={deletingBusy} onClick={() => setSelected([])}>{tr('Clear selection')}</Button>}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" color="error" size="small" startIcon={<DeleteOutlineRounded />} disabled={deletingBusy || !selectedRows.length} onClick={() => { setDeleting(selectedRows); setDeleteError(''); }}>{tr('Delete selected ({0})', [selectedRows.length])}</Button>
      </Stack>}
      {isFetching && <LinearProgress />}
      {isError && <Alert severity="error" sx={{ m: 2 }} action={<Button onClick={() => void refetch()}>{tr('Retry')}</Button>}>{tr('Could not load the report library.')}</Alert>}
      {actionError && <Alert severity="error" sx={{ m: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>}
      {!isLoading && !isError && !sorted.length && <Stack sx={{ p: 5, alignItems: 'center', textAlign: 'center' }} spacing={1.5}><FolderOpenRounded sx={{ fontSize: 42, color: 'text.disabled' }} /><Typography variant="h6">{tr(rows.length ? 'No reports match your filters.' : 'Your report library is ready.')}</Typography><Typography variant="body2" color="text.secondary">{tr(rows.length ? 'Try another search or clear the filters.' : customer ? 'Issued reports will appear here for review, download and discussion.' : 'Create a report from recorded inspections to prepare your first customer deliverable.')}</Typography>{rows.length ? <Button onClick={reset}>{tr('Clear filters')}</Button> : onCreate && <Button variant="contained" onClick={onCreate}>{tr('Create report')}</Button>}</Stack>}
      <TableContainer sx={{ display: { xs: 'none', md: 'block' } }}><Table sx={{ '& th': { bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 700 }, '& td': { py: 2 } }}>
        <TableHead><TableRow>{showSelection && <TableCell padding="checkbox"><Checkbox checked={pageSelectable.length > 0 && selectedOnPage === pageSelectable.length} indeterminate={selectedOnPage > 0 && selectedOnPage < pageSelectable.length} disabled={!pageSelectable.length || deletingBusy} slotProps={{ input: { 'aria-label': tr('Select reports on this page') } }} onChange={(_, checked) => setSelected(old => checked ? [...new Set([...old, ...pageSelectable.map(r => r.id)])] : old.filter(id => !pageSelectable.some(r => r.id === id)))} /></TableCell>}{['Report & review', 'Inspection scope', 'Inspection period', 'Issued', 'Actions'].map((text) => <TableCell key={text}>{tr(text)}</TableCell>)}</TableRow></TableHead>
        <TableBody>{isLoading ? [1, 2, 3].map((n) => <TableRow key={n}>{[1, 2, 3, 4, 5].map((k) => <TableCell key={k}><Skeleton /></TableCell>)}</TableRow>) : pageRows.map((r) => <TableRow key={r.id} hover selected={selected.includes(r.id)}>
          {showSelection && <TableCell padding="checkbox">{selectionBox(r)}</TableCell>}
          <TableCell sx={{ maxWidth: 240 }}><Button component={Link} to={`/reports/${r.id}/digital`} sx={{ p: 0, textAlign: 'start', overflowWrap: 'anywhere', justifyContent: 'flex-start' }}>{r.report_number}</Button><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{r.team_name || tr('Unassigned')}</Typography>{creatorLabel(r)}{discussion(r)}</TableCell>
          <TableCell sx={{ maxWidth: 260 }}><Chip size="small" variant="outlined" label={tr(reportTypes[r.report_type || ''] || 'Inspection report')} /><Typography variant="body2" sx={{ mt: .75, overflowWrap: 'anywhere' }}>{scope(r)}</Typography>{r.line_sector && <Typography variant="caption" color="text.secondary">{r.line_sector}</Typography>}</TableCell>
          <TableCell><Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{dateLabel(r.start_date)}</Typography>{r.end_date !== r.start_date && <Typography variant="caption" color="text.secondary">{tr('to ')}{dateLabel(r.end_date)}</Typography>}</TableCell>
          <TableCell><Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>{reportTimestamp(r.created_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })}</Typography><Chip size="small" sx={{ mt: .75, height: 22, fontSize: 11 }} variant="outlined" color={r.has_file ? 'success' : 'warning'} label={tr(r.has_file ? 'Archived' : 'Live regeneration')} /></TableCell>
          <TableCell>{actions(r)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></TableContainer>
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>{isLoading ? <Box sx={{ p: 2 }}><Skeleton height={120} /><Skeleton height={120} /></Box> : pageRows.map((r) => <Box key={r.id} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        {showSelection && selectionBox(r)}<Button sx={{ p: 0, overflowWrap: 'anywhere', textAlign: 'start' }} component={Link} to={`/reports/${r.id}/digital`}>{r.report_number}</Button><Typography variant="body2" sx={{ my: .5 }}>{r.team_name} · {scope(r)}</Typography><Typography variant="caption" color="text.secondary">{dateLabel(r.start_date)} — {dateLabel(r.end_date)}</Typography><Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}><Chip size="small" variant="outlined" color={r.has_file ? 'success' : 'warning'} label={tr(r.has_file ? 'Archived' : 'Live regeneration')} />{actions(r)}</Stack>{creatorLabel(r)}{discussion(r)}
      </Box>)}</Box>
      <TablePagination component="div" count={sorted.length} page={currentPage} rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50]} onPageChange={(_, next) => setPage(next)} onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} sx={{ '.MuiTablePagination-toolbar': { px: 1.5, flexWrap: 'wrap' }, '.MuiTablePagination-spacer': { display: { xs: 'none', sm: 'block' } } } } />
    </Paper>
    {viewing && review && <ReportReviewDialog key={viewing.id} report={viewing} initialTab={review.tab} onClose={() => setReview(null)} />}
    <Dialog open={deleting.length > 0} onClose={() => { if (!deletingBusy) setDeleting([]); }} maxWidth="sm" fullWidth aria-labelledby="delete-report-title">
      <DialogTitle id="delete-report-title">{deleting.length === 1 ? tr('Delete this report?') : tr('Delete {0} selected reports?', [deleting.length])}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>{tr('The saved documents and their comments will be permanently removed. Tower inspections and original evidence images will be retained.')}</Alert>
        <Box sx={{ maxHeight: 260, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
          {deleting.map(r => <Box key={r.id} sx={{ p: 1.5, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
            <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{r.report_number}</Typography>
            <Typography variant="caption" color="text.secondary">{r.team_name} · {dateLabel(r.start_date)} — {dateLabel(r.end_date)}</Typography>
          </Box>)}
        </Box>
        {deletingBusy && <LinearProgress sx={{ mt: 2 }} />}
        {deleteError && <Alert severity="error" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>{deleteError}</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button disabled={deletingBusy} onClick={() => setDeleting([])}>{tr('Cancel')}</Button>
        <Button variant="contained" color="error" disabled={deletingBusy} onClick={() => void confirmDelete()}>{deletingBusy ? tr('Deleting…') : deleting.length === 1 ? tr('Delete report') : tr('Delete {0} reports', [deleting.length])}</Button>
      </DialogActions>
    </Dialog>
    <Snackbar open={!!notice} autoHideDuration={5000} onClose={() => setNotice('')} message={notice} />
  </Stack>;
}
