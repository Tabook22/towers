import { Box, Stack, Typography } from '@mui/material';
import { FactCheckRounded, GridViewRounded, PhotoLibraryRounded, ForumRounded, ArrowForwardRounded, ShieldOutlined } from '@mui/icons-material';
import { ReportHistoryTable } from '../components/ReportHistoryTable';
import { tr, useLanguage } from '../i18n';

export function ClientReportsPage() {
  useLanguage();
  return <Stack spacing={3}>
    <Box component="header" sx={{ position: 'relative', overflow: 'hidden', p: { xs: 3, md: 4 }, borderRadius: '24px', color: '#fff', background: 'linear-gradient(120deg, #092d3d, #12566a 70%, #197978)', boxShadow: '0 14px 40px #103e521a', '&::after': { content: '\"\"', position: 'absolute', width: 360, height: 360, border: '1px solid #ffffff18', borderRadius: '50%', right: -100, top: -150, pointerEvents: 'none' } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}><ShieldOutlined sx={{ color: '#a6e4d7', fontSize: 20 }} /><Typography variant="overline" sx={{ letterSpacing: '.14em', color: '#bbdedf' }}>{tr('Customer review workspace')}</Typography></Stack>
      <Typography component="h1" sx={{ fontSize: { xs: 30, md: 42 }, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.15, mb: 1.5 }}>{tr('Your inspections. Clearly explained.')}</Typography>
      <Typography sx={{ color: '#d1e5e9', maxWidth: 700, lineHeight: 1.8 }}>{tr('Review the findings, explore the recorded details and photographs, then ask your team a question. Issued documents stay available for download.')}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5, mt: 3.5, position: 'relative', zIndex: 1 }}>
        {[{ text: '1 · Overview', icon: GridViewRounded }, { text: '2 · Inspection data', icon: FactCheckRounded }, { text: '3 · Evidence', icon: PhotoLibraryRounded }, { text: '4 · Discussion', icon: ForumRounded }].map(({ text, icon: Icon }, index) => <Stack key={text} direction="row" spacing={1.5} sx={{ p: 1.5, alignItems: 'center', bgcolor: '#ffffff0c', border: '1px solid #ffffff18', borderRadius: 2.5 }}><Icon sx={{ color: '#9ce0d4', fontSize: 22 }} /><Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{tr(text)}</Typography>{index < 3 && <ArrowForwardRounded sx={{ fontSize: 16, color: '#9cc4ca', transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />}</Stack>)}
      </Box>
    </Box>
    <ReportHistoryTable customer />
  </Stack>;
}
