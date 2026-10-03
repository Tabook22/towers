import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { tr, useLanguage } from '../i18n';

// Lightweight vector illustrations: crisp in both languages and without image downloads.
function StageIllustration({ stage }: { stage: number }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 96 68" width="84" height="60" fill="none">
    <ellipse cx="48" cy="58" rx="34" ry="5" fill="currentColor" opacity=".10" />
    {stage === 0 ? <>
      <rect x="25" y="12" width="46" height="45" rx="6" fill="white" stroke="currentColor" strokeWidth="2" />
      <rect x="38" y="8" width="20" height="9" rx="3" fill="currentColor" />
      {[27,37,47].map(y => <g key={y}><path d={`M32 ${y}l2 2 4-5`} stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d={`M44 ${y}h17`} stroke="currentColor" opacity=".5" strokeWidth="2" strokeLinecap="round" /></g>)}
    </> : stage === 1 ? <>
      <path d="M47 7 32 56h31L47 7Zm-8 28 17 12H35l18-21H41m-7 12H13m47 0h22M39 24H22m34 0h18" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {[17,27,68,78].map(x => <path key={x} d={`M${x} 38v11m-3-8h6m-6 4h6`} stroke="currentColor" strokeWidth="2" />)}
      <circle cx="76" cy="17" r="10" fill="#fff3c4" /><path d="M76 11v9m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4" stroke="currentColor" strokeWidth="2" />
    </> : stage === 2 ? <>
      <rect x="16" y="23" width="63" height="32" rx="7" fill="white" stroke="currentColor" strokeWidth="2" />
      <path d="m30 23 5-9h23l5 9" stroke="currentColor" strokeWidth="2" /><circle cx="47" cy="38" r="11" fill="currentColor" opacity=".15" /><circle cx="47" cy="38" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M66 30h5M77 9v9m-4-4h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </> : <>
      <rect x="25" y="9" width="42" height="48" rx="5" fill="white" stroke="currentColor" strokeWidth="2" /><path d="M34 21h23m-23 8h23m-23 8h13" stroke="currentColor" opacity=".5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="65" cy="46" r="13" fill="currentColor" /><path d="m58 46 5 5 9-10" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>}
  </svg>;
}

export function InspectionJourney({ active, onSelect, disabled, positions, screened, installed, evidence, totalEvidence, checks }: {
  active: number; onSelect: (step: number) => void; disabled: boolean; positions: number;
  screened: number; installed: number; evidence: number; totalEvidence: number; checks: number;
}) {
  useLanguage();
  const steps = [
    { title: 'Visit details', caption: tr('Who, when & equipment'), color: '#247c90', bg: '#e8f5f7' },
    { title: 'Tower & readings', caption: tr('{0}/{1} installed positions screened', [screened, installed]), color: '#93700a', bg: '#fff7d7' },
    { title: 'Photos & evidence', caption: positions ? tr('{0}/{1} evidence categories covered', [evidence, totalEvidence]) : tr('Set up the tower first'), color: '#486baf', bg: '#edf2fc' },
    { title: 'Review & save', caption: checks ? tr('{0} check groups to review', [checks]) : tr('Confirm this visit once'), color: '#337e62', bg: '#eaf6ee' },
  ];
  return <Box component="nav" aria-label={tr('Inspection entry steps')} sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.25 }}>
    {steps.map((s, i) => <ButtonBase key={s.title} aria-current={active === i ? 'step' : undefined} disabled={disabled || (i === 2 && !positions)} onClick={() => onSelect(i)}
      sx={{ p: 1.25, borderRadius: 2.5, border: '2px solid', borderColor: active === i ? s.color : 'divider', bgcolor: active === i ? s.bg : 'background.paper', textAlign: 'start', justifyContent: 'flex-start', transition: 'border-color 150ms, box-shadow 150ms', '&:hover': { borderColor: s.color }, '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 }, '&.Mui-disabled': { opacity: .6 } }}>
      <Stack sx={{ width: '100%', gap: .5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: s.color }}>
          <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: s.bg, border: `1px solid ${s.color}`, display: 'grid', placeItems: 'center', fontWeight: 800 }}>{i+1}</Box>
          <StageIllustration stage={i} />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 800, color: active === i ? '#173e49' : 'text.primary' }}>{tr(s.title)}</Typography>
        <Typography variant="caption" sx={{ lineHeight: 1.4, color: active === i ? '#405d66' : 'text.secondary' }}>{s.caption}</Typography>
      </Stack>
    </ButtonBase>)}
  </Box>;
}
