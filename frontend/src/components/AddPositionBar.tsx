import { useState } from 'react';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineRounded';
import type { ChoiceLists, Position } from '../api/types';
import { deriveDirectionFromArea, deriveDirectionsFromArea } from '../utils/direction';

// Display-only hint — S1/S2 stay the actual stored values (position codes, the 12-slot identity,
// and every existing report already key off them), this just shows which physical string each one
// conventionally is so a leader doesn't have to guess or check a separate field.
const STRING_LABELS: Record<string, string> = { S1: 'S1 — Outer', S2: 'S2 — Inner' };

function comboKey(ohl: string, phase: string, string_: string, direction: string | null) {
  return `${ohl}|${phase}|${string_}|${direction ?? ''}`;
}

interface Props {
  /** All baseline positions for this visit (the 12 canonical (OHL, phase, string) slots always
   * exist server-side — see BUILD_PROMPT's fixed ID scheme — plus any extra Tension-direction rows
   * already created). Only the ones in `hiddenIds` are offered here; everything else is already on
   * screen. */
  positions: Position[];
  hiddenIds: Set<number>;
  lists: ChoiceLists;
  /** The tower's own line/area name — used to auto-fill Direction for Suspension, and to offer
   * only this tower's own line directions (e.g. "Ashoor-Saada" -> Ashoor, Saada) for Tension. */
  towerArea?: string | null;
  onAdd: (position: Position, direction: string, mountType: string, stringCount: string) => Promise<void>;
  /** Creates a missing slot after a string edit, or an additional Tension direction. */
  onCreate: (ohl: string, phase: string, string_: string, direction: string, mountType: string, stringCount: string) => Promise<void>;
}

export function AddPositionBar({ positions, hiddenIds, lists, towerArea, onAdd, onCreate }: Props) {
  const [mountType, setMountType] = useState('');
  const [ohl, setOhl] = useState('');
  const [direction, setDirection] = useState('');
  const [phase, setPhase] = useState('');
  const [stringVal, setStringVal] = useState('');
  const [stringCount, setStringCount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isTension = mountType === 'Tension';
  const hidden = positions.filter((p) => hiddenIds.has(p.id));
  const match = hidden.find((p) => p.ohl === ohl && p.phase === phase && p.string === stringVal);

  // This tower's own line directions (typically 2, from its area name, e.g. "Ashoor-Saada") — a
  // Tension tower needs both, not just the single best guess Suspension uses. Falls back to the
  // full choice list when the area doesn't match any of them, so nothing is ever fully blocked.
  const towerDirections = deriveDirectionsFromArea(towerArea, lists.direction);
  const tensionDirections = towerDirections.length > 0 ? towerDirections : lists.direction;

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

  const reset = () => {
    setStringCount('');
    setMountType('');
    setOhl('');
    setDirection('');
    setPhase('');
    setStringVal('');
  };

  if (remaining.length === 0 && tensionRemaining.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography color="text.secondary">All positions have been added.</Typography>
      </Paper>
    );
  }

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
    if (saving || !mountType || !stringCount || !stringOptions.includes(stringVal)) return;
    setSaving(true); setError('');
    try {
      if (!ohl || !phase || !stringVal || (isTension && !direction)) return;
      if (match) {
        await onAdd(match, direction, mountType, stringCount);
      } else {
        await onCreate(ohl, phase, stringVal, direction, mountType, stringCount);
      }
      reset();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Could not add this position. Please check the fields and try again.');
    } finally { setSaving(false); }
  };

  return (
    <Paper
      elevation={4}
      sx={{
        p: 2,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'success.light',
      }}
    >
      <Stack component="fieldset" disabled={saving} direction="row" spacing={2} sx={{ m: 0, p: 0, border: 0, alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography sx={{ fontWeight: 700 }}>Add position</Typography>
        <TextField
          select
          size="small"
          label="Tower type"
          value={mountType}
          onChange={(e) => {
            const value = e.target.value;
            setMountType(value);
            setOhl('');
            setPhase('');
            setStringCount('');
            setStringVal('');
            // Suspension runs straight through — no direction to record. Auto-fill it from the
            // tower's own line so the position still gets a valid image code. Tension needs a real
            // choice (it can run toward more than one direction), so clear it instead.
            setDirection(value === 'Suspension' ? deriveDirectionFromArea(towerArea, lists.direction) || '' : '');
          }}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">—</MenuItem>
          {lists.mount_type.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="OHL"
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
              {v}
            </MenuItem>
          ))}
        </TextField>
        {isTension && (
          <TextField
            select
            size="small"
            label="Direction"
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
                {d}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          size="small"
          label="Phase"
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
              {v}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Number of strings" value={stringCount}
          disabled={!phase} onChange={e => { setStringCount(e.target.value); setStringVal(''); }} sx={{ minWidth: 160 }}>
          <MenuItem value="Single">1</MenuItem><MenuItem value="Double">2</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="String"
          value={stringVal}
          onChange={(e) => setStringVal(e.target.value)}
          disabled={!phase || !stringCount}
          sx={{ minWidth: 150 }}
        >
          {stringOptions.map((v) => (
            <MenuItem key={v} value={v}>
              {stringCount === 'Double' ? STRING_LABELS[v] || v : v}
            </MenuItem>
          ))}
        </TextField>
        {!isTension && (
          <TextField
            select
            size="small"
            label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            disabled={mountType === 'Suspension'}
            helperText={mountType === 'Suspension' ? 'Not needed for Suspension' : undefined}
            sx={{ minWidth: 110 }}
          >
            <MenuItem value="">—</MenuItem>
            {lists.direction.map((d) => (
              <MenuItem key={d} value={d}>
                {d}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Button
          variant="contained"
          startIcon={<AddCircleOutlineIcon />}
          disabled={saving || !mountType || !stringCount || !stringOptions.includes(stringVal) || !(ohl && phase && stringVal) || (!match && !direction) || (isTension && !direction)}
          onClick={() => void handleAdd()}
        >
          {saving ? 'Saving…' : 'Add'}
        </Button>
      </Stack>
      {mountType && phase && stringCount && <Typography variant="body2" sx={{ mt: 1.5 }}>
        {mountType} · {ohl} · Phase {phase} · {stringCount === 'Single' ? '1 string' : '2 strings'} · {stringVal ? (stringCount === 'Double' ? STRING_LABELS[stringVal] : stringVal) : 'Choose a string'}
      </Typography>}
      {phase && stringCount && !stringOptions.length && <Alert severity="info" sx={{ mt: 1 }}>The matching string positions have already been added. Edit their inspection cards below.</Alert>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Paper>
  );
}
