import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, ToggleButton, ToggleButtonGroup, TextField, Typography } from '@mui/material';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import ThermostatRounded from '@mui/icons-material/ThermostatRounded';
import AddCircleOutlineRounded from '@mui/icons-material/AddCircleOutlineRounded';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import TouchAppOutlined from '@mui/icons-material/TouchAppOutlined';
import TuneRounded from '@mui/icons-material/TuneRounded';
import type { ChoiceLists, Position, PositionSlot, VisitDetail } from '../api/types';
import { tr, useLanguage } from '../i18n';
import type { DraftImage } from '../api/visitEntry';
import { evidenceProgress, needsInspectionWork, nextIncompletePosition } from '../utils/inspectionProgress';
import { positionIdentity, resolveSuspensionSlots } from '../utils/visitEntry';
import { positionLabel } from '../utils/positionChanges';
import { matchesVisualSlot, numericReading, visualScreeningPatch, visualSides, visualSlots, visitVisualLayout, type VisualLayout } from '../utils/visualTower';
import { TowerDrawingSheet } from './TowerDrawingSheet';
import { TowerPositionMap } from './TowerPositionMap';
import { InspectionReadingField } from './InspectionReadingField';
import { PositionImageGallery } from './PositionImageGallery';
import { NextStepCoach } from './NextStepCoach';
import { nextVisitGuidance } from '../utils/visitGuidance';
import type { VisitReviewCheck, VisitCheckTarget } from '../utils/visitWorkflow';
import { inspectionCheck } from '../i18n/inspection';

export function VisualTowerForm({ visit, positions, lists, userKey, disabled, onPrepare, onReading, onHeader, onDone, onInvalid, stagedImages, status, draftError, onOpenChange, visitDetails, renderPositionDetails, onReview, initialOpen = false, navigationBusy = false, feedback, onLater, checks, onHeaderCheck, onShared }: {
  visit: VisitDetail; positions: Position[]; lists: ChoiceLists; disabled: boolean;
  userKey: string; initialOpen?: boolean; navigationBusy?: boolean; feedback?: ReactNode;
  stagedImages: DraftImage[]; status: string; draftError: string;
  onOpenChange: (open: boolean) => void;
  visitDetails: ReactNode;
  checks: VisitReviewCheck[]; onHeaderCheck: (check: VisitReviewCheck) => void;
  renderPositionDetails: (position: Position, focus?: { target: VisitCheckTarget; request: number }, onInvalid?: (invalid: boolean) => void) => ReactNode;
  onShared: (ids: number[]) => void;
  onReview: () => void; onLater: () => Promise<void>;
  onPrepare: (slots: PositionSlot[]) => void;
  onReading: (slots: PositionSlot[], slot: PositionSlot, changes: Partial<Position>) => void;
  onHeader: (values: Record<string, unknown>) => void;
  onDone: (id?: number) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const language = useLanguage();
  const preferenceKey = `iip-visual-tower:${userKey}:${visit.id}`;
  const [preferences] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
      if (value && lists.ohl.includes(value.ohl) && lists.mount_type.includes(value.mount) && ['Single', 'Double'].includes(value.count)
        && (value.mount === 'Suspension' || (lists.direction.includes(value.directionA) && lists.direction.includes(value.directionB) && value.directionA !== value.directionB))) return value as {
          ohl: string; mount: string; count: string; directionA: string; directionB: string; back: boolean; view_side?: string;
        };
    } catch { /* presentation preferences are optional */ }
    return null;
  });
  const [initialized, setInitialized] = useState(!!preferences);
  const [initialLayout] = useState(() => visitVisualLayout(positions, preferences));
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [view, setView] = useState<'drawing' | 'details' | 'position'>('drawing');
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [guideFocus, setGuideFocus] = useState<{ target: VisitCheckTarget; request: number }>();
  const [headerCheck, setHeaderCheck] = useState<VisitReviewCheck | null>(null);
  const [guideVisible, setGuideVisible] = useState(false);
  const [worksheet, setWorksheet] = useState(false);
  const [editorInvalid, setEditorInvalid] = useState(false);
  const quickEditor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detailKey && !worksheet && window.innerWidth < 1200) quickEditor.current?.scrollIntoView({ block: 'start' });
  }, [detailKey, worksheet]);
  useEffect(() => {
    if (view === 'details' && headerCheck) { onHeaderCheck(headerCheck); setHeaderCheck(null); }
  }, [view, headerCheck, onHeaderCheck]);
  const setWorkspaceOpen = (value: boolean) => { setOpen(value); onOpenChange(value); };
  const [ohl, setOhl] = useState(initialLayout.ohl);
  const [mount, setMount] = useState(initialLayout.mount);
  const [count, setCount] = useState(initialLayout.count);
  const [directionA, setDirectionA] = useState(initialLayout.directionA);
  const [directionB, setDirectionB] = useState(initialLayout.directionB);
  const [back, setBack] = useState(initialLayout.back);
  const [viewSide, setViewSide] = useState(initialLayout.view_side || (positions.some(p => p.in_scope !== false && p.direction) ? 'Unspecified' : 'Front'));
  const [error, setError] = useState('');
  const [badFields, setBadFields] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (initialized && (mount === 'Suspension' || (directionA && directionB && directionA !== directionB))) {
      try { localStorage.setItem(preferenceKey, JSON.stringify({ ohl, mount, count, directionA, directionB, back, view_side: viewSide })); } catch { /* readings still use the visit draft */ }
    }
  }, [initialized, preferenceKey, ohl, mount, count, directionA, directionB, back, viewSide]);
  const invalid = editorInvalid || Object.values(badFields).some(Boolean) || (visit.humidity_pct != null && (visit.humidity_pct < 0 || visit.humidity_pct > 100));
  useEffect(() => { onInvalid(invalid); }, [invalid, onInvalid]);
  const markInvalid = (key: string, bad: boolean) => {
    setBadFields(current => ({ ...current, [key]: bad }));
  };
  const applyLayout = (layout: VisualLayout) => {
    setOhl(layout.ohl); setMount(layout.mount); setCount(layout.count);
    setDirectionA(layout.directionA); setDirectionB(layout.directionB); setBack(layout.back);
    setViewSide(layout.view_side || (positions.some(p => p.in_scope !== false && p.direction) ? 'Unspecified' : 'Front'));
  };
  const start = () => {
    applyLayout(visitVisualLayout(positions, { ohl, mount, count, directionA, directionB, back, view_side: viewSide }));
    setInitialized(true); setError(''); setWorkspaceOpen(true);
  };
  useEffect(() => {
    if (initialOpen) start();
    // Open once for a newly navigated visit; subsequent edits preserve the chosen view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = disabled || navigationBusy || leaving;
  const suspension = mount === 'Suspension';
  const gantry = mount === 'Gantry';
  const validDirections = suspension || !!directionA && !!directionB && directionA !== directionB;
  const proposed: PositionSlot[] = gantry ? [] : validDirections ? visualSlots(ohl, mount, count, directionA, directionB)
    : directionA && directionA === directionB ? [] : [directionA, directionB].filter(Boolean).flatMap(direction =>
      ['R', 'Y', 'B'].flatMap(phase => (count === 'Double' ? ['S1', 'S2'] : ['S1']).map(string => ({ ohl, phase, string, direction, mount_type: mount, string_count: count }))));
  let slots: PositionSlot[] = [];
  let layoutError = '';
  try { slots = resolveSuspensionSlots(positions, proposed.map(slot => ({ ...slot, view_side: viewSide }))); } catch (err) { layoutError = (err as Error).message; }
  if (!layoutError && slots.some(slot => positions.some(p => p.in_scope !== false && positionIdentity(p) === positionIdentity(slot)
    && ((p.mount_type && p.mount_type !== slot.mount_type) || (p.string_count && p.string_count !== slot.string_count))))) {
    layoutError = 'This drawing configuration differs from the visit positions. Use the visit layout to see their saved readings. Changing a drawing does not convert existing insulators.';
  }
  // Preparing a view is an explicit scope decision, never an instruction to create its opposite.
  const entrySlots = slots;
  const findPosition = (slot: PositionSlot) => positions.find(p => matchesVisualSlot(p, slot));
  const ready = slots.length > 0 && slots.every(slot => !!findPosition(slot));
  const visible = slots.map(findPosition).filter((position): position is Position => !!position);
  const directions = [...new Set([...lists.direction, ...positions.map(p => p.direction).filter((v): v is string => !!v && v !== 'NA')])];
  const done = () => { if (!invalid && !locked) { setWorkspaceOpen(false); onDone(detailPosition?.id ?? visible[0]?.id); } };
  const candidates = positions.filter(p => p.in_scope !== false && !!p.direction);
  const detailPosition = candidates.find(p => positionIdentity(p) === detailKey);
  const nextIncomplete = nextIncompletePosition(visible, detailPosition?.id, lists.image_type, stagedImages);
  const currentSlotIndex = slots.findIndex(slot => positionIdentity(slot) === detailKey);
  const nextSlot = [...slots.slice(currentSlotIndex + 1), ...slots.slice(0, currentSlotIndex + 1)].find(slot => {
    if (positionIdentity(slot) === detailKey) return false;
    const position = findPosition(slot);
    return !position || needsInspectionWork(position, lists.image_type, stagedImages);
  });
  const screened = candidates.filter(p => p.installed && p.screening_result !== 'Not inspected').length;
  const installed = candidates.filter(p => p.installed).length;
  const evidence = candidates.reduce((total, p) => total + evidenceProgress(p, lists.image_type, stagedImages).complete, 0);
  const coach = nextVisitGuidance(checks, candidates.length);
  const coachPosition = positions.find(p => p.id === coach.check?.positionIds[0]);
  const selectStage = (step: number) => {
    if (locked || invalid) return;
    if (step === 0) setView('details');
    else if (step === 1) setView('drawing');
    else if (step === 2) {
      const target = detailPosition || candidates.find(p => evidenceProgress(p, lists.image_type, stagedImages).missing.length) || candidates[0];
      if (target) { setDetailKey(positionIdentity(target)); setGuideFocus({ target: 'evidence', request: Date.now() }); setView('position'); }
    } else { setWorkspaceOpen(false); onReview(); }
  };
  const followCoach = () => {
    if (locked || invalid) return;
    if (coach.check && !coach.check.positionIds.length) { setView('details'); setHeaderCheck(coach.check); }
    else if (coachPosition && candidates.some(p => p.id === coachPosition.id)) {
      setDetailKey(positionIdentity(coachPosition)); setGuideFocus({ target: coach.check!.target, request: Date.now() }); setView(worksheet ? 'position' : 'drawing');
    } else if (coachPosition) {
      // Legacy positions without a diagram identity still have an editable position card.
      setWorkspaceOpen(false); requestAnimationFrame(() => onHeaderCheck(coach.check!));
    } else if (coach.step === 4) { setWorkspaceOpen(false); onReview(); }
    else setView('drawing');
  };
  const openDetails = (slot: PositionSlot) => {
    if (invalid || locked) return;
    try {
      if (!findPosition(slot)) onPrepare([slot]);
      setDetailKey(positionIdentity(slot)); setGuideFocus(undefined); setView(worksheet ? 'position' : 'drawing'); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : tr('Check the layout.')); }
  };
  const numberField = (key: string, label: string, value: number | null, save: (value: number | null) => void, percent = false) => !percent
    ? <InspectionReadingField label={tr(label)} value={value} onChange={save} onInvalid={bad => markInvalid(key, bad)} disabled={locked} />
    : <TextField
    size="small" fullWidth type="number" disabled={locked} label={label} value={value ?? ''} error={!!badFields[key] || (percent && value != null && (value < 0 || value > 100))}
    slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 'any', ...(percent ? { min: 0, max: 100 } : {}) } }}
    onChange={event => {
      const element = event.target as HTMLInputElement;
      const bad = element.validity.badInput || (percent && element.value !== '' && (Number(element.value) < 0 || Number(element.value) > 100));
      markInvalid(key, bad);
      if (!element.validity.badInput) save(numericReading(element.value));
    }} />;
  return <>
    <Button variant="contained" startIcon={<TransmissionTowerIcon />} disabled={disabled || navigationBusy} onClick={start}>{tr('Visual tower form')}</Button>
    <Dialog open={open} onClose={() => { if (!invalid && !locked) setWorkspaceOpen(false); }} fullWidth maxWidth="xl" aria-labelledby="visual-tower-title" slotProps={{ paper: { sx: { borderRadius: 3, m: { xs: 1, sm: 3 }, width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' }, maxHeight: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' } } } }}>
      <DialogTitle id="visual-tower-title" sx={{ background: 'linear-gradient(115deg, #123849, #17566a)', color: '#fff', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', py: 2 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', bgcolor: '#ffffff18', p: 1, borderRadius: 2 }}><TransmissionTowerIcon /></Box>
        <Box sx={{ flex: 1 }}><Typography component="span" sx={{ display: 'block', fontWeight: 800, fontSize: '1.25rem' }}>{tr('Visual tower form')}</Typography><Typography component="span" variant="caption" sx={{ color: '#c9e6ec' }}>{tr('Read the tower. Record each position. Review once.')}</Typography></Box>
        <Chip icon={<VisibilityRounded sx={{ color: '#b6e2ed !important' }} />} label={tr(viewSide === 'Front' ? 'Front view' : viewSide === 'Back' ? 'Back view' : 'View not recorded')} sx={{ bgcolor: '#ffffff15', color: '#fff' }} />
        <Chip label={<bdi>{visit.tower?.tower_id}</bdi>} sx={{ bgcolor: '#ffffff15', color: '#fff', border: '1px solid #ffffff30', fontWeight: 650 }} />
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 1.5, sm: 3 }, py: 2.5, bgcolor: 'background.default' }}><Stack component="fieldset" disabled={disabled} spacing={2} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">{tr('Screened in this draft: {0}/{1}', [screened, installed])}</Typography>
          <Typography variant="caption" color="text.secondary">{tr('Evidence categories: {0}/{1}', [evidence, candidates.length * lists.image_type.length])}</Typography>
          <Chip size="small" label={tr(status)} role="status" variant="outlined" sx={{ marginInlineStart: 'auto', bgcolor: 'background.paper', fontSize: 11 }} />
        </Stack>
        {draftError && <Alert severity="warning">{tr(draftError)}</Alert>}
        {feedback}
        {error && <Alert severity="warning">{tr(error)}</Alert>}
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button variant={view === 'details' ? 'contained' : 'outlined'} disabled={locked || invalid} onClick={() => setView('details')}>{tr('Visit details')}</Button>
          <Button variant={view !== 'details' ? 'contained' : 'outlined'} disabled={locked || invalid} onClick={() => setView('drawing')}>{tr('Inspect tower')}</Button>
          <Button startIcon={<TuneRounded />} disabled={locked || invalid || !visible.length} onClick={() => onShared(visible.map(p => p.id))} sx={{ marginInlineStart: { sm: 'auto' } }}>{tr('Shared asset details')}</Button>
        </Stack>
        <Box hidden={!guideVisible}>
          {guideVisible && <NextStepCoach title="Your visit assistant" task={coach.task} why={coach.why} step={coach.step}
            showSequence={false}
            steps={['Visit details', 'Readings & results', 'Photos & evidence', 'Review & save']}
            detail={<>{coach.check ? inspectionCheck(coach.check.message) : tr('One visit at a time. Your entries stay in the working draft.')}{coachPosition && <> · <bdi dir="ltr">{positionLabel(coachPosition)}</bdi></>}</>}
            action={coach.step === 4 ? 'Review this visit' : 'Take me there'} onAction={followCoach} disabled={locked || invalid} />}
          <Button size="small" onClick={() => setGuideVisible(false)}>{tr('Minimize visit assistant')}</Button>
        </Box>
        {view === 'details' && visitDetails}
        {view === 'position' && <Stack spacing={2}>
          <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button startIcon={<TransmissionTowerIcon />} disabled={locked} onClick={() => setView('drawing')}>{tr('Back to tower drawing')}</Button>
            <TextField select size="small" label={tr('Position')} value={detailPosition ? positionIdentity(detailPosition) : ''} disabled={locked} sx={{ flex: 1, minWidth: 220 }}
              onChange={event => { setDetailKey(event.target.value); setGuideFocus(undefined); }}>
              {candidates.map(p => <MenuItem key={p.id} value={positionIdentity(p)}><bdi dir="ltr">{positionLabel(p)}</bdi></MenuItem>)}
            </TextField>
            <Button disabled={locked || !nextIncomplete} onClick={() => { if (nextIncomplete) { setDetailKey(positionIdentity(nextIncomplete)); setGuideFocus(undefined); } }}>{tr('Next incomplete position')}</Button>
          </Stack>
          {detailPosition ? renderPositionDetails(detailPosition, guideFocus, setEditorInvalid) : <Alert severity="info">{tr('Choose a position from the drawing to enter its details and images.')}</Alert>}
        </Stack>}
        <Box hidden={view !== 'drawing'}>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1.5 }}><Typography variant="body2" sx={{ fontWeight: 800 }}>{tr(mount)} · {tr(count === 'Double' ? '2 strings' : '1 string')}</Typography><Typography variant="caption" color="text.secondary">{tr('Line')}: <bdi>{visit.tower?.area || '—'}</bdi></Typography><Button size="small" sx={{ marginInlineStart: 'auto' }} onClick={() => setGuideVisible(!guideVisible)}>{tr(guideVisible ? 'Minimize visit assistant' : 'Show visit assistant')}</Button></Stack>
        {!suspension && !gantry && <ToggleButtonGroup exclusive value={ohl} onChange={(_, value) => {
          if (!value) return;
          if (positions.some(p => p.in_scope !== false && p.direction && p.ohl === value)) applyLayout(visitVisualLayout(positions, { ohl: value, back, view_side: viewSide }));
          else setOhl(value);
          setDetailKey(null);
        }} disabled={invalid || locked} aria-label={tr('Tower side')}>
          <ToggleButton value="OHL1">{tr('OHL1 — South')}</ToggleButton><ToggleButton value="OHL2">{tr('OHL2 — North')}</ToggleButton>
        </ToggleButtonGroup>}
        {gantry && <Alert severity="info">{tr('Gantry: use the individual position cards below. A dedicated diagram requires the site arrangement.')}</Alert>}
        {suspension && worksheet && <Alert severity="info">{tr('Suspension: both OHL sides are shown. Line direction is not required. Select the actual number of strings; existing evidence stays linked.')}</Alert>}
        {layoutError && <Alert severity="warning" action={<Button disabled={invalid || locked} onClick={() => { applyLayout(visitVisualLayout(positions, { ohl, back, view_side: viewSide })); setError(''); }}>{tr('Use visit layout')}</Button>}>{tr(layoutError)}</Alert>}
        {viewSide === 'Unspecified' && <Alert severity="warning">{tr('These earlier readings have no recorded viewing side. They are preserved separately. Use Position configuration to identify their view; do not enter new front/back readings here.')}</Alert>}
        {worksheet && <Stack direction="row" spacing={1}><Chip label={tr('Front view') + ': ' + candidates.filter(p => p.view_side === 'Front').length} /><Chip label={tr('Back view') + ': ' + candidates.filter(p => p.view_side === 'Back').length} /></Stack>}
        {!gantry && (!ready || worksheet) && <Alert severity={ready ? 'info' : 'warning'} icon={<TransmissionTowerIcon />}>
          {tr('Drawing: {0} positions · Linked to this layout: {1} · In the whole visit: {2}', [slots.length, visible.length, candidates.length])}
          {!ready && <Typography variant="caption" sx={{ display: 'block' }}>{tr('Preview positions are not inspection records yet. Add them to the draft or enter a reading to prepare them.')}</Typography>}
        </Alert>}
        <ToggleButtonGroup exclusive size="small" value={worksheet ? 'worksheet' : 'quick'} disabled={invalid || locked} onChange={(_, value) => { if (value) setWorksheet(value === 'worksheet'); }} aria-label={tr('Entry view')}>
          <ToggleButton value="quick">{tr('Quick inspection')}</ToggleButton><ToggleButton value="worksheet">{tr('Detailed worksheet')}</ToggleButton>
        </ToggleButtonGroup>
        <TowerDrawingSheet count={count} setupComplete={ready}
          overview={!worksheet && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(310px, 350px) minmax(0, 1fr)' }, gap: 2.5, mt: 2, alignItems: 'start' }}>
            {!gantry && <TowerPositionMap slots={slots} positions={positions} stagedImages={stagedImages} imageTypes={lists.image_type} back={back} suspension={suspension} directionA={directionA} selectedKey={detailKey} disabled={locked || invalid || !!layoutError || viewSide === 'Unspecified'} onSelect={openDetails} />}
            <Stack ref={quickEditor} spacing={2} sx={{ minWidth: 0, scrollMarginTop: 16 }}>
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, p: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '14px', alignItems: 'center' }}>
                <TextField select size="small" label={tr('Position')} value={detailPosition ? positionIdentity(detailPosition) : ''} disabled={locked || invalid} sx={{ flex: 1, minWidth: 180 }} onChange={event => { setDetailKey(event.target.value); setGuideFocus(undefined); }}>
                  {candidates.map(p => <MenuItem key={p.id} value={positionIdentity(p)}><bdi dir="ltr">{positionLabel(p)}</bdi></MenuItem>)}
                </TextField>
                <Button variant="outlined" endIcon={<ArrowForwardRounded sx={{ transform: language === 'ar' ? 'rotate(180deg)' : undefined }} />} sx={{ minHeight: 44, fontSize: 12 }} disabled={locked || invalid || !nextSlot || !!layoutError || viewSide === 'Unspecified'} onClick={() => { if (nextSlot) openDetails(nextSlot); }}>{tr('Next incomplete position')}</Button>
              </Stack>
              {detailPosition ? renderPositionDetails(detailPosition, guideFocus, setEditorInvalid) : <Paper variant="outlined" sx={{ minHeight: 320, display: 'grid', placeItems: 'center', p: 3, borderRadius: '20px', textAlign: 'center', borderStyle: 'dashed' }}><Stack spacing={1.5} sx={{ alignItems: 'center', maxWidth: 300 }}><Box sx={{ p: 2, bgcolor: 'action.hover', color: 'primary.main', borderRadius: '20px' }}><TouchAppOutlined sx={{ fontSize: 36 }} /></Box><Typography sx={{ fontWeight: 800 }}>{tr('Select a string to begin')}</Typography><Typography variant="body2" color="text.secondary">{tr('Choose a position from the drawing to enter its details and images.')}</Typography></Stack></Paper>}
            </Stack>
          </Box>}
          controls={<Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: '1fr 1.4fr 1fr 1fr' }, gap: 2, '& .MuiInputBase-root': { minHeight: 48 }, '& .MuiSelect-select': { whiteSpace: 'normal' } }}>
            <TextField select size="small" label={tr('Tower type')} value={mount} disabled={invalid || locked} onChange={event => { setMount(event.target.value); setDetailKey(null); }}>{lists.mount_type.map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}</TextField>
            <TextField size="small" label={tr('Tower side')} value={suspension ? tr('Both sides') : tr(ohl === 'OHL1' ? 'OHL1 — South' : 'OHL2 — North')} slotProps={{ input: { readOnly: true } }} />
            <TextField select size="small" label={tr('Number of strings')} value={count} disabled={invalid || locked} onChange={event => { setCount(event.target.value); setDetailKey(null); }}><MenuItem value="Single">1</MenuItem><MenuItem value="Double">2</MenuItem></TextField>
            <TextField select size="small" label={tr('Viewing side')} value={viewSide} disabled={invalid || locked} onChange={event => { const side = event.target.value; applyLayout(visitVisualLayout(positions, { ohl, mount, count, directionA, directionB, back: side === 'Back', view_side: side })); setDetailKey(null); setError(''); }}><MenuItem value="Front">{tr('Front view')}</MenuItem><MenuItem value="Back">{tr('Back view')}</MenuItem>{candidates.some(p => !p.view_side || p.view_side === 'Unspecified') && <MenuItem value="Unspecified">{tr('View not recorded')}</MenuItem>}</TextField>
          </Box>}
          directions={visualSides(back).map((side, index) => suspension ? <Paper key={side} variant="outlined" sx={{ p: 1.5, bgcolor: '#edf5f4', color: '#194b55', textAlign: 'center' }}><Typography sx={{ fontWeight: 800 }}>{tr(side === 'A' ? 'OHL1 — South' : 'OHL2 — North')}</Typography><Typography variant="caption">{tr('R / Y / B · No direction required')}</Typography></Paper> : <TextField key={side} fullWidth select size="small" label={tr(index === 0 ? 'Left side direction' : 'Right side direction')} value={side === 'A' ? directionA : directionB} disabled={invalid || locked}
            error={!(side === 'A' ? directionA : directionB) || directionA === directionB}
            helperText={tr(!(side === 'A' ? directionA : directionB) ? 'Select a direction to enable readings.' : side === 'A' ? 'A — left in front view' : 'B — right in front view')}
            onChange={event => { if (side === 'A') setDirectionA(event.target.value); else setDirectionB(event.target.value); setDetailKey(null); }}>
            <MenuItem value="">{tr('Select direction')}</MenuItem>{directions.map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}
          </TextField>)}
          prepare={<Stack sx={{ alignItems: 'center' }}>
            {ready ? <Chip variant="outlined" sx={{ bgcolor: '#e9f4ef', color: '#286648', borderColor: '#bbd7c9', fontWeight: 650 }} label={tr('{0} positions ready for entry', [visible.length])} /> : <Button variant="contained" startIcon={<AddCircleOutlineRounded />} sx={{ minHeight: 48, borderRadius: 2 }} disabled={!validDirections || locked || invalid || gantry || !!layoutError || viewSide === 'Unspecified'} onClick={() => {
              try { onPrepare(entrySlots); setDetailKey(positionIdentity(entrySlots[0])); setError(''); } catch (err) { setError(err instanceof Error ? err.message : tr('Check the layout.')); }
            }}>{tr('Add missing positions to draft')}</Button>}
          </Stack>}
          towerNumber={<TextField fullWidth size="small" label={tr('Tower number')} value={visit.tower?.tower_id || ''} helperText={tr('Linked to this visit. Open another tower to change it.')} slotProps={{ input: { readOnly: true } }} />}
          humidity={numberField('humidity', tr('Humidity (%)'), visit.humidity_pct, value => onHeader({ humidity_pct: value }), true)}
          renderPosition={(sideIndex, phase, string) => {
            const side = visualSides(back)[sideIndex];
            const direction = side === 'A' ? directionA : directionB;
            const sideOhl = suspension ? (side === 'A' ? 'OHL1' : 'OHL2') : ohl;
            const slot = slots.find(p => p.ohl === sideOhl && p.phase === phase && p.string === string && (suspension || p.direction === direction));
            const position = slot ? findPosition(slot) : undefined;
            const save = (changes: Partial<Position>) => {
              if (!slot) return;
              try { onReading(entrySlots, slot, changes); setError(''); }
              catch (err) { setError(err instanceof Error ? err.message : tr('Check the layout.')); }
            };
            const label = position ? positionLabel(position) : [sideOhl, phase, string, (suspension ? 'NA' : direction) || tr(sideIndex === 0 ? 'Left side' : 'Right side')].join(' · ');
            const phaseColor = ({ R: '#9a3434', Y: '#806013', B: '#275f9a' } as Record<string, string>)[phase];
            return <Stack spacing={1} component="section" aria-label={label} sx={{ p: 1.25, borderRadius: '18px', bgcolor: '#ffffff', boxShadow: '0 3px 12px #243f4b09', border: '1px solid #e0e7e7', borderTop: `3px solid ${phaseColor}`, transition: 'box-shadow 150ms, border-color 150ms', '&:focus-within': { borderColor: '#52929d', boxShadow: '0 0 0 3px #0b7b8812' }, '& .MuiInputBase-root': { fontSize: 14, minHeight: 46 }, '& .MuiInputBase-input': { py: 1.25, px: 1 }, '& .MuiInputLabel-root': { fontSize: 13 } }}>
              <Typography variant="caption" sx={{ color: '#245562', fontWeight: 700 }}>{tr(viewSide === 'Front' ? 'Front view' : viewSide === 'Back' ? 'Back view' : 'View not recorded')}</Typography><Box sx={{ display: 'flex', alignItems: 'center', gap: 0.65, minHeight: 23 }}>
                <Box component="span" sx={{ bgcolor: phaseColor, color: '#fff', borderRadius: 0.75, width: 22, height: 22, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 }}>{phase}</Box>
                <Typography variant="caption" sx={{ fontWeight: 800, color: '#193d48' }}><bdi>{sideOhl} · {string}</bdi></Typography>
                <Typography variant="caption" sx={{ marginInlineStart: 'auto', color: '#52686c', fontSize: 11 }}>{tr(count === 'Single' ? 'Single' : string === 'S1' ? 'Outer' : 'Inner')}</Typography>
              </Box>
              {!suspension && <Typography variant="caption" sx={{ color: '#52686c', lineHeight: 1.25 }}><bdi>{direction || tr('Select direction')}</bdi></Typography>}
              <Box component="fieldset" disabled={locked || !slot || !!layoutError || viewSide === 'Unspecified'} sx={{ m: 0, p: 0, border: 0, minWidth: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
                {numberField(label + ':max', 'Tmax (°C)', position?.tmax_c ?? null, value => save({ tmax_c: value }))}
                {numberField(label + ':ref', 'Tref (°C)', position?.tref_c ?? null, value => save({ tref_c: value }))}
              </Box>
              <Typography variant="caption" title={tr('ΔT (°C)')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, bgcolor: '#edf4f4', color: '#245562', px: 1, py: .75, minHeight: 30, borderRadius: 0.75, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}><Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: .25 }}><ThermostatRounded sx={{ fontSize: 16 }} /><bdi aria-label={tr('ΔT (°C)')}>ΔT (°C)</bdi></Box><bdi style={{ fontSize: 16, fontWeight: 800 }}>{position?.tmax_c != null && position.tref_c != null ? Math.round((position.tmax_c - position.tref_c) * 100) / 100 : '—'}</bdi></Typography>
              <TextField select disabled={locked || !slot || !!layoutError || viewSide === 'Unspecified'} size="small" label={tr('Screening result')} value={position?.screening_result || 'Not inspected'} onChange={event => save(visualScreeningPatch(event.target.value))}>{lists.screening_result.map(value => <MenuItem key={value} value={value}>{tr(value)}</MenuItem>)}</TextField>
              <Button size="small" fullWidth startIcon={<PhotoCameraRounded />} disabled={!slot || invalid || disabled || !!layoutError} onClick={() => { if (slot) openDetails(slot); }}
                sx={{ bgcolor: '#e7f1f2', color: '#164754', borderRadius: 1.5, justifyContent: 'space-between', fontSize: 12, py: 1, minHeight: 44, '&:hover': { bgcolor: '#cee4e7' } }}>
                {tr('Photos & details')} · {position ? evidenceProgress(position, lists.image_type, stagedImages).complete : 0}/{lists.image_type.length}
              </Button>
              {position && <PositionImageGallery position={position} stagedImages={stagedImages} showEmpty />}
            </Stack>;
          }} />
        {!suspension && directionA && directionA === directionB && <Alert severity="warning">{tr('Choose two different directions for this OHL.')}</Alert>}
        <Box component="details" sx={{ mt: 2, color: 'text.secondary', '& summary': { cursor: 'pointer', fontSize: 12, py: 1, minHeight: 36 } }}>
          <Typography component="summary">{tr('Inspection guidance')}</Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{tr('Front and back have separate readings, results and evidence. Switching views never copies readings. OHL, phase, direction and string remain part of each record.')}</Typography>
          <Typography variant="caption">{tr('Low T° is the reference temperature (Tref), not a minimum-temperature field. Choose each screening result explicitly; temperatures do not automatically determine a hotspot.')}</Typography>
        </Box>
        </Box>
        {invalid && <Alert severity="error">{tr('Correct the highlighted readings before leaving this form. Humidity must be between 0 and 100%.')}</Alert>}
      </Stack></DialogContent>
      <DialogActions sx={{ px: 2.5, py: 1.5, gap: 1, flexWrap: 'wrap', borderTop: '1px solid', borderColor: 'divider', boxShadow: '0 -4px 18px rgba(16,63,78,.06)', '& .MuiButton-root': { minHeight: 44 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 160 }}>{tr('One visit draft. Review and confirm once when ready.')}</Typography>
        <Button startIcon={<SaveOutlined />} disabled={locked || invalid} onClick={async () => { setLeaving(true); setError(''); try { await onLater(); } catch (err) { setError(err instanceof Error ? err.message : tr('Could not save the draft.')); } finally { setLeaving(false); } }}>{tr('Finish later')}</Button>
        <Button disabled={locked || invalid} onClick={done}>{tr('Close workspace')}</Button>
        <Button startIcon={<FactCheckRounded />} variant="contained"
          disabled={locked || invalid} onClick={() => selectStage(3)}>
          {tr('Review and save visit')}
        </Button>
      </DialogActions>
    </Dialog>
  </>;
}
