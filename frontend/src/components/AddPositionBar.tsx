import { tr, useLanguage } from '../i18n';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import ExploreRounded from '@mui/icons-material/ExploreRounded';
import CableRounded from '@mui/icons-material/CableRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import type { ChoiceLists, Position } from '../api/types';

import { positionError } from '../utils/positionChanges';

// Display-only hint — S1/S2 stay the actual stored values (position codes, the 12-slot identity,
// and every existing report already key off them), this just shows which physical string each one
// conventionally is so a leader doesn't have to guess or check a separate field.
const STRING_LABELS: Record<string, string> = { S1: 'S1 — Outer', S2: 'S2 — Inner' };

function comboKey(ohl: string, phase: string, string_: string, direction: string | null) {
  return `${ohl}|${phase}|${string_}|${direction ?? ''}`;
}

interface Props {
  /** All existing positions. Hidden baseline slots can be activated; slots freed by an
   * edit or deletion can be created again. */
  positions: Position[];
  hiddenIds: Set<number>;
  lists: ChoiceLists;
  /** The tower's line/area name supplies a Suspension default, never a Tension restriction. */
  towerArea?: string | null;
  onAdd: (position: Position, direction: string, mountType: string, stringCount: string, viewSide: string) => Promise<void>;
  /** Creates a missing slot after an edit/deletion, or an additional Tension direction. */
  onCreate: (ohl: string, phase: string, string_: string, direction: string, mountType: string, stringCount: string, viewSide: string) => Promise<void>;
}

export function AddPositionBar({ positions: allPositions, hiddenIds, lists, onAdd, onCreate }: Props) {
  useLanguage();
  const [viewSide, setViewSide] = useState('Front');
  const positions = allPositions.filter(p => p.view_side === viewSide || (!p.direction && hiddenIds.has(p.id)));
  const [mountType, setMountType] = useState('');
  const [ohl, setOhl] = useState('');
  const [direction, setDirection] = useState('');
  const [phase, setPhase] = useState('');
  const [stringVal, setStringVal] = useState('');
  const [stringCount, setStringCount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveLock = useRef(false);

  const isTension = mountType === 'Tension';
  const hidden = positions.filter((p) => hiddenIds.has(p.id));
  const match = hidden.find((p) => p.ohl === ohl && p.phase === phase && p.string === stringVal);

  // Branches can face destinations beyond the two names in the tower's line.
  const tensionDirections = lists.direction;

  // Every (ohl, direction, phase, string) combo already on screen (a claimed baseline slot or an
  // already-created extra) — everything else is still available to add for a Tension tower.
  const claimed = new Set(
    positions.filter((p) => !hiddenIds.has(p.id)).map((p) => comboKey(p.ohl, p.phase, p.string, p.direction)),
  );
  const tensionCombos = lists.ohl.flatMap((o) =>
    tensionDirections.flatMap((d) => lists.phase.flatMap((p) => lists.string.map((s) => ({ ohl: o, direction: d, phase: p, string: s })))),
  );
  const tensionRemaining = tensionCombos.filter((c) => !claimed.has(comboKey(c.ohl, c.phase, c.string, c.direction)));
  // Editing S1 to S2 can free a canonical slot without leaving a hidden baseline row.
  const remaining = lists.ohl.flatMap(o => lists.phase.flatMap(p => lists.string.map(s => ({ ohl: o, phase: p, string: s }))))
    .filter(c => !positions.some(p => !hiddenIds.has(p.id) && p.ohl === c.ohl && p.phase === c.phase && p.string === c.string));

  const reset = () => { setStringVal(''); };


  const ohlOptions = isTension ? [...new Set(tensionRemaining.map((c) => c.ohl))] : [...new Set(remaining.map((p) => p.ohl))];
  const directionOptions = isTension
    ? [...new Set(tensionRemaining.filter((c) => c.ohl === ohl).map((c) => c.direction))]
    : lists.direction;
  const phaseOptions = isTension
    ? [...new Set(tensionRemaining.filter((c) => c.ohl === ohl && c.direction === direction).map((c) => c.phase))]
    : [...new Set(remaining.filter((p) => p.ohl === ohl).map((p) => p.phase))];
  const availableStrings = isTension
    ? tensionRemaining.filter((c) => c.ohl === ohl && c.direction === direction && c.phase === phase).map((c) => c.string)
    : [...new Set(remaining.filter((p) => p.ohl === ohl && p.phase === phase).map((p) => p.string))];

  const stringOptions = availableStrings.filter(s => stringCount === 'Double' || (stringCount === 'Single' && s === 'S1'));
  const handleAdd = async () => {
    if (saveLock.current || !mountType || !stringCount || !stringOptions.includes(stringVal)) return;
    saveLock.current = true;
    setSaving(true); setError('');
    try {
      if (!ohl || !phase || !stringVal || (isTension && !direction)) return;
      if (match) {
        await onAdd(match, mountType === 'Suspension' ? 'NA' : direction, mountType, stringCount, viewSide);
      } else {
        await onCreate(ohl, phase, stringVal, mountType === 'Suspension' ? 'NA' : direction, mountType, stringCount, viewSide);
      }
      reset();

    } catch (err) {
      setError(positionError(err, tr("Addition not confirmed. Your entries are kept here. Check your connection and reload the visit before retrying if the server may have received the request.")));
    } finally { saveLock.current = false; setSaving(false); }
  };

  const ready = !saving && !!mountType && !!stringCount && stringOptions.includes(stringVal) && !!(ohl && phase && stringVal) && (Boolean(match) || !!direction) && (!isTension || !!direction);
  const hint = !mountType ? 'Choose the tower type to begin.' : !ohl ? 'Choose the OHL side of the tower.' : isTension && !direction ? 'Choose the direction for this tension position.' : !phase ? 'Choose the phase: R, Y or B.' : !stringCount ? 'Choose whether this position has one or two strings.' : !stringVal ? 'Choose the string you are inspecting.' : !ready ? 'Complete the remaining position details.' : 'Ready to add to the visit draft. Enter readings and photos next.';
  return <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, borderRadius: '20px', bgcolor: 'background.paper' }}>
    <Stack component="fieldset" disabled={saving} spacing={2} sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        <PositionStep number={1} icon={<VisibilityRounded />} title={tr('View & tower type')} description={tr('Identify the observation side and tower design.')} complete={!!mountType}>
        <TextField select size="small" label={tr('Viewing side')} value={viewSide} onChange={e => { setViewSide(e.target.value); setPhase(''); setStringVal(''); }} sx={{ minWidth: 150 }}><MenuItem value="Front">{tr('Front view')}</MenuItem><MenuItem value="Back">{tr('Back view')}</MenuItem></TextField>
        <TextField
          select
          size="small"
          label={tr("Tower type")}
          value={mountType}
          onChange={(e) => {
            const value = e.target.value;
            setMountType(value);
            setOhl('');
            setPhase('');
            setStringCount('');
            setStringVal('');
            setDirection(value === 'Suspension' ? 'NA' : '');
          }}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">—</MenuItem>
          {lists.mount_type.map((m) => (
            <MenuItem key={m} value={m}>
              {tr(m)}
            </MenuItem>
          ))}
        </TextField>

        </PositionStep>
        <PositionStep number={2} icon={<ExploreRounded />} title={tr('Locate the position')} description={tr('Choose the OHL, direction when needed, and phase.')} complete={!!ohl && !!phase && (!isTension || !!direction)}>
        <TextField
          select
          size="small"
          label={tr("OHL")}
          disabled={!mountType}
          value={ohl}
          onChange={(e) => {
            setOhl(e.target.value);
            if (isTension) setDirection('');
            setPhase('');
            setStringCount('');
            setStringVal('');
          }}
          sx={{ minWidth: 110 }}
        >
          {ohlOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {tr(v)}
            </MenuItem>
          ))}
        </TextField>
        {isTension && (
          <TextField
            select
            size="small"
            label={tr("Direction")}
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value);
              setPhase('');
              setStringCount('');
              setStringVal('');
            }}
            disabled={!ohl}
            sx={{ minWidth: 110 }}
          >
            {directionOptions.map((d) => (
              <MenuItem key={d} value={d}>
                {tr(d)}
              </MenuItem>
            ))}
          </TextField>
        )}
        {mountType && !isTension && mountType !== 'Suspension' && (
          <TextField
            select
            size="small"
            label={tr("Direction")}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            disabled={mountType === 'Suspension'}
            helperText={mountType === 'Suspension' ? tr("Not needed for Suspension") : undefined}
            sx={{ minWidth: 110 }}
          >
            <MenuItem value="">—</MenuItem>
            {lists.direction.map((d) => (
              <MenuItem key={d} value={d}>
                {tr(d)}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          size="small"
          label={tr("Phase")}
          value={phase}
          onChange={(e) => {
            const nextPhase = e.target.value;
            setPhase(nextPhase);
            const saved = positions.find(p => !hiddenIds.has(p.id) && p.ohl === ohl && p.phase === nextPhase && p.direction === direction && p.mount_type === mountType && p.string_count);
            setStringCount(saved?.string_count || '');
            setStringVal('');
          }}
          disabled={isTension ? !ohl || !direction : !ohl}
          sx={{ minWidth: 110 }}
        >
          {phaseOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {tr(v)}
            </MenuItem>
          ))}
        </TextField>

          {mountType === 'Suspension' && <Typography variant="caption" color="text.secondary">{tr('Not needed for Suspension')}</Typography>}
        </PositionStep>
        <PositionStep number={3} icon={<CableRounded />} title={tr('Identify the string')} description={tr('For double strings: S1 is outer and S2 is inner.')} complete={!!stringVal && stringOptions.includes(stringVal)}>
        <TextField select size="small" label={tr("Number of strings")} value={stringCount}
          disabled={!phase} onChange={e => { setStringCount(e.target.value); setStringVal(''); }} sx={{ minWidth: 160 }}>
          <MenuItem value="Single">1</MenuItem><MenuItem value="Double">2</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={tr("String")}
          value={stringVal}
          onChange={(e) => setStringVal(e.target.value)}
          disabled={!phase || !stringCount}
          sx={{ minWidth: 150 }}
        >
          {stringOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {tr(stringCount === 'Double' ? STRING_LABELS[v] || v : v)}
            </MenuItem>
          ))}
        </TextField>

        </PositionStep>
      </Box>
      <Box sx={{ p: 2, borderRadius: '16px', bgcolor: 'action.hover' }}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: .75, mb: 1.5 }} aria-label={tr('Position preview')}>
          {[tr(viewSide === 'Front' ? 'Front view' : 'Back view'), mountType && tr(mountType), ohl, phase, mountType === 'Suspension' ? '' : direction, stringCount && tr(stringCount === 'Single' ? '1 string' : '2 strings'), stringVal && tr(stringCount === 'Double' ? STRING_LABELS[stringVal] || stringVal : stringVal)].filter(Boolean).map((value, i) => <Chip key={i} label={value} size="small" variant="outlined" sx={{ bgcolor: 'background.paper' }} />)}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, gap: 2, justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {ready ? <CheckCircleRounded color="success" /> : <ArrowForwardRounded color="primary" sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />}
            <Typography variant="body2" aria-live="polite">{tr(hint)}</Typography>
          </Stack>
        <Button
          variant="contained"
          startIcon={<AddCircleOutlineIcon />}
          disabled={saving || !mountType || !stringCount || !stringOptions.includes(stringVal) || !(ohl && phase && stringVal) || (!match && !direction) || (isTension && !direction)}
          onClick={() => void handleAdd()}
        >
          {saving ? tr("Adding…") : tr("Add position")}
        </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{tr('Adds one position to your draft. Confirm the whole visit once when ready.')}</Typography>
      </Box>
    </Stack>
    {phase && stringCount && !stringOptions.length && <Alert severity="info" sx={{ mt: 1 }}>{tr("The matching string positions have already been added. Edit their inspection cards below.")}</Alert>}
    {error && <Alert severity="error" sx={{ mt: 1 }}>{tr(error)}</Alert>}
  </Paper>;
}

function PositionStep({ number, icon, title, description, complete, children }: { number: number; icon: ReactNode; title: string; description: string; complete: boolean; children: ReactNode }) {
  return <Stack spacing={1.5} sx={{ p: 2, border: '1px solid', borderColor: complete ? 'success.main' : 'divider', borderRadius: '18px', minWidth: 0, '& .MuiTextField-root': { width: '100%', minWidth: '0 !important' }, '& .MuiOutlinedInput-root': { bgcolor: theme => theme.palette.mode === 'dark' ? '#2d3028' : '#fff9df' } }}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Box sx={{ display: 'grid', placeItems: 'center', p: 1, bgcolor: 'action.hover', color: 'primary.main', borderRadius: '12px' }}>{icon}</Box>
      <Chip size="small" icon={complete ? <CheckCircleRounded /> : undefined} label={number} color={complete ? 'success' : 'default'} variant="outlined" />
    </Stack>
    <Box><Typography component="h4" sx={{ fontWeight: 800 }}>{title}</Typography><Typography variant="caption" color="text.secondary">{description}</Typography></Box>
    {children}
  </Stack>;
}
