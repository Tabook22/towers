import { useRef, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import CampaignRounded from '@mui/icons-material/CampaignRounded';
import AssignmentTurnedInRounded from '@mui/icons-material/AssignmentTurnedInRounded';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import { defaultNoticeAppearance, type FieldNotice, type NoticeBody, type NoticeCategory, noticeError, useChangeNotice, useNoticeOptions } from '../api/notices';
import { AppearanceEditor } from './NoticeDesign';
import { noteDesign, noteTextStyle, paperStyle, useNoticeDesign } from './noticeDesignUtils';

export function NoticeEditor({ notice, onClose }: { notice: FieldNotice | null; onClose: () => void }) {
  const options = useNoticeOptions(true);
  const save = useChangeNotice();
  const { t } = useNoticeDesign();
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState<NoticeBody>(notice ? { title: notice.title, body: notice.body, category: notice.category, team_id: notice.team_id, tower_id: notice.tower_id, owner_id: notice.owner_id, due_on: notice.due_on, expires_on: notice.expires_on, appearance: { ...defaultNoticeAppearance, ...notice.appearance } } : { title: '', body: '', category: 'update', team_id: null, tower_id: null, owner_id: null, due_on: null, expires_on: null, appearance: { ...defaultNoticeAppearance } });
  const design = noteDesign(form);
  const [error, setError] = useState('');
  const effectiveTeam = options.data && !options.data.can_broadcast ? options.data.teams[0]?.id ?? null : form.team_id;
  const people = options.data?.people.filter(p => !effectiveTeam || p.team_id === effectiveTeam) || [];
  const towers = options.data?.towers.filter(t => !effectiveTeam || t.team_ids.includes(effectiveTeam)) || [];
  const change = <K extends keyof NoticeBody>(key: K, value: NoticeBody[K]) => setForm(f => ({ ...f, [key]: value }));
  const insertEmoji = (emoji: string) => {
    const input = messageInput.current;
    const start = input?.selectionStart ?? form.body.length, end = input?.selectionEnd ?? start;
    const next = form.body.slice(0, start) + emoji + form.body.slice(end);
    if (next.length > 4000) return;
    change('body', next);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); });
  };
  const submit = async () => {
    setError('');
    try {
      const body = { ...form, title: form.title.trim(), body: form.body.trim(), team_id: effectiveTeam };
      await save.mutateAsync(notice ? { kind: 'edit', notice, body } : { kind: 'create', body });
      onClose();
    } catch (err) { setError(noticeError(err)); }
  };
  return <Dialog open onClose={save.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ pb: 1 }}><Typography component="span" variant="h6" sx={{ fontWeight: 800 }}>{t(notice ? 'Edit notice' : 'Pin a field notice')}</Typography><Typography variant="body2" color="text.secondary">{t('A clear instruction helps the crew act with confidence.')}</Typography></DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {options.isLoading && <LinearProgress />}
      {options.isError && <Alert severity="error" action={<Button onClick={() => void options.refetch()}>Retry</Button>}>Could not load notice options.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <ToggleButtonGroup exclusive value={form.category} onChange={(_, category: NoticeCategory | null) => { if (category) setForm(f => ({ ...f, category, owner_id: category === 'action' ? f.owner_id : null, due_on: category === 'action' ? f.due_on : null })); }} fullWidth size="small" aria-label="Notice type">
        <ToggleButton value="urgent" sx={{ gap: 0.7 }}><CampaignRounded fontSize="small" />{t('Urgent')}</ToggleButton>
        <ToggleButton value="action" sx={{ gap: 0.7 }}><AssignmentTurnedInRounded fontSize="small" />{t('Action')}</ToggleButton>
        <ToggleButton value="update" sx={{ gap: 0.7 }}><StickyNote2Rounded fontSize="small" />{t('Update')}</ToggleButton>
      </ToggleButtonGroup>
      {form.category === 'urgent' && <Alert severity="warning">{t('An urgent banner appears for recipients until they acknowledge this notice or it is archived or expires.')}</Alert>}
      <TextField autoFocus label={t('Title')} required value={form.title} onChange={e => change('title', e.target.value)} slotProps={{ htmlInput: { maxLength: 160, dir: design.direction, lang: design.language === 'auto' ? undefined : design.language } }} placeholder="What does the crew need to know?" />
      <TextField label={t('Message')} inputRef={messageInput} required multiline minRows={4} maxRows={10} value={form.body} onChange={e => change('body', e.target.value)} slotProps={{ htmlInput: { maxLength: 4000, dir: design.direction, lang: design.language === 'auto' ? undefined : design.language, style: { fontFamily: design.family, fontSize: design.font_size } } }} helperText={`${form.body.length}/4000`} placeholder="Explain what needs attention and what to do next." />
      <Box><Typography variant="caption" color="text.secondary">{t('Add an emoji to the message')}</Typography><Stack direction="row" sx={{ flexWrap: 'wrap', gap: .5 }}>{['👍', '✅', '⚠️', '📷', '📍', '💡', '🙏', '🔧'].map(emoji => <Button key={emoji} size="small" aria-label={`Insert ${emoji}`} onMouseDown={e => e.preventDefault()} onClick={() => insertEmoji(emoji)} sx={{ minWidth: 36, fontSize: 21 }}>{emoji}</Button>)}</Stack></Box>
      <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><AppearanceEditor value={form.appearance} paper={design.paper} change={next => change('appearance', next)} /></Box>
      <Box><Typography variant="caption" color="text.secondary">{t('Live preview')}</Typography><Box dir={design.direction} lang={design.language === 'auto' ? undefined : design.language} sx={{ ...paperStyle(design.paper), p: 3, my: 1 }}>
        <Typography sx={{ ...noteTextStyle(form), fontWeight: 800, fontSize: design.font_size + 2 }}>{design.marker && <span dir="auto">{design.marker} </span>}{form.title || t('Title')}</Typography>
        <Typography sx={{ ...noteTextStyle(form), mt: 1 }}>{form.body || t('Message')}</Typography>
      </Box></Box>
      <TextField select label={t('Who should see this?')} value={effectiveTeam ?? ''} onChange={e => setForm(f => ({ ...f, team_id: e.target.value ? Number(e.target.value) : null, owner_id: null, tower_id: null }))} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
        {options.data?.can_broadcast && <MenuItem value="">{t('Everyone · all field staff')}</MenuItem>}
        {options.data?.teams.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
      </TextField>
      <Autocomplete options={towers} getOptionLabel={o => o.name} value={towers.find(t => t.id === form.tower_id) || null} onChange={(_, tower) => change('tower_id', tower?.id ?? null)} isOptionEqualToValue={(a, b) => a.id === b.id} renderInput={params => <TextField {...params} label={t('Link a tower (optional)')} helperText={t(effectiveTeam ? 'Choose a tower this team is assigned to or has inspected.' : 'Opens the tower record from the note.')} />} />
      {form.category === 'action' && <Autocomplete options={people} getOptionLabel={o => o.name} value={people.find(p => p.id === form.owner_id) || null} onChange={(_, owner) => change('owner_id', owner?.id ?? null)} isOptionEqualToValue={(a, b) => a.id === b.id} renderInput={params => <TextField {...params} label={t('Action owner (optional)')} helperText={t('Without an owner, any recipient can mark the action done.')} />} />}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: form.category === 'action' ? '1fr 1fr' : '1fr' }, gap: 2 }}>
        {form.category === 'action' && <TextField label={t('Due date (optional)')} type="date" value={form.due_on || ''} onChange={e => change('due_on', e.target.value || null)} slotProps={{ inputLabel: { shrink: true } }} />}
        <TextField label={t('Expiry date (optional)')} type="date" value={form.expires_on || ''} onChange={e => change('expires_on', e.target.value || null)} slotProps={{ inputLabel: { shrink: true } }} helperText={t('Visible through this date in Oman, then moved to history.')} />
      </Box>
      {notice && <Alert severity="info">{t('Changes to the instruction, audience, dates or marker start a new acknowledgement round. Colour, font and direction changes preserve existing acknowledgements.')}</Alert>}
    </Stack></DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}><Button disabled={save.isPending} onClick={onClose}>{t('Cancel')}</Button><Button variant="contained" onClick={() => void submit()} disabled={!options.data?.can_publish || !form.title.trim() || !form.body.trim() || save.isPending}>{t(save.isPending ? 'Saving…' : notice ? 'Save changes' : 'Publish notice')}</Button></DialogActions>
  </Dialog>;
}
