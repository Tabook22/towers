import { useRef, useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import UploadFileIcon from '@mui/icons-material/UploadFileRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FolderCopyRoundedIcon from '@mui/icons-material/FolderCopyRounded';
import { ReportHistoryTable } from '../components/ReportHistoryTable';
import {
  useAreas,
  useDashboardSummary,
  useDeleteReportTemplate,
  useReportTemplate,
  useUploadReportTemplate,
} from '../api/hooks';
import { mediaUrl } from '../api/client';
import { getPermissionLevel, type ReportTemplate } from '../api/types';
import { VisitStatusChip } from '../components/Badges';
import { TeamActivityReport } from '../components/TeamActivityReport';
import { FieldExecutionPlanForm } from '../components/FieldExecutionPlanForm';
import { OfficialReportForm } from '../components/OfficialReportForm';
import { useAuth } from '../auth/AuthContext';

// Secondary exports and template tools stay collapsed until needed.
function ReportSection({
  title,
  useWhen,
  defaultExpanded,
  children,
}: {
  title: string;
  useWhen: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Alert severity="info" icon={false} sx={{ mb: 2 }}>
          <strong>Use this when:</strong> {useWhen}
        </Alert>
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

// One kind's upload/replace/remove/download-starter controls — used twice below (Word, PDF form)
// with only the labels/accept-filter/endpoints differing.
function TemplateSlot({
  kind,
  label,
  accept,
  description,
  template,
  loading,
  canRemove,
}: {
  kind: 'docx' | 'pdf';
  label: string;
  accept: string;
  description: string;
  template: ReportTemplate | null | undefined;
  loading: boolean;
  canRemove: boolean;
}) {
  const uploadTemplate = useUploadReportTemplate();
  const deleteTemplate = useDeleteReportTemplate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    uploadTemplate.mutate(file, {
      onError: (err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setUploadError(detail || `Could not upload that file — please make sure it's a valid ${accept}.`);
      },
    });
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {description}
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {!loading && template ? (
          <Chip
            icon={<DescriptionRoundedIcon fontSize="small" />}
            label={`${template.original_filename} — uploaded ${new Date(template.uploaded_at).toLocaleDateString()}`}
            color="primary"
            variant="outlined"
          />
        ) : (
          !loading && (
            <Typography variant="body2" color="text.secondary">
              No custom template uploaded yet.
            </Typography>
          )
        )}

        <input
          ref={fileRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0] || null);
            e.target.value = '';
          }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<UploadFileIcon fontSize="small" />}
          onClick={() => fileRef.current?.click()}
          disabled={uploadTemplate.isPending}
        >
          {template ? 'Replace template' : 'Upload template'}
        </Button>
        <Button
          size="small"
          variant="text"
          startIcon={<DownloadRoundedIcon fontSize="small" />}
          component="a"
          href={mediaUrl(`/api/report-templates/starter?kind=${kind}`)}
          target="_blank"
          rel="noreferrer"
        >
          Download starter
        </Button>
        {template && canRemove && (
          <Button
            size="small"
            variant="text"
            color="error"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={() => deleteTemplate.mutate(kind)}
            disabled={deleteTemplate.isPending}
          >
            Remove
          </Button>
        )}
      </Stack>
      {uploadError && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      )}
    </Box>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  // Mirrors routers/reports.py and routers/report_templates.py: generating the official/execution
  // reports and uploading a custom template need "add"; clearing an active template needs "full".
  const reportsLevel =
    user?.role === 'admin'
      ? user.is_super_admin
        ? 'full'
        : getPermissionLevel(user.permissions, 'generate_reports')
      : user?.role === 'reviewer'
        ? 'full'
        : 'view';
  const canManageProjectPlans = reportsLevel === 'add' || reportsLevel === 'full';
  const canRemoveTemplate = reportsLevel === 'full';
  const [tab, setTab] = useState('library');
  const [created, setCreated] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [area, setArea] = useState<string>('');
  const { data: areas } = useAreas();
  const { data, isLoading } = useDashboardSummary(area || undefined);

  const { data: templates, isLoading: templatesLoading } = useReportTemplate();

  const overallReportUrl = mediaUrl(`/api/reports/overall.pdf${area ? `?area=${encodeURIComponent(area)}` : ''}`);

  return (
    <Stack spacing={3}>
      <Box sx={{ p: { xs: 3, md: 4 }, borderRadius: '22px', color: '#fff', position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 95% 0%, #246d76 0%, transparent 55%), linear-gradient(115deg, #102c3b, #123c48)', '&::after': { content: '""', position: 'absolute', width: 280, height: 280, border: '1px solid #ffffff12', borderRadius: '50%', right: -90, bottom: -190, pointerEvents: 'none' } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, position: 'relative', zIndex: 1 }}>
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}><FolderCopyRoundedIcon sx={{ fontSize: 19, color: '#76d5c6' }} /><Typography variant="overline" sx={{ color: '#9fe4da', letterSpacing: 2 }}>Inspection intelligence</Typography></Stack>
            <Typography variant="h3" component="h1" sx={{ fontWeight: 750, letterSpacing: '-0.04em', fontSize: { xs: 32, md: 40 }, mb: 1 }}>Every inspection. Clearly reported.</Typography>
            <Typography sx={{ color: '#bed3dc', maxWidth: 650 }}>Your reporting workspace. Create customer-ready documents and keep every saved report within reach.</Typography>
          </Box>
          {canManageProjectPlans && <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setTab('create')} sx={{ bgcolor: '#b9f2df', color: '#103b35', px: 2.5, py: 1.3, flexShrink: 0, alignSelf: { xs: 'flex-start', md: 'center' }, '&:hover': { bgcolor: '#d6f9ed' } }}>Create report</Button>}
        </Stack>
      </Box>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Reporting workspace" variant="scrollable" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="library" label="Report library" id="report-tab-library" aria-controls="report-panel-library" />
        {canManageProjectPlans && <Tab value="create" label="Create report" id="report-tab-create" aria-controls="report-panel-create" />}
        <Tab value="tools" label="Exports & templates" id="report-tab-tools" aria-controls="report-panel-tools" />
      </Tabs>
      <Box role="tabpanel" id="report-panel-library" aria-labelledby="report-tab-library" hidden={tab !== 'library'}><ReportHistoryTable key={libraryVersion} /></Box>
      {canManageProjectPlans && <Box role="tabpanel" id="report-panel-create" aria-labelledby="report-tab-create" hidden={tab !== 'create'}><Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: '16px' }}><OfficialReportForm showHistory={false} onCreated={() => { setCreated(true); setLibraryVersion((n) => n + 1); setTab('library'); }} /></Paper></Box>}
      <Box role="tabpanel" id="report-panel-tools" aria-labelledby="report-tab-tools" hidden={tab !== 'tools'}>
      <Stack spacing={2}>

      <ReportSection
        title="Team activity report"
        useWhen="you just want to see or export what a team has actually done so far — not the customer template, a plain internal breakdown you can filter and download as Excel."
      >
        <TeamActivityReport />
      </ReportSection>

      <ReportSection
        title="Overall summary (PDF)"
        useWhen="you want a quick internal snapshot PDF across all towers (optionally one area) — a fast status check for yourself, not something to hand the customer."
      >
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All areas</MenuItem>
            {areas?.map((a) => (
              <MenuItem key={a} value={a}>
                {a}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            startIcon={<PictureAsPdfIcon />}
            component="a"
            href={overallReportUrl}
            target="_blank"
            rel="noreferrer"
          >
            Download overall summary (PDF)
          </Button>
        </Stack>
      </ReportSection>

      {canManageProjectPlans && (
        <ReportSection
          title="Field execution plan"
          useWhen="you're mobilizing and need a plan document showing tower/team counts and a day-by-day schedule — a planning tool, not an inspection report."
        >
          <FieldExecutionPlanForm />
        </ReportSection>
      )}

      {canManageProjectPlans && (
      <ReportSection
        title="Custom report templates"
        useWhen="you want reports in your own branded layout (logo, colors, fonts) instead of the built-in one — advanced, and not needed for the official customer report in Create report, which already uses the customer's own fixed template."
      >
        <Stack spacing={2.5} divider={<Divider />}>
          <TemplateSlot
            kind="docx"
            label="Word template"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            description={
              'A Word (.docx) mail-merge template — full layout freedom, and it supports a repeating table row ' +
              'per position automatically.'
            }
            template={templates?.docx}
            loading={templatesLoading}
            canRemove={canRemoveTemplate}
          />
          <TemplateSlot
            kind="pdf"
            label="PDF template"
            accept=".pdf,application/pdf"
            description={
              'A fillable PDF form — design the page and place named form fields (in Acrobat, LibreOffice, or ' +
              'a similar PDF form editor); since a PDF form can’t repeat rows the way Word can, the starter ' +
              'gives one fixed field per position slot (1–12) instead of a loop.'
            }
            template={templates?.pdf}
            loading={templatesLoading}
            canRemove={canRemoveTemplate}
          />
        </Stack>
      </ReportSection>
      )}

      <ReportSection
        title="Per-tower reports"
        useWhen="you want a one-off PDF or Word download for a single tower's latest visit only — not the official customer report in Create report."
      >
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Tower</TableCell>
                <TableCell>Area</TableCell>
                <TableCell>Latest visit</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Report</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.rows.map((row) => (
                <TableRow key={row.tower.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{row.tower.tower_id}</TableCell>
                  <TableCell>{row.tower.area || '-'}</TableCell>
                  <TableCell>{row.latest_visit?.inspection_date || '-'}</TableCell>
                  <TableCell>
                    <VisitStatusChip status={row.rollup?.visit_status} />
                  </TableCell>
                  <TableCell align="right">
                    {row.latest_visit ? (
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          startIcon={<PictureAsPdfIcon fontSize="small" />}
                          component="a"
                          href={mediaUrl(`/api/reports/visits/${row.latest_visit.id}.pdf`)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PDF
                        </Button>
                        <Tooltip title={templates?.docx ? '' : 'Upload a Word template above first'}>
                          <span>
                            <Button
                              size="small"
                              startIcon={<DescriptionRoundedIcon fontSize="small" />}
                              component="a"
                              href={mediaUrl(`/api/reports/visits/${row.latest_visit.id}.docx`)}
                              target="_blank"
                              rel="noreferrer"
                              disabled={!templates?.docx}
                            >
                              Word
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title={templates?.pdf ? '' : 'Upload a PDF template above first'}>
                          <span>
                            <Button
                              size="small"
                              startIcon={<PictureAsPdfIcon fontSize="small" />}
                              component="a"
                              href={mediaUrl(`/api/reports/visits/${row.latest_visit.id}/custom.pdf`)}
                              target="_blank"
                              rel="noreferrer"
                              disabled={!templates?.pdf}
                            >
                              PDF (custom)
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        No visit yet
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    No towers yet — add one from the Towers page.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </ReportSection>
      </Stack>
      </Box>
      <Snackbar open={created} autoHideDuration={6000} onClose={() => setCreated(false)} message="Report created and saved to your library. Your download is ready." />
    </Stack>
  );
}
