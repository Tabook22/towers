import { Box, ButtonBase, Chip, Paper, Stack, Typography } from '@mui/material';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import AssignmentRounded from '@mui/icons-material/AssignmentRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import AddPhotoAlternateRounded from '@mui/icons-material/AddPhotoAlternateRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import { tr, useLanguage } from '../i18n';
import { useSearchParams } from 'react-router-dom';

export const inspectionStepIcons = [CalendarMonthRounded, TransmissionTowerIcon, AssignmentRounded, GridViewRounded, AddPhotoAlternateRounded, FactCheckRounded];
const labels = ['Plan the day', 'Open tower visit', 'Visit details', 'Prepare positions', 'Findings & images', 'Review & save'];

/** Stage numbers describe the order of work, not an inferred completion status. */
export function TeamWorkflowSequence({ onStep, teamMode = false }: { onStep?: (step: number) => void; teamMode?: boolean }) {
  useLanguage();
  const [, setParams] = useSearchParams();
  const openStep = (step: number) => {
    if (onStep) return onStep(step);
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('guide', 'inspection'); next.set('guideStep', String(step)); return next;
    }, { replace: true });
  };
  const steps = teamMode ? ['Plan the day', 'Inspect towers', 'Review & report'] : labels;
  const icons = teamMode ? [CalendarMonthRounded, TransmissionTowerIcon, FactCheckRounded] : inspectionStepIcons;
  return <Paper variant="outlined" sx={{ p: 1.5 }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 1, mb: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{tr('Daily inspection sequence')}</Typography>
      <Typography variant="caption" color="text.secondary">{teamMode ? tr('Plan once. Inspect each tower. Review confirmed work.') : tr('Follow 1–6 for each visit. Numbers show the sequence, not completion.')}</Typography>
    </Stack>
    <Box component="ol" aria-label={tr('Daily inspection sequence')} sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: `repeat(${steps.length}, minmax(0, 1fr))` }, gap: 1, m: 0, p: 0, listStyle: 'none' }}>
      {steps.map((label, index) => {
        const Icon = icons[index];
        return <Box component="li" key={label} sx={{ minWidth: 0 }}><ButtonBase onClick={() => openStep(index + 1)} aria-label={tr('Step {0}: {1}', [index + 1, tr(label)])} sx={{ height: '100%', width: '100%', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, justifyContent: 'flex-start', textAlign: 'start', '&:hover': { bgcolor: 'action.hover' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
          <Stack spacing={0.75}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Chip label={index + 1} size="small" color="primary" /><Icon color="primary" fontSize="small" /></Stack>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{tr(label)}</Typography>
          </Stack>
        </ButtonBase></Box>;
      })}
    </Box>
  </Paper>;
}
