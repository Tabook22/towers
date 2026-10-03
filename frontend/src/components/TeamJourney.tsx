import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { useOutingPlan, useOutingPlans, useTeamMissions } from '../api/hooks';
import { localInspectionDate } from '../utils/teamTowerWork';
import { planStepBlock, type PlanBlock, type PlanStep } from '../utils/teamPlanJourney';
import { TeamPlanControls, TeamPlanNotice } from './TeamPlanControls';
import { Alert, Box, CardActionArea, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import DirectionsCarRounded from '@mui/icons-material/DirectionsCarRounded';
import AssignmentTurnedInRounded from '@mui/icons-material/AssignmentTurnedInRounded';
import RouteRounded from '@mui/icons-material/RouteRounded';
import { DashboardSection } from './DashboardSection';
import { tr, useLanguage } from '../i18n';

const steps = [
  { id: 'planning', title: 'Plan the day', icon: DirectionsCarRounded, color: '#94691b', text: 'The leader chooses towers and orders the route. The crew follows one shared plan.' },
  { id: 'work', title: 'Inspect towers', icon: EngineeringRounded, color: '#237d8e', text: 'Open a tower visit, enter readings on the drawing and attach images to each position.' },
  { id: 'history', title: 'Review & report', icon: AssignmentTurnedInRounded, color: '#7968a9', text: 'Complete missing checks, confirm the visit once, then prepare its report.' },
];

export function TeamJourney({ teams, canPlan }: { teams: { id: number; name: string }[]; canPlan: boolean }) {
  useLanguage();
  const navigate = useNavigate();
  const [selected, setSelected] = useState('');
  const teamId = teams.length === 1 ? teams[0].id : teams.find(team => String(team.id) === selected)?.id;
  const [day, setDay] = useState(localInspectionDate);
  const [chooseTeam, setChooseTeam] = useState(false);
  const teamInput = useRef<HTMLInputElement>(null);
  const [block, setBlock] = useState<PlanBlock>(null);
  const plan = useOutingPlan(teamId, day);
  const plans = useOutingPlans(teamId);
  const visits = useTeamMissions(teamId);
  const go = (step: PlanStep) => {
    if (!teamId) return;
    navigate(`/teams/${teamId}?tab=${step}&planDay=${encodeURIComponent(day)}&planScope=1`);
  };
  const openStep = (step: PlanStep) => {
    if (!teamId) { setChooseTeam(true); teamInput.current?.focus(); return; }
    const reason = planStepBlock(step, teamId, day, plan.data, visits.data, plan.isError || (step === 'history' && visits.isError));
    if (reason) setBlock(reason); else go(step);
  };
  return <DashboardSection icon={<RouteRounded />} title={tr('From crew to completed inspection')} eyebrow={tr('HOW TEAMS WORK')}
    description={tr('Teams brings your people, assigned towers, daily visits and reports into one workspace.')}>
    <Stack spacing={1.5} sx={{ mb: 2.5 }}>
      <TextField select size="small" inputRef={teamInput} label={tr('Team for this plan')} value={teamId ?? ''} onChange={event => { setSelected(String(event.target.value)); setChooseTeam(false); }}>
        <MenuItem value="">{tr('Select a team')}</MenuItem>{teams.map(team => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
      </TextField>
      <TeamPlanControls day={day} plans={plans.data} onDay={setDay} />
      {chooseTeam && <Alert severity="info">{tr('Choose a team first, then click a step below.')}</Alert>}
      <Typography variant="caption" color="text.secondary">{tr('One team, one plan day: plan the route → inspect its towers → review the recorded work.')}</Typography>
    </Stack>
    <Box component="ol" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 3, p: 0, m: 0, listStyle: 'none' }}>
      {steps.map(({ id, title, icon: Icon, color, text }, index) => <Box component="li" key={title} sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '20px', position: 'relative', borderTop: `3px solid ${color}` }}>
        <CardActionArea onClick={() => openStep(id as PlanStep)} aria-label={tr('Open step {0}: {1}', [index + 1, tr(title)])} sx={{ p: 2.25, height: '100%', borderRadius: '18px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 64, height: 64, bgcolor: `${color}16`, borderRadius: '20px' }}><Icon sx={{ fontSize: 38, color: theme => theme.palette.mode === 'dark' ? 'text.primary' : color }} /></Box>
          <Chip label={index + 1} size="small" sx={{ fontWeight: 800 }} />
        </Stack>
        <Typography sx={{ fontWeight: 800, mb: .75 }}>{tr(title)}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>{tr(text)}</Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, pt: 2, mt: 'auto', color: 'primary.main' }}><Typography variant="body2" sx={{ fontWeight: 800 }}>{tr('Open this step')}</Typography><ArrowForwardRounded fontSize="small" sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} /></Stack>
        </CardActionArea>
        {index < 2 && <Box aria-hidden="true" sx={{ position: 'absolute', zIndex: 1, insetInlineEnd: { xs: 'calc(50% - 15px)', md: -24 }, bottom: { xs: -25, md: 'calc(50% - 15px)' }, borderRadius: '50%', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', width: 30, height: 30, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><ArrowForwardRounded fontSize="small" sx={{ transform: theme => ({ xs: 'rotate(90deg)', md: theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }) }} /></Box>}
      </Box>)}
    </Box>
    <TeamPlanNotice reason={block} day={day} canPlan={canPlan} onClose={() => setBlock(null)} onNext={go} />
  </DashboardSection>;
}
