import { useEffect, useMemo, useRef, useState } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { Box, Button, ButtonBase, Chip, Paper, Stack, Typography } from '@mui/material';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import type { ActivityTeam, CountKey } from '../api/teamActivityTypes';
import { activityTrend, teamFieldStats } from '../utils/teamActivityCharts';

const metrics: { key: CountKey; label: string; colour: string }[] = [
  { key: 'planned', label: 'Mission towers', colour: '#8b7bb4' },
  { key: 'visited', label: 'Visited', colour: '#238ba1' },
  { key: 'recorded', label: 'Recorded', colour: '#5674d5' },
  { key: 'finished', label: 'Finished', colour: '#249b73' },
  { key: 'reported', label: 'In reports', colour: '#c38927' },
];
const trendMetrics = metrics.filter(m => ['visited', 'recorded', 'finished'].includes(m.key));
const shortDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function DailyTrend({ teams, start, end }: { teams: ActivityTeam[]; start: string; end: string }) {
  const theme = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visible, setVisible] = useState<CountKey[]>(['visited', 'recorded', 'finished']);
  const rows = useMemo(() => activityTrend(teams, start, end), [teams, start, end]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(230, entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!rows.length) return null;
  const active = rows.reduce((last, row, index) => trendMetrics.some(m => row.counts[m.key] > 0) ? index : last, rows.length - 1);
  const found = rows.findIndex(row => row.date === selectedDate);
  const selected = found >= 0 ? found : active;
  const current = rows[selected];
  const max = Math.max(4, Math.ceil(Math.max(...rows.flatMap(row => visible.map(k => row.counts[k]))) / 4) * 4);
  const left = 34, right = width - 12, top = 16, bottom = 172;
  const x = (i: number) => rows.length === 1 ? (left + right) / 2 : left + (right - left) * i / (rows.length - 1);
  const y = (n: number) => bottom - n / max * (bottom - top);
  const ticks = [...new Set(Array.from({ length: width < 420 ? 3 : 5 }, (_, i) => Math.round(i * (rows.length - 1) / (width < 420 ? 2 : 4))))];
  return <Box sx={{ minWidth: 0 }}>
    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Daily tower activity</Typography>
    <Typography variant="caption" color="text.secondary">Towers per day · toggle a series to compare</Typography>
    <Stack direction="row" sx={{ gap: .5, flexWrap: 'wrap', mt: 1 }}>
      {trendMetrics.map(m => <Button key={m.key} size="small" aria-pressed={visible.includes(m.key)} onClick={() => setVisible(v => v.includes(m.key) ? v.length > 1 ? v.filter(k => k !== m.key) : v : [...v, m.key])}
        sx={{ color: 'text.primary', bgcolor: visible.includes(m.key) ? alpha(m.colour, .13) : undefined, opacity: visible.includes(m.key) ? 1 : .55 }}>
        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: m.colour, mr: .75 }} />{m.label}
      </Button>)}
    </Stack>
    <Box ref={container} sx={{ mt: 1, width: '100%' }}>
      <svg role="img" aria-label={`Daily visited, recorded and finished towers from ${start} to ${end}. Use the date slider below for exact values.`} width="100%" height="202" viewBox={`0 0 ${width} 202`}
        onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); const i = Math.max(0, Math.min(rows.length - 1, Math.round(((event.clientX - bounds.left) * width / bounds.width - left) / (right - left) * (rows.length - 1)))); setSelectedDate(rows[i].date); }}>
        {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={left} x2={right} y1={y(max * i / 4)} y2={y(max * i / 4)} stroke={theme.palette.divider} strokeDasharray="3 5" /><text x={left - 8} y={y(max * i / 4) + 4} textAnchor="end" fontSize="11" fill={theme.palette.text.secondary}>{max * i / 4}</text></g>)}
        {visible.includes('visited') && <polygon points={`${x(0)},${bottom} ${rows.map((r, i) => `${x(i)},${y(r.counts.visited)}`).join(' ')} ${x(rows.length - 1)},${bottom}`} fill={alpha('#238ba1', .07)} />}
        {trendMetrics.filter(m => visible.includes(m.key)).map(m => <g key={m.key}>
          <polyline points={rows.map((row, i) => `${x(i)},${y(row.counts[m.key])}`).join(' ')} fill="none" stroke={m.colour} strokeWidth="2.5" strokeLinejoin="round" strokeDasharray={m.key === 'recorded' ? '6 4' : undefined} />
          <circle cx={x(selected)} cy={y(current.counts[m.key])} r="4.5" fill={m.colour} stroke={theme.palette.background.paper} strokeWidth="2" />
        </g>)}
        <line x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} stroke={theme.palette.text.secondary} opacity=".3" strokeDasharray="3 4" />
        {ticks.map(i => <text key={i} x={x(i)} y="195" textAnchor={i === 0 && rows.length > 1 ? 'start' : i === rows.length - 1 && rows.length > 1 ? 'end' : 'middle'} fontSize="11" fill={theme.palette.text.secondary}>{shortDate(rows[i].date)}</text>)}
      </svg>
    </Box>
    <Box component="input" type="range" aria-label="Inspect activity date" aria-valuetext={`${shortDate(current.date)}: ${current.counts.visited} visited, ${current.counts.recorded} recorded, ${current.counts.finished} finished`} min={0} max={rows.length - 1} value={selected} disabled={rows.length === 1} onChange={e => setSelectedDate(rows[Number(e.target.value)].date)} sx={{ width: '100%', mx: 0, accentColor: '#238ba1', cursor: 'pointer' }} />
    <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mt: 1, p: 1.25, borderRadius: 1.5, bgcolor: 'action.hover' }}>
      <Typography variant="caption" sx={{ fontWeight: 800 }}>{shortDate(current.date)}</Typography>
      {trendMetrics.map(m => <Typography key={m.key} variant="caption"><Box component="span" sx={{ color: m.colour, fontWeight: 800 }}>{current.counts[m.key]}</Box> {m.label.toLowerCase()}</Typography>)}
    </Stack>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Repeat visits count on each visit date. Blank dates are shown as zero; they do not prove a missed assignment.</Typography>
  </Box>;
}

export function ActivityOverviewCharts({ teams, start, end, selectTeam }: { teams: ActivityTeam[]; start: string; end: string; selectTeam: (id: number) => void }) {
  const ranked = teams.map(team => ({ team, stats: teamFieldStats(team) })).sort((a, b) => b.stats.visitDays - a.stats.visitDays || a.team.name.localeCompare(b.team.name));
  const maxDays = Math.max(1, ...ranked.map(row => row.stats.visitDays));
  const visitDays = ranked.reduce((sum, row) => sum + row.stats.visitDays, 0);
  return <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
    <Stack direction="row" sx={{ p: 2.5, pb: 2, gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 2, p: 1, display: 'flex' }}><InsightsRounded /></Box>
      <Box sx={{ flex: 1 }}><Typography variant="h6" sx={{ fontWeight: 800 }}>Progress at a glance</Typography><Typography variant="body2" color="text.secondary">{teams.length === 1 ? teams[0].name : `${teams.length} teams`} · {shortDate(start)} – {shortDate(end)}</Typography></Box>
      <Chip icon={<CalendarMonthRounded />} label={`${visitDays} team visit-days`} variant="outlined" />
    </Stack>
    <Box sx={{ px: 2.5, pb: 2.5, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.7fr) minmax(240px, 1fr)' }, gap: 3 }}>
      <DailyTrend teams={teams} start={start} end={end} />
      <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2, minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Days in the field</Typography>
        <Typography variant="caption" color="text.secondary">A day counts when the team visited at least one tower.</Typography>
        <Stack spacing={1.75} sx={{ mt: 2, maxHeight: 288, overflowY: 'auto' }}>{ranked.map(({ team, stats }) => <ButtonBase key={team.id} onClick={() => selectTeam(team.id)} aria-label={`Show ${team.name}: ${stats.visitDays} visit days`} sx={{ display: 'block', width: '100%', textAlign: 'start', borderRadius: 1, p: .5, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: .7 }}><Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{team.name}</Typography><Typography variant="body2" sx={{ fontWeight: 800, flexShrink: 0 }}>{stats.visitDays} <Box component="span" sx={{ fontWeight: 400 }}>days</Box></Typography></Stack>
          <Box sx={{ height: 9, borderRadius: 5, bgcolor: 'action.selected', overflow: 'hidden' }}><Box sx={{ height: '100%', width: `${stats.visitDays / maxDays * 100}%`, bgcolor: '#238ba1', borderRadius: 5 }} /></Box>
          <Typography variant="caption" color="text.secondary">{team.counts.visited} towers visited · {stats.recordingDays} recording days</Typography>
        </ButtonBase>)}</Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Select a team to focus the page. Team visit-days add each team’s days; two teams on one date count as two.</Typography>
      </Box>
    </Box>
  </Paper>;
}

export function TeamProgressCharts({ team, onCategory }: { team: ActivityTeam; onCategory: (key: CountKey) => void }) {
  const theme = useTheme();
  const stats = teamFieldStats(team);
  const maxCount = Math.max(1, ...metrics.map(m => team.counts[m.key]));
  const circumference = 2 * Math.PI * 58;
  const arc = stats.visited ? stats.finishedVisits / stats.visited * circumference : 0;
  return <Box sx={{ px: 2.5, py: 2.5, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5, mb: 2.5 }}>
      {[{ label: 'Visit days', value: stats.visitDays, detail: 'Actual field activity' }, { label: 'Recording days', value: stats.recordingDays, detail: 'Saved inspection dates' }, { label: 'Mission days', value: stats.missionDays, detail: 'Saved daily plans' }, { label: 'Towers / visit-day', value: stats.visitsPerDay.toFixed(1), detail: 'Includes repeat visits' }].map(item => <Box key={item.label} sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>{item.label}</Typography><Typography variant="h5" sx={{ fontWeight: 800, my: .4 }}>{item.value}</Typography><Typography variant="caption" color="text.secondary">{item.detail}</Typography>
      </Box>)}
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.5fr) minmax(220px, 1fr)' }, gap: 3 }}>
      <Box><Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Tower progress</Typography><Typography variant="caption" color="text.secondary">Unique towers in the selected period · select a bar to view towers</Typography>
        <Stack spacing={1} sx={{ mt: 1.5 }}>{metrics.map(m => <ButtonBase key={m.key} aria-label={`${team.name}: ${team.counts[m.key]} ${m.label.toLowerCase()}, view towers`} onClick={() => onCategory(m.key)} sx={{ width: '100%', display: 'grid', gridTemplateColumns: '100px minmax(0, 1fr) 30px', gap: 1.25, textAlign: 'start', p: .5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>{m.label}</Typography><Box sx={{ height: 15, borderRadius: '4px', bgcolor: alpha(m.colour, .1), overflow: 'hidden' }}><Box sx={{ width: `${team.counts[m.key] / maxCount * 100}%`, height: '100%', bgcolor: m.colour, borderRadius: '4px' }} /></Box><Typography variant="body2" sx={{ fontWeight: 800, textAlign: 'end' }}>{team.counts[m.key]}</Typography>
        </ButtonBase>)}</Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>These categories overlap. A saved record can be a draft, and a finished visit can still need its report.</Typography>
      </Box>
      <Box sx={{ textAlign: 'center', bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Visited towers · completion</Typography>
        <svg role="img" aria-label={`${team.name}: ${stats.finishedVisits} finished and ${stats.unfinishedVisits} not finished out of ${stats.visited} visited towers`} width="174" height="174" viewBox="0 0 174 174" style={{ display: 'block', margin: '4px auto' }}>
          <circle cx="87" cy="87" r="58" fill="none" stroke={stats.visited ? '#e5b861' : theme.palette.divider} strokeWidth="18" />
          {arc > 0 && <circle cx="87" cy="87" r="58" fill="none" stroke="#249b73" strokeWidth="18" strokeDasharray={`${arc} ${circumference - arc}`} transform="rotate(-90 87 87)" />}
          <text x="87" y="87" textAnchor="middle" fill={theme.palette.text.primary} fontSize="28" fontWeight="800">{stats.completion === null ? '—' : `${stats.completion}%`}</text>
          <text x="87" y="107" textAnchor="middle" fill={theme.palette.text.secondary} fontSize="11">{stats.visited ? 'finished' : 'no visits yet'}</text>
        </svg>
        <Stack direction="row" sx={{ justifyContent: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {[{ label: 'Finished', count: stats.finishedVisits, colour: '#249b73' }, { label: 'Not finished', count: stats.unfinishedVisits, colour: '#e5b861' }].map(item => <Typography key={item.label} variant="caption"><Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: item.colour, mr: .5 }} /><b>{item.count}</b> {item.label}</Typography>)}
        </Stack><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Field completion, not report approval.</Typography>
      </Box>
    </Box>
  </Box>;
}
