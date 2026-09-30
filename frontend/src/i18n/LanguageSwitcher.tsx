import { Button, Tooltip } from '@mui/material';
import TranslateRounded from '@mui/icons-material/TranslateRounded';
import { setLanguage, useLanguage } from './index';
export function LanguageSwitcher() {
  const language = useLanguage();
  return <Tooltip title={language === 'ar' ? 'تغيير لغة الواجهة إلى الإنجليزية' : 'Switch interface language to Arabic'}>
    <Button color="inherit" size="small" startIcon={<TranslateRounded />} onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
      aria-label={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'} lang={language === 'ar' ? 'en' : 'ar'}
      sx={{ whiteSpace: 'nowrap', minWidth: 72, flexShrink: 0 }}>{language === 'ar' ? 'English' : 'العربية'}</Button>
  </Tooltip>;
}
