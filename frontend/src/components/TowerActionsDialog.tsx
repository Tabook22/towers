import { useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/CloseRounded';
import TowerIcon from '@mui/icons-material/CellTowerRounded';
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import LinkOffIcon from '@mui/icons-material/LinkOffRounded';
import { useNavigate } from 'react-router-dom';
import { useClaimTowerForTeam, useReleaseTower, useTeams } from '../api/hooks';
import type { TowerWithStats } from '../api/types';
import { mediaUrl } from '../api/client';
import { ExpandableImage } from './ExpandableImage';

type Action = 'inspections' | 'register' | 'assign' | 'unassign';

// Mounted afresh for each selection, so previous choices/errors never carry to another tower.
export function TowerActionsDialog({ tower, canManage, ownTeamId, onClose, onEdit, onSuccess }: {
  tower: TowerWithStats; canManage: boolean; ownTeamId?: number | null;
  onClose: () => void; onEdit: () => void; onSuccess: (message: string) => void;
}) {
  const navigate = useNavigate();
  const { data: teams = [], isLoading, isError } = useTeams();
  const claim = useClaimTowerForTeam();
  const release = useReleaseTower();
  const [action, setAction] = useState<Action>('inspections');
  const [teamId, setTeamId] = useState('');
  const [details, setDetails] = useState(false);
  const [error, setError] = useState('');
  const pending = claim.isPending || release.isPending;
  const assigned = tower.assigned_team_id != null;
  const canAssign = canManage || (!!ownTeamId && !assigned);
  const canUnassign = assigned && (canManage || (!!ownTeamId && ownTeamId === tower.assigned_team_id));
  const target = canManage ? teams.find(t => String(t.id) === teamId) : teams.find(t => t.id === ownTeamId);
  const submit = async () => {
    if (pending) return;
    if (action === 'register') { setDetails(true); return; }
    if (action === 'inspections') { onClose(); navigate(`/towers/${tower.id}`); return; }
    setError('');
    try {
      if (action === 'unassign' && canUnassign) {
        await release.mutateAsync(tower.id);
        onSuccess(`${tower.tower_id} is now unassigned.`);
      } else if (action === 'assign' && canAssign && (!canManage || (target && target.id !== tower.assigned_team_id))) {
        await claim.mutateAsync(canManage ? { towerId: tower.id, teamId: target!.id } : tower.id);
        onSuccess(`${tower.tower_id} assigned to ${target?.name || 'your team'}.`);
      } else return;
      onClose();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Could not update this tower. Please try again.');
    }
  };
  const fields = [
    ['Tower ID', tower.tower_id], ['Voltage', tower.voltage], ['Tower type', tower.tower_type],
    ['Area / line', tower.area], ['Line sector', tower.line_sector], ['Location', tower.location_name],
    ['Height', tower.height_m == null ? null : `${tower.height_m} m`],
    ['Latitude', tower.latitude], ['Longitude', tower.longitude], ['Assigned team', tower.assigned_team_name || 'Unassigned'],
    ['Catalog status', tower.is_active ? 'Active' : 'Inactive'], ['Registered', tower.created_at?.slice(0, 10)], ['Last updated', tower.updated_at?.slice(0, 10)],
  ];
  const options = [
    { value: 'inspections', title: 'Show tower inspection details', text: `${tower.visit_count} recorded visit${tower.visit_count === 1 ? '' : 's'} · open inspection history and results`, icon: <FactCheckIcon />, disabled: false },
    { value: 'register', title: 'Show tower registered details', text: 'View the saved location, specifications, photo and notes.', icon: <InfoIcon />, disabled: false },
    { value: 'assign', title: assigned ? 'Reassign to another team' : 'Assign to a team', text: canAssign ? 'Choose who is responsible for this tower.' : 'Only an authorized administrator can reassign this tower.', icon: <GroupsIcon />, disabled: !canAssign },
    { value: 'unassign', title: 'Unassign tower', text: assigned ? 'Return this tower to the free pool.' : 'This tower is already unassigned.', icon: <LinkOffIcon />, disabled: !canUnassign },
  ];
  return <Dialog open onClose={() => { if (!pending) onClose(); }} maxWidth="sm" fullWidth aria-labelledby="tower-actions-title">
    <DialogTitle sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', pr: 7 }} id="tower-actions-title">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><TowerIcon /><Box><Typography component="span" variant="h6">{tower.tower_id}</Typography><Typography variant="body2">{details ? 'Registered tower details' : 'What would you like to do?'}</Typography></Box></Stack>
      <IconButton aria-label="Close tower actions" disabled={pending} onClick={onClose} sx={{ position: 'absolute', right: 12, top: 14, color: 'inherit' }}><CloseIcon /></IconButton>
    </DialogTitle>
    <DialogContent sx={{ pt: '20px !important' }}>
      <Stack direction="row" sx={{ mb: 2, gap: 1, flexWrap: 'wrap' }}><Chip size="small" label={tower.assigned_team_name || 'Unassigned'} color={assigned ? 'primary' : 'default'} variant="outlined" /><Chip size="small" label={tower.area || 'No area set'} /><Chip size="small" label={tower.voltage || 'Voltage not set'} /></Stack>
      {details ? <Stack spacing={2}>
        {tower.photo_path && <ExpandableImage src={mediaUrl(`/api/towers/${tower.id}/photo`, tower.photo_uploaded_at)} alt={tower.tower_id} height={200} />}
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>{fields.map(([label, value]) => <Box key={String(label)}><Typography component="dt" variant="caption" color="text.secondary">{label}</Typography><Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value ?? 'Not recorded'}</Typography></Box>)}</Box>
        <Box><Typography variant="caption" color="text.secondary">Notes</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{tower.notes || 'No notes recorded.'}</Typography></Box>
      </Stack> : <>
        <RadioGroup aria-label="Tower action" value={action} onChange={e => { setAction(e.target.value as Action); setError(''); }}>
          {options.map(option => <FormControlLabel key={option.value} value={option.value} disabled={pending || option.disabled} control={<Radio size="small" />} sx={{ m: 0, mb: 1, p: 1.25, border: '1px solid', borderColor: action === option.value ? 'primary.main' : 'divider', borderRadius: 2, bgcolor: action === option.value ? 'action.selected' : 'transparent', '& .MuiFormControlLabel-label': { flex: 1 } }} label={<Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>{option.icon}<Box><Typography variant="body2" sx={{ fontWeight: 700 }}>{option.title}</Typography><Typography variant="caption" color="text.secondary">{option.text}</Typography></Box></Stack>} />)}
        </RadioGroup>
        {action === 'assign' && canManage && <TextField select fullWidth label="Assign to team" value={teamId} onChange={e => setTeamId(e.target.value)} disabled={pending || isLoading} sx={{ mt: 1 }} helperText={isError ? 'Could not load teams. Close and try again.' : isLoading ? 'Loading teams…' : 'Select a different team to reassign this tower.'}><MenuItem value="">Select a team</MenuItem>{teams.map(team => <MenuItem key={team.id} value={String(team.id)} disabled={team.id === tower.assigned_team_id}>{team.name}{team.id === tower.assigned_team_id ? ' (current team)' : ''}</MenuItem>)}</TextField>}
        {(action === 'assign' || action === 'unassign') && <Alert severity="info" sx={{ mt: 2 }}>{action === 'unassign' ? `Unassign from ${tower.assigned_team_name || 'the current team'}.` : `Assign to ${target?.name || (canManage ? 'the selected team' : 'your team')}.`} {assigned ? 'This removes the previous team’s mission-plan links for this tower. ' : ''}Existing inspections and reports are kept.</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }} role="alert">{error}</Alert>}
      </>}
    </DialogContent>
    <DialogActions sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
      <Button disabled={pending} onClick={details ? () => setDetails(false) : onClose}>{details ? 'Back to actions' : 'Cancel'}</Button>
      {details ? canManage && <Button variant="contained" onClick={onEdit}>Edit registered details</Button> : <Button variant="contained" color={action === 'unassign' ? 'warning' : 'primary'} onClick={() => void submit()} disabled={pending || (action === 'assign' && (!canAssign || (canManage && (!target || target.id === tower.assigned_team_id)))) || (action === 'unassign' && !canUnassign)}>{pending ? 'Saving…' : action === 'register' ? 'View registered details' : action === 'inspections' ? 'Open inspections' : action === 'unassign' ? 'Unassign tower' : assigned ? 'Reassign tower' : 'Assign tower'}</Button>}
    </DialogActions>
  </Dialog>;
}
