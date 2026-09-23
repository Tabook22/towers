import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import { useAuth } from '../auth/AuthContext';
import { mediaUrl } from '../api/client';
import { useDeleteReportImage, useOetcReportHistory, useReportImages, useUpdateOetcLineReport } from '../api/hooks';
import type { LineInspectionReportOut, LineInspectionReportUpdate, ReportImageOut } from '../api/types';
import { DocxViewerDialog } from '../components/DocxViewerDialog';
import { ImageLightbox } from '../components/ImageLightbox';

type SortKey = 'created_at' | 'report_number' | 'team_name' | 'line_sector';

const REPORT_TYPE_LABELS: Record<string, string> = {
  tower: 'By tower',
  team: 'By team',
  area: 'By line',
  consolidated: 'Overall project',
};

// Kept in sync with backend models.OVERALL_CONDITION_CHOICES by hand — hardcoded rather than
// fetched via useChoiceLists() since a client login has no access to /api/lists (see
// app/client_guard.py's allowlist) and this short, stable set isn't worth widening it for.
const OVERALL_CONDITION_CHOICES = ['Acceptable', 'Monitor', 'Maintenance Required', 'Urgent Action Required'];

function downloadUrl(r: LineInspectionReportOut): string {
  return mediaUrl(`/api/reports/oetc-line-report/${r.id}/${r.has_file ? 'file' : 'redownload'}`);
}

const IMAGE_TYPE_LABELS: Record<string, string> = {
  'TH Full': 'Thermal — Full',
  'TH Close': 'Thermal — Close',
  'RGB Full': 'Visual — Full',
  'RGB Close': 'Visual — Close',
};

function ReportImageGallery({ report, canDelete }: { report: LineInspectionReportOut; canDelete: boolean }) {
  const { data: images, isLoading } = useReportImages(report.id);
  const deleteImage = useDeleteReportImage(report.id);
  const [lightbox, setLightbox] = useState<ReportImageOut | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = (img: ReportImageOut) => {
    setDeleteError(null);
    deleteImage.mutate(img.image_id, {
      onError: (err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setDeleteError(detail || 'Could not delete this image.');
      },
    });
  };

  if (isLoading) return <LinearProgress sx={{ my: 2 }} />;
  if (!images || images.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        No images were captured for this report.
      </Alert>
    );
  }

  return (
    <>
      {deleteError && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      )}
      <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
        {images.map((img) => (
          <Grid key={img.id} size={{ xs: 6, sm: 4, md: 3 }}>
            <Paper
              variant="outlined"
              sx={{ position: 'relative', overflow: 'hidden', borderRadius: 2, cursor: 'pointer', '&:hover .zoom-hint': { opacity: 1 } }}
              onClick={() => setLightbox(img)}
            >
              <Box
                component="img"
                src={mediaUrl(`/api/images/${img.image_id}/thumbnail`)}
                alt={IMAGE_TYPE_LABELS[img.image_type] || img.image_type}
                sx={{ width: '100%', height: 140, objectFit: 'cover', display: 'block', bgcolor: 'action.hover' }}
              />
              <Box
                className="zoom-hint"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'rgba(0,0,0,0.35)',
                  opacity: 0,
                  transition: 'opacity 0.15s',
                }}
              >
                <ZoomInRoundedIcon sx={{ color: 'white' }} />
              </Box>
              <Stack sx={{ p: 1 }} spacing={0.25}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {IMAGE_TYPE_LABELS[img.image_type] || img.image_type}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {img.tower_code} · {img.position_code || `${img.image_type}`}
                </Typography>
              </Stack>
              {canDelete && (
                <Tooltip title="Delete this image">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Delete this image? This cannot be undone.')) {
                        handleDelete(img);
                      }
                    }}
                    sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" sx={{ color: 'white' }} />
                  </IconButton>
                </Tooltip>
              )}
            </Paper>
          </Grid>
        ))}
      </Grid>
      {lightbox && (
        <ImageLightbox
          open={!!lightbox}
          onClose={() => setLightbox(null)}
          title={`${lightbox.tower_code} — ${IMAGE_TYPE_LABELS[lightbox.image_type] || lightbox.image_type}`}
          subtitle={[lightbox.position_code, lightbox.capture_date].filter(Boolean).join(' · ')}
          imageUrl={mediaUrl(`/api/images/${lightbox.image_id}/file`)}
        />
      )}
    </>
  );
}

function ReportSignOffForm({ report }: { report: LineInspectionReportOut }) {
  const { user } = useAuth();
  const canEdit = !!user?.can_edit_reports;
  const update = useUpdateOetcLineReport();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LineInspectionReportUpdate>({});
  const [saved, setSaved] = useState(false);

  const startEdit = () => {
    setDraft({
      overall_condition: report.overall_condition,
      probable_cause: report.probable_cause,
      corrective_action: report.corrective_action,
      additional_comments: report.additional_comments,
      prepared_by: report.prepared_by,
      reviewed_by: report.reviewed_by,
      approved_by: report.approved_by,
      approval_date: report.approval_date,
    });
    setSaved(false);
    setEditing(true);
  };

  const save = () => {
    update.mutate(
      { id: report.id, payload: draft },
      { onSuccess: () => { setEditing(false); setSaved(true); } },
    );
  };

  const field = (label: string, value: string | null) => (
    <Grid size={{ xs: 12, sm: 6 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2">{value || '—'}</Typography>
    </Grid>
  );

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Overall assessment
        </Typography>
        {canEdit && !editing && (
          <Button size="small" onClick={startEdit}>
            Edit
          </Button>
        )}
      </Stack>
      {saved && (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setSaved(false)}>
          Saved.
        </Alert>
      )}
      {editing ? (
        <Stack spacing={1.5}>
          <TextField
            select
            size="small"
            label="Overall condition"
            value={draft.overall_condition || ''}
            onChange={(e) => setDraft((d) => ({ ...d, overall_condition: e.target.value }))}
          >
            <MenuItem value="">—</MenuItem>
            {OVERALL_CONDITION_CHOICES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            multiline
            minRows={2}
            label="Probable cause"
            value={draft.probable_cause || ''}
            onChange={(e) => setDraft((d) => ({ ...d, probable_cause: e.target.value }))}
          />
          <TextField
            size="small"
            multiline
            minRows={2}
            label="Recommended corrective action"
            value={draft.corrective_action || ''}
            onChange={(e) => setDraft((d) => ({ ...d, corrective_action: e.target.value }))}
          />
          <TextField
            size="small"
            multiline
            minRows={2}
            label="Additional comments"
            value={draft.additional_comments || ''}
            onChange={(e) => setDraft((d) => ({ ...d, additional_comments: e.target.value }))}
          />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" size="small" onClick={save} disabled={update.isPending}>
              Save
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Grid container spacing={1.5}>
          {field('Overall condition', report.overall_condition)}
          {field('Prepared by', report.prepared_by)}
          {field('Probable cause', report.probable_cause)}
          {field('Reviewed by', report.reviewed_by)}
          {field('Recommended corrective action', report.corrective_action)}
          {field('Approved by', report.approved_by)}
          {field('Additional comments', report.additional_comments)}
          {field('Approval date', report.approval_date)}
        </Grid>
      )}
    </Box>
  );
}

function ReportDetailDialog({ report, onClose }: { report: LineInspectionReportOut; onClose: () => void }) {
  const { user } = useAuth();
  const [viewingDoc, setViewingDoc] = useState(false);

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Report {report.report_number}
        <Typography variant="body2" color="text.secondary">
          {report.tower_name || 'Whole team campaign'} · {report.team_name || '—'}
          {report.line_sector ? ` · ${report.line_sector}` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Type
            </Typography>
            <Typography variant="body2">{REPORT_TYPE_LABELS[report.report_type || ''] || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Date range
            </Typography>
            <Typography variant="body2">
              {report.start_date === report.end_date ? report.start_date : `${report.start_date} → ${report.end_date}`}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Generated
            </Typography>
            <Typography variant="body2">{new Date(report.created_at).toLocaleString()}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Images
            </Typography>
            <Typography variant="body2">{report.image_count}</Typography>
          </Grid>
        </Grid>

        <ReportSignOffForm report={report} />

        <Stack direction="row" sx={{ alignItems: 'center', mt: 3, mb: 1 }} spacing={1}>
          <PhotoLibraryRoundedIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Image archive for this report
          </Typography>
        </Stack>
        <ReportImageGallery report={report} canDelete={!!user?.can_delete_report_images} />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setViewingDoc(true)} startIcon={<VisibilityRoundedIcon />}>
          View report
        </Button>
        <Button href={downloadUrl(report)} target="_blank" rel="noreferrer" startIcon={<DownloadRoundedIcon />}>
          Download
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
      {viewingDoc && (
        <DocxViewerDialog open={viewingDoc} onClose={() => setViewingDoc(false)} title={report.report_number} fileUrl={downloadUrl(report)} />
      )}
    </Dialog>
  );
}

/** The customer's own view of every report ever generated for them — searchable/sortable by
 * number, tower, team, line, type, and date, with each report's own permanently-linked image
 * archive one click away (see backend models.ReportImage). A client login is locked to exactly
 * this page (see Layout.tsx's isClient nav and App.tsx's route guard) — everything shown here is
 * read-only unless the account was explicitly granted can_edit_reports / can_delete_report_images
 * (see Settings > Client accounts). */
export function ClientReportsPage() {
  const { data: rows, isLoading } = useOetcReportHistory();
  const [search, setSearch] = useState('');
  const [tower, setTower] = useState('');
  const [team, setTeam] = useState('');
  const [line, setLine] = useState('');
  const [reportType, setReportType] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Holds only the id, not the row object — the dialog looks the live row up from `rows` on every
  // render instead, so an edit's refetched data shows up immediately instead of the stale snapshot
  // taken when the dialog was first opened.
  const [detailId, setDetailId] = useState<number | null>(null);
  const detail = detailId != null ? (rows || []).find((r) => r.id === detailId) || null : null;

  const towers = useMemo(
    () => Array.from(new Set((rows || []).map((r) => r.tower_name).filter((v): v is string => !!v))).sort(),
    [rows],
  );
  const teams = useMemo(
    () => Array.from(new Set((rows || []).map((r) => r.team_name).filter((v): v is string => !!v))).sort(),
    [rows],
  );
  const lines = useMemo(
    () => Array.from(new Set((rows || []).map((r) => r.line_sector).filter((v): v is string => !!v))).sort(),
    [rows],
  );

  const filtered = (rows || []).filter((r) => {
    if (search && !r.report_number.toLowerCase().includes(search.toLowerCase())) return false;
    if (tower && r.tower_name !== tower) return false;
    if (team && r.team_name !== team) return false;
    if (line && r.line_sector !== line) return false;
    if (reportType && r.report_type !== reportType) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const va = (sortKey === 'created_at' ? a.created_at : a[sortKey]) || '';
    const vb = (sortKey === 'created_at' ? b.created_at : b[sortKey]) || '';
    const cmp = String(va).localeCompare(String(vb));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' ? 'desc' : 'asc');
    }
  };

  if (isLoading) return <LinearProgress />;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>
        Reports
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Every inspection report generated for you — view it online, download it, or open its linked photos for a closer look.
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', mb: 2 }}>
        <TextField
          size="small"
          label="Search report number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        {towers.length > 0 && (
          <TextField select size="small" label="Tower" value={tower} onChange={(e) => setTower(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">All towers</MenuItem>
            {towers.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
        )}
        {teams.length > 1 && (
          <TextField select size="small" label="Team" value={team} onChange={(e) => setTeam(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All teams</MenuItem>
            {teams.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
        )}
        {lines.length > 0 && (
          <TextField select size="small" label="Line" value={line} onChange={(e) => setLine(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">All lines</MenuItem>
            {lines.map((l) => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField select size="small" label="Type" value={reportType} onChange={(e) => setReportType(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All types</MenuItem>
          {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {(!rows || rows.length === 0) ? (
        <Alert severity="info">No reports have been generated yet.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel active={sortKey === 'report_number'} direction={sortDir} onClick={() => toggleSort('report_number')}>
                    Report number
                  </TableSortLabel>
                </TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell>
                  <TableSortLabel active={sortKey === 'line_sector'} direction={sortDir} onClick={() => toggleSort('line_sector')}>
                    Line
                  </TableSortLabel>
                </TableCell>
                <TableCell>Date range</TableCell>
                <TableCell>
                  <TableSortLabel active={sortKey === 'created_at'} direction={sortDir} onClick={() => toggleSort('created_at')}>
                    Generated
                  </TableSortLabel>
                </TableCell>
                <TableCell>Images</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => setDetailId(r.id)}>
                  <TableCell sx={{ fontWeight: 700, wordBreak: 'break-all' }}>{r.report_number}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={REPORT_TYPE_LABELS[r.report_type || ''] || '—'} />
                  </TableCell>
                  <TableCell>{r.tower_name || 'Whole team campaign'}</TableCell>
                  <TableCell>{r.line_sector || '—'}</TableCell>
                  <TableCell>{r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}</TableCell>
                  <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{r.image_count}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="View">
                      <IconButton size="small" onClick={() => setDetailId(r.id)}>
                        <VisibilityRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Download">
                      <IconButton size="small" component="a" href={downloadUrl(r)} target="_blank" rel="noreferrer">
                        <DownloadRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No reports match these filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {detail && <ReportDetailDialog report={detail} onClose={() => setDetailId(null)} />}
    </Box>
  );
}
