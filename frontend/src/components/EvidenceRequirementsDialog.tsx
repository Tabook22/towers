import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tab, Tabs, TextField, Typography, Paper } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { tr, useLanguage } from '../i18n';
import type { Position } from '../api/types';
import { evidenceRequirements } from '../utils/evidenceRequirements';
import { positionLabel, positionError } from '../utils/positionChanges';
import type { StagedEvidence } from '../utils/inspectionProgress';

export function EvidenceRequirementsDialog({ open, initialTab, onClose, positions, types, staged, visitId, canChange, disabled, onOpenPosition }: {
  open: boolean; initialTab: 'missing' | 'screening'; onClose: () => void; positions: Position[]; types: string[];
  staged: StagedEvidence[]; visitId: number; canChange: boolean; disabled: boolean; onOpenPosition: (id: number) => void;
}) {
  useLanguage();
  const qc = useQueryClient();
  const [tab, setTab] = useState('missing');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setTab(initialTab); setError(''); } }, [open, initialTab]);
  const slots = evidenceRequirements(positions, types, staged);
  const missing = slots.filter(s => s.missing), waived = slots.filter(s => s.waived);
  const unscreened = positions.filter(p => p.in_scope !== false && p.installed && (!p.screening_result || p.screening_result === 'Not inspected'));
  const change = async (imageId: number, required: boolean) => {
    setBusy(true); setError('');
    try {
      await apiClient.post(`/api/images/${imageId}/requirement`, { required, reason: required ? '' : reason.trim() });
      setSelectedId(null); setReason('');
      await Promise.all(['visit', 'towers', 'teams', 'dashboard', 'archive'].map(key => qc.invalidateQueries({ queryKey: key === 'visit' ? [key, visitId] : [key] })));
    } catch (err) { setError(positionError(err, tr('Could not update the evidence requirement. Try again.'))); }
    finally { setBusy(false); }
  };
  const openPosition = (id: number) => { onClose(); onOpenPosition(id); };
  return <><Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
    <DialogTitle>{tr('Inspection follow-up')}</DialogTitle>
    <DialogContent dividers><Stack spacing={2}>
      <Alert severity="info">{tr('Remove an optional category by marking it Not required and recording a reason. Photos are preserved, and you can make the category required again. Default empty slots are not documented exemptions.')}</Alert>
      {staged.length > 0 && <Alert severity="info">{tr('Draft photos count in this list. Confirm the visit to include them in saved evidence and map badges.')}</Alert>}
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable">
        <Tab value="missing" label={`${tr('Incomplete evidence')} (${missing.length})`} />
        <Tab value="waived" label={`${tr('Not required')} (${waived.length})`} />
        <Tab value="screening" label={`${tr('Unfinished screening')} (${unscreened.length})`} />
      </Tabs>
      {error && <Alert severity="error">{error}</Alert>}
      {tab === 'screening' ? <>
        <Typography>{tr('These positions need a screening result. Making a photo optional does not complete screening.')}</Typography>
        {unscreened.map(p => <Paper variant="outlined" key={p.id} sx={{ p: 2 }}><Typography><bdi dir="ltr">{positionLabel(p)}</bdi></Typography><Button onClick={() => openPosition(p.id)}>{tr('Open position')}</Button></Paper>)}
        {!unscreened.length && <Typography>{tr('No unfinished screening checks.')}</Typography>}
      </> : <>
        {(tab === 'waived' ? waived : missing).map(({ position, type, image }) => <Paper key={`${position.id}-${type}`} variant="outlined" sx={{ p: 2, bgcolor: tab === 'waived' ? 'action.hover' : undefined }}>
          <Typography sx={{ fontWeight: 700 }}><bdi dir="ltr">{positionLabel(position)}</bdi> · {tr(type)}</Typography>
          {tab === 'waived' ? <Typography variant="body2">{image?.exemption_reason} · {image?.exemption_by}</Typography> : <Typography variant="body2" color="text.secondary">{tr(image?.evidence_status === 'RECAPTURE REQUIRED' ? 'Recapture required' : 'Required image missing')}</Typography>}
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
            <Button onClick={() => openPosition(position.id)}>{tr('Open position')}</Button>
            {canChange && <Button disabled={disabled || busy || !image || image.id <= 0 || position.id <= 0} onClick={() => tab === 'waived' ? void change(image!.id, true) : (setSelectedId(image!.id), setReason(''))}>{tr(tab === 'waived' ? 'Make required again' : 'Mark not required')}</Button>}
          </Stack>
          {(!image || image.id <= 0 || position.id <= 0) && <Typography variant="caption">{tr('Confirm this position first to change its saved evidence requirements.')}</Typography>}
        </Paper>)}
        {!(tab === 'waived' ? waived : missing).length && <Typography>{tr(tab === 'waived' ? 'No documented optional categories.' : 'No incomplete required evidence.')}</Typography>}
      </>}
    </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={onClose}>{tr('Close')}</Button></DialogActions>
  </Dialog><Dialog open={selectedId !== null} onClose={busy ? undefined : () => setSelectedId(null)} maxWidth="sm" fullWidth>
    <DialogTitle>{tr('Mark evidence not required')}</DialogTitle><DialogContent><TextField autoFocus multiline minRows={3} fullWidth label={tr('Why is this evidence optional or not required?')} value={reason} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} sx={{ mt: 1 }} />{error && <Alert severity="error">{error}</Alert>}</DialogContent>
    <DialogActions><Button disabled={busy} onClick={() => setSelectedId(null)}>{tr('Cancel')}</Button><Button disabled={busy || !reason.trim()} onClick={() => selectedId !== null && void change(selectedId, false)}>{tr('Mark not required')}</Button></DialogActions>
  </Dialog></>;
}
