import { useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useOetcReportHistory } from '../api/hooks';
import { locale, tr } from '../i18n';
import { emptyReportFilters, reportTimestamp, reportTowers, selectReports, type ReportSortKey } from '../utils/reportLibrary';

export function CustomerReportPicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const { data: reports = [], isLoading, isError, refetch } = useOetcReportHistory();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('created_at:desc');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [key, direction] = sort.split(':');
  const rows = selectReports(reports, { ...emptyReportFilters, search }, key as ReportSortKey, direction as 'asc' | 'desc').filter(r => !selectedOnly || selected.includes(r.id));
  const validSelected = selected.filter(id => reports.some(r => r.id === id));
  return <Stack spacing={1.5} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography sx={{ fontWeight: 700 }}>{tr('Reports shared with this customer')}</Typography><Chip color="primary" size="small" label={tr('{0} selected', [validSelected.length])} /></Stack>
    <Typography variant="body2" color="text.secondary">{tr('Only checked reports will be visible. New reports stay private until you share them. Uncheck a report to remove access.')}</Typography>
    <TextField size="small" label={tr('Search reports')} value={search} onChange={e => setSearch(e.target.value)} placeholder={tr('Report number, team, tower or line…')} />
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <TextField select size="small" label={tr('Sort by')} value={sort} onChange={e => setSort(e.target.value)} sx={{ minWidth: 170 }}>
        {[['created_at:desc', 'Newest first'], ['created_at:asc', 'Oldest first'], ['report_number:asc', 'Report number'], ['line_sector:asc', 'Line A–Z'], ['team_name:asc', 'Team A–Z']].map(([value, label]) => <MenuItem key={value} value={value}>{tr(label)}</MenuItem>)}
      </TextField>
      <FormControlLabel control={<Checkbox checked={selectedOnly} onChange={e => setSelectedOnly(e.target.checked)} />} label={tr('Show selected only')} />
    </Stack>
    <Stack direction="row" spacing={1}><Button size="small" disabled={isLoading || isError || !rows.length} onClick={() => onChange([...new Set([...validSelected, ...rows.map(r => r.id)])])}>{tr('Select matching reports')}</Button><Button size="small" disabled={!selected.length} onClick={() => onChange([])}>{tr('Clear selection')}</Button></Stack>
    {isLoading ? <Typography variant="body2">{tr('Loading reports…')}</Typography> : isError ? <Alert severity="error" action={<Button onClick={() => void refetch()}>{tr('Retry')}</Button>}>{tr('Could not load reports. Please try again.')}</Alert> : <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
      {!rows.length && <Typography color="text.secondary" sx={{ p: 2 }}>{tr('No matching reports')}</Typography>}
      {rows.map(r => <Box key={r.id} sx={{ display: 'flex', gap: 1, p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: selected.includes(r.id) ? 'action.selected' : undefined, borderRadius: 1 }}>
        <Checkbox checked={selected.includes(r.id)} onChange={(_, checked) => onChange(checked ? [...new Set([...validSelected, r.id])] : validSelected.filter(id => id !== r.id))} slotProps={{ input: { 'aria-label': tr('Select report {0}', [r.report_number]) } }} />
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 650 }}>{r.report_number}</Typography><Typography variant="body2" color="text.secondary">{[r.line_sector, r.team_name].filter(Boolean).join(' · ')} · {tr('Total towers: {0}', [new Set(reportTowers(r).map(t => t.id)).size])}</Typography><Typography variant="caption" color="text.secondary">{reportTimestamp(r.created_at).toLocaleString(locale(), { timeZone: 'Asia/Muscat' })} · {r.created_by_name || r.created_by_username || tr('Not recorded')}</Typography></Box>
        <Button size="small" href={`/reports/${r.id}/digital`} target="_blank" rel="noopener noreferrer">{tr('Preview')}</Button>
      </Box>)}
    </Box>}
    {!selected.length && <Alert severity="info">{tr('No reports selected. This customer will see an empty report library.')}</Alert>}
  </Stack>;
}
