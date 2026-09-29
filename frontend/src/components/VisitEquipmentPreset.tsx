import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import type { VisitDetail } from '../api/types';

const fields = ['inspector_name', 'camera_drone', 'camera_serial_no', 'calibration_cert_no', 'calibration_due_date'] as const;
const labels: Record<string, string> = { inspector_name: 'Inspector', camera_drone: 'Camera / drone', camera_serial_no: 'Serial number', calibration_cert_no: 'Calibration certificate', calibration_due_date: 'Calibration due' };
type Preset = Partial<Record<typeof fields[number], string>>;

export function VisitEquipmentPreset({ visit, userId, inspectorName, onApply }: {
  visit: VisitDetail; userId: string; inspectorName: string; onApply: (values: Record<string, unknown>) => Promise<unknown>;
}) {
  const key = `iip-equipment-preset:${userId}`;
  const [review, setReview] = useState<Preset | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const remember = () => {
    try {
      const preset = Object.fromEntries(fields.filter(field => visit[field]).map(field => [field, visit[field]]));
      localStorage.setItem(key, JSON.stringify(preset)); setMessage('Equipment preset saved on this device for your account.'); setError('');
    } catch { setError('This browser could not save the preset.'); }
  };
  const open = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}') as Preset;
      const values: Preset = {};
      for (const field of fields) if (typeof saved[field] === 'string') values[field] = saved[field];
      if (!values.inspector_name && !visit.inspector_name) values.inspector_name = inspectorName;
      setReview(values); setError('');
    } catch { setError('The saved preset could not be read. Save a new preset from this visit.'); }
  };
  return <Stack spacing={1} sx={{ my: 2 }}>
    <Stack direction="row" spacing={1}><Button onClick={open}>Use inspector / equipment preset</Button><Button onClick={remember}>Remember saved equipment</Button></Stack>
    {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}{error && <Alert severity="error">{error}</Alert>}
    <Dialog open={!!review} onClose={() => { if (!busy) setReview(null); }} fullWidth maxWidth="sm">
      <DialogTitle>Confirm inspector and equipment</DialogTitle>
      <DialogContent><Stack spacing={1}>
        <Alert severity="info">Confirm this is the equipment used on this visit. Only empty fields will be filled. Weather, load, temperatures and camera settings are never copied.</Alert>
        {review && fields.filter(field => review[field]).map(field => <Typography key={field}>{labels[field]}: {review[field]}{visit[field] ? ' (existing value will be kept)' : ''}</Typography>)}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button disabled={busy} variant="contained" onClick={async () => {
        setBusy(true);
        try { await onApply(Object.fromEntries(fields.filter(field => review?.[field] && !visit[field]).map(field => [field, review![field]]))); setReview(null); setMessage('Preset applied. Check the sync status if you are offline.'); }
        catch { setError('Could not apply the preset. Your saved visit is unchanged.'); }
        finally { setBusy(false); }
      }}>Apply to empty fields</Button></DialogActions>
    </Dialog>
  </Stack>;
}
