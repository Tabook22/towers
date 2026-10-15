import { Box } from '@mui/material';
import { API_BASE_URL } from '../api/client';
import { useReportLogo } from '../api/reportBranding';
import { tr, useLanguage } from '../i18n';

export function ReportLogo() {
  useLanguage();
  const { data } = useReportLogo();
  if (!data?.logo_url) return null;
  return <Box sx={{ bgcolor: '#fff', borderRadius: 2, p: 1, width: { xs: 180, md: 220 }, height: 135, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Box component="img" src={new URL(data.logo_url, API_BASE_URL).toString()} alt={tr('Company report logo')} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
  </Box>;
}
