import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Stack,
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
import {
  useAreas,
  useDashboardSummary,
  useDeleteReportTemplate,
  useReportTemplate,
  useUploadReportTemplate,
} from '../api/hooks';
import { mediaUrl } from '../api/client';
import type { ReportTemplate } from '../api/types';
import { VisitStatusChip } from '../components/Badges';
import { TeamActivityReport } from '../components/TeamActivityReport';
import { FieldExecutionPlanForm } from '../components/FieldExecutionPlanForm';
import { OetcGroupedReportForm } from '../components/OetcGroupedReportForm';
import { useAuth } from '../auth/AuthContext';

// One kind's upload/replace/remove/download-starter controls — used twice below (Word, PDF form)
// with only the labels/accept-filter/endpoints differing.
function TemplateSlot({
  kind,
  label,
  accept,
  description,
  template,
  loading,
}: {
  kind: 'docx' | 'pdf';
  label: string;
  accept: string;
  description: string;
  template: ReportTemplate | null | undefined;
  loading: boolean;
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
        {template && (
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
  const canManageProjectPlans = user?.role === 'admin' || user?.role === 'reviewer';
  const [area, setArea] = useState<string>('');
  const { data: areas } = useAreas();
  const { data, isLoading } = useDashboardSummary(area || undefined);

  const { data: templates, isLoading: templatesLoading } = useReportTemplate();

  const overallReportUrl = mediaUrl(`/api/reports/overall.pdf${area ? `?area=${encodeURIComponent(area)}` : ''}`);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Reports
        </Typography>
        <Typography color="text.secondary">
          Per-tower inspection reports and the Dufar-area overall summary, generated from live data.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Custom report templates
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Upload your own template — your logo, brand colors, fonts, and layout, exactly as you design it —
            and matching reports get generated from it. Download a starter template below for a working
            example with the right placeholder tags already in place; restyle it without touching those tags,
            then upload it back here.
          </Typography>

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
            />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <TeamActivityReport />
        </CardContent>
      </Card>

      {canManageProjectPlans && (
        <Card>
          <CardContent>
            <OetcGroupedReportForm />
          </CardContent>
        </Card>
      )}

      {canManageProjectPlans && (
        <Card>
          <CardContent>
            <FieldExecutionPlanForm />
          </CardContent>
        </Card>
      )}

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
    </Stack>
  );
}
