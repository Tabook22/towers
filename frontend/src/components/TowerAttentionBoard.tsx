import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, InputAdornment, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CampaignRounded from '@mui/icons-material/CampaignRounded';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import LocalFireDepartmentRounded from '@mui/icons-material/LocalFireDepartmentRounded';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import type { DashboardTowerRow, Team } from '../api/types';
import { tr, useLanguage } from '../i18n';
import { towerAttentionItems, type AttentionStage } from '../utils/towerAttention';

const stages = [
  { id: 'planned', label: 'To start', description: 'Plan the visit and begin readings', icon: ScheduleRounded, color: '#9a640d' },
  { id: 'progress', label: 'In progress', description: 'Continue readings and collect evidence', icon: EditNoteRounded, color: '#157499' },
  { id: 'review', label: 'Screened · follow-up', description: 'Check evidence and review the visit', icon: FactCheckRounded, color: '#6462a3' },
] as const;

export function TowerAttentionBoard({ rows, teams, canOpenTeams, onMissingChecks }: {
  rows: DashboardTowerRow[]; teams: Team[]; canOpenTeams: boolean;
  onMissingChecks: (visitId: number, towerId: string) => void;
}) {
  useLanguage();
  const [stage, setStage] = useState<AttentionStage | ''>('');
  const [team, setTeam] = useState('');
  const [search, setSearch] = useState('');
  const items = towerAttentionItems(rows, teams);
  const ownerName = (id: number | null, name: string | null) => name || (id != null ? tr('Team #{0}', [id]) : tr('Unassigned'));
  const owners = [...new Map(items.map(item => [String(item.teamId ?? 'none'), ownerName(item.teamId, item.teamName)])).entries()];
  const visible = items.filter(item => (!stage || stage === item.stage)
    && (!team || team === String(item.teamId ?? 'none'))
    && `${item.tower.tower_id} ${item.tower.area || ''} ${item.teamName || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <Accordion defaultExpanded disableGutters sx={{ overflow: 'hidden', borderRadius: '24px !important', border: '1px solid', borderColor: 'divider', boxShadow: '0 10px 32px rgba(16,65,81,.08)', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRounded sx={{ color: '#fff' }} />} sx={{ px: { xs: 2, md: 3 }, py: 1.5, color: '#fff', background: 'linear-gradient(115deg, #103e50, #1b6571)', borderTop: '4px solid #edbd55' }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}>
          <Box sx={{ bgcolor: 'rgba(255,218,139,.16)', borderRadius: 3, p: 1.4, display: { xs: 'none', sm: 'flex' }, color: '#ffda8b' }}><CampaignRounded sx={{ fontSize: 34 }} /></Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" sx={{ color: '#ffda8b', letterSpacing: 1.6 }}>{tr('FIELD FOLLOW-UP')}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{tr('Towers needing attention')}</Typography>
            <Typography variant="body2" sx={{ mt: .5, color: '#deedf0' }}>{tr('Know what is waiting, who owns it, and what to do next.')}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center', px: 2, borderInlineStart: '1px solid #ffffff30' }}>
            <Typography variant="h3" sx={{ fontWeight: 800 }}>{items.length}</Typography>
            <Typography variant="caption">{tr('Open towers')}</Typography>
          </Box>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ p: { xs: 2, md: 3 }, bgcolor: theme => theme.palette.mode === 'dark' ? 'background.default' : '#f7f9fa' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5, mb: 2.5 }}>
          {stages.map(({ id, label, description, icon: Icon, color }) => (
            <Button key={id} aria-pressed={stage === id} onClick={() => setStage(stage === id ? '' : id)} sx={{ textAlign: 'start', justifyContent: 'flex-start', p: 1.8, gap: 1.5, border: '2px solid', borderColor: stage === id ? color : 'divider', bgcolor: theme => alpha(color, theme.palette.mode === 'dark' ? .16 : .06), borderRadius: '16px', color: 'text.primary', '&:hover': { bgcolor: alpha(color, .14) } }}>
              <Icon sx={{ color, fontSize: 28 }} />
              <Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 800 }}>{tr(label)}</Typography><Typography variant="caption" color="text.secondary">{tr(description)}</Typography></Box>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>{items.filter(item => item.stage === id).length}</Typography>
            </Button>
          ))}
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <TextField size="small" label={tr('Find a tower, area or team')} value={search} onChange={event => setSearch(event.target.value)} sx={{ flex: 1 }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment> } }} />
          <TextField select size="small" label={tr('Responsible team')} value={team} onChange={event => setTeam(event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">{tr('All teams')}</MenuItem>
            {owners.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
          </TextField>
          {(stage || team || search) && <Button onClick={() => { setStage(''); setTeam(''); setSearch(''); }}>{tr('Clear filters')}</Button>}
        </Stack>
        <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} role="status">{tr('{0} of {1} towers', [visible.length, items.length])}</Typography>
          <Typography variant="caption" color="text.secondary">{tr('Highest hotspot count first')}</Typography>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 2 }}>
          {visible.map(item => {
            const config = stages.find(value => value.id === item.stage)!;
            const Icon = config.icon;
            const progress = item.rollup ? Math.min(100, Math.max(0, item.rollup.completion_pct)) : null;
            return <Paper component="article" variant="outlined" key={item.tower.id} sx={{ p: 2.25, borderRadius: '20px', borderTop: `3px solid ${config.color}`, display: 'flex', flexDirection: 'column', gap: 1.6, minWidth: 0, transition: 'box-shadow .2s', '&:hover': { boxShadow: '0 6px 22px rgba(16,65,81,.12)' } }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                <Box sx={{ display: 'flex', p: 1, borderRadius: 2, bgcolor: theme => alpha(theme.palette.primary.main, .08), color: 'primary.main' }}><TransmissionTowerIcon /></Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography component={RouterLink} to={`/towers/${item.tower.id}`} sx={{ fontSize: '1.08rem', fontWeight: 800, color: 'text.primary', textDecoration: 'none', overflowWrap: 'anywhere', '&:hover': { textDecoration: 'underline' } }}>{item.tower.tower_id}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item.tower.area || tr('Area not recorded')}</Typography>
                </Box>
              </Stack>
              <Chip size="small" icon={<Icon />} label={tr(config.label)} sx={{ alignSelf: 'flex-start', bgcolor: alpha(config.color, .1), fontWeight: 700 }} />
              <Box sx={{ bgcolor: theme => alpha(theme.palette.primary.main, .055), borderRadius: 2, p: 1.25 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><GroupsRounded fontSize="small" color="primary" />
                  <Box sx={{ minWidth: 0 }}><Typography variant="caption" color="text.secondary">{tr(item.latest_visit?.team_id != null ? 'Visit team' : 'Assigned team')}</Typography>
                    {canOpenTeams && item.teamId != null ? <Typography component={RouterLink} to={`/teams/${item.teamId}`} sx={{ display: 'block', fontWeight: 700, color: 'primary.main', overflowWrap: 'anywhere' }}>{ownerName(item.teamId, item.teamName)}</Typography>
                      : <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{ownerName(item.teamId, item.teamName)}</Typography>}
                  </Box>
                </Stack>
                {item.reassigned && <Typography variant="caption" color="text.secondary">{tr('Tower now assigned to {0}', [ownerName(item.tower.assigned_team_id, item.assignedName)])}</Typography>}
              </Box>
              <Box>
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', mb: .75 }}><Typography variant="body2" color="text.secondary">{tr('Screening progress')}</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{progress != null ? `${progress}%` : tr('Not recorded')}</Typography></Stack>
                <LinearProgress variant="determinate" value={progress ?? 0} aria-label={tr('Screening progress')} sx={{ height: 7, borderRadius: 4, '& .MuiLinearProgress-bar': { bgcolor: config.color, borderRadius: 4 } }} />
                <Typography variant="caption" color="text.secondary">{item.rollup ? tr('{0} of {1} installed positions screened', [item.rollup.screened, item.rollup.installed]) : tr('Open the tower to prepare its inspection.')}</Typography>
              </Box>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: .75 }}>
                {!!item.rollup?.hotspots && <Chip size="small" variant="outlined" color="error" icon={<LocalFireDepartmentRounded />} label={tr('Hotspots: {0}', [item.rollup.hotspots])} />}
                {!!item.rollup?.images_pending && <Chip size="small" variant="outlined" color="warning" icon={<PhotoLibraryRounded />} label={tr('{0} evidence slots pending', [item.rollup.images_pending])} />}
                {item.rollup?.images_pending === 0 && <Chip size="small" variant="outlined" icon={<CheckCircleOutlineRounded />} label={tr('No pending evidence slots')} />}
              </Stack>
              <Box sx={{ mt: 'auto', pt: .5 }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>{tr(item.stage === 'review' ? 'Screening is ready. Evidence and final review may still need attention.' : item.stage === 'planned' ? 'Next: open the tower visit and start the inspection.' : 'Next: continue the visit and complete the missing checks.')}</Typography>
                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  <Button component={RouterLink} to={item.href} variant="contained" disableElevation endIcon={<ArrowForwardRounded sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />} aria-label={`${tr(item.action)} — ${item.tower.tower_id}`}>{tr(item.action)}</Button>
                  {item.latest_visit && item.rollup?.visit_status === 'Inspection incomplete' && <Button size="small" onClick={() => onMissingChecks(item.latest_visit!.id, item.tower.tower_id)}>{tr('Missing checks')}</Button>}
                </Stack>
              </Box>
            </Paper>;
          })}
        </Box>
        {visible.length === 0 && <Box sx={{ textAlign: 'center', py: 5 }}><CheckCircleOutlineRounded sx={{ fontSize: 44, color: 'text.secondary', mb: 1 }} /><Typography sx={{ fontWeight: 700 }}>{tr(items.length ? 'No towers match these filters.' : 'No open tower work in this selection.')}</Typography><Typography variant="body2" color="text.secondary">{tr(items.length ? 'Clear the filters to see the whole board.' : 'Planned visits, ongoing visits and assigned towers awaiting their first visit appear here.')}</Typography></Box>}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2.5 }}>{tr('Latest open visits and assigned towers awaiting a first visit. Progress uses confirmed data; unconfirmed drafts are shown inside the visit.')}</Typography>
      </AccordionDetails>
    </Accordion>
  );
}
