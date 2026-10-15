import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { CloseRounded, EditOutlined, ThermostatRounded } from '@mui/icons-material';
import type { Position } from '../api/types';
import { positionLabel } from '../utils/positionChanges';
import { InspectionReadingField } from './InspectionReadingField';
import { tr, useLanguage } from '../i18n';

export function ReadingCorrectionLauncher({ positions, requestedPosition, requestedCorrection, disabled, severities, onReview, onDetails }: {
  positions: Position[]; requestedPosition?: number; requestedCorrection: boolean; disabled: boolean; severities: string[];
  onReview: (position: Position, changes: Partial<Position>) => void;
  onDetails: (positionId: number) => void;
}) {
  useLanguage();
  const [selected, setSelected] = useState<number | null>(requestedPosition || null);
  const [editing, setEditing] = useState<Position | null>(null);
  const [maximum, setMaximum] = useState<number | null>(null);
  const [reference, setReference] = useState<number | null>(null);
  const [severity, setSeverity] = useState('');
  const [notes, setNotes] = useState('');
  const [invalidMax, setInvalidMax] = useState(false);
  const [invalidRef, setInvalidRef] = useState(false);
  const [openedRequest, setOpenedRequest] = useState<number | null>(null);
  const position = positions.find(item => item.id === selected) || null;
  const begin = (item: Position) => {
    setEditing(item); setMaximum(item.tmax_c); setReference(item.tref_c);
    setSeverity(item.severity || ''); setNotes(item.inspector_notes || '');
    setInvalidMax(false); setInvalidRef(false);
  };
  useEffect(() => {
    if (!requestedCorrection || !requestedPosition || disabled || openedRequest === requestedPosition) return;
    const item = positions.find(position => position.id === requestedPosition);
    if (item) { setSelected(item.id); begin(item); setOpenedRequest(item.id); }
  }, [requestedCorrection, requestedPosition, disabled, positions, openedRequest]);
  const delta = maximum !== null && reference !== null ? Math.round((maximum - reference) * 100) / 100 : null;
  const changed = editing && (editing.tmax_c !== maximum || editing.tref_c !== reference || (editing.severity || '') !== severity || (editing.inspector_notes || '') !== notes);
  return <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, bgcolor: 'background.paper', borderColor: 'primary.main' }}>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}><Box sx={{ p: 1, color: 'primary.main', bgcolor: 'action.hover', borderRadius: 2, display: 'flex' }}><ThermostatRounded /></Box><Box><Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{tr('Correct a recorded reading')}</Typography><Typography variant="body2" color="text.secondary">{tr('Choose the insulator position, verify its evidence, then review and confirm the correction.')}</Typography></Box></Stack>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
      <Autocomplete options={positions.filter(item => item.id > 0)} value={position} onChange={(_, next) => setSelected(next?.id ?? null)} getOptionLabel={item => positionLabel(item)} isOptionEqualToValue={(a, b) => a.id === b.id} disabled={disabled} sx={{ flex: 1, minWidth: 0 }} renderInput={params => <TextField {...params} size="small" label={tr('Choose a position to correct')} />} />
      <Button variant="contained" startIcon={<ThermostatRounded />} disabled={disabled || !position} onClick={() => position && begin(position)}>{tr('Correct temperatures')}</Button>
      <Button variant="outlined" startIcon={<EditOutlined />} disabled={disabled || !position} onClick={() => position && onDetails(position.id)}>{tr('Edit inspection details')}</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{tr('Corrections update the source inspection. Generate a revised report after saving; previously issued Word and PDF files remain unchanged.')}</Typography>
    <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="sm" aria-labelledby="reading-correction-title">
      <DialogTitle><Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}><ThermostatRounded color="primary" /><Typography id="reading-correction-title" component="h2" variant="h6" sx={{ flex: 1 }}>{tr('Correct temperatures')}</Typography><IconButton aria-label={tr('Close correction')} onClick={() => setEditing(null)}><CloseRounded /></IconButton></Stack></DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{editing && positionLabel(editing)}</Typography>
        <Alert severity="info">{tr('Check the original thermal evidence before changing readings. ΔT is calculated as Tmax minus Tref; it cannot be edited independently.')}</Alert>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><InspectionReadingField label={tr('Tmax (°C)')} value={maximum} onChange={setMaximum} onInvalid={setInvalidMax} /><InspectionReadingField label={tr('Tref (°C)')} value={reference} onChange={setReference} onInvalid={setInvalidRef} /></Stack>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}><Typography variant="caption" color="text.secondary">{tr('Calculated ΔT (°C)')}</Typography><Typography sx={{ fontSize: 28, fontWeight: 800 }}>{invalidMax || invalidRef || delta === null ? '—' : delta}</Typography></Paper>
        <TextField select size="small" label={tr('Severity')} value={severity} onChange={event => setSeverity(event.target.value)} helperText={tr('Review the recorded classification against the verified readings.')}><MenuItem value="">{tr('Not recorded')}</MenuItem>{severities.map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}</TextField>
        <TextField size="small" label={tr('Inspector notes')} multiline minRows={3} value={notes} onChange={event => setNotes(event.target.value)} helperText={tr('Describe what was corrected and the evidence used.')} />
        <Typography variant="caption" color="text.secondary">{tr('The next step reviews all unsaved changes in this visit. Nothing is confirmed until you complete that review.')}</Typography>
      </Stack></DialogContent>
      <DialogActions sx={{ p: 2 }}><Button onClick={() => setEditing(null)}>{tr('Cancel')}</Button><Button variant="contained" disabled={!editing || !changed || invalidMax || invalidRef || disabled} onClick={() => {
        if (!editing) return;
        const changes: Partial<Position> = {};
        if (editing.tmax_c !== maximum) changes.tmax_c = maximum;
        if (editing.tref_c !== reference) changes.tref_c = reference;
        if ((editing.severity || '') !== severity) changes.severity = severity || null;
        if ((editing.inspector_notes || '') !== notes) changes.inspector_notes = notes || null;
        onReview(editing, changes); setEditing(null);
      }}>{tr('Review correction')}</Button></DialogActions>
    </Dialog>
  </Paper>;
}
