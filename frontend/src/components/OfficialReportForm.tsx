import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import TextField from '@mui/material/TextField';
import {
  useAreas,
  useChoiceLists,
  useGenerateOetcAreaReport,
  useGenerateOetcConsolidatedReport,
  useGenerateOetcReport,
  useTeamJobMap,
  useTeams,
} from '../api/hooks';

type Mode = 'team' | 'area' | 'consolidated';

/** The one place to generate the customer's own official "Transmission Line Insulator Thermal
 * Inspection Report" — the exact template they handed us, filled in from real Position/Visit data,
 * never restyled. Three scopes cover everything an admin asks for: one team's own campaign (with an
 * optional single tower within it, for "just this one tower"), every team working one area, or the
 * whole project at once ("the general final report"). Same rendering path either way — see backend
 * services/oetc_report.py and oetc_grouped_report.py. */
export function OfficialReportForm() {
  const { data: teams } = useTeams();
  const { data: areas } = useAreas();
  const { data: lists } = useChoiceLists();
  const generateTeam = useGenerateOetcReport();
  const generateArea = useGenerateOetcAreaReport();
  const generateConsolidated = useGenerateOetcConsolidatedReport();

  const [mode, setMode] = useState<Mode>('team');
  const [teamId, setTeamId] = useState('');
  const [towerId, setTowerId] = useState('');
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

  const { data: jobMap } = useTeamJobMap(mode === 'team' && teamId ? Number(teamId) : undefined);

  const generating = generateTeam.isPending || generateArea.isPending || generateConsolidated.isPending;
  const requiredFilled =
    reportNumber.trim() &&
    startDate &&
    endDate &&
    (mode === 'consolidated' || (mode === 'area' && area) || (mode === 'team' && teamId));

  const handleModeChange = (next: Mode | null) => {
    if (!next) return;
    setMode(next);
    setTowerId('');
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
    if (mode === 'team') {
      generateTeam.mutate(
        { ...shared, team_id: Number(teamId), tower_id: towerId ? Number(towerId) : null },
        { onError },
      );
    } else if (mode === 'area') {
      generateArea.mutate({ ...shared, area }, { onError });
    } else {
      generateConsolidated.mutate(shared, { onError });
    }
  };

  const buttonLabel = generating
    ? 'Generating…'
    : mode === 'team'
      ? towerId
        ? 'Generate tower report'
        : 'Generate team report'
      : mode === 'area'
        ? 'Generate area report'
        : 'Generate final report';

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
        real inspection data — the page design is never changed. Pick what this report should cover:
        one team's own work (optionally just one tower of theirs), every team in one area, or
        everything at once as the general final report.
      </Typography>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_, v) => handleModeChange(v)}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="team">One team</ToggleButton>
        <ToggleButton value="area">One area</ToggleButton>
        <ToggleButton value="consolidated">Final report (everything)</ToggleButton>
      </ToggleButtonGroup>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        {mode === 'team' && (
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
            <TextField
              select
              size="small"
              label="Team"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setTowerId('');
              }}
              sx={{ minWidth: 220 }}
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
            <TextField
              select
              size="small"
              label="Tower"
              value={towerId}
              onChange={(e) => setTowerId(e.target.value)}
              disabled={!teamId}
              sx={{ minWidth: 220 }}
              helperText="Leave as 'All towers' for that team's whole campaign"
            >
              <MenuItem value="">
                <em>All towers (whole team campaign)</em>
              </MenuItem>
              {(jobMap?.towers || []).map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.tower_id}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        )}
        {mode === 'area' && (
          <TextField select size="small" label="Area" value={area} onChange={(e) => setArea(e.target.value)} sx={{ maxWidth: 320 }}>
            <MenuItem value="">
              <em>Select an area</em>
            </MenuItem>
            {areas?.map((a) => (
              <MenuItem key={a} value={a}>
                {a}
              </MenuItem>
            ))}
          </TextField>
        )}
        {mode === 'consolidated' && (
          <Alert severity="info" sx={{ maxWidth: 560 }}>
            Covers every area, every team, every mission — in Area → Team → Mission order, each
            team's own section unchanged. This is the one to hand the customer as the overall project
            report.
          </Alert>
        )}

        <TextField
          size="small"
          label="Report number"
          placeholder="e.g. OETC-DFRTRM-IR-2026-01"
          helperText={
            mode === 'team'
              ? 'Must be unique — used as the file name too.'
              : 'Each team\'s section gets its own number derived from this (e.g. -ASHOOR-SAADA-TEAM1) so it stays traceable per team.'
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
    </Box>
  );
}
