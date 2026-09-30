import { tr, useLanguage } from '../i18n';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Grid,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import { useAreas, useGenerateFieldExecutionPlan, useTeams } from '../api/hooks';

/** The customer-facing project mobilization/execution plan (.docx) — client info, live tower/team
 * counts pulled from the app, and a computed day-by-day schedule projection, rendered into a
 * bundled Word template that mirrors a real customer-approved layout exactly. Everything below is a
 * one-time-per-generation input (client, reference letter, period) plus which towers/teams to
 * include — see backend services/field_execution_plan.py for exactly what's computed vs. fixed. */
export function FieldExecutionPlanForm() {
  useLanguage();
  const { data: areas } = useAreas();
  const { data: teams } = useTeams();
  const generate = useGenerateFieldExecutionPlan();

  const [clientName, setClientName] = useState('');
  const [clientShort, setClientShort] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [preparedBy, setPreparedBy] = useState('Sky Green Line Technology');
  const [periodLabel, setPeriodLabel] = useState('');
  const [voltageLabel, setVoltageLabel] = useState('132 kV');
  const [regionLabel, setRegionLabel] = useState('');
  const [area, setArea] = useState('');
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [capacity, setCapacity] = useState(15);
  const [error, setError] = useState<string | null>(null);

  const teamById = new Map((teams || []).map((t) => [t.id, t.name]));

  const requiredFilled =
    clientName.trim() && clientShort.trim() && referenceNo.trim() && referenceDate.trim() && preparedBy.trim() &&
    periodLabel.trim() && voltageLabel.trim() && regionLabel.trim();

  const handleGenerate = () => {
    setError(null);
    generate.mutate(
      {
        client_name: clientName.trim(),
        client_short: clientShort.trim(),
        reference_no: referenceNo.trim(),
        reference_date: referenceDate.trim(),
        prepared_by: preparedBy.trim(),
        period_label: periodLabel.trim(),
        voltage_label: voltageLabel.trim(),
        region_label: regionLabel.trim(),
        area: area || undefined,
        team_ids: teamIds.length > 0 ? teamIds : undefined,
        capacity_per_team_per_day: capacity,
      },
      {
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || tr("Could not generate the plan document."));
        },
      },
    );
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{tr("Field execution plan")}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr("The customer-facing mobilization plan — client info, live tower/team counts, and a computed day-by-day schedule, generated into the approved plan layout. Assign each tower a")}{' '}
        <strong>{tr("Line sector")}</strong>{tr(" (Towers page) and each team a ")}<strong>{tr("Primary line sector")}</strong>{' '}{tr("(Teams page) first so the sector breakdown and schedule come out meaningful — towers without one are grouped as \"unclassified\".")}</Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {tr(error)}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Client name")}
            fullWidth
            size="small"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            helperText={tr("Full name only — the short code below is added automatically")}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Client short code")}
            fullWidth
            size="small"
            value={clientShort}
            onChange={(e) => setClientShort(e.target.value)}
            placeholder={tr("e.g. OETC")}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Reference letter number")}
            fullWidth
            size="small"
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Reference letter date")}
            fullWidth
            size="small"
            value={referenceDate}
            onChange={(e) => setReferenceDate(e.target.value)}
            placeholder={tr("shown exactly as typed, e.g. 06/09/2026")}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Prepared by")}
            fullWidth
            size="small"
            value={preparedBy}
            onChange={(e) => setPreparedBy(e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Target period")}
            fullWidth
            size="small"
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            placeholder={tr("e.g. September 2026")}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Voltage label")}
            fullWidth
            size="small"
            value={voltageLabel}
            onChange={(e) => setVoltageLabel(e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Region label")}
            fullWidth
            size="small"
            value={regionLabel}
            onChange={(e) => setRegionLabel(e.target.value)}
            placeholder={tr("e.g. Dhofar Governorate")}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            label={tr("Towers to include")}
            fullWidth
            size="small"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          >
            <MenuItem value="">{tr("All active towers")}</MenuItem>
            {areas?.map((a) => (
              <MenuItem key={a} value={a}>
                {a}{tr(" only")}</MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label={tr("Assumed towers/team/day")}
            type="number"
            fullWidth
            size="small"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value) || 1)}
            slotProps={{ htmlInput: { min: 1, max: 200 } }}
          />
        </Grid>
        <Grid size={12}>
          <Select
            multiple
            fullWidth
            size="small"
            displayEmpty
            value={teamIds}
            onChange={(e) => setTeamIds(typeof e.target.value === 'string' ? [] : (e.target.value as number[]))}
            renderValue={(selected) =>
              selected.length === 0 ? (
                <em>{tr("All active teams")}</em>
              ) : (
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((id) => (
                    <Chip key={id} size="small" label={teamById.get(id) || id} />
                  ))}
                </Stack>
              )
            }
          >
            {teams?.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                <Checkbox checked={teamIds.includes(t.id)} size="small" />
                <ListItemText primary={t.name} />
              </MenuItem>
            ))}
          </Select>
        </Grid>
      </Grid>

      <Button
        variant="contained"
        startIcon={<DescriptionRoundedIcon />}
        sx={{ mt: 2 }}
        disabled={!requiredFilled || generate.isPending}
        onClick={handleGenerate}
      >
        {generate.isPending ? tr("Generating…") : tr("Generate & download plan (.docx)")}
      </Button>
    </Box>
  );
}
