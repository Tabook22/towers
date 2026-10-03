import { tr, useLanguage } from '../i18n';
import { useMemo, useRef, useState } from 'react';
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
import TransmissionTowerIcon from './TransmissionTowerIcon';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import {
  useAreas,
  useChoiceLists,
  useGenerateOetcAreaReport,
  useGenerateOetcConsolidatedReport,
  useGenerateOetcReport,
  useOetcReportPreview,
  useTeams,
  useTowers,
} from '../api/hooks';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import { DashboardSection } from './DashboardSection';
import { ReportHistoryTable } from './ReportHistoryTable';
import { reportError } from '../utils/reportLibrary';

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
export function OfficialReportForm({ showHistory = true, onCreated }: { showHistory?: boolean; onCreated?: () => void }) {
  useLanguage();
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
  const generationLock = useRef(false);

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
  const scopeChosen =
    mode === 'overall' || (mode === 'team' && !!teamId) || (mode === 'tower' && !!towerId) || (mode === 'line' && !!area);
  const validDates = Boolean(startDate && endDate && startDate <= endDate);
  const requiredFilled = validDates && scopeChosen;

  // Live "what will this include" check — fires the moment a scope and both dates are picked, well
  // before the report number/sign-off fields are filled in, so the "no visits found" surprise (the
  // single biggest source of confusion with this form) shows up immediately instead of only after
  // clicking Generate.
  const preview = useOetcReportPreview({
    team_id: mode === 'team' ? Number(teamId) : undefined,
    tower_id: mode === 'tower' && towerId ? towerId : undefined,
    area: mode === 'line' ? area : undefined,
    start_date: startDate || undefined,
    end_date: endDate || undefined,
    enabled: Boolean(scopeChosen && validDates),
  });

  const handleModeChange = (next: Mode | null) => {
    if (!next) return;
    setMode(next);
    setError(null);
  };

  const handleGenerate = () => {
    if (generationLock.current || generating || !requiredFilled || preview.isFetching || preview.isError || !preview.data?.ok) return;
    generationLock.current = true;
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
    const onError = async (err: unknown) => {
      setError(await reportError(err, tr("Could not generate the report.")));
    };
    const onSettled = () => { generationLock.current = false; };
    if (mode === 'tower') {
      generateTeam.mutate({ ...shared, tower_id: towerId }, { onError, onSuccess: onCreated, onSettled });
    } else if (mode === 'team') {
      generateTeam.mutate({ ...shared, team_id: Number(teamId) }, { onError, onSuccess: onCreated, onSettled });
    } else if (mode === 'line') {
      generateArea.mutate({ ...shared, area }, { onError, onSuccess: onCreated, onSettled });
    } else {
      generateConsolidated.mutate(shared, { onError, onSuccess: onCreated, onSettled });
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
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{tr("Official report for the customer")}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr("Choose the inspection scope and date range, review the coverage, then add your assessment and sign-off. Reports use the official customer template and are saved to the library.")}</Typography>

      <Accordion variant="outlined" sx={{ mb: 2 }} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><HelpOutlineRounded color="primary" fontSize="small" /><Typography variant="subtitle2">{tr("Help with report coverage")}</Typography></Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1}>
            <Typography variant="body2">
              <strong>1.</strong>{tr(" The tower has inspection visits linked to a team in the selected date range.")}</Typography>
            <Typography variant="body2">
              <strong>2.</strong>{tr(" The visit must be linked to the team that performed the inspection. Admin-created visits can also be included when correctly team-linked.")}</Typography>
            <Typography variant="body2">
              <strong>3.</strong>{tr(" Record a screening result, reading, inspector note or evidence. Prepared layouts alone are excluded; older direction-only records are retained.")}</Typography>
            <Typography variant="body2">
              <strong>4.</strong>{tr(" The date range below actually covers when the work was recorded.")}</Typography>
            <Typography variant="body2" color="text.secondary">{tr("Full walkthrough: Help page → For Admins → 7. Reports → \"How to build the final report\".")}</Typography>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {tr(error)}
        </Alert>
      )}

      <Stack component="fieldset" disabled={generating} spacing={2.5} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <DashboardSection icon={<CalendarMonthRounded />} title={tr('1 · Scope & dates')} description={tr('Choose which inspections to include and check the coverage before writing your assessment.')} tone="teal">
      <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, v) => handleModeChange(v)} sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1, '& .MuiToggleButton-root': { minHeight: 48, borderRadius: '12px !important', border: '1px solid', borderColor: 'divider', gap: 1 } }}>
        <ToggleButton value="tower"><TransmissionTowerIcon fontSize="small" />{tr("By tower")}</ToggleButton>
        <ToggleButton value="team"><GroupsRoundedIcon fontSize="small" />{tr("By team")}</ToggleButton>
        <ToggleButton value="line"><TransmissionTowerIcon fontSize="small" />{tr("By line")}</ToggleButton>
        <ToggleButton value="overall"><DescriptionRoundedIcon fontSize="small" />{tr("Overall (final report)")}</ToggleButton>
      </ToggleButtonGroup>


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
              renderInput={(params) => <TextField {...params} label={tr("Tower")} placeholder={tr("Search by tower number")} />}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {selectedTowerOption ? selectedTowerOption.assigned_team_name ? tr("Team: {0} (worked out automatically)", [selectedTowerOption.assigned_team_name]) : tr("The team will be resolved from this tower’s inspection visits.") : tr("Just the report for this one tower — the team is worked out automatically.")}
            </Typography>
          </Box>
        )}
        {mode === 'team' && (
          <TextField
            select
            size="small"
            label={tr("Team")}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            sx={{ minWidth: 220, maxWidth: 320 }}
            helperText={tr("Covers that team's whole campaign in the date range below.")}
          >
            <MenuItem value="">
              <em>{tr("Select a team")}</em>
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
              label={tr("Transmission line")}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              sx={{ minWidth: 220, maxWidth: 320 }}
              helperText={tr("Every team currently working this line, combined into one file.")}
            >
              <MenuItem value="">
                <em>{tr("Select a line")}</em>
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
          <Alert severity="info" sx={{ maxWidth: 560 }}>{tr("Every line, every team, every mission — in Line → Team → Mission order, each team's own section unchanged. This is the one to hand the customer as the overall project report.")}</Alert>
        )}

        {(mode === 'tower' || mode === 'team') && <TextField
          size="small"
          label={tr("Report number (optional)")}
          placeholder={tr("Automatically assigned")}
          helperText={tr("Leave blank for a unique number, or enter your own reference.")}
          value={reportNumber}
          onChange={(e) => setReportNumber(e.target.value)}
          sx={{ maxWidth: 420 }}
        />}
        {(mode === 'line' || mode === 'overall') && <Alert severity="info">{tr("Each team section receives an automatic report number and is saved separately in the library. The combined document downloads when generation finishes.")}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            type="date"
            size="small"
            label={tr("From")}
            slotProps={{ inputLabel: { shrink: true } }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <TextField
            type="date"
            size="small"
            label={tr("To")}
            error={Boolean(startDate && endDate && !validDates)}
            helperText={startDate && endDate && !validDates ? tr("End date must be on or after start date.") : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Stack>

        {scopeChosen && validDates && (
          <Box>
            {preview.isLoading ? (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                <CircularProgress size={16} />
                <Typography variant="body2">{tr("Checking what this will include…")}</Typography>
              </Stack>
            ) : preview.isError ? (
              <Alert severity="error">{tr("Could not check report coverage. Check your connection and try again.")}</Alert>
            ) : preview.data && !preview.data.ok ? (
              <Alert severity="warning">
                {preview.data.message}{tr(" — review the scope and dates, or open Help with report coverage above.")}</Alert>
            ) : preview.data ? (
              <Alert
                severity="success"
                icon={<VisibilityRoundedIcon fontSize="inherit" />}
                sx={{ '& .MuiAlert-message': { width: '100%' } }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>{tr("This will include:")}</Typography>
                <Stack direction="row" spacing={2.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <TransmissionTowerIcon fontSize="small" />
                    <Typography variant="body2">
                      {preview.data.tower_count}{tr(" tower")}{preview.data.tower_count === 1 ? '' : tr("s")}
                    </Typography>
                  </Stack>
                  {mode !== 'tower' && (
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <GroupsRoundedIcon fontSize="small" />
                      <Typography variant="body2">
                        {preview.data.team_count}{tr(" team")}{preview.data.team_count === 1 ? '' : tr("s")}
                      </Typography>
                    </Stack>
                  )}
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <DescriptionRoundedIcon fontSize="small" />
                    <Typography variant="body2">{preview.data.position_count}{tr(" insulator findings")}</Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <LocalFireDepartmentRoundedIcon fontSize="small" color={preview.data.hotspot_count > 0 ? 'error' : 'inherit'} />
                    <Typography variant="body2">
                      {preview.data.hotspot_count}{tr(" hotspot")}{preview.data.hotspot_count === 1 ? '' : tr("s")}
                    </Typography>
                  </Stack>
                </Stack>
              </Alert>
            ) : null}
          </Box>
        )}

      </Stack>
      </DashboardSection>
      <DashboardSection icon={<EditNoteRounded />} title={tr('2 · Findings & recommendations')} description={tr('Summarize the condition, probable causes and corrective actions for the customer.')} tone="amber">
      <Stack spacing={2}>
        <TextField
          select
          size="small"
          label={tr("Overall condition")}
          value={overallCondition}
          onChange={(e) => setOverallCondition(e.target.value)}
          sx={{ maxWidth: 320 }}
        >
          <MenuItem value="">
            <em>{tr("Not set")}</em>
          </MenuItem>
          {lists?.overall_condition.map((c) => (
            <MenuItem key={c} value={c}>
              {tr(c)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label={tr("Probable cause of thermal anomaly")}
          multiline
          minRows={2}
          value={probableCause}
          onChange={(e) => setProbableCause(e.target.value)}
        />
        <TextField
          size="small"
          label={tr("Recommended corrective action")}
          multiline
          minRows={2}
          value={correctiveAction}
          onChange={(e) => setCorrectiveAction(e.target.value)}
        />
        <TextField
          size="small"
          label={tr("Additional comments")}
          multiline
          minRows={2}
          value={additionalComments}
          onChange={(e) => setAdditionalComments(e.target.value)}
        />

      </Stack>
      </DashboardSection>
      <DashboardSection icon={<FactCheckRounded />} title={tr('3 · Approval & generation')} description={tr('Add the sign-off names and approval date, then generate and save the report.')} tone="green">
      <Stack spacing={2}>
        <Typography variant="subtitle2">{tr("Approval — applied to every section in the file")}</Typography>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
          <TextField size="small" label={tr("Prepared by")} value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
          <TextField size="small" label={tr("Reviewed by")} value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} />
          <TextField size="small" label={tr("Approved by")} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
          <TextField
            type="date"
            size="small"
            label={tr("Approval date")}
            slotProps={{ inputLabel: { shrink: true } }}
            value={approvalDate}
            onChange={(e) => setApprovalDate(e.target.value)}
          />
        </Stack>

        <Box>
          <Button variant="contained" startIcon={<DescriptionRoundedIcon />} sx={{ minHeight: 48, px: 3, borderRadius: 2 }} disabled={!requiredFilled || generating || preview.isFetching || preview.isError || !preview.data?.ok} onClick={handleGenerate}>
            {tr(buttonLabel)}
          </Button>
        </Box>
      </Stack>

      </DashboardSection>
      {preview.data?.ok && ((preview.data.draft_visit_count || 0) > 0 || (preview.data.uninspected_position_count || 0) > 0 || (preview.data.without_selected_evidence_count || 0) > 0) && <Alert severity="warning">
        {tr('Before issue: {0} draft visits, {1} positions without a screening result, {2} positions without selected evidence.', [preview.data.draft_visit_count || 0, preview.data.uninspected_position_count || 0, preview.data.without_selected_evidence_count || 0])}
        <Typography variant="caption" sx={{ display: 'block', mt: .5 }}>{tr('Review these gaps before delivery. Some evidence omissions may be intentional; they are not automatically classified as defects.')}</Typography>
      </Alert>}
      </Stack>

      {showHistory && <Accordion variant="outlined" sx={{ mt: 3 }} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <HistoryRoundedIcon fontSize="small" color="action" />
            <Typography variant="subtitle2">{tr("Report history — see what's already been generated")}</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary">{tr("Every report generated above, with a one-click re-download — no need to redo the form or risk reusing a report number that's already taken.")}</Typography>
          <ReportHistoryTable />
        </AccordionDetails>
      </Accordion>}
    </Box>
  );
}
