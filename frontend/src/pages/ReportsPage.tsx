import { tr, useLanguage, locale } from '../i18n';
import { useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
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
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import UploadFileIcon from '@mui/icons-material/UploadFileRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FolderCopyRoundedIcon from '@mui/icons-material/FolderCopyRounded';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import RouteRounded from '@mui/icons-material/RouteRounded';
import DesignServicesRounded from '@mui/icons-material/DesignServicesRounded';
import TransmissionTowerIcon from '../components/TransmissionTowerIcon';
import { DashboardSection } from '../components/DashboardSection';
import { ReportHistoryTable } from '../components/ReportHistoryTable';
import { ReportLogo } from '../components/ReportLogo';
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

// Reuse the Teams section design; children stay mounted when collapsed.
function ReportSection({ title, useWhen, icon, tone = 'teal', defaultExpanded = false, children }: {
  title: string; useWhen: string; icon: ReactNode;
  tone?: 'teal' | 'green' | 'blue' | 'violet' | 'amber';
  defaultExpanded?: boolean; children: ReactNode;
}) {
  return <DashboardSection title={title} description={useWhen} icon={icon} tone={tone} defaultExpanded={defaultExpanded}>{children}</DashboardSection>;
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
  useLanguage();
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
        setUploadError(detail || tr("Could not upload that file — please make sure it's a valid {0}.", [accept]));
      },
    });
  };

  return (
    <Box sx={{ p: 2.5, borderRadius: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>{kind === 'pdf' ? <PictureAsPdfIcon color="primary" /> : <DescriptionRoundedIcon color="primary" />}<Chip size="small" variant="outlined" label={kind === 'pdf' ? 'PDF' : 'Word'} /></Stack>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {tr(description)}
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {!loading && template ? (
          <Chip
            icon={<DescriptionRoundedIcon fontSize="small" />}
            label={tr("{0} — uploaded {1}", [template.original_filename, new Date(template.uploaded_at).toLocaleDateString(locale())])}
            color="primary"
            variant="outlined"
          />
        ) : (
          !loading && (
            <Typography variant="body2" color="text.secondary">{tr("No custom template uploaded yet.")}</Typography>
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
          {template ? tr("Replace template") : tr("Upload template")}
        </Button>
        <Button
          size="small"
          variant="text"
          startIcon={<DownloadRoundedIcon fontSize="small" />}
          component="a"
          href={mediaUrl(`/api/report-templates/starter?kind=${kind}`)}
          target="_blank"
          rel="noreferrer"
        >{tr("Download starter")}</Button>
        {template && canRemove && (
          <Button
            size="small"
            variant="text"
            color="error"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={() => { setUploadError(null); deleteTemplate.mutate(kind, { onError: () => setUploadError(tr('Could not remove the template. Please try again.')) }); }}
            disabled={deleteTemplate.isPending}
          >{tr("Remove")}</Button>
        )}
      </Stack>
      {uploadError && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setUploadError(null)}>
          {tr(uploadError)}
        </Alert>
      )}
    </Box>
  );
}

export function ReportsPage() {
  useLanguage();
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
    <Stack spacing={2.5} sx={{ '@media (prefers-reduced-motion: reduce)': { '& *, & *::before, & *::after': { transition: 'none !important', animation: 'none !important' } } }}>
      <Box sx={{ p: { xs: 2.5, md: 3 }, borderRadius: '24px', boxShadow: '0 14px 36px rgba(12,65,82,.14)', color: '#fff', position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 95% 0%, #258e97 0%, transparent 60%), linear-gradient(115deg, #102c3b, #145466)', '&::after': { content: '""', position: 'absolute', width: 280, height: 280, border: '1px solid #ffffff12', borderRadius: '50%', right: -90, bottom: -190, pointerEvents: 'none' } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, position: 'relative', zIndex: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}><FolderCopyRoundedIcon sx={{ fontSize: 19, color: '#76d5c6' }} /><Typography variant="overline" sx={{ color: '#9fe4da', letterSpacing: 2 }}>{tr("Inspection intelligence")}</Typography></Stack>
            <Typography variant="h3" component="h1" sx={{ fontWeight: 750, letterSpacing: '-0.04em', fontSize: { xs: 27, md: 32 }, mb: 1 }}>{tr("Every inspection. Clearly reported.")}</Typography>
            <Typography sx={{ color: '#bed3dc', maxWidth: 650 }}>{tr("Your reporting workspace. Create customer-ready documents and keep every saved report within reach.")}</Typography>
          </Box>
          <ReportLogo />
          <Stack spacing={1} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', md: 'center' } }}>
            {canManageProjectPlans && <Button id="report-create-button" variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setTab('create')} sx={{ bgcolor: '#b9f2df', color: '#103b35', px: 2.5, py: 1.3, '&:hover': { bgcolor: '#d6f9ed' } }}>{tr("Create report")}</Button>}
            <Button id="report-tools-button" startIcon={<DesignServicesRounded />} onClick={() => setTab('tools')} sx={{ color: '#e0f0f4', '&:hover': { bgcolor: '#ffffff12' } }}>{tr("Exports & templates")}</Button>
            {tab !== 'library' && <Button id="report-library-button" onClick={() => setTab('library')} sx={{ color: '#e0f0f4', '&:hover': { bgcolor: '#ffffff12' } }}>{tr('Back to reports')}</Button>}
          </Stack>
        </Stack>
      </Box>
      <Box id="report-panel-library" hidden={tab !== 'library'}><ReportHistoryTable key={libraryVersion} showIntro={false} /></Box>
      {canManageProjectPlans && <Box role="region" id="report-panel-create" aria-labelledby="report-create-button" hidden={tab !== 'create'}><Box><OfficialReportForm showHistory={false} onCreated={() => { setCreated(true); setLibraryVersion((n) => n + 1); setTab('library'); }} /></Box></Box>}
      <Box role="region" id="report-panel-tools" aria-labelledby="report-tools-button" hidden={tab !== 'tools'}>
      <Stack spacing={2}>

      <ReportSection
        title={tr("Team activity report")}
        icon={<EngineeringRounded />} tone="green"
        useWhen={tr("Follow each team’s visits, readings and evidence. Export the activity to Excel.")}
      >
        <TeamActivityReport />
      </ReportSection>

      <ReportSection
        title={tr("Overall summary (PDF)")}
        icon={<InsightsRounded />} tone="blue"
        useWhen={tr("Download an internal snapshot of tower progress across all areas or one selected area.")}
      >
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label={tr("Area")}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">{tr("All areas")}</MenuItem>
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
          >{tr("Download overall summary (PDF)")}</Button>
        </Stack>
      </ReportSection>

      {canManageProjectPlans && (
        <ReportSection
          title={tr("Field execution plan")}
          icon={<RouteRounded />} tone="amber"
        useWhen={tr("Prepare the mobilization document with tower counts, teams and a daily schedule.")}
        >
          <FieldExecutionPlanForm />
        </ReportSection>
      )}

      {canManageProjectPlans && (
      <ReportSection
        title={tr("Custom report templates")}
        icon={<DesignServicesRounded />} tone="violet"
        useWhen={tr("Manage branded Word and PDF layouts for custom tower exports.")}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
          <TemplateSlot
            kind="docx"
            label={tr("Word template")}
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            description={tr("A flexible Word layout with an automatically repeating row for each inspection position.")}
            template={templates?.docx}
            loading={templatesLoading}
            canRemove={canRemoveTemplate}
          />
          <TemplateSlot
            kind="pdf"
            label={tr("PDF template")}
            accept=".pdf,application/pdf"
            description={tr("A fixed PDF form with named fields. The starter includes position slots 1–12.")}
            template={templates?.pdf}
            loading={templatesLoading}
            canRemove={canRemoveTemplate}
          />
        </Box>
      </ReportSection>
      )}

      <ReportSection
        title={tr("Per-tower reports")}
        icon={<TransmissionTowerIcon />} tone="teal"
        useWhen={tr("Download the latest visit for one tower as a PDF or a custom document.")}
      >
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{tr("Tower")}</TableCell>
                <TableCell>{tr("Area")}</TableCell>
                <TableCell>{tr("Latest visit")}</TableCell>
                <TableCell>{tr("Status")}</TableCell>
                <TableCell align="right">{tr("Report")}</TableCell>
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
                        >{tr("PDF")}</Button>
                        <Tooltip title={templates?.docx ? '' : tr("Upload a Word template above first")}>
                          <span>
                            <Button
                              size="small"
                              startIcon={<DescriptionRoundedIcon fontSize="small" />}
                              component="a"
                              href={mediaUrl(`/api/reports/visits/${row.latest_visit.id}.docx`)}
                              target="_blank"
                              rel="noreferrer"
                              disabled={!templates?.docx}
                            >{tr("Word")}</Button>
                          </span>
                        </Tooltip>
                        <Tooltip title={templates?.pdf ? '' : tr("Upload a PDF template above first")}>
                          <span>
                            <Button
                              size="small"
                              startIcon={<PictureAsPdfIcon fontSize="small" />}
                              component="a"
                              href={mediaUrl(`/api/reports/visits/${row.latest_visit.id}/custom.pdf`)}
                              target="_blank"
                              rel="noreferrer"
                              disabled={!templates?.pdf}
                            >{tr("PDF (custom)")}</Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">{tr("No visit yet")}</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && data?.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">{tr("No towers yet — add one from the Towers page.")}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </ReportSection>
      </Stack>
      </Box>
      <Snackbar open={created} autoHideDuration={6000} onClose={() => setCreated(false)} message={tr("Report created and saved to your library. Your download is ready.")} />
    </Stack>
  );
}
