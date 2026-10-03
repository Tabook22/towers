import { tr, useLanguage } from '../i18n';
import { useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import type { VisitDetail } from '../api/types';

const fields = ['inspector_name', 'camera_drone', 'camera_serial_no', 'calibration_cert_no', 'calibration_due_date'] as const;
type Preset = Partial<Record<typeof fields[number], string>>;

export function VisitEquipmentPreset({ visit, userId, inspectorName, onApply }: {
  visit: VisitDetail; userId: string; inspectorName: string; onApply: (values: Record<string, unknown>) => Promise<unknown>;
}) {
  useLanguage();
  const key = `iip-equipment-preset:${userId}`;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const remember = () => {
    try {
      const preset = Object.fromEntries(fields.filter(field => visit[field]).map(field => [field, visit[field]]));
      localStorage.setItem(key, JSON.stringify(preset)); setMessage(tr("Equipment preset saved on this device for your account.")); setError('');
    } catch { setError(tr("This browser could not save the preset.")); }
  };
  const open = async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}') as Preset;
      const values: Preset = {};
      for (const field of fields) if (typeof saved[field] === 'string') values[field] = saved[field];
      if (!values.inspector_name && !visit.inspector_name) values.inspector_name = inspectorName;
      await onApply(Object.fromEntries(fields.filter(field => values[field] && !visit[field]).map(field => [field, values[field]]))); setError(''); setMessage(tr("Preset added to the visit draft. Check it in the final review."));
    } catch { setError(tr("The saved preset could not be read. Save a new preset from this visit.")); }
  };
  return <Stack spacing={1} sx={{ my: 2 }}>
    <Stack direction="row" spacing={1}><Button onClick={() => void open()}>{tr("Use inspector / equipment preset")}</Button><Button onClick={remember}>{tr("Remember current equipment")}</Button></Stack>
    {message && <Alert severity="success" onClose={() => setMessage('')}>{tr(message)}</Alert>}{error && <Alert severity="error">{tr(error)}</Alert>}

  </Stack>;
}
