import { useState, type ReactNode } from 'react';
import { Avatar, Box, Button, Chip, Collapse, Paper, Stack, Typography } from '@mui/material';
import AssistantRounded from '@mui/icons-material/AssistantRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { tr, useLanguage } from '../i18n';

/** A recommendation, not another required wizard or completion status. */
export function NextStepCoach({ title, task, why, detail, step, steps, action, onAction, disabled, children, showSequence = true }: {
  title: string; task: string; why: string; detail?: ReactNode; step: number; steps: string[];
  action: string; onAction: () => void; disabled?: boolean; children?: ReactNode; showSequence?: boolean;
}) {
  const lang = useLanguage();
  const [showWhy, setShowWhy] = useState(false);
  return <Paper component="aside" aria-label={tr(title)} variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', borderColor: 'primary.main', backgroundImage: 'linear-gradient(115deg, rgba(48,155,172,.12), transparent 75%)' }}>
    <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5 }}>
      <Stack direction="row" spacing={1.2} sx={{ alignItems: 'center', mb: 1.2 }}>
        <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', color: 'primary.contrastText' }}><AssistantRounded fontSize="small" /></Avatar>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>{tr(title)}</Typography>
        <Chip size="small" variant="outlined" label={tr('Suggested next step')} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: { xs: 17, sm: 19 }, fontWeight: 800 }}>{tr(task)}</Typography>
          {detail && <Typography variant="body2" sx={{ mt: .5 }} color="text.secondary">{detail}</Typography>}
        </Box>
        <Button variant="contained" disabled={disabled} endIcon={<ArrowForwardRounded sx={{ transform: lang === 'ar' ? 'rotate(180deg)' : undefined }} />} onClick={onAction} sx={{ flexShrink: 0, borderRadius: 2, py: 1 }}>{tr(action)}</Button>
      </Stack>
      <Button size="small" onClick={() => setShowWhy(!showWhy)} aria-expanded={showWhy} sx={{ mt: .5, px: 0 }}>{tr(showWhy ? 'Hide explanation' : 'Why this step?')}</Button>
      <Collapse in={showWhy}><Typography variant="body2" color="text.secondary" sx={{ pb: 1 }}>{tr(why)}</Typography></Collapse>
      {children}
    </Box>
    {showSequence && <Box component="ol" aria-label={tr('Suggested sequence')} sx={{ listStyle: 'none', m: 0, p: 1, display: 'flex', gap: 1, flexWrap: 'wrap', bgcolor: 'action.hover', borderTop: '1px solid', borderColor: 'divider' }}>
      {steps.map((label, index) => <Box component="li" key={label} aria-current={index + 1 === step ? 'step' : undefined} sx={{ flex: '1 1 110px', display: 'flex', alignItems: 'center', gap: .75, p: .5, color: index + 1 === step ? 'primary.main' : 'text.secondary' }}>
        <Box component="span" sx={{ display: 'grid', placeItems: 'center', width: 23, height: 23, borderRadius: '50%', fontSize: 12, bgcolor: index + 1 === step ? 'primary.main' : 'action.selected', color: index + 1 === step ? 'primary.contrastText' : 'text.secondary' }}>{index + 1}</Box>
        <Typography variant="caption" sx={{ fontWeight: index + 1 === step ? 800 : 500 }}>{tr(label)}</Typography>
      </Box>)}
    </Box>}
  </Paper>;
}
