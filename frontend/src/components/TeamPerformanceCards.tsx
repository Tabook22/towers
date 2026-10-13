import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { CheckCircleOutlineRounded, PendingActionsRounded, AssignmentOutlined } from '@mui/icons-material';
import { teamPerformance, type PerformanceTower } from '../utils/teamPerformance';
import { tr, useLanguage } from '../i18n';

interface PerformanceTeam { id: number; name: string; towers: PerformanceTower[] }
type PerformanceFilter = 'all' | 'ready' | 'in_progress' | 'without_visit' | 'remaining';

export function TeamPerformanceCards<T extends PerformanceTeam>({ teams, onOpen }: { teams: T[]; onOpen: (team: T, filter: PerformanceFilter) => void }) {
  useLanguage();
  return <Stack spacing={2}>
    <Box><Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>{tr('Team recording progress')}</Typography><Typography variant="body2" color="text.secondary">{tr('Assigned towers = data complete + in progress + no visit recorded. Remaining = assigned − data complete.')}</Typography></Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>{teams.map(team => {
      const stats = teamPerformance(team.towers);
      const segments = [
        { label: 'Data complete', count: stats.complete, color: '#27816a', filter: 'ready' as const, icon: <CheckCircleOutlineRounded fontSize="small" /> },
        { label: 'In progress', count: stats.inProgress, color: '#a96816', filter: 'in_progress' as const, icon: <PendingActionsRounded fontSize="small" /> },
        { label: 'No visit recorded', count: stats.noVisit, color: '#577b9b', filter: 'without_visit' as const, icon: <AssignmentOutlined fontSize="small" /> },
      ];
      return <Paper key={team.id} variant="outlined" sx={{ p: 2.5, borderRadius: 3, borderTop: '3px solid #268590', boxShadow: '0 5px 22px rgba(16,62,82,.05)' }}>
        <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}><Box sx={{ minWidth: 0 }}><Typography component="h3" variant="subtitle1" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{team.name}</Typography><Button size="small" sx={{ px: 0 }} onClick={() => onOpen(team, 'all')}>{tr('Assigned towers')}: {stats.assigned}</Button></Box><Box sx={{ textAlign: 'end' }}><Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main' }}>{stats.percent}%</Typography><Typography variant="caption" color="text.secondary">{tr('Data completion')}</Typography></Box></Stack>
        <Box role="group" aria-label={tr('Recording progress for {0}', [team.name])} sx={{ display: 'flex', gap: .5, height: 22, borderRadius: 2, overflow: 'hidden', bgcolor: 'action.hover', mb: 2 }}>{segments.filter(s => s.count > 0).map(segment => <Button key={segment.label} aria-label={tr('{0}: {1} towers for {2}', [tr(segment.label), segment.count, team.name])} title={`${tr(segment.label)}: ${segment.count}`} onClick={() => onOpen(team, segment.filter)} sx={{ minWidth: 0, flex: segment.count, p: 0, bgcolor: segment.color, '&:hover': { bgcolor: segment.color, filter: 'brightness(1.12)' } }} />)}</Box>
        <Stack spacing={.5}>{segments.map(segment => <Button key={segment.label} disabled={!segment.count} onClick={() => onOpen(team, segment.filter)} sx={{ justifyContent: 'space-between', textTransform: 'none', px: 1, color: 'text.primary' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Box sx={{ display: 'flex', color: segment.color }}>{segment.icon}</Box><Typography variant="body2">{tr(segment.label)}</Typography></Stack><Typography sx={{ fontWeight: 800 }}>{segment.count}</Typography></Button>)}</Stack>
        <Button variant="outlined" fullWidth disabled={!stats.remaining} onClick={() => onOpen(team, 'remaining')} sx={{ mt: 2, borderRadius: 2 }}>{tr('View remaining towers · {0}', [stats.remaining])}</Button>
      </Paper>;
    })}</Box>
    <Typography variant="caption" color="text.secondary">{tr('Data complete means the latest recorded visit has screening and required evidence coverage. Confirm the physical tower configuration and supervisor approval separately; this graph does not certify final acceptance. A field visit may still be waiting for manual database entry.')}</Typography>
  </Stack>;
}
