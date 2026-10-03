import { useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import { tr, useLanguage } from '../i18n';
import { inspectionStepIcons } from './TeamWorkflowSequence';

const steps = [
  { title: 'Plan the towers for the mission', role: 'Administrator / team leader',
    text: 'Open Planning & tracking. Select the towers and their order, then Save mission plan once. Available unassigned towers are assigned to this team automatically. If the work is already assigned, go straight to Tower work.',
    tab: 'planning', action: 'Open Planning & tracking' },
  { title: 'Choose a tower and open its visit', role: 'Inspection crew',
    text: 'In Tower work, search for the tower. Use Start inspection for its first visit, Continue inspection for unfinished work, or Review inspection to check a saved visit. Do not create a separate visit just to finish an existing one.',
    tab: 'work', action: 'Open Tower work' },
  { title: 'Enter the visit details once', role: 'Inside the inspection visit',
    text: 'Open Visit details. Check the date and enter the inspector, equipment, weather, electrical load and applicable report information. These details apply to the whole visit.' },
  { title: 'Prepare the positions together', role: 'Inside the inspection visit',
    text: 'Open Visual tower form. Check the tower type, OHL sides, strings and applicable directions once. Entering the first reading prepares the matching positions automatically. Shared details remains available for matching asset information.' },
  { title: 'Record each position and its images', role: 'Inside the inspection visit',
    text: 'Enter readings on the drawing. Use Photos & details beside any insulator to add its images, findings and report fields without leaving the workspace. Next incomplete position moves to remaining work. Every reading and image stays with its own position.' },
  { title: 'Review and save the whole visit once', role: 'Inspection crew',
    text: 'After all positions are entered, choose Review and save visit. Check the proposed details, image associations and warnings, then Confirm and save visit. Wait for the success message. If stopping early, use Save draft and finish later; a draft is not confirmed report data.' },
];

/** Guidance only: links select a screen, never create a visit or save inspection data. */
export function TeamInspectionGuide({ teams, currentTeamId }: { teams: { id: number; name: string }[]; currentTeamId?: number }) {
  useLanguage();
  const titleId = useId();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState('');
  const stepElements = useRef<(HTMLLIElement | null)[]>([]);
  const teamId = currentTeamId ?? (selected ? Number(selected) : undefined);
  const team = teams.find(t => t.id === teamId);
  const setOpen = (open: boolean) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (open) next.set('guide', 'inspection'); else next.delete('guide');
    next.delete('guideStep');
    return next;
  }, { replace: true });
  const openTab = (tab: string) => {
    if (!team) return;
    if (currentTeamId) setParams(previous => {
      const next = new URLSearchParams(previous); next.delete('guide'); next.delete('guideStep'); next.set('tab', tab); return next;
    }, { replace: true });
    else navigate(`/teams/${team.id}?tab=${tab}`);
  };
  return <>
    <Button size="small" startIcon={<HelpOutlineRounded />} onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start', textTransform: 'none' }}>{tr('How to complete an inspection')}</Button>
    <Dialog open={params.get('guide') === 'inspection'} onClose={() => setOpen(false)} fullWidth maxWidth="md" aria-labelledby={titleId} slotProps={{ transition: { onEntered: () => {
      const index = Number(params.get('guideStep')) - 1;
      stepElements.current[index]?.scrollIntoView({ block: 'nearest' });
    } } }}>
      <DialogTitle id={titleId}>{tr('How to complete an inspection')}</DialogTitle>
      <DialogContent dividers><Stack spacing={2}>
        <Typography>{tr('An optional guide, not extra steps to confirm. Set up the team once, then repeat the tower inspection flow.')}</Typography>
        {!currentTeamId && <TextField select fullWidth size="small" label={tr('Choose a team for the shortcuts')} value={team ? String(team.id) : ''} onChange={event => setSelected(event.target.value)} helperText={tr('Choose an existing team to enable the screen shortcuts. You can read the guide without selecting one.')}>
          <MenuItem value="">{tr('Select a team')}</MenuItem>
          {teams.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
        </TextField>}
        {team && <Chip label={team.name} sx={{ alignSelf: 'flex-start' }} variant="outlined" />}
        <Accordion disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography sx={{ fontWeight: 700 }}>{tr('One-time setup — administrator')}</Typography></AccordionSummary>
          <AccordionDetails><Stack spacing={1.5}>
            <Typography variant="body2">{tr('On Teams, expand Team leaders & logins to create a leader account. Use Add team, or edit a team to select its leader. Add individual member accounts only when separate logins are needed. Tower work and inspection visits are the daily workspace; account setup is not repeated for every tower.')}</Typography>
            <Button disabled={!team} onClick={() => openTab('settings')} sx={{ alignSelf: 'flex-start' }}>{tr('Open Team settings')}</Button>
          </Stack></AccordionDetails>
        </Accordion>
        <Stack component="ol" spacing={2} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {steps.map((step, index) => {
            const Icon = inspectionStepIcons[index];
            return <Paper component="li" ref={(element: HTMLLIElement | null) => { stepElements.current[index] = element; }} key={step.title} variant="outlined" sx={{ p: 2, borderColor: Number(params.get('guideStep')) === index + 1 ? 'primary.main' : 'divider' }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Chip size="small" color="primary" label={index + 1} />
              <Icon color="primary" fontSize="small" />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">{tr(step.role)}</Typography>
                <Typography sx={{ fontWeight: 700 }}>{tr(step.title)}</Typography>
                <Typography variant="body2" sx={{ mt: 0.75 }}>{tr(step.text)}</Typography>
                {step.tab && <Button size="small" disabled={!team} onClick={() => openTab(step.tab!)} sx={{ mt: 1 }}>{tr(step.action)}</Button>}
              </Box>
            </Stack>
          </Paper>; })}
        </Stack>
        <Alert severity="info">{tr('Ready for review is inspection screening readiness. Evidence completeness and report approval are separate checks. GPS presence alone does not complete an inspection.')}</Alert>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>{tr('After saving — review and report')}</Typography>
          <Typography variant="body2" sx={{ mt: 0.75 }}>{tr('Use Back to team to work on the next tower. An authorized administrator or reviewer checks History & reports and generates the official report from confirmed data. Previously generated reports stay unchanged until a new report is generated.')}</Typography>
          <Button disabled={!team} onClick={() => openTab('history')} sx={{ mt: 1 }}>{tr('Open History & reports')}</Button>
        </Box>
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => navigate('/help')}>{tr('All help guides')}</Button><Button variant="contained" onClick={() => setOpen(false)}>{tr('Close guide')}</Button></DialogActions>
    </Dialog>
  </>;
}
