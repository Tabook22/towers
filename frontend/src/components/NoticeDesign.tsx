import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Box, Button, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { getContrastRatio } from '@mui/material/styles';
import AddRounded from '@mui/icons-material/AddRounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { type NoticeAppearance } from '../api/notices';
import { BoardContext, defaults, arabic, noteFonts, notePapers, useNoticeDesign, type BoardPreferences } from './noticeDesignUtils';

export function NoticePreferences({ userId, children }: { userId: number; children: ReactNode }) {
  const key = `field-noticeboard-v2:${userId}`;
  const [prefs, set] = useState<BoardPreferences>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      return { language: saved.language === 'ar' ? 'ar' : 'en', board: /^#[\da-f]{6}$/i.test(saved.board) ? saved.board : defaults.board,
        zoom: Number.isFinite(saved.zoom) ? Math.min(150, Math.max(75, saved.zoom)) : 100,
        order: Array.isArray(saved.order) ? saved.order.filter((id: unknown) => Number.isInteger(id)).slice(0, 2000) : [] };
    } catch { return defaults; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* Private browsing can disable storage. */ } }, [key, prefs]);
  return <BoardContext.Provider value={{ prefs, setPrefs: update => set(value => ({ ...value, ...update })), t: text => prefs.language === 'ar' ? arabic[text] || text : text }}>{children}</BoardContext.Provider>;
}
export function BoardToolbar() {
  const { prefs, setPrefs, t } = useNoticeDesign();
  const [settings, showSettings] = useState(false);
  return <Box dir={prefs.language === 'ar' ? 'rtl' : 'ltr'} sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: .25 }}>
      <Tooltip title={t('Board appearance')}><IconButton aria-label={t('Board appearance')} aria-expanded={settings} onClick={() => showSettings(v => !v)} size="small"><TuneRounded fontSize="small" /></IconButton></Tooltip>
      <Button size="small" onClick={() => setPrefs({ language: prefs.language === 'en' ? 'ar' : 'en' })} aria-label={t('Board language')} sx={{ minWidth: 60 }}>{prefs.language === 'en' ? 'العربية' : 'English'}</Button>
      <Stack direction="row" sx={{ alignItems: 'center' }} dir="ltr">
        <IconButton size="small" aria-label={t('Zoom out')} disabled={prefs.zoom <= 75} onClick={() => setPrefs({ zoom: Math.max(75, prefs.zoom - 10) })}><RemoveRounded fontSize="small" /></IconButton>
        <Tooltip title={t('Reset zoom')}><Button size="small" aria-label={t('Reset zoom')} onClick={() => setPrefs({ zoom: 100 })} sx={{ minWidth: 48, fontVariantNumeric: 'tabular-nums' }}>{prefs.zoom}%</Button></Tooltip>
        <IconButton size="small" aria-label={t('Zoom in')} disabled={prefs.zoom >= 150} onClick={() => setPrefs({ zoom: Math.min(150, prefs.zoom + 10) })}><AddRounded fontSize="small" /></IconButton>
      </Stack>
    </Stack>
    {settings && <Stack spacing={1.5} sx={{ pt: 1.5 }}>
      <TextField label={t('Board colour')} type="color" value={prefs.board} onChange={e => setPrefs({ board: e.target.value })} size="small" fullWidth />
      <Stack direction="row" sx={{ gap: 1 }}>{['#f1f5f2', '#f3e7d3', '#e4edf7', '#eadfeb', '#253b42'].map(colour => <IconButton key={colour} aria-label={`Board ${colour}`} onClick={() => setPrefs({ board: colour })} sx={{ width: 32, height: 32, bgcolor: colour, border: prefs.board === colour ? '3px solid #258292' : '1px solid #999', '&:hover': { bgcolor: colour } }} />)}</Stack>
      <Button size="small" onClick={() => setPrefs({ order: [] })}>{t('Default arrangement')}</Button>
      <Typography variant="caption" color="text.secondary">{t('Personal settings · saved on this device')}</Typography>
    </Stack>}
  </Box>;
}

export function AppearanceEditor({ value, paper, change }: { value: NoticeAppearance; paper: string; change: (next: NoticeAppearance) => void }) {
  const { t } = useNoticeDesign();
  const set = <K extends keyof NoticeAppearance>(key: K, next: NoticeAppearance[K]) => change({ ...value, [key]: next });
  return <Stack spacing={2}>
    <Typography variant="subtitle2">{t('Notice design')}</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
      <TextField select size="small" label={t('Language')} value={value.language} onChange={e => { const language = e.target.value as NoticeAppearance['language']; change({ ...value, language, direction: language === 'ar' ? 'rtl' : language === 'en' ? 'ltr' : 'auto', font: language === 'ar' ? 'arabic' : value.font }); }}>
        <MenuItem value="auto">{t('Automatic')}</MenuItem><MenuItem value="en">English</MenuItem><MenuItem value="ar">العربية</MenuItem>
      </TextField>
      <TextField select size="small" label={t('Text direction')} value={value.direction} onChange={e => set('direction', e.target.value as NoticeAppearance['direction'])}>
        <MenuItem value="auto">{t('Automatic')}</MenuItem><MenuItem value="rtl">{t('Right to left')}</MenuItem><MenuItem value="ltr">{t('Left to right')}</MenuItem>
      </TextField>
      <TextField select size="small" label={t('Font')} value={value.font} onChange={e => set('font', e.target.value as NoticeAppearance['font'])}>{Object.entries(noteFonts).map(([key, font]) => <MenuItem key={key} value={key} sx={{ fontFamily: font.family }}>{font.label}</MenuItem>)}</TextField>
      <TextField select size="small" label={t('Font size')} value={value.font_size} onChange={e => set('font_size', Number(e.target.value))}>{[14, 16, 18, 20, 22, 24, 26, 28].map(size => <MenuItem key={size} value={size}>{size} px</MenuItem>)}</TextField>
      <TextField size="small" label={t('Note colour')} type="color" value={paper} onChange={e => set('paper', e.target.value)} />
      <TextField size="small" label={t('Text colour')} type="color" value={value.ink} onChange={e => set('ink', e.target.value)} />
    </Box>
    <Typography variant="caption" color="text.secondary">{t('Language sets reading direction; it does not translate the message.')}</Typography>
    {getContrastRatio(paper, value.ink) < 4.5 && <Alert severity="warning">{t('Low contrast: choose a darker text colour or a lighter note colour for easier reading.')}</Alert>}
    <Stack direction="row" sx={{ gap: .75, flexWrap: 'wrap', alignItems: 'center' }}>{notePapers.map(colour => <IconButton key={colour} aria-label={`Note ${colour}`} onClick={() => set('paper', colour)} sx={{ width: 32, height: 32, bgcolor: colour, border: value.paper === colour ? '3px solid #258292' : '1px solid #aaa', '&:hover': { bgcolor: colour } }} />)}<Button size="small" onClick={() => set('paper', null)}>{t('Use category colour')}</Button></Stack>
    <TextField size="small" label={t('Marker')} value={value.marker} onChange={e => set('marker', e.target.value)} slotProps={{ htmlInput: { maxLength: 16 } }} placeholder="📌 ⚠️ 🔥 ✅" />
    <Stack direction="row" sx={{ gap: .5, flexWrap: 'wrap' }}>{['📌', '⚠️', '🚨', '❗', '🔥', '✅', '📷', '💡', '📢', '🛠️'].map(emoji => <Button size="small" key={emoji} aria-label={`Marker ${emoji}`} onClick={() => set('marker', emoji)} sx={{ minWidth: 36, fontSize: 22, bgcolor: value.marker === emoji ? 'action.selected' : undefined }}>{emoji}</Button>)}<Button size="small" onClick={() => set('marker', '')}>{t('No marker')}</Button></Stack>
  </Stack>;
}
