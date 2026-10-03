import { tr, useLanguage, locale } from '../i18n';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Autocomplete, Box, Button, Chip, IconButton, InputAdornment, LinearProgress, MenuItem, Paper, Skeleton, Snackbar, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DeviceThermostatRounded from '@mui/icons-material/DeviceThermostatRounded';
import CameraAltRounded from '@mui/icons-material/CameraAltRounded';
import PhotoCameraBackRounded from '@mui/icons-material/PhotoCameraBackRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import DescriptionRounded from '@mui/icons-material/DescriptionRounded';
import DrawRounded from '@mui/icons-material/DrawRounded';
import FilterAltRounded from '@mui/icons-material/FilterAltRounded';
import SortRounded from '@mui/icons-material/SortRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import { DashboardSection } from './DashboardSection';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useArchive, useOetcReportHistory } from '../api/hooks';
import { apiClient, mediaUrl } from '../api/client';
import type { ArchiveVisitPhoto, ImageRow, LineInspectionReportOut } from '../api/types';
import { evidenceLabels, evidenceTypes, groupArchiveEvidence, naturalCompare } from '../utils/archiveEvidence';
import { reportError } from '../utils/reportLibrary';
import { ImageLightbox } from './ImageLightbox';
import { DocxViewerDialog } from './DocxViewerDialog';
import { ReplaceEvidenceDialog } from './ReplaceEvidenceDialog';
import { useAuth } from '../auth/AuthContext';

interface Preview { url: string; title: string; subtitle: string }
const categoryIcon = (type: string) => type.startsWith('TH') ? <DeviceThermostatRounded /> : type.startsWith('RGB') ? <CameraAltRounded /> : <PhotoCameraBackRounded />;
const groupStyle = { borderRadius: '18px !important', overflow: 'hidden', border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' }, '& > .MuiAccordion-heading': { bgcolor: 'action.hover' }, '& .MuiAccordionSummary-root.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -3 } };
const emptyImages: ImageRow[] = [];
const emptyPhotos: ArchiveVisitPhoto[] = [];

function EvidencePhoto({ image, open, viewReport }: { image: ImageRow; open: (preview: Preview) => void; viewReport: (id: number) => void }) {
  useLanguage();
  const { user } = useAuth();
  const canReplace = ['admin', 'reviewer', 'team_leader'].includes(user?.role || '');
  const [replacing, setReplacing] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = `${image.tower_code} · ${tr(image.view_side === 'Front' ? 'Front view' : image.view_side === 'Back' ? 'Back view' : 'View not recorded')} · ${image.ohl} ${image.phase} ${image.string}${image.direction ? ` — ${image.direction}` : ''} · ${evidenceLabels[image.image_type]}`;
  const subtitle = [image.team_name, image.archive_date || image.capture_date, image.original_filename].filter(Boolean).join(' · ');
  const download = async () => {
    setDownloading(true); setError(null);
    try {
      const res = await apiClient.get(`/api/images/${image.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url; link.download = image.original_filename || `${image.image_code || image.id}.jpg`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(await reportError(err, tr("Could not download this image. Please try again."))); }
    finally { setDownloading(false); }
  };
  return <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: '16px' }}>
    <Box component="button" aria-label={tr("View {0}, {1}", [title, image.sequence > 1 ? tr("extra {0}", [image.sequence - 1]) : tr("primary")])} onClick={() => open({ url: mediaUrl(`/api/images/${image.id}/file`, image.uploaded_at), title, subtitle })} sx={{ display: 'block', position: 'relative', width: '100%', height: 170, p: 1, border: 0, bgcolor: '#101e28', cursor: 'zoom-in', '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: -3 } }}>
      {failed ? <Typography color="#fff" variant="caption">{tr("Preview unavailable · open original")}</Typography> : <Box component="img" loading="lazy" src={mediaUrl(`/api/images/${image.id}/${image.thumbnail_path ? 'thumbnail' : 'file'}`, image.uploaded_at)} alt={title} onError={() => setFailed(true)} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      <Box component="span" sx={{ position: 'absolute', bottom: 8, insetInlineEnd: 8, display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: '10px', bgcolor: '#123f50dd', color: '#fff' }}><ZoomInRounded fontSize="small" /></Box>
    </Box>
    <Box sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Chip size="small" variant="outlined" label={image.sequence > 1 ? tr("Extra {0}", [image.sequence - 1]) : tr("Primary")} />
        <Tooltip title={tr("Download original")}><span><IconButton size="small" aria-label={tr("Download {0}", [title])} disabled={downloading} onClick={() => void download()}><DownloadRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
      </Stack>
      <Typography variant="caption" sx={{ display: 'block', overflowWrap: 'anywhere', mt: 0.75 }}>{image.original_filename || image.image_code || tr("Image {0}", [image.id])}</Typography>
      <Typography variant="caption" color="text.secondary">{image.archive_date || image.capture_date || tr("Date unknown")}</Typography>
      {canReplace && <Button size="small" fullWidth startIcon={<SwapHorizRoundedIcon />} sx={{ mt: 1 }} onClick={() => setReplacing(true)} aria-label={tr("Replace {0}", [title])}>{tr("Replace image")}</Button>}
      {image.annotated_path && <Button size="small" fullWidth startIcon={<DrawRounded />} sx={{ mt: 1 }} onClick={() => open({ url: mediaUrl(`/api/images/${image.id}/annotation`, image.annotated_uploaded_at), title: tr("{0} · Annotated", [title]), subtitle })}>{tr("View annotation")}</Button>}
      {!!image.reports?.length && <Stack spacing={0.5} sx={{ mt: 1 }}>
        <Typography variant="caption" color="success.main">{tr("Linked to ")}{image.reports.length}{tr(" saved report")}{image.reports.length === 1 ? '' : tr("s")}</Typography>
        {image.reports.map((report) => <Tooltip key={report.id} title={tr("Open report · recorded as {0}", [report.image_type])}><Button size="small" startIcon={<DescriptionRounded fontSize="small" />} onClick={() => viewReport(report.id)} sx={{ p: 0, justifyContent: 'flex-start', textAlign: 'left', overflowWrap: 'anywhere', fontSize: 11 }}>{report.report_number}</Button></Tooltip>)}
      </Stack>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{tr(error)}</Alert>}
    </Box>
    {replacing && <ReplaceEvidenceDialog image={image} onClose={() => setReplacing(false)} onReplaced={() => { setReplacing(false); setReplaced(true); setFailed(false); }} />}
    <Snackbar open={replaced} autoHideDuration={7000} onClose={() => setReplaced(false)} message={tr("Image replaced. Generate a new report when your evidence is ready.")} />
  </Paper>;
}

function FieldPhoto({ photo, open }: { photo: ArchiveVisitPhoto; open: (preview: Preview) => void }) {
  useLanguage();
  const title = `${photo.tower_code} · ${photo.position_code || 'Tower field photo'}`;
  return <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '16px' }}>
    <Box component="button" aria-label={tr("View field photo {0}", [photo.original_filename || photo.id])} onClick={() => open({ url: mediaUrl(`/api/visits/${photo.visit_id}/photos/${photo.id}/file`, photo.uploaded_at), title, subtitle: [photo.team_name, photo.caption, photo.archive_date].filter(Boolean).join(' · ') })} sx={{ width: '100%', height: 150, border: 0, bgcolor: '#101e28', cursor: 'zoom-in' }}>
      <Box component="img" loading="lazy" src={mediaUrl(`/api/visits/${photo.visit_id}/photos/${photo.id}/thumbnail`, photo.uploaded_at)} alt={photo.caption || photo.original_filename || title} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </Box>
    <Typography variant="caption" sx={{ display: 'block', mt: 1, overflowWrap: 'anywhere' }}>{photo.caption || photo.original_filename || tr("Field photo")}</Typography>
    <Typography variant="caption" color="text.secondary">{photo.archive_date || tr("Date unknown")}</Typography>
    <Button size="small" component="a" href={mediaUrl(`/api/visits/${photo.visit_id}/photos/${photo.id}/file`, photo.uploaded_at)} target="_blank" rel="noreferrer">{tr("Open original")}</Button>
  </Paper>;
}

export function InspectionEvidenceArchive() {
  useLanguage();
  const [params, setParams] = useSearchParams();
  const reportId = Number(params.get('report')) || undefined;
  const [team, setTeam] = useState<number | null>(null);
  const [tower, setTower] = useState<number | null>(null);
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('insulator');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [viewingReport, setViewingReport] = useState<LineInspectionReportOut | null>(null);
  const archive = useArchive({ team_id: team || undefined, tower_id: tower || undefined, year: year ? Number(year) : undefined, month: month ? Number(month) : undefined, report_id: reportId });
  const history = useOetcReportHistory();
  const images = archive.data?.images || emptyImages;
  const photos = archive.data?.photos || emptyPhotos;
  const tree = useMemo(() => groupArchiveEvidence(images, photos, search, sort === 'date'), [images, photos, search, sort]);
  const visibleImages = tree.flatMap(t => t.towers.flatMap(tower => tower.positions.flatMap(p => p.images)));
  const visiblePhotoCount = tree.reduce((n, t) => n + t.towers.reduce((m, tower) => m + tower.photos.length + tower.positions.reduce((p, position) => p + position.photos.length, 0), 0), 0);
  // Keep chosen options while a filtered query refreshes.
  const [selectedTeam, setSelectedTeam] = useState<{ id: number; name: string } | null>(null);
  const [selectedTower, setSelectedTower] = useState<{ id: number; name: string } | null>(null);
  const teamOptions = Array.from(new Map([...images, ...photos].filter(r => r.team_id != null).map(r => [r.team_id!, { id: r.team_id!, name: r.team_name || 'Unnamed team' }])).values()).sort((a,b) => naturalCompare(a.name,b.name));
  const towerOptions = Array.from(new Map([...images, ...photos].filter(r => r.tower_pk != null).map(r => [r.tower_pk!, { id: r.tower_pk!, name: r.tower_code || 'Unnamed tower' }])).values()).sort((a,b) => naturalCompare(a.name,b.name));
  const active = !!(team || tower || year || month || search || reportId);
  const selectedReport = history.data?.find((r) => r.id === reportId) || null;
  const years = [...new Set([...Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)), ...images.map(r => (r.archive_date || r.capture_date || '').slice(0,4)), ...photos.map(r => (r.archive_date || '').slice(0,4)), year].filter(Boolean))].sort().reverse();
  const reset = () => { setTeam(null); setTower(null); setSelectedTeam(null); setSelectedTower(null); setYear(''); setMonth(''); setSearch(''); setParams((p) => { p.delete('report'); return p; }); };
  const shown = tree.reduce((sum, t) => sum + t.count, 0);
  const viewReport = (id: number) => { const report = history.data?.find(r => r.id === id); if (report) setViewingReport(report); };
  return <Stack spacing={2.5}>
    <DashboardSection icon={<FilterAltRounded />} title={tr('Find inspection evidence')} description={tr('Filter by crew, tower, saved report or capture date. Your selections stay in place when this section is collapsed.')} tone="blue">
    <Box sx={{ '& .MuiOutlinedInput-root': { borderRadius: '14px', minHeight: 48 } }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}><SearchRoundedIcon color="primary" sx={{ fontSize: 30 }} /><Box sx={{ flex: 1 }}><Typography variant="h5">{tr("Inspection evidence")}</Typography><Typography variant="body2" color="text.secondary">{tr("Team → tower → insulator. Every category, every additional capture, together.")}</Typography></Box><Tooltip title={tr("Refresh all images")}><span><IconButton aria-label={tr("Refresh image archive")} disabled={archive.isFetching} onClick={() => void archive.refetch()}><RefreshRoundedIcon /></IconButton></span></Tooltip></Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '2fr 1fr 1fr' }, gap: 2 }}>
        <TextField size="small" label={tr("Search team, tower or insulator")} value={search} onChange={e => setSearch(e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment> } }} />
        <Autocomplete size="small" options={teamOptions} value={selectedTeam} getOptionLabel={o => o.name} isOptionEqualToValue={(a,b) => a.id === b.id} onChange={(_,value) => { setTeam(value?.id || null); setSelectedTeam(value); setTower(null); setSelectedTower(null); }} renderInput={p => <TextField {...p} slotProps={{ ...p.slotProps, input: { ...p.slotProps.input, startAdornment: <><InputAdornment position="start"><GroupsRoundedIcon fontSize="small" /></InputAdornment>{p.slotProps.input.startAdornment}</> } }} label={tr("Team")} placeholder={tr("All teams")} />} />
        <Autocomplete size="small" options={towerOptions} value={selectedTower} getOptionLabel={o => o.name} isOptionEqualToValue={(a,b) => a.id === b.id} onChange={(_,value) => { setTower(value?.id || null); setSelectedTower(value); }} renderInput={p => <TextField {...p} slotProps={{ ...p.slotProps, input: { ...p.slotProps.input, startAdornment: <><InputAdornment position="start"><TransmissionTowerIcon fontSize="small" /></InputAdornment>{p.slotProps.input.startAdornment}</> } }} label={tr("Tower")} placeholder={tr("All towers")} />} />
        <Autocomplete size="small" options={history.data || []} value={selectedReport} getOptionLabel={r => r.report_number} isOptionEqualToValue={(a,b) => a.id === b.id} onChange={(_,report) => setParams(p => { if (report) p.set('report', String(report.id)); else p.delete('report'); return p; })} renderInput={p => <TextField {...p} slotProps={{ ...p.slotProps, input: { ...p.slotProps.input, startAdornment: <><InputAdornment position="start"><DescriptionRounded fontSize="small" /></InputAdornment>{p.slotProps.input.startAdornment}</> } }} label={tr("Saved report")} placeholder={tr("All uploaded evidence")} />} />
        <TextField select size="small" label={tr("Capture year")} slotProps={{ inputLabel: { shrink: true }, input: { startAdornment: <InputAdornment position="start"><CalendarMonthRounded fontSize="small" /></InputAdornment> }, select: { displayEmpty: true, renderValue: () => year || tr('All years') } }} value={year} onChange={e => setYear(e.target.value)}><MenuItem value="">{tr("All years")}</MenuItem>{years.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}</TextField>
        <TextField select size="small" label={tr("Capture month")} slotProps={{ inputLabel: { shrink: true }, input: { startAdornment: <InputAdornment position="start"><CalendarMonthRounded fontSize="small" /></InputAdornment> }, select: { displayEmpty: true, renderValue: () => month ? new Date(2000, Number(month) - 1, 1).toLocaleString(locale(), { month: 'long' }) : tr('All months') } }} value={month} onChange={e => setMonth(e.target.value)}><MenuItem value="">{tr("All months")}</MenuItem>{Array.from({length:12},(_,i) => <MenuItem key={i} value={String(i+1)}>{new Date(2000,i,1).toLocaleString(locale(),{month:'long'})}</MenuItem>)}</TextField>
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{tr("Dates use capture date, then inspection or upload date when unavailable.")}</Typography>
        {active && <Button size="small" startIcon={<RestartAltRounded />} onClick={reset}>{tr("Clear filters")}</Button>}
        <TextField select size="small" label={tr("Insulator order")} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SortRounded fontSize="small" /></InputAdornment> } }} value={sort} onChange={e => setSort(e.target.value)} sx={{ minWidth: 175 }}><MenuItem value="insulator">{tr("Circuit / phase / string")}</MenuItem><MenuItem value="date">{tr("Newest inspection first")}</MenuItem></TextField>
      </Stack>
    </Box>
    </DashboardSection>
    {archive.isFetching && <Box role="status"><LinearProgress /><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{tr("Loading all matching images and field photos…")}</Typography></Box>}
    {archive.isError && <Alert severity="error" action={<Button color="inherit" onClick={() => void archive.refetch()}>{tr("Retry")}</Button>}>{tr("The complete archive could not be loaded. Please retry before judging evidence completeness.")}</Alert>}
    {history.isError && <Alert severity="warning">{tr("Report references could not be loaded. Uploaded images remain available.")}</Alert>}
    <DashboardSection icon={<PhotoLibraryRoundedIcon />} title={tr('Evidence library')} description={tr('Browse team → tower → insulator. Open a thumbnail to inspect the original image and its details.')} eyebrow={tr('CAPTURED IN THE FIELD')} tone="teal">
    <Stack spacing={2.5}>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' }, gap: 1.5 }}>
      {[...evidenceTypes.map(type => ({ type, label: evidenceLabels[type], value: visibleImages.filter(img => img.image_type === type).length })), { type: 'field', label: tr('Field photos'), value: visiblePhotoCount }].map(stat => <Paper variant="outlined" key={stat.type} sx={{ p: 2, borderRadius: '18px', borderTop: '3px solid', borderTopColor: stat.type.startsWith('TH') ? 'warning.main' : 'primary.main' }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: '12px', mb: 1, color: stat.type.startsWith('TH') ? 'warning.main' : 'primary.main', bgcolor: theme => alpha(stat.type.startsWith('TH') ? theme.palette.warning.main : theme.palette.primary.main, .1) }}>{categoryIcon(stat.type)}</Box>
        <Typography variant="body2" color="text.secondary">{tr(stat.label)}</Typography>{archive.isLoading ? <Skeleton width={60} height={36} /> : <Typography variant="h5" sx={{ mt: .5, fontWeight: 800 }}>{stat.value}</Typography>}
      </Paper>)}
    </Box>
    {!archive.isLoading && !archive.isError && <Typography variant="body2" color="text.secondary" aria-live="polite">{shown.toLocaleString(locale())}{tr(" images shown · ")}{visibleImages.filter(i => i.sequence > 1).length.toLocaleString(locale())}{tr(" additional captures included · ")}{visibleImages.filter(i => i.reports?.length).length.toLocaleString(locale())}{tr(" linked to saved reports")}</Typography>}
    {reportId && <Alert severity="info">{tr("Showing image references recorded for ")}{selectedReport?.report_number || tr("report {0}", [reportId])}{tr(". Other uploads and unlinked field photos are available by clearing the report filter.")}</Alert>}
    {!archive.isLoading && !archive.isError && !tree.length && <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}><PhotoLibraryRoundedIcon color="primary" sx={{ fontSize: 44, mb: 1 }} /><Typography variant="h6">{tr("No images in this selection")}</Typography><Typography color="text.secondary">{tr("Try another team, tower, report or date range.")}</Typography>{active && <Button sx={{ mt: 2 }} onClick={reset}>{tr("Show all uploaded evidence")}</Button>}</Paper>}
    {tree.map(t => <Accordion key={`${t.id}-${reportId || 'all'}`} defaultExpanded={tree.length === 1} disableGutters sx={groupStyle} slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', width: '100%' }}><GroupsRoundedIcon color="primary" /><Typography sx={{ fontWeight: 700, flex: 1 }}>{t.name}</Typography><Chip size="small" label={tr("{0} towers · {1} images", [t.towers.length, t.count])} /></Stack></AccordionSummary>
      <AccordionDetails sx={{ p: { xs: 1, md: 2 } }}><Stack spacing={1.5}>{t.towers.map(towerGroup => <Accordion key={towerGroup.id} variant="outlined" disableGutters sx={groupStyle} defaultExpanded={t.towers.length === 1} slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', width: '100%' }}><TransmissionTowerIcon color="action" /><Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 700 }}>{towerGroup.name}</Typography><Typography variant="caption" color="text.secondary">{towerGroup.area} · {towerGroup.positions.length}{tr(" insulator inspections")}</Typography></Box><Chip size="small" label={tr("{0} images", [towerGroup.count])} /></Stack></AccordionSummary>
        <AccordionDetails sx={{ p: { xs: 1, md: 2 } }}><Stack spacing={2}>
          {towerGroup.positions.map(position => <Accordion key={position.id} disableGutters sx={groupStyle} defaultExpanded={towerGroup.positions.length === 1} slotProps={{ transition: { unmountOnExit: true } }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Box sx={{ width: '100%' }}><Typography sx={{ fontWeight: 700 }}>{position.label}</Typography><Typography variant="caption" color="text.secondary">{position.date || tr("Inspection date unavailable")}{position.visitId ? tr(" · Visit {0}", [position.visitId]) : ''}</Typography><Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>{evidenceTypes.map(type => { const count = position.images.filter(img => img.image_type === type).length; return <Chip key={type} size="small" icon={categoryIcon(type)} color={count ? 'primary' : 'default'} variant="outlined" label={`${evidenceLabels[type]} · ${count}`} />; })}{!!position.photos.length && <Chip size="small" variant="outlined" label={tr("{0} field photos", [position.photos.length])} />}</Stack></Box></AccordionSummary>
            <AccordionDetails sx={{ p: { xs: 1, md: 2 } }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))', xl: 'repeat(4,minmax(0,1fr))' }, gap: 1.5 }}>
                {evidenceTypes.map(type => { const category = position.images.filter(img => img.image_type === type); return <Box key={type} sx={{ minWidth: 0 }}><Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: .75, '& svg': { fontSize: 20, color: type.startsWith('TH') ? 'warning.main' : 'primary.main' } }}>{categoryIcon(type)}{tr(evidenceLabels[type])} <Typography component="span" variant="caption" color="text.secondary">({category.length})</Typography></Typography><Stack spacing={1.5}>{category.length ? category.map(img => <EvidencePhoto key={img.id} image={img} open={setPreview} viewReport={viewReport} />) : <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: '16px', minHeight: 170, p: 2, display: 'grid', placeItems: 'center' }}><Typography variant="caption" color="text.secondary">{active ? tr("No image in this selection") : tr("Not uploaded")}</Typography></Box>}</Stack></Box>; })}
              </Box>
              {!!position.photos.length && <Box sx={{ mt: 3 }}><Typography variant="subtitle2" sx={{ mb: 1 }}>{tr("Additional field photos · this insulator")}</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))', lg: 'repeat(3,minmax(0,1fr))' }, gap: 1.5 }}>{position.photos.map(photo => <FieldPhoto key={photo.id} photo={photo} open={setPreview} />)}</Box></Box>}
            </AccordionDetails>
          </Accordion>)}
          {!!towerGroup.photos.length && <Accordion disableGutters slotProps={{ transition: { unmountOnExit: true } }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="subtitle2">{tr("Other tower photos · ")}{towerGroup.photos.length}{tr(" without an insulator tag")}</Typography></AccordionSummary><AccordionDetails><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))', lg: 'repeat(3,minmax(0,1fr))' }, gap: 1.5 }}>{towerGroup.photos.map(photo => <FieldPhoto key={photo.id} photo={photo} open={setPreview} />)}</Box></AccordionDetails></Accordion>}
        </Stack></AccordionDetails>
      </Accordion>)}</Stack></AccordionDetails>
    </Accordion>)}
    </Stack>
    </DashboardSection>
    {preview && <ImageLightbox open onClose={() => setPreview(null)} title={preview.title} subtitle={preview.subtitle} imageUrl={preview.url} />}
    {viewingReport && <DocxViewerDialog open onClose={() => setViewingReport(null)} title={viewingReport.report_number} fileUrl={mediaUrl(`/api/reports/oetc-line-report/${viewingReport.id}/${viewingReport.has_file ? 'file' : 'redownload'}`)} notice={!viewingReport.has_file ? 'This report is regenerated from current inspection data.' : undefined} />}
  </Stack>;
}
