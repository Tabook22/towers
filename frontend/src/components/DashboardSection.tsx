import { useId, useState, type ReactNode } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Stack, Typography } from '@mui/material';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { tr, useLanguage } from '../i18n';

const tones = {
  teal: ['#123f50', '#216578', '#8dd8e8'],
  green: ['#193f40', '#286558', '#a6dfc6'],
  blue: ['#193b59', '#2a5e82', '#a8d9ff'],
  violet: ['#363856', '#585779', '#d1c6ff'],
  amber: ['#4a3d28', '#75603c', '#ffda8b'],
} as const;

/** Keep content mounted when collapsed so map state and unfinished form entries survive. */
export function DashboardSection({ icon, title, description, eyebrow, tone = 'teal', defaultExpanded = true, expanded: controlledExpanded, onExpandedChange, compact = false, badge, children }: {
  icon: ReactNode; title: string; description: string; eyebrow?: string;
  tone?: keyof typeof tones; defaultExpanded?: boolean; compact?: boolean; badge?: ReactNode; children: ReactNode;
  expanded?: boolean; onExpandedChange?: (expanded: boolean) => void;
}) {
  useLanguage();
  const id = useId();
  const [localExpanded, setExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? localExpanded;
  const [start, end, accent] = tones[tone];
  return <Accordion expanded={expanded} onChange={(_, next) => { setExpanded(next); onExpandedChange?.(next); }} disableGutters sx={{
    borderRadius: '24px !important', overflow: 'hidden', border: '1px solid', borderColor: 'divider',
    boxShadow: '0 8px 28px rgba(16,65,81,.07)', '&:before': { display: 'none' },
  }}>
    <AccordionSummary id={`${id}-heading`} aria-controls={`${id}-content`} expandIcon={<ExpandMoreRounded sx={{ color: '#fff' }} />} sx={{
      px: compact ? 2 : { xs: 2, md: 3 }, py: compact ? 1 : 1.5,
      color: '#fff', background: `linear-gradient(115deg, ${start}, ${end})`, borderTop: `3px solid ${accent}`,
      '&.Mui-focusVisible': { outline: `3px solid ${accent}`, outlineOffset: -4 },
    }}>
      <Stack direction="row" spacing={compact ? 1.25 : 2} sx={{ width: '100%', alignItems: 'center', minWidth: 0 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: compact ? 40 : { xs: 44, sm: 58 }, height: compact ? 40 : { xs: 44, sm: 58 }, borderRadius: '16px', bgcolor: '#ffffff16', color: accent, '& > svg': { fontSize: compact ? 25 : 32 } }}>{icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {eyebrow && <Typography component="span" variant="overline" sx={{ color: accent, letterSpacing: 1.4, lineHeight: 1.7 }}>{eyebrow}</Typography>}
          <Typography component="span" sx={{ display: 'block', fontSize: compact ? '1rem' : { xs: '1.1rem', sm: '1.35rem' }, fontWeight: 800, lineHeight: 1.35 }}>{title}</Typography>
          <Typography component="span" variant="body2" sx={{ display: 'block', mt: .6, color: '#eff6fa', opacity: .9, lineHeight: 1.6 }}>{description}</Typography>
          {badge && <Box sx={{ mt: 1 }}>{badge}</Box>}
        </Box>
        {!compact && <Typography component="span" variant="caption" sx={{ display: { xs: 'none', md: 'block' }, color: '#eff6fa', mx: 1 }}>{tr(expanded ? 'Collapse' : 'Expand')}</Typography>}
      </Stack>
    </AccordionSummary>
    <AccordionDetails id={`${id}-content`} sx={{ p: compact ? 0 : { xs: 2, md: 3 }, bgcolor: theme => theme.palette.mode === 'dark' ? 'background.default' : '#f7f9fa' }}>{children}</AccordionDetails>
  </Accordion>;
}
