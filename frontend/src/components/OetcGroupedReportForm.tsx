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
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import TextField from '@mui/material/TextField';
import { useAreas, useChoiceLists, useGenerateOetcAreaReport, useGenerateOetcConsolidatedReport } from '../api/hooks';

type Mode = 'area' | 'consolidated';

/** Same official "Transmission Line Insulator Thermal Inspection Report" template as the single-team
 * one on each team's own page — this one bundles more than one team's campaign into a single .docx:
 * either every team currently working one area, or (Consolidated) every team in every area at once.
 * Sections stay in Area → Team → Mission order; each team's own section is rendered completely
 * unchanged, so the customer's official page design is never touched — see
 * backend services/oetc_grouped_report.py. */
export function OetcGroupedReportForm() {
  const { data: areas } = useAreas();
  const { data: lists } = useChoiceLists();
  const generateArea = useGenerateOetcAreaReport();
  const generateConsolidated = useGenerateOetcConsolidatedReport();

  const [mode, setMode] = useState<Mode>('area');
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

  const generating = generateArea.isPending || generateConsolidated.isPending;
  const requiredFilled = reportNumber.trim() && startDate && endDate && (mode === 'consolidated' || area);

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
    if (mode === 'area') {
      generateArea.mutate({ ...shared, area }, { onError });
    } else {
      generateConsolidated.mutate(shared, { onError });
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
        <LayersRoundedIcon color="action" fontSize="small" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Grouped official report — by area
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The same official template as a single team's report on its own page — this bundles every team's
        campaign into one file: pick one area for just that area's teams, or "Consolidated" for every area,
        every team, every mission at once. Each team keeps its own unmodified section, in Area → Team → Mission
        order, so the customer's page design is never touched.
      </Typography>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_, v) => v && setMode(v)}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="area">By area</ToggleButton>
        <ToggleButton value="consolidated">Consolidated (every area)</ToggleButton>
      </ToggleButtonGroup>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={2}>
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

        <TextField
          size="small"
          label="Base report number"
          placeholder="e.g. OETC-DFRTRM-IR-2026-01"
          helperText="Each team's section gets its own number derived from this (e.g. -ASHOOR-SAADA-TEAM1) so it stays traceable per team."
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

        <Typography variant="subtitle2">Approval — applied to every team's section</Typography>
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
            {generating ? 'Generating…' : mode === 'area' ? 'Generate area report' : 'Generate consolidated report'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
