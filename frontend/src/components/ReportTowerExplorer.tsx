import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme } from '@mui/material';
import { ArrowBackRounded, ArrowForwardRounded, CloseRounded, DescriptionOutlined, LockOutlined, PhotoLibraryOutlined, ThermostatRounded, ZoomInRounded, ZoomOutRounded, RestartAltRounded } from '@mui/icons-material';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import { TowerDrawingSheet } from './TowerDrawingSheet';
import { apiClient, mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { DigitalFinding } from '../utils/digitalReport';
import { severityRank } from '../utils/digitalReport';
import { reportTowerLayouts, reportTowerSlot } from '../utils/reportTower';
import { inspectionValue } from '../i18n/inspection';
import { formatDate, tr, useLanguage } from '../i18n';

const display = (v: unknown) => v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? tr(v ? 'Yes' : 'No') : String(v);
const severityColor = (row: DigitalFinding) => {
  const rank = severityRank(row.fields.severity);
  return rank === 0 ? 'error' : rank === 1 ? 'warning' : rank === 3 ? 'success' : 'default';
};
const details = ['ohl', 'phase', 'string', 'direction', 'view_side', 'mount_type', 'string_count', 'gs_side', 'tower_proximity', 'installed', 'screening_result', 'severity', 'tmax_c', 'tref_c', 'delta_t', 'manufacturer', 'year_installed', 'insulator_type', 'pollution_condition', 'thermal_indication', 'visual_indications', 'confidence', 'inspector_notes'];
const labels: Record<string, string> = { ohl: 'Circuit', phase: 'Phase', string: 'String', direction: 'Direction', view_side: 'Viewing side', mount_type: 'Tower type', string_count: 'String count', gs_side: 'GS side', tower_proximity: 'Tower proximity', installed: 'Installed', screening_result: 'Screening result', severity: 'Severity', tmax_c: 'Tmax (°C)', tref_c: 'Tref (°C)', delta_t: 'ΔT (°C)', manufacturer: 'Manufacturer', year_installed: 'Year installed', insulator_type: 'Insulator type', pollution_condition: 'Pollution condition', thermal_indication: 'Thermal indications', visual_indications: 'Visual indications', confidence: 'Confidence', inspector_notes: 'Inspector notes' };

/** Uses only frozen report findings and report-scoped archived photographs. No mutation APIs. */
export function ReportTowerExplorer({ reportId, rows, startKey, onOpenFinding }: { reportId: number; rows: DigitalFinding[]; startKey: string; onOpenFinding: (key: string) => void }) {
  useLanguage();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const [presentation, setPresentation] = useState<string | null>(null);
  const mode = presentation || (compact ? 'cards' : 'diagram');
  const { user } = useAuth();
  const layouts = useMemo(() => reportTowerLayouts(rows), [rows]);
  const [layoutKey, setLayoutKey] = useState('');
  const [positionKey, setPositionKey] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ row: DigitalFinding; index: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const evidence = useQuery({ queryKey: ['digital-report-evidence', user?.id, reportId], queryFn: async () => (await apiClient.get<{ available: string[] }>(`/api/reports/oetc-line-report/${reportId}/digital-evidence`)).data.available });
  const available = useMemo(() => new Set(evidence.data || []), [evidence.data]);
  const unavailable = (key: string) => !available.has(key) || failedImages.includes(key);
  const imageSrc = (row: DigitalFinding, index: number) => mediaUrl(`/api/reports/oetc-line-report/${reportId}/digital-evidence/${encodeURIComponent(`${row.key}:${index}`)}`);
  useEffect(() => {
    const initial = layouts.find(item => item.rows.some(row => row.key === startKey));
    if (initial) setLayoutKey(initial.key);
  }, [layouts, startKey]);
  const layout = layouts.find(item => item.key === layoutKey) || layouts[0];
  const position = rows.find(row => row.key === positionKey);
  const imageFailure = (key: string) => setFailedImages(old => old.includes(key) ? old : [...old, key]);
  const openPhoto = (row: DigitalFinding, index: number) => { setPhoto({ row, index }); setZoom(1); };
  const thumbnails = (row: DigitalFinding) => <Stack direction="row" spacing={.5} sx={{ minHeight: 44 }}>
    {row.evidence.slice(0, 4).map((item, index) => {
      const key = `${row.key}:${index}`;
      return unavailable(key) ? <Tooltip key={key} title={tr(evidence.isLoading ? 'Loading photographs' : 'Original photograph unavailable')}><Box sx={{ width: 40, height: 40, border: 1, borderColor: 'divider', bgcolor: 'action.hover', borderRadius: 1, display: 'grid', placeItems: 'center' }}><PhotoLibraryOutlined sx={{ fontSize: 17, color: 'text.disabled' }} /></Box></Tooltip> : <Tooltip key={key} title={item.image_type}><Button aria-label={tr('Open {0} photograph', [item.image_type])} onClick={() => openPhoto(row, index)} sx={{ p: 0, minWidth: 40, width: 40, height: 40, overflow: 'hidden', borderRadius: 1 }}><Box component="img" src={imageSrc(row, index)} alt={item.image_type} loading="lazy" onError={() => imageFailure(key)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /></Button></Tooltip>;
    })}
  </Stack>;
  const card = (row: DigitalFinding) => <Paper component="section" variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, outline: startKey === row.key ? '2px solid' : undefined, outlineColor: 'primary.main', borderTop: '3px solid', borderTopColor: ({ R: '#b74248', Y: '#9b7719', B: '#3976b4' } as Record<string, string>)[String(row.fields.phase)] || 'divider', boxShadow: '0 4px 14px #183e4c0a' }}>
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">{display(row.fields.view_side) === '—' ? tr('View not recorded') : tr(String(row.fields.view_side) + ' view')}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 800 }}><bdi>{display(row.fields.ohl)} · {display(row.fields.phase)} · {display(row.fields.string)}</bdi></Typography>
      <Chip size="small" color={severityColor(row)} variant="outlined" label={row.fields.severity ? tr(String(row.fields.severity)) : tr('Severity not recorded')} sx={{ alignSelf: 'flex-start', height: 23, fontSize: 11 }} />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: .75 }}>{['tmax_c', 'tref_c'].map(field => <Box key={field} sx={{ bgcolor: 'action.hover', borderRadius: 1.5, p: .75 }}><Typography variant="caption" color="text.secondary" title={tr(labels[field])} sx={{ fontSize: 10, whiteSpace: 'nowrap' }}><bdi>{field === 'tmax_c' ? 'Tmax (°C)' : 'Tref (°C)'}</bdi></Typography><Typography variant="body2" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{display(row.fields[field])}</Typography></Box>)}</Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', color: 'primary.main', px: .75 }}><ThermostatRounded sx={{ fontSize: 17 }} /><Typography variant="caption">ΔT (°C)</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{display(row.fields.delta_t)}</Typography></Stack>
      <Typography variant="caption" sx={{ lineHeight: 1.4 }}>{row.fields.screening_result ? tr(String(row.fields.screening_result)) : tr('Not recorded')}</Typography>
      <Button size="small" startIcon={<PhotoLibraryOutlined />} onClick={() => setPositionKey(row.key)} sx={{ bgcolor: 'action.hover', fontSize: 11 }}>{tr('Photos & details')} · {row.evidence.length}</Button>
      {thumbnails(row)}
    </Stack>
  </Paper>;
  if (!layout) return <Alert severity="info">{tr('No recorded positions in this report.')}</Alert>;
  const visitLayouts = layouts.filter(item => item.visitId === layout.visitId);
  const visits = [...new Map(layouts.map(item => [item.visitId, item])).values()];
  const sides = layout.viewSide === 'Back' ? [1, 0] : [0, 1];
  const context = <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>{[layout.mount || tr('Not recorded'), layout.circuit || tr('Not recorded'), layout.count || tr('Not recorded'), layout.viewSide ? tr(layout.viewSide + ' view') : tr('View not recorded')].map((text, i) => <Chip key={i} size="small" variant="outlined" label={tr(text)} />)}</Stack>;
  return <Stack spacing={2.5}>
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' }, mb: 2 }}><Box sx={{ p: 1.5, bgcolor: 'action.hover', color: 'primary.main', borderRadius: 3, alignSelf: 'flex-start', display: 'flex' }}><TransmissionTowerIcon /></Box><Box sx={{ flex: 1 }}><Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>{tr('Explore the tower')}</Typography><Typography variant="body2" color="text.secondary">{tr('Select an insulator to examine its recorded readings, observations and original photographs.')}</Typography></Box><Chip icon={<LockOutlined />} variant="outlined" color="primary" label={tr('View only')} /></Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <TextField select size="small" label={tr('Tower / inspection visit')} value={layout.visitId} onChange={e => { const next = layouts.find(item => item.visitId === e.target.value); if (next) setLayoutKey(next.key); }}>{visits.map(item => <MenuItem key={item.visitId} value={item.visitId}>{item.tower} · {item.date ? formatDate(item.date, { day: 'numeric', month: 'short', year: 'numeric' }) : tr('Not recorded')} · #{item.visitId}</MenuItem>)}</TextField>
        <TextField select size="small" label={tr('Recorded arrangement')} value={layout.key} onChange={e => setLayoutKey(e.target.value)}>{visitLayouts.map(item => <MenuItem key={item.key} value={item.key}>{item.circuit || '—'} · {tr(item.mount || 'Not recorded')} · {tr(item.viewSide ? item.viewSide + ' view' : 'View not recorded')} · {tr(item.count || 'Not recorded')}</MenuItem>)}</TextField>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{tr('This view shows all positions included in this issued visit, independent of the report search filters. The drawing is a schematic; directions are labelled as recorded.')}</Typography>
    </Paper>
    {evidence.isError && <Alert severity="warning" action={<Button onClick={() => void evidence.refetch()}>{tr('Retry')}</Button>}>{tr('Could not load original photographs. The issued report remains available.')}</Alert>}
    {layout.drawable && <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, next: string | null) => { if (next) setPresentation(next); }} aria-label={tr('Tower presentation')} sx={{ alignSelf: 'flex-start', '& .MuiToggleButton-root': { px: 2, gap: 1 } }}><ToggleButton value="diagram"><TransmissionTowerIcon fontSize="small" />{tr('Tower diagram')}</ToggleButton><ToggleButton value="cards"><PhotoLibraryOutlined fontSize="small" />{tr('Position cards')}</ToggleButton></ToggleButtonGroup>}
    {layout.drawable && mode === 'diagram' ? <TowerDrawingSheet key={layout.key} readOnly setupComplete count={layout.count} controls={context} directions={sides.map(side => <Paper key={side} variant="outlined" sx={{ p: 1.5, textAlign: 'center', bgcolor: 'background.paper' }}><Typography sx={{ fontWeight: 800 }}>{layout.mount === 'Suspension' ? layout.sides[side] : `${layout.circuit} · ${layout.sides[side] || tr('Direction not recorded')}`}</Typography><Typography variant="caption" color="text.secondary">{tr(layout.viewSide ? layout.viewSide + ' view' : 'View not recorded')}</Typography></Paper>)} prepare={<Chip icon={<LockOutlined sx={{ color: 'inherit !important' }} />} label={tr('Issued report · view only')} variant="outlined" sx={{ bgcolor: '#e7f1f2', color: '#164754', borderColor: '#b4d1d6' }} />} towerNumber={<Box><Typography variant="caption" color="text.secondary">{tr('Tower number')}</Typography><Typography sx={{ fontWeight: 800 }}>{layout.tower}</Typography></Box>} humidity={<Box><Typography variant="caption" color="text.secondary">{tr('Humidity (%)')}</Typography><Typography sx={{ fontWeight: 800 }}>{display(layout.rows[0].fields.humidity_pct)}</Typography></Box>} renderPosition={(side, phase, string) => {
      const row = reportTowerSlot(layout, side, phase, string);
      return row ? card(row) : <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderStyle: 'dashed', bgcolor: 'background.paper' }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{phase} · {string}</Typography><Typography variant="caption" color="text.secondary">{tr('Not included in issued report')}</Typography></Paper>;
    }} /> : <>{!layout.drawable && <Alert severity="info">{tr('The saved arrangement does not support a reliable tower schematic. Every recorded position is shown below.')}</Alert>}{context}<Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 2 }}>{layout.rows.map(row => <Box key={row.key}>{card(row)}</Box>)}</Box></>}
    <Dialog open={!!position} onClose={() => setPositionKey(null)} fullWidth maxWidth="md" aria-labelledby="report-position-title">
      <DialogTitle id="report-position-title"><Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}><TransmissionTowerIcon color="primary" /><Box sx={{ flex: 1 }}><Typography component="span" sx={{ fontWeight: 800 }}>{position ? display(position.fields.tower) : ''}</Typography><Typography variant="body2" color="text.secondary">{position ? [position.fields.ohl, position.fields.phase, position.fields.string, position.fields.direction, position.fields.view_side].filter(Boolean).join(' · ') : ''}</Typography></Box><IconButton aria-label={tr('Close')} onClick={() => setPositionKey(null)}><CloseRounded /></IconButton></Stack></DialogTitle>
      {position && <DialogContent><Stack spacing={2.5}><Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}><Chip icon={<LockOutlined />} label={tr('View only')} size="small" /><Chip size="small" variant="outlined" color={severityColor(position)} label={position.fields.severity ? tr(String(position.fields.severity)) : tr('Severity not recorded')} /><Button size="small" startIcon={<DescriptionOutlined />} onClick={() => { setPositionKey(null); onOpenFinding(position.key); }}>{tr('View in report template')}</Button></Stack>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>{details.map(field => <Box key={field} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2, gridColumn: field === 'inspector_notes' ? '1 / -1' : undefined }}><Typography component="dt" variant="caption" color="text.secondary">{tr(labels[field])}</Typography><Typography component="dd" variant="body2" sx={{ m: 0, mt: .5, fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{position.fields[field] === null || position.fields[field] === undefined || position.fields[field] === '' ? '—' : inspectionValue(field, position.fields[field])}</Typography></Box>)}</Box>
        <Typography variant="h6" sx={{ fontWeight: 750 }}>{tr('Original evidence photographs')}</Typography>
        {!position.evidence.length && <Alert severity="info">{tr('No photographs included for this position.')}</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>{position.evidence.map((item, index) => {
          const key = `${position.key}:${index}`;
          return <Paper key={key} variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3 }}>{unavailable(key) ? <Stack sx={{ height: 180, alignItems: 'center', justifyContent: 'center', p: 2 }} spacing={1}><PhotoLibraryOutlined color="disabled" /><Typography variant="caption" color="text.secondary">{tr(evidence.isLoading ? 'Loading photographs' : 'Original photograph unavailable')}</Typography></Stack> : <Button aria-label={tr('Open {0} photograph', [item.image_type])} onClick={() => openPhoto(position, index)} sx={{ p: 0, display: 'block', width: '100%', bgcolor: '#102b37' }}><Box component="img" src={imageSrc(position, index)} alt={item.image_type} loading="lazy" onError={() => imageFailure(key)} sx={{ display: 'block', width: '100%', height: 230, objectFit: 'contain' }} /></Button>}<Box sx={{ p: 1.5 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{item.image_type}</Typography><Typography variant="caption" color="text.secondary">{item.capture_date || '—'} {item.capture_time || ''}</Typography></Box></Paper>;
        })}</Box>
      </Stack></DialogContent>}
    </Dialog>
    <Dialog open={!!photo} onClose={() => setPhoto(null)} fullWidth maxWidth="xl" aria-labelledby="report-photo-title">
      <DialogTitle id="report-photo-title"><Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}><Typography sx={{ flex: 1, fontWeight: 750 }}>{photo ? `${display(photo.row.fields.tower)} · ${photo.row.evidence[photo.index].image_type}` : ''}</Typography><Chip size="small" icon={<LockOutlined />} label={tr('View only')} /><IconButton aria-label={tr('Close photograph')} onClick={() => setPhoto(null)}><CloseRounded /></IconButton></Stack></DialogTitle>
      {photo && <DialogContent><Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}><IconButton aria-label={tr('Previous photograph')} disabled={!photo.row.evidence.slice(0, photo.index).some((_, index) => !unavailable(`${photo.row.key}:${index}`))} onClick={() => { const index = photo.row.evidence.map((_, i) => i).filter(i => i < photo.index && !unavailable(`${photo.row.key}:${i}`)).at(-1); if (index !== undefined) openPhoto(photo.row, index); }}><ArrowBackRounded /></IconButton><Typography variant="caption">{photo.index + 1} / {photo.row.evidence.length}</Typography><IconButton aria-label={tr('Next photograph')} disabled={!photo.row.evidence.some((_, index) => index > photo.index && !unavailable(`${photo.row.key}:${index}`))} onClick={() => { const index = photo.row.evidence.findIndex((_, i) => i > photo.index && !unavailable(`${photo.row.key}:${i}`)); if (index >= 0) openPhoto(photo.row, index); }}><ArrowForwardRounded /></IconButton><Box sx={{ flex: 1 }} /><IconButton aria-label={tr('Zoom out')} disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - .5))}><ZoomOutRounded /></IconButton><Typography variant="caption">{Math.round(zoom * 100)}%</Typography><IconButton aria-label={tr('Zoom in')} disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, z + .5))}><ZoomInRounded /></IconButton><Button startIcon={<RestartAltRounded />} onClick={() => setZoom(1)}>{tr('Reset')}</Button></Stack><Box tabIndex={0} role="region" aria-label={tr('Photograph zoom and pan')} sx={{ overflow: 'auto', maxHeight: '72vh', bgcolor: '#102b37', borderRadius: 2 }}>{unavailable(`${photo.row.key}:${photo.index}`) ? <Alert severity="warning">{tr('Original photograph unavailable')}</Alert> : <Box component="img" src={imageSrc(photo.row, photo.index)} alt={photo.row.evidence[photo.index].image_type} onError={() => imageFailure(`${photo.row.key}:${photo.index}`)} sx={{ display: 'block', width: `${zoom * 100}%`, maxWidth: 'none' }} />}</Box></DialogContent>}
    </Dialog>
  </Stack>;
}
