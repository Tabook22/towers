import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';

/** Native disclosure keeps all form fields mounted when collapsed. */
export function InspectionDisclosure({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <Box component="details" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '18px', bgcolor: 'background.paper', '&[open] > summary .disclosure-chevron': { transform: 'rotate(180deg)' } }}>
    <Box component="summary" sx={{ p: 2, cursor: 'pointer', listStyle: 'none', '&::-webkit-details-marker': { display: 'none' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', borderRadius: '18px' } }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Box sx={{ display: 'grid', placeItems: 'center', p: 1.25, borderRadius: '14px', bgcolor: 'action.hover', color: 'primary.main' }}>{icon}</Box>
        <Box sx={{ flex: 1 }}><Typography component="span" sx={{ display: 'block', fontWeight: 800 }}>{title}</Typography><Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', mt: .5 }}>{description}</Typography></Box>
        <ExpandMoreRounded className="disclosure-chevron" sx={{ color: 'primary.main' }} />
      </Stack>
    </Box>
    <Box sx={{ p: { xs: 1, sm: 2 }, pt: 0 }}>{children}</Box>
  </Box>;
}
