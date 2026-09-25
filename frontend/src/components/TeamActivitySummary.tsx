import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import CellTowerRounded from '@mui/icons-material/CellTowerRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import RouteRounded from '@mui/icons-material/RouteRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import DescriptionRounded from '@mui/icons-material/DescriptionRounded';
import { apiClient, mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DocxViewerDialog } from './DocxViewerDialog';
import { ActivityOverviewCharts, TeamProgressCharts } from './TeamProgressCharts';
import { categoryTowers, teamFieldStats } from '../utils/teamActivityCharts';
import type { CountKey, Counts, ActivityReport as Report, ActivityTower as Tower, TeamActivity as Activity } from '../api/teamActivityTypes';

const labels: Record<CountKey, string> = { planned: 'Mission towers', visited: 'Visited', recorded: 'Recorded', finished: 'Finished', reported: 'In reports' };
const definitions: Record<CountKey, string> = {
  planned: 'Towers selected in a saved daily mission plan.',
  visited: 'An on-site or done check-in, an in-progress or completed inspection, or saved photos / screening results. Planned records alone do not count.',
  recorded: 'Towers with a saved inspection record, including records still planned or in draft.',
  finished: 'Towers marked done in the field, with a completed mission, or with a closed inspection record. This does not mean the report is approved.',
  reported: 'Distinct towers captured in saved official reports. Multiple reports for one tower count once. Old reports may not identify an exact day.',
};
const keys = Object.keys(labels) as CountKey[];
function initialDates() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { start: `${today.slice(0, 7)}-01`, end: today };
}
function dateLabel(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
const reportUrl = (r: Report) => mediaUrl(`/api/reports/oetc-line-report/${r.id}/${r.has_file ? 'file' : 'redownload'}`);

export function TeamActivitySummary() {
  const { user } = useAuth();
  const canReadReports = user?.role !== 'team_member';
  const [dates, setDates] = useState(initialDates);
  const [teamId, setTeamId] = useState('');
  const [sort, setSort] = useState('newest');
  const [detail, setDetail] = useState<{ title: string; towers: Tower[]; reportsOnly?: boolean } | null>(null);
  const [viewReport, setViewReport] = useState<Report | null>(null);
  const valid = Boolean(dates.start && dates.end && dates.start <= dates.end && (Date.parse(dates.end) - Date.parse(dates.start)) / 86400000 <= 366);
  const query = useQuery({
    queryKey: ['team-activity-summary', user?.id, dates.start, dates.end],
    queryFn: async ({ signal }) => (await apiClient.get<Activity>('/api/team-activity', { params: { start_date: dates.start, end_date: dates.end }, signal })).data,
    enabled: valid,
    refetchInterval: 60000,
  });
  const teams = (query.data?.teams || []).filter(t => !teamId || t.id === Number(teamId));
  const totals = Object.fromEntries(keys.map(k => [k, teams.reduce((sum, t) => sum + t.counts[k], 0)])) as Counts;
  const icons = [<RouteRounded key="planned" />, <CellTowerRounded key="visited" />, <DescriptionRounded key="recorded" />, <TaskAltRounded key="finished" />, <DescriptionRounded key="reported" />];

  return <Stack spacing={2}>
    <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3 }}>
      <Box sx={{ p: { xs: 2, md: 3 }, background: 'linear-gradient(115deg, #103e50, #176275)', color: 'white' }}>
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}><GroupsRounded /><Typography variant="overline" sx={{ letterSpacing: 2, color: '#c7e9ee' }}>FIELD PERFORMANCE</Typography></Stack>
        <Typography variant="h5" sx={{ fontWeight: 800, mt: 1 }}>From mission to report</Typography>
        <Typography sx={{ mt: 1, maxWidth: 760, color: '#d0e6eb' }}>See what each crew planned, visited and recorded — and which towers reached a saved customer report.</Typography>
      </Box>
      <Stack direction="row" spacing={2} useFlexGap sx={{ p: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField label="From date" type="date" value={dates.start} onChange={e => setDates({ ...dates, start: e.target.value })} size="small" slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="To date" type="date" value={dates.end} onChange={e => setDates({ ...dates, end: e.target.value })} size="small" slotProps={{ inputLabel: { shrink: true } }} />
        <TextField select label="Team" value={teamId} onChange={e => setTeamId(e.target.value)} size="small" sx={{ minWidth: 190 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
          <MenuItem value="">All accessible teams</MenuItem>{query.data?.teams.map(t => <MenuItem key={t.id} value={String(t.id)}>{t.name}{t.is_active ? '' : ' (archived)'}</MenuItem>)}
        </TextField>
        <TextField select label="Daily order" value={sort} onChange={e => setSort(e.target.value)} size="small" sx={{ minWidth: 160 }}>
          <MenuItem value="newest">Newest first</MenuItem><MenuItem value="oldest">Oldest first</MenuItem><MenuItem value="visited">Most visited</MenuItem><MenuItem value="reported">Most reported</MenuItem>
        </TextField>
        <Button onClick={() => setDates(initialDates())}>This month</Button>
        <Button startIcon={<RefreshRounded />} disabled={!valid || query.isFetching} onClick={() => void query.refetch()}>Refresh</Button>
      </Stack>
      {query.isFetching && <LinearProgress aria-label="Loading team activity" />}
    </Paper>
    {!valid && <Alert severity="warning">Choose a start and end date, in order, spanning no more than one year.</Alert>}
    {query.isError && <Alert severity="error" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>Team activity could not be loaded. Please try again.</Alert>}
    {valid && query.data && <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1.5 }}>
        {keys.map((key, i) => <Tooltip key={key} describeChild title={definitions[key]}><Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: key === 'reported' ? '#edf7f1' : 'background.paper' }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', color: key === 'reported' ? '#21714c' : '#286779' }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{labels[key]}</Typography>{icons[i]}</Stack>
          <Typography variant="h4" sx={{ mt: 1, fontWeight: 800 }}>{totals[key]}</Typography>
        </Paper></Tooltip>)}
      </Box>
      <Typography variant="caption" color="text.secondary">Totals count each tower once per team in this date range. Daily rows count it once each day, so repeat visits can make daily sums higher. Report dates refer to the inspection period, not the document creation date.</Typography>
      {teams.length > 0 && <ActivityOverviewCharts teams={teams} start={query.data.start_date} end={query.data.end_date} selectTeam={id => setTeamId(String(id))} />}
      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px !important', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography variant="body2" sx={{ fontWeight: 600 }}>How these numbers are counted</Typography></AccordionSummary>
        <AccordionDetails><Stack spacing={1}>{keys.map(k => <Typography key={k} variant="body2"><b>{labels[k]}:</b> {definitions[k]}</Typography>)}<Typography variant="body2">Mission plans and field check-ins use their saved field date; inspection records use their entered inspection date. Missing plans are shown explicitly. An empty checklist is not proof of a visit.</Typography></Stack></AccordionDetails>
      </Accordion>
      {teams.length === 0 && <Alert severity="info">No accessible teams match this selection.</Alert>}
      {teams.map(team => {
        const days = [...team.days].sort((a, b) => sort === 'oldest' ? a.date.localeCompare(b.date) : sort === 'visited' || sort === 'reported' ? b.counts[sort] - a.counts[sort] || b.date.localeCompare(a.date) : b.date.localeCompare(a.date));
        return <Paper key={team.id} variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2.5, bgcolor: '#f6f9fa', justifyContent: 'space-between' }}>
            <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>{team.name} {!team.is_active && <Chip size="small" label="Archived" />}</Typography>
              <Typography variant="body2" color="text.secondary">{team.mission_count} daily missions · {teamFieldStats(team).visitDays} visit days · {team.counts.visited} towers visited · {team.counts.finished} finished</Typography>
            </Box>
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" startIcon={<DescriptionRounded />} onClick={() => setDetail({ title: `${team.name} · Towers in saved reports`, towers: team.report_towers, reportsOnly: true })}>{team.counts.reported} towers in {team.reports.length} reports</Button>
              <Button component={Link} to={`/teams/${team.id}#mission-plan`}>Open missions</Button>
            </Stack>
          </Stack>
          <TeamProgressCharts team={team} onCategory={key => setDetail({ title: `${team.name} · ${labels[key]}`, towers: categoryTowers(team, key), reportsOnly: key === 'reported' })} />
          {(team.undated_report_towers > 0 || team.unknown_scope_reports > 0) && <Alert severity="info" sx={{ m: 2 }}>
            {team.undated_report_towers > 0 && `${team.undated_report_towers} reported towers have no exact day saved. They are included in the team report total, but not assigned to a daily row. `}
            {team.unknown_scope_reports > 0 && `${team.unknown_scope_reports} older reports have no traceable tower list and are excluded from tower counts.`}
          </Alert>}
          <TableContainer><Table size="small" aria-label={`${team.name} daily tower activity`}>
            <TableHead><TableRow><TableCell>Day / mission</TableCell>{keys.map(k => <TableCell key={k} align="center"><Tooltip describeChild title={definitions[k]}><span>{labels[k]}</span></Tooltip></TableCell>)}<TableCell /></TableRow></TableHead>
            <TableBody>{days.map(day => <TableRow key={day.date} hover>
              <TableCell sx={{ minWidth: 185, py: 1.5 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{dateLabel(day.date)}</Typography><Typography variant="caption" color={day.has_mission ? 'text.secondary' : 'warning.main'}>{day.has_mission ? day.mission_name || 'Daily mission' : 'No saved mission plan'}{day.mission_ended ? ' · Ended' : ''}</Typography></TableCell>
              {keys.map(k => <TableCell key={k} align="center"><Button size="small" aria-label={`${labels[k]} on ${day.date}`} onClick={() => setDetail({ title: `${team.name} · ${dateLabel(day.date)} · ${labels[k]}`, towers: day.towers.filter(t => t[k]) })} sx={{ minWidth: 32, fontWeight: 800, color: k === 'reported' ? 'success.main' : 'primary.main' }}>{day.counts[k]}</Button></TableCell>)}
              <TableCell><Button size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => setDetail({ title: `${team.name} · ${dateLabel(day.date)}`, towers: day.towers })}>View towers</Button></TableCell>
            </TableRow>)}{days.length === 0 && <TableRow><TableCell colSpan={7} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No dated missions or inspection activity in this period. Choose another date range or open missions to plan this crew’s next outing.</TableCell></TableRow>}</TableBody>
          </Table></TableContainer>
        </Paper>;
      })}
    </>}
    <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} fullWidth maxWidth="md">
      <DialogTitle>{detail?.title}</DialogTitle><DialogContent dividers>
        <Stack spacing={2}>{detail?.towers.map(tower => <Paper key={tower.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}><Button component={Link} to={`/towers/${tower.id}`} startIcon={<CellTowerRounded />}>{tower.name}</Button>
            {!detail.reportsOnly && <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>{keys.filter(k => tower[k]).map(k => <Chip key={k} size="small" label={labels[k]} color={k === 'reported' ? 'success' : 'default'} />)}</Stack>}
          </Stack>
          {!detail.reportsOnly && <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>{tower.visit_ids?.map(id => <Button key={id} component={Link} to={`/visits/${id}`} size="small">Inspection #{id}</Button>)}</Stack>}
          {tower.reports.map(report => <Stack key={report.id} direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 1, mt: 1, p: 1.5, bgcolor: '#edf7f1', borderRadius: 2 }}>
            <Box><Typography variant="body2" sx={{ fontWeight: 700 }}>{report.number}</Typography><Typography variant="caption">{report.start_date} — {report.end_date}{!report.has_file ? ' · Legacy report: opens a regenerated copy' : ''}</Typography></Box>
            {canReadReports && <Stack direction="row"><Button size="small" onClick={() => setViewReport(report)}>View report</Button><Button size="small" component="a" href={reportUrl(report)} target="_blank" rel="noreferrer">Download</Button></Stack>}
          </Stack>)}
          {!detail.reportsOnly && tower.reports.length === 0 && <Typography variant="caption" color="text.secondary">No saved report traced to this tower on this day.</Typography>}
        </Paper>)}{detail?.towers.length === 0 && <Typography color="text.secondary">No towers in this category for the selected period.</Typography>}</Stack>
      </DialogContent><DialogActions>{canReadReports && <Button component={Link} to="/reports">Report library</Button>}<Button onClick={() => setDetail(null)}>Close</Button></DialogActions>
    </Dialog>
    <DocxViewerDialog open={Boolean(viewReport)} onClose={() => setViewReport(null)} title={viewReport?.number || ''} fileUrl={viewReport ? reportUrl(viewReport) : ''} />
  </Stack>;
}
