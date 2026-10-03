import { Box, Chip, Stack, Typography } from '@mui/material';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import { ReportHistoryTable } from '../components/ReportHistoryTable';
import { tr, useLanguage } from '../i18n';

export function ClientReportsPage() {
  useLanguage();
  return <Stack spacing={2.5}>
    <Box sx={{ p: { xs: 2.5, md: 3 }, borderRadius: '16px', color: '#fff', background: 'linear-gradient(115deg, #102c3b, #1a5963)' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}><FactCheckRounded sx={{ color: '#a6e4d7' }} /><Typography variant="overline">{tr('Customer review workspace')}</Typography></Stack>
      <Typography component="h1" variant="h4" sx={{ fontWeight: 800, letterSpacing: '-.025em', mb: 1 }}>{tr('Your inspections. Clearly explained.')}</Typography>
      <Typography variant="body2" sx={{ color: '#d1e5e9', maxWidth: 750 }}>{tr('Review the findings, explore the recorded details and photographs, then ask your team a question. Issued documents stay available for download.')}</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 2 }}>{['1 · Overview', '2 · Inspection data', '3 · Evidence', '4 · Discussion'].map((text) => <Chip key={text} size="small" label={tr(text)} sx={{ bgcolor: '#ffffff14', color: 'inherit' }} />)}</Stack>
    </Box>
    <ReportHistoryTable customer />
  </Stack>;
}
