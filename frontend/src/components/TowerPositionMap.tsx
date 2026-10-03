import { Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import type { Position, PositionSlot } from '../api/types';
import type { DraftImage } from '../api/visitEntry';
import { tr, useLanguage } from '../i18n';
import { evidenceProgress, needsInspectionWork } from '../utils/inspectionProgress';
import { positionIdentity } from '../utils/visitEntry';
import { positionLabel } from '../utils/positionChanges';
import { matchesVisualSlot, visualSides } from '../utils/visualTower';

/** Navigation only: readings and attachments belong to the single position editor. */
export function TowerPositionMap({ slots, positions, stagedImages, imageTypes, back, suspension, directionA, selectedKey, disabled, onSelect }: {
  slots: PositionSlot[]; positions: Position[]; stagedImages: DraftImage[]; imageTypes: string[];
  back: boolean; suspension: boolean; directionA: string; selectedKey: string | null;
  disabled: boolean; onSelect: (slot: PositionSlot) => void;
}) {
  const sides = visualSides(back);
  const language = useLanguage();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const inspected = slots.filter(slot => {
    const position = positions.find(p => matchesVisualSlot(p, slot));
    return position?.installed && position.screening_result !== 'Not inspected';
  }).length;
  const phaseColors = dark ? ['#f18f8f', '#e6c064', '#85b8ee'] : ['#b74248', '#8a650d', '#3976b4'];
  return <Paper variant="outlined" component="section" aria-label={tr('Tower navigator')}
    sx={{ overflow: 'hidden', borderRadius: '22px', borderColor: 'divider', bgcolor: dark ? '#192c36' : '#f5f8fa', boxShadow: '0 8px 24px rgba(16,47,63,.04)' }}>
    <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: dark ? '#203642' : '#edf3f6' }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ p: .85, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: 'background.paper', borderRadius: '12px' }}><TransmissionTowerIcon fontSize="small" /></Box>
        <Box sx={{ flex: 1 }}><Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{tr('Tower navigator')}</Typography>
          <Typography variant="caption" color="text.secondary">{tr(back ? 'Back view' : 'Front view')} · {tr('Tap a string to inspect')}</Typography></Box>
      </Stack>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: .75 }}>
        <Typography variant="caption" color="text.secondary">{tr('Inspection progress')}</Typography>
        <Typography variant="caption" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{tr('{0}/{1} inspected', [inspected, slots.length])}</Typography>
      </Stack>
      <LinearProgress aria-label={tr('Inspection progress')} variant="determinate" value={slots.length ? inspected / slots.length * 100 : 0} sx={{ height: 5, borderRadius: 4, bgcolor: alpha(theme.palette.primary.main, .12), '& .MuiLinearProgress-bar': { borderRadius: 4 } }} />
    </Box>
    <Box sx={{ p: 1.5 }}>
    <Box dir="ltr" style={{ direction: 'ltr' }} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 36px minmax(0, 1fr)', gap: .75 }}>
      {sides.map((side, index) => <Box key={side} sx={{ gridColumn: index === 0 ? 1 : 3, gridRow: 1, textAlign: 'center', py: .75 }}>
        <Typography variant="caption" sx={{ fontWeight: 800, overflowWrap: 'anywhere', fontSize: 11 }}>
          <bdi>{suspension ? tr(side === 'A' ? 'OHL1 — South' : 'OHL2 — North') : slots.find(s => (s.direction === directionA) === (side === 'A'))?.direction || '—'}</bdi>
        </Typography>
      </Box>)}
      <Box aria-hidden="true" sx={{ gridColumn: 2, gridRow: '2 / 5', display: 'flex', color: dark ? '#63808e' : '#9ab0bd', zIndex: 1 }}>
        <svg viewBox="0 0 36 510" preserveAspectRatio="none" width="36" height="100%">
          <path d="M18 0 L14 95 L9 260 L2 504 H34 L27 260 L22 95 Z M14 95 H22 M9 260 H27 M5 400 H31 M14 95 L27 260 L5 400 L34 504 M22 95 L9 260 L31 400 L2 504 M0 42 H36 M0 208 H36 M0 374 H36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </Box>
      {['R', 'Y', 'B'].map((phase, row) => <Box key={phase} aria-hidden="true" sx={{ gridColumn: 2, gridRow: row + 2, zIndex: 2, alignSelf: 'start', mt: 1.25, display: 'grid', placeItems: 'center', width: 26, height: 26, justifySelf: 'center', bgcolor: dark ? '#192c36' : '#f5f8fa', border: '1px solid', borderColor: alpha(phaseColors[row], .4), color: phaseColors[row], borderRadius: '50%', fontSize: 11, fontWeight: 900 }}>{phase}</Box>)}
      {['R', 'Y', 'B'].flatMap((phase, row) => sides.map((side, index) => {
        const phaseColor = phaseColors[row];
        const items = slots.filter(s => s.phase === phase && (suspension ? s.ohl === (side === 'A' ? 'OHL1' : 'OHL2') : (s.direction === directionA) === (side === 'A')))
          .sort((a, b) => index === 0 ? a.string.localeCompare(b.string) : b.string.localeCompare(a.string));
        return <Stack key={side + phase} spacing={.75} sx={{ gridColumn: index === 0 ? 1 : 3, gridRow: row + 2, py: 1, minWidth: 0 }}>
          {items.map(slot => {
            const position = positions.find(p => matchesVisualSlot(p, slot));
            const key = positionIdentity(slot);
            const selected = selectedKey === key;
            const progress = position ? evidenceProgress(position, imageTypes, stagedImages) : { complete: 0, total: imageTypes.length };
            const result = position?.screening_result || 'Not inspected';
            const complete = !!position && !needsInspectionWork(position, imageTypes, stagedImages);
            return <Button key={key} aria-label={positionLabel(slot as Position)} aria-pressed={selected}
              disabled={disabled} onClick={() => onSelect(slot)} variant="outlined"
              sx={{ minHeight: 82, px: 1.25, py: 1, textTransform: 'none', borderRadius: '13px', color: 'text.primary', borderColor: selected ? 'primary.main' : 'divider', borderWidth: selected ? 2 : 1, bgcolor: selected ? alpha(theme.palette.primary.main, dark ? .18 : .07) : 'background.paper', textAlign: 'start', justifyContent: 'flex-start', boxShadow: selected ? `0 0 0 3px ${alpha(theme.palette.primary.main, .09)}` : '0 2px 4px rgba(16,47,63,.025)', transition: 'background-color 150ms, box-shadow 150ms', '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, .10) }, '&.Mui-disabled': { color: 'text.secondary', bgcolor: 'action.disabledBackground', borderColor: 'divider' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3 } }}>
              <Stack style={{ direction: language === 'ar' ? 'rtl' : 'ltr' }} spacing={.4} sx={{ width: '100%', minWidth: 0 }}>
                <Stack direction="row" spacing={.6} sx={{ alignItems: 'center' }}>
                  <Box component="span" sx={{ fontSize: 11, fontWeight: 900, borderRadius: '5px', px: .65, py: .15, bgcolor: alpha(phaseColor, .12), color: phaseColor }}>{slot.string}</Box>
                  <Typography variant="caption" sx={{ fontWeight: 800 }}>{tr(slot.string_count === 'Single' ? 'Single' : slot.string === 'S1' ? 'Outer' : 'Inner')}</Typography>
                  {complete && <CheckCircleRounded sx={{ marginInlineStart: 'auto', fontSize: 15, color: dark ? '#8ad4b0' : '#287556' }} />}
                </Stack>
                <Typography variant="caption" sx={{ color: selected ? 'text.primary' : 'text.secondary', fontSize: 12, lineHeight: 1.3 }}>{tr(result)}</Typography>
                <Stack direction="row" spacing={.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                  <PhotoCameraOutlined sx={{ fontSize: 13 }} /><Typography variant="caption" sx={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{tr('Evidence: {0}/{1}', [progress.complete, progress.total])}</Typography>
                </Stack>
              </Stack>
            </Button>;
          })}
          {!items.length && <Typography variant="caption" color="text.secondary">{tr('Select direction')}</Typography>}
        </Stack>;
      }))}
    </Box>
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pb: 1.5, fontSize: 11 }}>{tr('Readings and photos stay together in the selected position.')}</Typography>
  </Paper>;
}
