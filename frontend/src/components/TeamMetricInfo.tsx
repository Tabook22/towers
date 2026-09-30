import { tr, useLanguage } from '../i18n';
import { useId, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import InfoRounded from '@mui/icons-material/InfoRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { teamMetricHelp, type TeamMetricTopic } from '../utils/teamMetricHelp';

export function TeamMetricInfo({ topic, daily = false, current }: { topic: TeamMetricTopic; daily?: boolean; current?: string }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const id = useId();
  const help = teamMetricHelp[topic];
  return <>
    <Tooltip title={tr("Explain {0}", [tr(help.title)])}>
      <IconButton type="button" size="small" aria-label={tr("About {0}{1}", [tr(help.title), daily ? tr(" per day") : ''])} aria-haspopup="dialog" aria-expanded={open}
        onClick={event => { event.stopPropagation(); setOpen(true); }}
        sx={{ width: 28, height: 28, flexShrink: 0, color: '#9b6500', bgcolor: 'rgba(239,184,50,.13)', '&:hover': { bgcolor: 'rgba(239,184,50,.27)' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
        <InfoRounded sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
    {open && <Dialog open onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-meaning`}>
      <DialogTitle id={`${id}-title`} sx={{ pr: 7, pb: 1 }}><Typography component="span" variant="overline" sx={{ display: 'block', color: 'text.secondary', letterSpacing: 1.5 }}>{tr("UNDERSTAND YOUR NUMBERS")}</Typography>{tr(help.title)}<IconButton aria-label={tr("Close explanation")} onClick={() => setOpen(false)} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded /></IconButton></DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Typography id={`${id}-meaning`} sx={{ lineHeight: 1.7 }}>{tr(help.meaning)}</Typography>
        {daily && <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}><Typography variant="body2"><b>{tr("For daily activity:")}</b>{tr(" the number counts matching towers on that date, once per team. It is not the whole-period total.")}</Typography></Box>}
        {current && <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}><Typography variant="caption" sx={{ fontWeight: 800 }}>{tr("CURRENT SELECTION")}</Typography><Typography sx={{ mt: .5, fontWeight: 700, overflowWrap: 'anywhere' }}>{current}</Typography></Box>}
        {[['Data used · input', help.input], ['How it is calculated', help.calculation], ['Why it matters', help.importance]].map(([title, body]) => <Box key={title}><Typography variant="subtitle2" sx={{ fontWeight: 800, mb: .5 }}>{tr(title)}</Typography><Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>{tr(body)}</Typography></Box>)}
        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', borderInlineStart: '3px solid #dca329' }}><Typography variant="subtitle2" sx={{ fontWeight: 800, mb: .5 }}>{tr("Example · reading the output")}</Typography><Typography variant="body2" sx={{ lineHeight: 1.7 }}>{tr(help.example)}</Typography></Box>
      </Stack></DialogContent><DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" onClick={() => setOpen(false)}>{tr("Got it")}</Button></DialogActions>
    </Dialog>}
  </>;
}
