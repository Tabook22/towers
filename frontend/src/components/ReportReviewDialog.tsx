import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, LinearProgress, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import DescriptionRounded from '@mui/icons-material/DescriptionRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { apiClient, mediaUrl } from '../api/client';
import { useDeleteReportImage, useReportImages, useUpdateOetcLineReport } from '../api/hooks';
import { getPermissionLevel, type InspectionSnapshot, type LineInspectionReportOut, type LineInspectionReportUpdate, type ReportImageOut, type ReportValue } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { locale, tr, useLanguage } from '../i18n';
import { reportError, reportTimestamp, reportTowers, reportTypes } from '../utils/reportLibrary';
import { DocxViewerDialog } from './DocxViewerDialog';
import { ImageLightbox } from './ImageLightbox';
import { ReportCommentsSection } from './ReportCommentsSection';

const labels: Record<string, string> = {
  tmax_c: 'Tmax (°C)', tref_c: 'Tref (°C)', delta_t: 'ΔT (°C)', ohl: 'Circuit', phase: 'Phase', string: 'String',
  gs_side: 'Ground / sky side', ambient_temp_c: 'Ambient temperature (°C)', humidity_pct: 'Humidity (%)',
  distance_to_target_m: 'Distance to target (m)', reflected_temp: 'Reflected temperature (°C)',
  voice_note_duration_seconds: 'Voice note duration (s)', corrective_action: 'Recommended corrective action',
};
const label = (key: string) => tr(labels[key] || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const present = (value: unknown) => value !== null && value !== undefined && value !== '';
const valueLabel = (value: ReportValue) => typeof value === 'boolean' ? tr(value ? 'Yes' : 'No') : String(value);
const assessmentKeys = ['overall_condition', 'probable_cause', 'corrective_action', 'additional_comments', 'prepared_by', 'reviewed_by', 'approved_by', 'approval_date'] as const;
const enumeratedFields = new Set(['overall_condition', 'screening_result', 'hotspot', 'severity', 'confidence', 'view_side', 'tower_proximity', 'insulator_type', 'mount_type', 'string_count', 'pollution_condition', 'thermal_indication', 'evidence_status', 'status']);

function DataFields({ values, exclude = [] }: { values: Record<string, unknown>; exclude?: string[] }) {
  const entries = Object.entries(values).filter(([key, value]) => !exclude.includes(key) && present(value) && !Array.isArray(value) && typeof value !== 'object');
  return <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
    {entries.map(([key, value]) => <Box key={key} sx={{ minWidth: 0, gridColumn: /notes|transcript|cause|action|comments/.test(key) ? '1 / -1' : undefined }}>
      <Typography component="dt" variant="caption" color="text.secondary">{label(key)}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, mt: .3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{enumeratedFields.has(key) ? tr(valueLabel(value as ReportValue)) : valueLabel(value as ReportValue)}</Typography>
    </Box>)}
    {!entries.length && <Typography variant="body2" color="text.secondary">{tr('Not recorded')}</Typography>}
  </Box>;
}

function Assessment({ report, original }: { report: LineInspectionReportOut; original?: InspectionSnapshot['assessment'] }) {
  const { user } = useAuth();
  const canEdit = (user?.role === 'client' && user.can_edit_reports) || (user?.role === 'admin' && (user.is_super_admin || getPermissionLevel(user.permissions, 'generate_reports') === 'full'));
  // Preserve the customer portal's assessment-only editor; do not expose internal sign-off edits.
  const editableKeys = user?.role === 'client' ? assessmentKeys.slice(0, 4) : assessmentKeys;
  const update = useUpdateOetcLineReport();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LineInspectionReportUpdate>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const changed = original && assessmentKeys.some((key) => (original[key] ?? null) !== report[key]);
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setError('');
    try { await update.mutateAsync({ id: report.id, payload: draft }); setEditing(false); setSaved(true); }
    catch (err) { setError(await reportError(err, tr('Could not save the assessment.'))); }
    finally { saving.current = false; }
  };
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: '16px' }}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
      <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 750 }}>{tr('Overall assessment')}</Typography>
      {canEdit && !editing && <Button onClick={() => { setDraft(Object.fromEntries(editableKeys.map((k) => [k, report[k]]))); setEditing(true); setSaved(false); setError(''); }}>{tr('Edit')}</Button>}
    </Stack>
    {(changed || editing || saved) && <Alert severity={saved ? 'success' : 'info'} sx={{ mb: 2 }}>{tr(saved ? 'Online assessment saved. Archived downloads are unchanged.' : 'Online assessment edits do not change the issued Word document or inspection data register. Generate a new report for a revised customer deliverable.')}</Alert>}
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {editing ? <Stack spacing={2}>
      {editableKeys.map((key) => <TextField key={key} size="small" label={label(key)} disabled={update.isPending} value={draft[key] || ''} onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value || null }))}
        select={key === 'overall_condition'} type={key === 'approval_date' ? 'date' : 'text'} multiline={['probable_cause', 'corrective_action', 'additional_comments'].includes(key)} minRows={2} slotProps={key === 'approval_date' ? { inputLabel: { shrink: true } } : undefined}>
        {key === 'overall_condition' && [<MenuItem key="blank" value="">{tr('Not recorded')}</MenuItem>, ...['Acceptable', 'Monitor', 'Maintenance Required', 'Urgent Action Required'].map((v) => <MenuItem key={v} value={v}>{tr(v)}</MenuItem>)]}
      </TextField>)}
      <Stack direction="row" spacing={1}><Button variant="contained" disabled={update.isPending} onClick={() => void save()}>{tr(update.isPending ? 'Saving…' : 'Save online assessment')}</Button><Button disabled={update.isPending} onClick={() => setEditing(false)}>{tr('Cancel')}</Button></Stack>
    </Stack> : <DataFields values={Object.fromEntries(assessmentKeys.map((key) => [key, report[key]]))} />}
    {changed && <Accordion elevation={0} sx={{ mt: 2, '&::before': { display: 'none' } }}><AccordionSummary expandIcon={<ExpandMoreRounded />}>{tr('Assessment at issue time')}</AccordionSummary><AccordionDetails><DataFields values={original} /></AccordionDetails></Accordion>}
  </Paper>;
}

function Evidence({ report, active }: { report: LineInspectionReportOut; active: boolean }) {
  const { user } = useAuth();
  const query = useReportImages(active ? report.id : undefined);
  const remove = useDeleteReportImage(report.id);
  const [zoom, setZoom] = useState<ReportImageOut | null>(null);
  const [deleting, setDeleting] = useState<ReportImageOut | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [failedPreviews, setFailedPreviews] = useState<number[]>([]);
  const images = (query.data || []).filter((img) => `${img.tower_code} ${img.position_code} ${img.image_type}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <Stack spacing={2}>
    <Alert severity="info">{tr('These are linked field images. The issued Word document is the reference for original embedded photographs; later replacements can differ.')}</Alert>
    <TextField size="small" label={tr('Find evidence')} placeholder={tr('Tower, position or image type')} value={search} onChange={(e) => setSearch(e.target.value)} />
    {query.isLoading && <LinearProgress />}
    {query.isError && <Alert severity="error" action={<Button onClick={() => void query.refetch()}>{tr('Retry')}</Button>}>{tr('Could not load report evidence.')}</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    {!query.isLoading && !query.isError && !images.length && <Alert severity="info">{tr(search ? 'No evidence matches your search.' : 'No linked images are available. Check the issued document for original evidence.')}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
      {images.map((img) => <Paper variant="outlined" key={img.id} sx={{ overflow: 'hidden', borderRadius: '16px' }}>
        <Box component="button" type="button" onClick={() => setZoom(img)} aria-label={`${tr('Open evidence')} · ${img.tower_code} · ${img.position_code || ''} · ${img.image_type}`} sx={{ width: '100%', p: 0, border: 0, cursor: 'zoom-in', bgcolor: 'action.hover', display: 'block', '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: -3 } }}>
          {failedPreviews.includes(img.image_id) ? <Box sx={{ height: 170, display: 'grid', placeItems: 'center', px: 2, color: 'text.secondary' }}>{tr('Preview unavailable · open image')}</Box> : <Box component="img" src={mediaUrl(`/api/images/${img.image_id}/thumbnail`)} alt={`${img.tower_code} · ${img.image_type}`} loading="lazy" onError={() => setFailedPreviews((ids) => [...new Set([...ids, img.image_id])])} sx={{ width: '100%', height: 170, objectFit: 'contain', display: 'block' }} />}
        </Box>
        <Box sx={{ p: 1.5 }}><Typography variant="subtitle2">{img.tower_code} · {tr(img.image_type)}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{img.position_code} · {img.capture_date || tr('Date not recorded')}</Typography>
          {img.version_status !== 'unchanged' && <Chip sx={{ mt: 1 }} size="small" variant="outlined" color={img.version_status === 'changed' ? 'warning' : 'default'} label={tr(img.version_status === 'changed' ? 'Changed since issue' : 'Original version unverified')} />}
          {user?.role === 'client' && user.can_delete_report_images && (img.sequence ?? 1) > 1 && <Button size="small" color="error" onClick={() => { setDeleting(img); setError(''); }}>{tr('Delete this image')}</Button>}
        </Box>
      </Paper>)}
    </Box>
    {zoom && <ImageLightbox open onClose={() => setZoom(null)} title={`${zoom.tower_code} · ${zoom.image_type}`} subtitle={zoom.position_code || ''} imageUrl={mediaUrl(`/api/images/${zoom.image_id}/file`)} />}
    <Dialog open={!!deleting} onClose={() => { if (!remove.isPending) setDeleting(null); }} maxWidth="xs" fullWidth>
      <DialogTitle>{tr('Delete this image?')}</DialogTitle><DialogContent>{tr('This permanently removes the field image, not the photograph already embedded in the archived report. Baseline evidence cannot be deleted.')}</DialogContent>
      <DialogActions><Button disabled={remove.isPending} onClick={() => setDeleting(null)}>{tr('Cancel')}</Button><Button color="error" disabled={remove.isPending} onClick={async () => { if (!deleting || remove.isPending) return; try { await remove.mutateAsync(deleting.image_id); setDeleting(null); } catch (err) { setError(await reportError(err, tr('Could not delete this image.'))); setDeleting(null); } }}>{tr('Delete')}</Button></DialogActions>
    </Dialog>
  </Stack>;
}

export type ReviewTab = 'overview' | 'inspection' | 'evidence' | 'discussion';
export function ReportReviewDialog({ report, onClose, initialTab = 'overview' }: { report: LineInspectionReportOut; onClose: () => void; initialTab?: ReviewTab }) {
  useLanguage();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [tab, setTab] = useState<ReviewTab>(initialTab);
  const [document, setDocument] = useState(false);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);
  const query = useQuery({ queryKey: ['report-inspection-data', report.id], queryFn: async () => (await apiClient.get<{ snapshot: InspectionSnapshot | null }>(`/api/reports/oetc-line-report/${report.id}/inspection-data`)).data });
  const snapshot = query.data?.snapshot;
  const positions = useMemo(() => snapshot?.visits.flatMap((visit) => visit.positions.map((position) => ({ visit, position }))) || [], [snapshot]);
  const results = [...new Set(positions.map(({ position }) => position.screening_result).filter((v): v is string => !!v))];
  const matching = positions.filter(({ visit, position }) => (!result || position.screening_result === result) && `${visit.tower} ${visit.inspection_date} ${position.position_code} ${position.ohl} ${position.phase} ${position.string} ${position.view_side} ${position.inspector_notes || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const file = `/api/reports/oetc-line-report/${report.id}/${report.has_file ? 'file' : 'redownload'}`;
  const download = async (pdf = false) => {
    if (downloadLock.current) return;
    downloadLock.current = true; setDownloading(true); setError('');
    try {
      const response = await apiClient.get(pdf ? `/api/reports/oetc-line-report/${report.id}/inspection-data.pdf` : file, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data); const link = window.document.createElement('a');
      link.href = url; link.download = `${report.report_number.replace(/[^\w.-]/g, '-')}${pdf ? '-inspection-data.pdf' : '.docx'}`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(await reportError(err, tr('Could not download this report. Please try again.'))); }
    finally { downloadLock.current = false; setDownloading(false); }
  };
  const totals = [
    [tr('Towers'), snapshot ? new Set(snapshot.visits.map((v) => v.tower)).size : reportTowers(report).length],
    [tr('Recorded positions'), snapshot ? positions.length : '—'],
    [tr('Hotspots recorded'), snapshot ? positions.filter(({ position: p }) => p.screening_result === 'Hotspot detected' || p.hotspot === 'Yes').length : '—'],
    [tr('Selected images'), snapshot ? positions.reduce((sum, { position }) => sum + position.evidence.length, 0) : report.image_count],
  ];
  return <>
    <Dialog open fullScreen={mobile} maxWidth="lg" fullWidth onClose={onClose} aria-labelledby="review-report-title" slotProps={{ paper: { sx: { borderRadius: mobile ? 0 : '24px', height: mobile ? '100%' : 'min(850px, 92vh)' } } }}>
      <DialogTitle component="div" sx={{ px: { xs: 2, sm: 3 }, py: 2, bgcolor: theme => alpha(theme.palette.primary.main, .05) }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}><Typography variant="overline" color="text.secondary">{tr('Customer report review')}</Typography><Typography id="review-report-title" component="h2" variant="h5" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{report.report_number}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{report.team_name} · {report.start_date} — {report.end_date}</Typography></Box>
          <IconButton onClick={onClose} aria-label={tr('Close report')}><CloseRounded /></IconButton>
        </Stack>
      </DialogTitle>
      <Tabs value={tab} onChange={(_, value: ReviewTab) => setTab(value)} variant="scrollable" scrollButtons="auto" aria-label={tr('Report review steps')} sx={{ px: { xs: 1, sm: 3 }, borderBottom: 1, borderColor: 'divider', minHeight: 56 }}>
        {([['overview', '1 · Overview'], ['inspection', '2 · Inspection data'], ['evidence', '3 · Evidence'], ['discussion', '4 · Discussion']] as const).map(([key, text]) => <Tab key={key} id={`review-tab-${key}`} aria-controls={`review-panel-${key}`} value={key} label={tr(text)} sx={{ textTransform: 'none', fontWeight: 700 }} />)}
      </Tabs>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: 3 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {query.isLoading && <LinearProgress sx={{ mb: 2 }} />}
        {query.isError && <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => void query.refetch()}>{tr('Retry')}</Button>}>{tr('Could not load inspection details. The document and discussion remain available.')}</Alert>}
        <Box role="tabpanel" id="review-panel-overview" aria-labelledby="review-tab-overview" hidden={tab !== 'overview'}>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">{tr('Start with the assessment, check individual readings and photographs, then leave a question or response in Discussion.')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>{totals.map(([text, value]) => <Paper variant="outlined" key={text} sx={{ p: 2, borderRadius: '16px', bgcolor: 'action.hover' }}><Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography><Typography variant="caption" color="text.secondary">{text}</Typography></Paper>)}</Box>
            <Assessment report={report} original={snapshot?.assessment} />
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '16px' }}><Typography variant="subtitle1" sx={{ fontWeight: 750, mb: 1.5 }}>{tr('Scope & version')}</Typography><DataFields values={{ report_type: tr(reportTypes[report.report_type || ''] || 'Inspection report'), towers: reportTowers(report).map((t) => t.name).join(', '), line_sector: report.line_sector, issued: reportTimestamp(report.created_at).toLocaleString(locale()), document: tr(report.has_file ? 'Archived original' : 'Live regeneration — no archived original') }} /></Paper>
            {!report.has_file && <Alert severity="warning">{tr('Viewing or downloading the Word document regenerates it from current inspection data. It may differ from the original issue.')}</Alert>}
            {snapshot === null && <Alert severity="info">{tr('This older report has no frozen inspection data register. Read the archived document; current field data is not shown as historical evidence.')}</Alert>}
          </Stack>
        </Box>
        <Box role="tabpanel" id="review-panel-inspection" aria-labelledby="review-tab-inspection" hidden={tab !== 'inspection'}>
          {snapshot ? <Stack spacing={2}>
            <Alert severity="info">{tr('Readings and notes are frozen at report issue time. Missing values mean not recorded, not normal. Severity is the inspector’s recorded assessment.')}</Alert>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField fullWidth size="small" label={tr('Find a position')} placeholder={tr('Tower, date, position or notes')} value={search} onChange={(e) => setSearch(e.target.value)} slotProps={{ input: { startAdornment: <SearchRounded sx={{ mr: 1, color: 'text.secondary' }} /> } }} /><TextField select size="small" label={tr('Screening result')} value={result} onChange={(e) => setResult(e.target.value)} sx={{ minWidth: 210 }}><MenuItem value="">{tr('All results')}</MenuItem>{results.map((v) => <MenuItem key={v} value={v}>{tr(v)}</MenuItem>)}</TextField></Stack>
            <Typography variant="body2" color="text.secondary" aria-live="polite">{tr('{0} of {1} positions', [matching.length, positions.length])}</Typography>
            {matching.map(({ visit, position }) => <Accordion key={`${visit.id}-${position.id}`} disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: '12px !important', '&::before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreRounded />}><Stack spacing={.5} sx={{ width: '100%', minWidth: 0, py: .5 }}><Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{visit.tower} · {String(position.view_side || '')} · {String(position.ohl)} · {String(position.phase)} · {String(position.string)}{position.direction ? ` · ${position.direction}` : ''}</Typography><Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}><Chip size="small" color={position.screening_result === 'Hotspot detected' || position.hotspot === 'Yes' ? 'warning' : 'default'} variant="outlined" label={tr(position.screening_result || 'Not recorded')} /><Typography variant="caption" color="text.secondary">{visit.inspection_date} · ΔT {String(position.delta_t ?? '—')} °C · {position.evidence.length} {tr('selected images')}</Typography></Stack></Stack></AccordionSummary>
              <AccordionDetails><Divider sx={{ mb: 2 }} /><DataFields values={position} exclude={['id', 'evidence']} /></AccordionDetails>
            </Accordion>)}
            {!matching.length && <Alert severity="info">{tr('No positions match your filters.')}</Alert>}
            <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 750, pt: 1 }}>{tr('Visit conditions & equipment')}</Typography>
            {snapshot.visits.map((visit) => <Accordion key={visit.id} elevation={0} disableGutters sx={{ border: 1, borderColor: 'divider', borderRadius: '12px !important', '&::before': { display: 'none' } }}><AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography variant="subtitle2">{visit.tower} · {visit.inspection_date} · {tr('Visit')} {visit.id}</Typography></AccordionSummary><AccordionDetails><DataFields values={visit} exclude={['positions', 'id', 'tower']} /></AccordionDetails></Accordion>)}
          </Stack> : !query.isLoading && !query.isError && <Alert severity="info">{tr('A frozen inspection data register is not available for this older report. Use the issued document.')}</Alert>}
        </Box>
        <Box role="tabpanel" id="review-panel-evidence" aria-labelledby="review-tab-evidence" hidden={tab !== 'evidence'}><Evidence report={report} active={tab === 'evidence'} /></Box>
        <Box role="tabpanel" id="review-panel-discussion" aria-labelledby="review-tab-discussion" hidden={tab !== 'discussion'}><ReportCommentsSection key={report.id} reportId={report.id} active={tab === 'discussion'} /></Box>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: 1.5, borderTop: 1, borderColor: 'divider', flexWrap: 'wrap', gap: 1 }}>
        <Button startIcon={<DescriptionRounded />} onClick={() => setDocument(true)}>{tr('View issued document')}</Button><Button startIcon={<DownloadRounded />} disabled={downloading} onClick={() => void download()}>{tr('Word')}</Button>{snapshot && <Button disabled={downloading} onClick={() => void download(true)}>{tr('Inspection data · PDF')}</Button>}
        <Box sx={{ flex: 1 }} /><Button variant="contained" onClick={() => { const steps: ReviewTab[] = ['overview', 'inspection', 'evidence', 'discussion']; if (tab === 'discussion') onClose(); else setTab(steps[steps.indexOf(tab) + 1]); }}>{tr(tab === 'discussion' ? 'Done' : 'Next step')}</Button>
      </DialogActions>
    </Dialog>
    {document && <DocxViewerDialog open onClose={() => setDocument(false)} title={report.report_number} fileUrl={mediaUrl(file)} notice={!report.has_file ? 'This is a regenerated copy using current inspection data. An archived original is not available.' : undefined} />}
  </>;
}
