import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import DirectionsCarRounded from '@mui/icons-material/DirectionsCarRounded';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import type { OutingPlanSummary } from '../api/types';
import type { PlanBlock, PlanStep } from '../utils/teamPlanJourney';
import { tr, useLanguage } from '../i18n';

export function TeamPlanControls({ day, plans, onDay }: { day: string; plans?: OutingPlanSummary[]; onDay: (day: string) => void }) {
  useLanguage();
  return <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
    <TextField size="small" type="date" label={tr('Plan day')} value={day} onChange={event => { if (event.target.value) onDay(event.target.value); }} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 180 }} />
    <TextField size="small" select label={tr('Saved plans')} value={plans?.some(plan => plan.field_date === day) ? day : ''} onChange={event => { if (event.target.value) onDay(event.target.value); }} sx={{ minWidth: 230, flex: 1 }}>
      <MenuItem value="">{tr('Choose a saved plan or set a day')}</MenuItem>
      {(plans || []).map(plan => <MenuItem key={plan.field_date} value={plan.field_date}>{plan.field_date} · {plan.name || tr('Mission plan')} · {tr('Towers: {0}', [plan.tower_count])}</MenuItem>)}
    </TextField>
  </Stack>;
}

export const planBlockMessages = {
  plan: 'There is no saved tower plan for this team and day. Choose towers and save the mission plan first.',
  inspection: 'No confirmed inspection results were found for this plan’s towers on this day. Inspect the planned towers and confirm their readings before review.',
  unavailable: 'The plan or inspection progress could not be verified yet. Wait for loading or refresh the page; no missing work has been assumed.',
};

export function TeamPlanNotice({ reason, day, canPlan, onClose, onNext }: { reason: PlanBlock; day: string; canPlan: boolean; onClose: () => void; onNext: (step: PlanStep) => void }) {
  useLanguage();
  return <Dialog open={!!reason} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>{tr('Your next step')}</DialogTitle>
    <DialogContent><Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tr('Plan day')}: {day}</Typography><Typography>{reason ? tr(planBlockMessages[reason]) : ''}</Typography>
      {reason === 'plan' && !canPlan && <Typography sx={{ mt: 1.5 }}>{tr('Ask your team leader to save the plan. You can open planning to view the team’s instructions.')}</Typography>}
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Button onClick={onClose}>{tr('Choose another plan')}</Button>
      {reason !== 'unavailable' && <Button variant="contained" startIcon={reason === 'plan' ? <DirectionsCarRounded /> : <EngineeringRounded />} onClick={() => onNext(reason === 'plan' ? 'planning' : 'work')}>{tr(reason === 'plan' ? 'Go to planning' : 'Inspect planned towers')}</Button>}
    </DialogActions>
  </Dialog>;
}
