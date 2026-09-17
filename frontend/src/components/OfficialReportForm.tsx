import { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import TextField from '@mui/material/TextField';
import {
  useAreas,
  useChoiceLists,
  useGenerateOetcAreaReport,
  useGenerateOetcConsolidatedReport,
  useGenerateOetcReport,
  useTeams,
  useTowers,
} from '../api/hooks';
import { ReportHistoryTable } from './ReportHistoryTable';

type Mode = 'tower' | 'team' | 'line' | 'overall';

/** The one place to generate the customer's own official "Transmission Line Insulator Thermal
 * Inspection Report" — the exact template they handed us, filled in from real Position/Visit data,
 * never restyled. Matches how an admin actually thinks about it, smallest scope to largest: report
 * by tower (one specific tower — the team it belongs to is worked out automatically), by team (that
 * team's whole campaign so far), by line (a whole transmission line, e.g. "Ashoor-Saada" — every
 * team currently working any part of it, combined into one file), or the overall report (every
 * line, every team, every tower at once). "Line" here is the Tower.area field — in this app a line
 * and an area are the same thing, just named for what an admin actually calls it. Same rendering
 * path in every case — see backend services/oetc_report.py and oetc_grouped_report.py. */
export function OfficialReportForm() {
  const { data: teams } = useTeams();
  const { data: towers } = useTowers({ include_inactive: true, limit: 5000 });
  const { data: areas } = useAreas();
  const { data: lists } = useChoiceLists();
  const generateTeam = useGenerateOetcReport();
  const generateArea = useGenerateOetcAreaReport();
  const generateConsolidated = useGenerateOetcConsolidatedReport();

  const [mode, setMode] = useState<Mode>('tower');
  const [teamId, setTeamId] = useState('');
  const [towerId, setTowerId] = useState<number | null>(null);
  const [area, setArea] = useState('');
  const [reportNumber, setReportNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [overallCondition, setOverallCondition] = useState('');
  const [probableCause, setProbableCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [additionalComments, setAdditionalComments] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [reviewedBy, setReviewedBy] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvalDate, setApprovalDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const towerOptions = useMemo(
    () =>
      (towers || [])
        .slice()
        .sort((a, b) => a.tower_id.localeCompare(b.tower_id, undefined, { numeric: true }))
        .map((t) => ({ id: t.id, label: t.area ? `${t.tower_id} — ${t.area}` : t.tower_id, assigned_team_name: t.assigned_team_name })),
    [towers],
  );
  const selectedTowerOption = towerOptions.find((t) => t.id === towerId) || null;

  const generating = generateTeam.isPending || generateArea.isPending || generateConsolidated.isPending;
  const requiredFilled =
    reportNumber.trim() &&
    startDate &&
    endDate &&
    (mode === 'overall' ||
      (mode === 'team' && teamId) ||
      (mode === 'tower' && towerId) ||
      (mode === 'line' && area));

  const handleModeChange = (next: Mode | null) => {
    if (!next) return;
    setMode(next);
    setError(null);
  };

  const handleGenerate = () => {
    setError(null);
    const shared = {
      report_number: reportNumber.trim(),
      start_date: startDate,
      end_date: endDate,
      overall_condition: overallCondition || null,
      probable_cause: probableCause.trim() || null,
      corrective_action: correctiveAction.trim() || null,
      additional_comments: additionalComments.trim() || null,
      prepared_by: preparedBy.trim() || null,
      reviewed_by: reviewedBy.trim() || null,
      approved_by: approvedBy.trim() || null,
      approval_date: approvalDate || null,
    };
    const onError = (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Could not generate the report.');
    };
    if (mode === 'tower') {
      generateTeam.mutate({ ...shared, tower_id: towerId }, { onError });
    } else if (mode === 'team') {
      generateTeam.mutate({ ...shared, team_id: Number(teamId) }, { onError });
    } else if (mode === 'line') {
      generateArea.mutate({ ...shared, area }, { onError });
    } else {
      generateConsolidated.mutate(shared, { onError });
    }
  };

  const buttonLabel = generating
    ? 'Generating…'
    : mode === 'tower'
      ? 'Generate tower report'
      : mode === 'team'
        ? 'Generate team report'
        : mode === 'line'
          ? 'Generate line report'
          : 'Generate overall report';

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
        <DescriptionRoundedIcon color="action" fontSize="small" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Official report for the customer
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Fills the customer's own "Transmission Line Insulator Thermal Inspection Report" template with
        real inspection data — the page design is never changed. Four kinds, smallest to largest:{' '}
        <strong>by tower</strong> (one specific tower), <strong>by team</strong> (everything that team
        has done so far), <strong>by line</strong> (a whole transmission line, e.g. Ashoor-Saada —
        every team currently working any part of it, combined into one file), and{' '}
        <strong>overall</strong> (every line, every team, every tower together — the one to hand the
        customer as the final project report).
      </Typography>

      <Accordion variant="outlined" sx={{ mb: 2 }} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          <Typography variant="subtitle2">
            Getting "No visits found" or an empty report? Check this first
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1}>
            <Typography variant="body2">
              <strong>1.</strong> The tower is assigned to a team (Towers page) — not "Unassigned".
            </Typography>
            <Typography variant="body2">
              <strong>2.</strong> The visit was started from the team leader's or a crew member's own
              login (they tap the tower, then <strong>Start visit</strong>) — not created directly by
              an admin. This is what links a visit to a team; it's the most common reason a report
              comes back empty.
            </Typography>
            <Typography variant="body2">
              <strong>3.</strong> At least one position on that visit has a Direction set or a photo
              uploaded — an untouched position is correctly left out, not an error.
            </Typography>
            <Typography variant="body2">
              <strong>4.</strong> The date range below actually covers when the work was recorded.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Full walkthrough: Help page → For Admins → 7. Reports → "How to build the final report".
            </Typography>
          </Stack>
        </AccordionDetails>
      </Accordion>

      <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, v) => handleModeChange(v)} sx={{ mb: 2 }}>
        <ToggleButton value="tower">By tower</ToggleButton>
        <ToggleButton value="team">By team</ToggleButton>
        <ToggleButton value="line">By line</ToggleButton>
        <ToggleButton value="overall">Overall (final report)</ToggleButton>
      </ToggleButtonGroup>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        {mode === 'tower' && (
          <Box>
            <Autocomplete
              size="small"
              sx={{ maxWidth: 360 }}
              options={towerOptions}
              value={selectedTowerOption}
              onChange={(_e, v) => setTowerId(v ? v.id : null)}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => <TextField {...params} label="Tower" placeholder="Search by tower number" />}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {selectedTowerOption
                ? selectedTowerOption.assigned_team_name
                  ? `Team: ${selectedTowerOption.assigned_team_name} (worked out automatically)`
                  : 'This tower has no team assigned yet — assign it on the Towers page first.'
                : 'Just the report for this one tower — the team is worked out automatically.'}
            </Typography>
          </Box>
        )}
        {mode === 'team' && (
          <TextField
            select
            size="small"
            label="Team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            sx={{ minWidth: 220, maxWidth: 320 }}
            helperText="Covers that team's whole campaign in the date range below."
          >
            <MenuItem value="">
              <em>Select a team</em>
            </MenuItem>
            {teams?.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {mode === 'line' && (
          <Box>
            <TextField
              select
              size="small"
              label="Transmission line"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              sx={{ minWidth: 220, maxWidth: 320 }}
              helperText="Every team currently working this line, combined into one file."
            >
              <MenuItem value="">
                <em>Select a line</em>
              </MenuItem>
              {areas?.map((a) => (
                <MenuItem key={a} value={a}>
                  {a}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        )}
        {mode === 'overall' && (
          <Alert severity="info" sx={{ maxWidth: 560 }}>
            Every line, every team, every mission — in Line → Team → Mission order, each team's own
            section unchanged. This is the one to hand the customer as the overall project report.
          </Alert>
        )}

        <TextField
          size="small"
          label="Report number"
          placeholder="e.g. OETC-DFRTRM-IR-2026-01"
          helperText={
            mode === 'tower' || mode === 'team'
              ? 'Must be unique — used as the file name too.'
              : "Each team's section gets its own number derived from this (e.g. -ASHOOR-SAADA-TEAM1) so it stays traceable per team."
          }
          value={reportNumber}
          onChange={(e) => setReportNumber(e.target.value)}
          sx={{ maxWidth: 420 }}
        />

        <Stack direction="row" spacing={2}>
          <TextField
            type="date"
            size="small"
            label="From"
            slotProps={{ inputLabel: { shrink: true } }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <TextField
            type="date"
            size="small"
            label="To"
            slotProps={{ inputLabel: { shrink: true } }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Stack>

        <TextField
          select
          size="small"
          label="Overall condition"
          value={overallCondition}
          onChange={(e) => setOverallCondition(e.target.value)}
          sx={{ maxWidth: 320 }}
        >
          <MenuItem value="">
            <em>Not set</em>
          </MenuItem>
          {lists?.overall_condition.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Probable cause of thermal anomaly"
          multiline
          minRows={2}
          value={probableCause}
          onChange={(e) => setProbableCause(e.target.value)}
        />
        <TextField
          size="small"
          label="Recommended corrective action"
          multiline
          minRows={2}
          value={correctiveAction}
          onChange={(e) => setCorrectiveAction(e.target.value)}
        />
        <TextField
          size="small"
          label="Additional comments"
          multiline
          minRows={2}
          value={additionalComments}
          onChange={(e) => setAdditionalComments(e.target.value)}
        />

        <Typography variant="subtitle2">Approval — applied to every section in the file</Typography>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
          <TextField size="small" label="Prepared by" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
          <TextField size="small" label="Reviewed by" value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} />
          <TextField size="small" label="Approved by" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
          <TextField
            type="date"
            size="small"
            label="Approval date"
            slotProps={{ inputLabel: { shrink: true } }}
            value={approvalDate}
            onChange={(e) => setApprovalDate(e.target.value)}
          />
        </Stack>

        <Box>
          <Button variant="contained" disabled={!requiredFilled || generating} onClick={handleGenerate}>
            {buttonLabel}
          </Button>
        </Box>
      </Stack>

      <Accordion variant="outlined" sx={{ mt: 3 }} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <HistoryRoundedIcon fontSize="small" color="action" />
            <Typography variant="subtitle2">Report history — see what's already been generated</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary">
            Every report generated above, with a one-click re-download — no need to redo the form
            or risk reusing a report number that's already taken.
          </Typography>
          <ReportHistoryTable />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
