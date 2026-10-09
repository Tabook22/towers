import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded';
import FitScreenRounded from '@mui/icons-material/FitScreenRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import SwipeRounded from '@mui/icons-material/SwipeRounded';
import { tr, useLanguage } from '../i18n';

export function drawingPositions(count: string) {
  return ['R', 'Y', 'B'].flatMap((phase, row) => [0, 1].flatMap(side => {
    const strings = count === 'Single' ? ['S1'] : side === 0 ? ['S1', 'S2'] : ['S2', 'S1'];
    return strings.map((string, index) => ({ phase, side, string, y: 330 + row * 230,
      x: count === 'Single' ? (side === 0 ? 350 : 850) : [235, 465, 735, 965][side * 2 + index],
      fieldX: count === 'Single' ? (side === 0 ? 145 : 870) : [25, 275, 750, 990][side * 2 + index],
    }));
  }));
}

/** A fixed-scale worksheet keeps editable fields beside their actual drawing anchors.
 * Inline physical coordinates deliberately bypass RTL style mirroring. */
export function TowerDrawingSheet({ count, controls, directions, prepare, towerNumber, humidity, renderPosition, overview, setupComplete = false, readOnly = false }: {
  count: string; controls: ReactNode; directions: ReactNode[]; prepare: ReactNode;
  towerNumber: ReactNode; humidity: ReactNode;
  renderPosition: (side: number, phase: string, string: string) => ReactNode;
  overview?: ReactNode;
  setupComplete?: boolean;
  readOnly?: boolean;
}) {
  const language = useLanguage();
  const points = drawingPositions(count);
  const compact = !!overview;
  const drawingViewport = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1344);
  // null follows the available width; manual zoom never changes any inspection data.
  const [manualZoom, setManualZoom] = useState<number | null>(readOnly ? null : 1);
  const [setupOpen, setSetupOpen] = useState(!setupComplete);
  useEffect(() => { setSetupOpen(!setupComplete); }, [setupComplete]);
  const zoom = manualZoom ?? Math.max(.1, Math.min(1, (viewportWidth - 2) / 1344));
  const zoomPercent = Math.round(zoom * 100);
  useEffect(() => {
    const viewport = drawingViewport.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth > 0) setViewportWidth(viewport.clientWidth);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [compact]);
  const changeZoom = (amount: number) => setManualZoom(Math.max(.1, Math.min(2, Math.round((zoom + amount) * 100) / 100)));
  const anchor = (left: number, top: number, width: number, child: ReactNode) => <Box
    style={{ position: 'absolute', left, top, width, direction: language === 'ar' ? 'rtl' : 'ltr' }}>{child}</Box>;
  return <>
    <Box component={overview ? 'details' : 'div'} {...(overview ? { open: setupOpen, onToggle: (event: SyntheticEvent<HTMLElement>) => setSetupOpen((event.currentTarget as HTMLDetailsElement).open) } : {})} sx={{ mt: 2, p: overview ? 1.5 : { xs: 2, md: 2.5 }, border: '1px solid', borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper', '&[open] summary': { mb: 2 } }}>
      {overview && <Typography component="summary" sx={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, color: 'text.secondary', minHeight: 28, alignContent: 'center' }}>{tr('Drawing setup')}</Typography>}
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2.5 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', p: 1.25, bgcolor: 'action.hover', borderRadius: '14px', color: 'primary.main' }}><TuneRounded /></Box>
        <Box>{!overview && <Typography component="h3" sx={{ fontWeight: 800 }}>{tr(readOnly ? 'Issued inspection configuration' : 'Drawing setup')}</Typography>}<Typography variant="body2" color="text.secondary">{tr(readOnly ? 'Recorded at report issue time. Select a position to explore its details and photographs.' : 'Check the tower type, strings and viewing side before entering readings.')}</Typography></Box>
      </Stack>
      {controls}
    </Box>
    {overview ? <>
      {(!setupComplete || setupOpen) && <Box dir="ltr" style={{ direction: 'ltr' }} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, my: 2 }}>{directions.map((node, index) => <Box key={index} style={{ direction: language === 'ar' ? 'rtl' : 'ltr' }}>{node}</Box>)}</Box>}
      {!setupComplete && prepare}
      {overview}
    </> : <><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ py: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><SwipeRounded color="primary" /><Typography variant="caption" color="text.secondary">{tr(readOnly ? 'Explore the recorded insulators. Zoom in for detail or fit the tower to your screen.' : 'Choose values directly on the tower drawing. On a small screen, scroll sideways to reach both sides.')}</Typography></Stack>
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}><Chip size="small" label={tr(readOnly ? 'Recorded readings · view only' : 'Yellow fields · your readings')} sx={{ bgcolor: '#fff7d6', color: '#554515', border: '1px solid #d7c88e' }} /><Chip size="small" label={tr('ΔT · calculated')} variant="outlined" /></Stack>
    </Stack>
    <Stack role="group" aria-label={tr('Tower drawing zoom')} direction="row" useFlexGap sx={{ position: 'sticky', top: 0, zIndex: 5, flexWrap: 'wrap', alignItems: 'center', gap: 1, p: 1.25, mb: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '16px', boxShadow: '0 3px 12px rgba(16,63,78,.08)', '& .MuiButton-root': { minHeight: 44 } }}>
      <ZoomInRounded color="primary" />
      <Typography variant="body2" sx={{ fontWeight: 800, marginInlineEnd: 'auto' }}>{tr('Drawing zoom')}</Typography>
      <Button variant="outlined" aria-label={tr('Zoom out')} disabled={zoom <= .1} onClick={() => changeZoom(-.1)} sx={{ minWidth: 44 }}><ZoomOutRounded /></Button>
      <Typography role="status" aria-label={tr('Drawing zoom: {0}%', [zoomPercent])} sx={{ minWidth: 58, textAlign: 'center', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}><bdi>{zoomPercent}%</bdi></Typography>
      <Button variant="outlined" aria-label={tr('Zoom in')} disabled={zoom >= 2} onClick={() => changeZoom(.1)} sx={{ minWidth: 44 }}><ZoomInRounded /></Button>
      <Button startIcon={<FitScreenRounded />} variant={manualZoom === null ? 'contained' : 'outlined'} onClick={() => setManualZoom(null)}>{tr('Fit to width')}</Button>
      <Button startIcon={<RestartAltRounded />} onClick={() => setManualZoom(1)}>{tr('Reset to 100%')}</Button>
    </Stack>
    <Box ref={drawingViewport} role="region" aria-label={tr(readOnly ? 'Read-only tower drawing' : 'Editable tower drawing')} tabIndex={0} sx={{ overflow: 'auto', border: '1px solid #d9e3e4', borderRadius: 3, bgcolor: '#f8faf9', color: '#193d48', boxShadow: '0 8px 32px #102e3a0d',
      '& .MuiInputBase-root': { bgcolor: '#fff7d6', color: '#293d42', borderRadius: 1.5, fontSize: 14, transition: 'background-color 150ms, box-shadow 150ms', '&:hover': { bgcolor: '#fff2bf' }, '&.Mui-focused': { bgcolor: '#fffbe9', boxShadow: '0 0 0 3px #007c9120' }, '&.Mui-disabled': { bgcolor: '#eef0ed', color: '#6c7576' }, '&:has(input[readonly])': { bgcolor: '#edf3f4' } },
      '& .MuiOutlinedInput-notchedOutline': { borderColor: '#d7c88e' },
      '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#b79b44' },
      '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#087b88', borderWidth: 2 },
      '& .MuiOutlinedInput-root.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#c73434' },
      '& .MuiInputLabel-root': { color: '#52686c', '&.Mui-focused': { color: '#066a76' }, '&.Mui-error': { color: '#b42323' } },
      '& .MuiFormHelperText-root': { color: '#52686c', '&.Mui-error': { color: '#b42323' } },
      '& .MuiSelect-icon': { color: '#52686c' }, '& input': { colorScheme: 'light', fontVariantNumeric: 'tabular-nums' },
      '& input:disabled': { WebkitTextFillColor: '#6c7576' },
    }}>
      <Box dir="ltr" style={{ direction: 'ltr', width: 1344 * zoom, height: 1660 * zoom, position: 'relative', overflow: 'hidden', marginInline: 'auto' }}>
      <Box dir="ltr" style={{ direction: 'ltr', transform: `scale(${zoom})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }} sx={{ width: 1344, height: 1660, background: 'radial-gradient(#b8cdd13b 0.7px, transparent 0.7px) 0 0 / 18px 18px, #f8faf9' }}>
        <Box component="svg" viewBox="0 0 1344 1660" aria-hidden="true" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', color: '#496874', pointerEvents: 'none' }}>
          <g transform="translate(0,-160) scale(1.12,1.7)">
          {['#b85050', '#a17815', '#3875b6'].map((color, row) => <g key={color}>
            <rect x="12" y={338 + row * 230} width="1176" height="206" rx="16" fill={color} fillOpacity="0.035" />
            <rect x="12" y={355 + row * 230} width="3" height="172" rx="1.5" fill={color} fillOpacity="0.5" />
          </g>)}
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M600 228 L575 275 L565 490 L551 700 L531 900 L520 1040 H680 L669 900 L649 700 L635 490 L625 275 Z" />
            <path d="M575 275 H625 L571 355 H629 L567 440 H633 L561 530 H639 L555 615 H645 L550 705 H650 L540 800 H660 L531 900 H669 L520 1040 M575 275 L629 355 L567 440 L639 530 L555 615 L650 705 L540 800 L669 900 L520 1040 M531 900 L680 1040" />
            {[330, 560, 790].map(y => <g key={y}>
              <path d={`M220 ${y} H980 L600 ${y - 52} Z M220 ${y} L600 ${y - 52}`} />
              <path d={`M220 ${y} L565 ${y - 8} M635 ${y - 8} L980 ${y}`} strokeWidth="1" />
            </g>)}
            <path d="M490 1040 H710 M475 1052 H725" />
            {[490, 520, 550, 580, 610, 640, 670, 700].map(x => <path key={x} d={`M${x} 1052 l-12 12`} strokeWidth="1" />)}
          </g>
          {points.map(point => <g key={`${point.side}-${point.phase}-${point.string}`} fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx={point.x} cy={point.y} r="3" fill="currentColor" />
            <path d={`M${point.x} ${point.y} v99`} />
            {Array.from({ length: 9 }, (_, index) => <ellipse key={index} cx={point.x} cy={point.y + 15 + index * 8} rx="10" ry="3" fill="currentColor" fillOpacity="0.1" />)}
            <circle cx={point.x} cy={point.y + 100} r="3" fill="currentColor" />
            <path d={`M${point.x} ${point.y + 112} H${point.side === 0 ? point.fieldX + 188 : point.fieldX}`} strokeDasharray="3 3" opacity="0.5" />
          </g>)}
          {['R', 'Y', 'B'].map((phase, row) => <g key={phase}>
            <circle cx="600" cy={402 + row * 230} r="18" fill="#f8faf9" stroke={['#b85050', '#a17815', '#3875b6'][row]} strokeWidth="1.5" />
            <text x="600" y={407 + row * 230} textAnchor="middle" fill={['#9a3434', '#806013', '#275f9a'][row]} fontSize="14" fontWeight="700">{phase}</text>
          </g>)}
          </g>
        </Box>
        {anchor(40, 40, 300, directions[0])}
        {anchor(1004, 40, 300, directions[1])}
        {anchor(480, 20, 384, prepare)}
        {points.map(point => <Box key={`${point.side}-${point.phase}-${point.string}`} style={{ position: 'absolute', left: point.fieldX * 1.12, top: point.y * 1.7 - 160 + 18, width: 210, direction: language === 'ar' ? 'rtl' : 'ltr' }}>
          {renderPosition(point.side, point.phase, point.string)}
        </Box>)}

      </Box>
      </Box>
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1.5fr 1fr' }, gap: 2, mt: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: '18px', bgcolor: 'background.paper', alignItems: 'flex-start' }}><TransmissionTowerIcon color="primary" sx={{ mt: 1 }} />{towerNumber}</Stack>
      <Stack direction="row" spacing={1.5} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: '18px', bgcolor: 'background.paper', alignItems: 'flex-start' }}><WaterDropRounded color="primary" sx={{ mt: 1 }} />{humidity}</Stack>
    </Box></>}
  </>;
}
