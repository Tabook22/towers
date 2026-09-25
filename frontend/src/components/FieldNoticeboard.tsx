import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, LinearProgress, MenuItem, Paper, Snackbar, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import PushPinRounded from '@mui/icons-material/PushPinRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import CampaignRounded from '@mui/icons-material/CampaignRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import AssignmentTurnedInRounded from '@mui/icons-material/AssignmentTurnedInRounded';
import StickyNote2Rounded from '@mui/icons-material/StickyNote2Rounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CellTowerRounded from '@mui/icons-material/CellTowerRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/client';
import { type FieldNotice, type NoticeAction, noticeError, useChangeNotice, useNotices } from '../api/notices';
import { NoticeEditor } from './NoticeEditor';
import { BoardToolbar, NoticePreferences } from './NoticeDesign';
import { noteDesign, noteTextStyle, paperStyle, useNoticeDesign } from './noticeDesignUtils';
import { NoticeGrid } from './NoticeGrid';

const appearance = {
  urgent: { label: 'Urgent', colour: '#ad3434', icon: CampaignRounded },
  action: { label: 'Action required', colour: '#8c5c0b', icon: AssignmentTurnedInRounded },
  update: { label: 'Field update', colour: '#226879', icon: StickyNote2Rounded },
};
const omanDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function day(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
function time(value: string) { return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

function NoteCard({ note, open }: { note: FieldNotice; open: () => void }) {
  const { prefs, t } = useNoticeDesign();
  const design = noteDesign(note);
  const style = appearance[note.category];
  const Icon = style.icon;
  const overdue = note.status === 'active' && note.due_on && note.due_on < omanDay();
  return <Box component="button" type="button" onClick={open} aria-label={`Open notice: ${note.title}`} sx={{
    ...paperStyle(design.paper), display: 'block', width: '100%', textAlign: 'start', font: 'inherit', cursor: 'pointer',
    color: '#24343c', p: 2.25, pt: 5, pb: 3,
    transition: 'filter .18s, transform .18s', '&:hover': { transform: 'translateY(-3px)', filter: 'drop-shadow(3px 11px 8px rgba(35,38,25,.28))' },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
    '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 3 },
  }}>
    <Box sx={{ position: 'absolute', left: '46%', top: -8, transform: 'rotate(-15deg)', color: style.colour, filter: 'drop-shadow(1px 3px 1px rgba(0,0,0,.25))' }}><PushPinRounded sx={{ fontSize: 23 }} /></Box>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
      <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center', bgcolor: '#ffffffde', color: style.colour, px: .75, py: .25, borderRadius: 1 }}><Icon sx={{ fontSize: 17 }} /><Typography component="span" variant="caption" sx={{ fontWeight: 800, letterSpacing: .3 }}>{t(style.label)}</Typography></Stack>
      {note.status !== 'active' ? <Chip size="small" label={note.status} sx={{ height: 21, fontSize: 10, bgcolor: '#ffffffde', color: '#24343c' }} /> : note.acknowledged && <Tooltip title="You acknowledged this version"><CheckCircleOutlineRounded sx={{ fontSize: 17, color: 'success.main' }} /></Tooltip>}
    </Stack>
    <Box component="span" lang={design.language === 'auto' ? undefined : design.language} sx={{ display: 'block' }}>
      <Typography dir={design.direction} component="span" sx={{ ...noteTextStyle(note, prefs.zoom), display: 'block', fontSize: (design.font_size + 2) * prefs.zoom / 100, fontWeight: 800, lineHeight: 1.4, mt: 1.2 }}>{design.marker && <span dir="auto">{design.marker} </span>}{note.title}</Typography>
      <Typography dir={design.direction} component="span" sx={{ ...noteTextStyle(note, prefs.zoom), display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden', mt: .8 }}>{note.body}</Typography>
    </Box>
    <Box sx={{ bgcolor: '#ffffffdc', borderRadius: 1, px: 1, pb: 1, mt: 1.5, color: '#24343c' }}><Stack direction="row" sx={{ gap: .75, flexWrap: 'wrap', mt: 1.5 }}>
      <Chip size="small" label={note.team_name || t('Everyone')} sx={{ bgcolor: '#ffffffd9', color: '#24343c', fontSize: 11, maxWidth: '100%' }} />
      {note.tower_name && <Chip size="small" icon={<CellTowerRounded />} label={note.tower_name} sx={{ bgcolor: '#ffffffd9', color: '#24343c', fontSize: 11, maxWidth: '100%' }} />}
    </Stack>
    {note.owner_name && <Typography component="span" variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>{t('For')} {note.owner_name}</Typography>}
    {note.due_on && <Typography component="span" variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: .5, color: overdue ? '#ad3434' : '#40555d', mt: .7 }}><ScheduleRounded sx={{ fontSize: 14 }} />{t(overdue ? 'Overdue' : 'Due')} · {day(note.due_on)}</Typography>}
    <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1.5, gap: 1, color: '#40555d' }}><Typography component="span" variant="caption" sx={{ fontSize: 10.5 }}>{note.author_name} · {time(note.updated_at)}</Typography><ArrowForwardRounded sx={{ fontSize: 16, flexShrink: 0 }} /></Stack></Box>
  </Box>;
}

function NoticeReceipts({ notice }: { notice: FieldNotice }) {
  const query = useQuery({ queryKey: ['notice-receipts', notice.id, notice.revision],
    queryFn: async ({ signal }) => (await apiClient.get<{ revision: number; people: { id: number; name: string; acknowledged_at: string | null }[] }>(`/api/notices/${notice.id}/receipts`, { signal })).data });
  if (query.isLoading) return <LinearProgress />;
  if (query.isError) return <Alert severity="error">Could not load acknowledgements.</Alert>;
  const people = query.data?.people || [];
  return <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
    <Typography variant="subtitle2">{people.filter(p => p.acknowledged_at).length} of {people.length} current recipients acknowledged</Typography>
    <Typography variant="caption" color="text.secondary">Version {query.data?.revision}. Includes active managers and the selected audience. Acknowledgement confirms reading, not task completion.</Typography>
    <Stack spacing={1} sx={{ mt: 2, maxHeight: 260, overflowY: 'auto' }}>{people.map(p => <Stack direction="row" key={p.id} sx={{ gap: 1, justifyContent: 'space-between' }}><Typography variant="body2">{p.name}</Typography><Typography variant="caption" sx={{ color: p.acknowledged_at ? 'success.main' : 'text.secondary' }}>{p.acknowledged_at ? time(p.acknowledged_at) : 'Not acknowledged'}</Typography></Stack>)}</Stack>
  </Paper>;
}

function NoticeDetail({ notice, close, followTower, edit, act, busy, error }: { notice: FieldNotice; close: () => void; followTower: () => void; edit: () => void; act: (action: NoticeAction) => void; busy: boolean; error: string }) {
  const [receipts, setReceipts] = useState(false);
  const { prefs, t } = useNoticeDesign();
  const design = noteDesign(notice);
  const style = appearance[notice.category];
  return <Dialog open onClose={busy ? undefined : close} fullWidth maxWidth="sm" aria-labelledby={`notice-title-${notice.id}`} slotProps={{ paper: { dir: prefs.language === 'ar' ? 'rtl' : 'ltr' } }}>
    <DialogTitle sx={{ pr: 7 }}><Chip size="small" label={t(style.label)} color={notice.category === 'urgent' ? 'error' : notice.category === 'action' ? 'warning' : 'info'} /><IconButton onClick={close} aria-label="Close notice" sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded /></IconButton></DialogTitle>
    <BoardToolbar />
    <DialogContent><Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {notice.status !== 'active' && <Alert severity={notice.status === 'completed' ? 'success' : 'info'}>This notice is {notice.status}.{notice.completed_at && ` Completed by ${notice.completed_by_name || 'a team member'} on ${time(notice.completed_at)}.`}</Alert>}
      <Box lang={design.language === 'auto' ? undefined : design.language} sx={{ ...paperStyle(design.paper), p: 3, mt: 2 }}>
        <Typography id={`notice-title-${notice.id}`} dir={design.direction} variant="h6" sx={{ ...noteTextStyle(notice, prefs.zoom), fontSize: (design.font_size + 3) * prefs.zoom / 100, fontWeight: 800 }}>{design.marker && <span dir="auto">{design.marker} </span>}{notice.title}</Typography>
        <Typography dir={design.direction} sx={{ ...noteTextStyle(notice, prefs.zoom), mt: 2 }}>{notice.body}</Typography>
      </Box>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}><Chip label={notice.team_name || t('Everyone · all field staff')} />{notice.tower_id && <Button component={Link} to={`/towers/${notice.tower_id}`} startIcon={<CellTowerRounded />} onClick={followTower}>{notice.tower_name}</Button>}</Stack>
      {(notice.owner_name || notice.due_on || notice.expires_on) && <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 2 }}>
        {notice.owner_name && <Typography variant="body2"><b>{t('Action owner:')}</b> {notice.owner_name}</Typography>}
        {notice.due_on && <Typography variant="body2"><b>{t('Due:')}</b> {notice.due_on}</Typography>}
        {notice.expires_on && <Typography variant="body2"><b>{t('Visible through:')}</b> {notice.expires_on} (Oman)</Typography>}
      </Box>}
      <Typography variant="caption" color="text.secondary">{t('Posted by')} {notice.author_name} · {time(notice.created_at)}{notice.revision > 1 ? ` · ${time(notice.updated_at)} · v${notice.revision}` : ''}</Typography>
      {notice.can_manage && <><Divider /><Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<EditRounded />} disabled={busy} onClick={edit}>{t('Edit notice')}</Button>
        <Button size="small" disabled={busy} onClick={() => setReceipts(v => !v)}>{receipts ? t('Hide acknowledgements') : `${t('Acknowledgements')} (${notice.acknowledgement_count})`}</Button>
        <Button size="small" startIcon={<Inventory2Outlined />} disabled={busy} onClick={() => act(notice.status === 'archived' ? 'restore' : 'archive')}>{t(notice.status === 'archived' ? 'Restore' : 'Archive')}</Button>
        {notice.completed_at && <Button size="small" disabled={busy} onClick={() => act('reopen')}>{t('Reopen action')}</Button>}
      </Stack>{receipts && <NoticeReceipts notice={notice} />}</>}
    </Stack></DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>{notice.status === 'active' && <>
      <Button variant={notice.can_complete ? 'outlined' : 'contained'} startIcon={<CheckCircleOutlineRounded />} disabled={busy || notice.acknowledged} onClick={() => act('acknowledge')}>{t(notice.acknowledged ? 'Acknowledged' : 'Acknowledge')}</Button>
      {notice.can_complete && <Button variant="contained" color="success" startIcon={<AssignmentTurnedInRounded />} disabled={busy} onClick={() => act('complete')}>{t('Mark action done')}</Button>}
    </>}<Button disabled={busy} onClick={close}>{t('Close')}</Button></DialogActions>
  </Dialog>;
}

function NoticeLibrary({ close, open, create, canPublish }: { close: () => void; open: (notice: FieldNotice) => void; create: () => void; canPublish: boolean }) {
  const { prefs, t } = useNoticeDesign();
  const [state, setState] = useState('active');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useNotices({ state, search, category, offset, limit: 20 });
  return <Dialog open onClose={close} fullWidth maxWidth="lg" slotProps={{ paper: { sx: { minHeight: '70vh', maxWidth: 1280 }, dir: prefs.language === 'ar' ? 'rtl' : 'ltr' } }}>
    <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>{t('Field Noticeboard')}<IconButton onClick={close} aria-label="Close noticeboard"><CloseRounded /></IconButton></DialogTitle>
    <BoardToolbar />
    <DialogContent><Stack spacing={2}>
      <Tabs value={state} onChange={(_, value) => { setState(value); setOffset(0); }}><Tab value="active" label={t('Active notices')} /><Tab value="history" label={t('History')} /></Tabs>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><TextField fullWidth size="small" label={t('Search notices')} value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} slotProps={{ input: { startAdornment: <SearchRounded sx={{ mr: 1, color: 'text.secondary' }} /> } }} /><TextField size="small" select label={t('Type')} value={category} onChange={e => { setCategory(e.target.value); setOffset(0); }} sx={{ minWidth: 170 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}><MenuItem value="">{t('All types')}</MenuItem>{Object.entries(appearance).map(([key, value]) => <MenuItem key={key} value={key}>{t(value.label)}</MenuItem>)}</TextField></Stack>
      {state === 'history' && <Typography variant="body2" color="text.secondary">{t('Completed, expired and archived notices stay here for reference.')}</Typography>}
      {query.isFetching && <LinearProgress />}{query.isError && <Alert severity="error" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>Could not load notices.</Alert>}
      <Box sx={{ bgcolor: prefs.board, p: { xs: 2, sm: 3 }, borderRadius: 2, backgroundImage: 'radial-gradient(rgba(90,110,100,.2) .8px, transparent .8px)', backgroundSize: '12px 12px' }}><NoticeGrid notes={query.data?.items || []} render={note => <NoteCard note={note} open={() => open(note)} />} /></Box>
      {query.data?.total === 0 && <Typography sx={{ textAlign: 'center', py: 5 }} color="text.secondary">{t(search || category ? 'No notices match these filters.' : state === 'history' ? 'No past notices yet.' : 'No active notices. You’re up to date.')}</Typography>}
      {query.data && query.data.total > 20 && <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Button disabled={!offset} onClick={() => setOffset(v => Math.max(0, v - 20))}>{t('Previous')}</Button><Typography variant="caption">{offset + 1}–{Math.min(offset + 20, query.data.total)} of {query.data.total}</Typography><Button disabled={offset + 20 >= query.data.total} onClick={() => setOffset(v => v + 20)}>{t('Next')}</Button></Stack>}
    </Stack></DialogContent><DialogActions sx={{ px: 3, pb: 2 }}>{canPublish && <Button variant="contained" startIcon={<AddRounded />} onClick={create}>{t('New notice')}</Button>}<Button onClick={close}>{t('Close')}</Button></DialogActions>
  </Dialog>;
}

export function FieldNoticeboard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <NoticePreferences key={user?.id || 0} userId={user?.id || 0}><NoticeboardContent>{children}</NoticeboardContent></NoticePreferences>;
}

function NoticeboardContent({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { prefs, t } = useNoticeDesign();
  const location = useLocation();
  const enabled = Boolean(user && user.role !== 'client') && (location.pathname === '/' || /^\/(teams|towers|visits)(\/|$)/.test(location.pathname));
  const query = useNotices({ limit: 3 }, enabled);
  const change = useChangeNotice();
  const [selected, setSelected] = useState<FieldNotice | null>(null);
  const [editor, setEditor] = useState<FieldNotice | null | undefined>(undefined);
  const [library, setLibrary] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const open = (notice: FieldNotice) => { setSelected(notice); setError(''); };
  const act = async (action: NoticeAction) => {
    if (!selected) return;
    setError('');
    try { const result = await change.mutateAsync({ kind: action, notice: selected }); setSelected(result); setToast(action === 'acknowledge' ? 'Acknowledged. Thank you for reading.' : action === 'complete' ? 'Action marked done.' : action === 'archive' ? 'Notice moved to history.' : 'Notice updated.'); }
    catch (err) { setError(noticeError(err)); }
  };
  if (!enabled) return <>{children}</>;
  const urgent = query.data?.urgent;
  return <>
    {urgent && <Alert severity="error" icon={<CampaignRounded />} sx={{ mb: 2.5, border: '1px solid', borderColor: 'error.light', borderRadius: 2, '& .MuiAlert-message': { width: '100%' } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}><Box><Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 1 }}>{t('FIELD ALERT')}{(query.data?.urgent_unacknowledged || 0) > 1 ? ` · ${query.data?.urgent_unacknowledged} need acknowledgement` : ''}</Typography><Typography dir={urgent.appearance?.direction || 'auto'} sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{urgent.title}</Typography><Typography variant="caption">{urgent.team_name || t('All field staff')} · {t('Please read before continuing your work.')}</Typography></Box><Button variant="contained" color="error" size="small" sx={{ flexShrink: 0 }} onClick={() => open(urgent)}>{t('Read urgent notice')}</Button></Stack>
    </Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3, '@media (min-width: 1500px)': { gridTemplateColumns: 'minmax(0, 1fr) 330px', alignItems: 'start' } }}>
      <Box sx={{ minWidth: 0, gridRow: 2, '@media (min-width: 1500px)': { gridRow: 1, gridColumn: 1 } }}>{children}</Box>
      <Paper component="aside" dir={prefs.language == "ar" ? "rtl" : "ltr"} aria-label="Field Noticeboard" variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', gridRow: 1, '@media (min-width: 1500px)': { gridColumn: 2, position: 'sticky', top: 88 }, bgcolor: 'background.paper' }}>
        <Box sx={{ px: 2.25, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Box sx={{ display: 'grid', placeItems: 'center', width: 35, height: 35, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}><PushPinRounded sx={{ fontSize: 19 }} /></Box><Box><Typography sx={{ fontWeight: 800, fontSize: 17 }}>{t('Field Noticeboard')}</Typography><Typography variant="caption" color="text.secondary">{t('The briefing before the work.')}</Typography></Box></Stack>{query.data?.can_publish && <Tooltip title="Publish a notice"><IconButton aria-label={t('New notice')} onClick={() => setEditor(null)} size="small" sx={{ bgcolor: 'action.hover' }}><AddRounded /></IconButton></Tooltip>}</Stack>
        </Box>
        <BoardToolbar />
        <Box sx={{ p: 2.25, bgcolor: prefs.board, maxHeight: { xs: 400, sm: 480 }, overflowY: 'auto', backgroundImage: 'radial-gradient(rgba(110,140,145,.13) .7px, transparent .7px)', backgroundSize: '9px 9px', '@media (min-width: 1500px)': { maxHeight: 'max(180px, calc(100vh - 365px))' } }}>
          {query.isLoading && <LinearProgress aria-label="Loading noticeboard" />}
          {query.isError && <Alert severity="warning" action={<Button size="small" onClick={() => void query.refetch()}>Retry</Button>}>Noticeboard unavailable. Check your connection.</Alert>}
          {query.data && query.data.items.length === 0 && <Stack spacing={1.5} sx={{ textAlign: 'center', alignItems: 'center', py: 2 }}><StickyNote2Rounded sx={{ fontSize: 42, color: 'primary.light', transform: 'rotate(-8deg)' }} /><Typography sx={{ fontWeight: 750 }}>{t(query.data.can_publish ? 'Your next field briefing starts here' : 'You’re up to date')}</Typography><Typography variant="body2" color="text.secondary">{t(query.data.can_publish ? 'Pin a clear instruction, an important update, or the next action for your crew.' : 'Important instructions and team actions will be pinned here.')}</Typography>{query.data.can_publish && <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={() => setEditor(null)}>{t('Create first notice')}</Button>}</Stack>}
          <NoticeGrid compact notes={query.data?.items || []} render={note => <NoteCard note={note} open={() => open(note)} />} />
        </Box>
        <Button fullWidth endIcon={<ArrowForwardRounded />} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider', borderRadius: 0 }} onClick={() => setLibrary(true)}>{t('View all notices')}{query.data?.active_count ? ` · ${query.data.active_count}` : ''}</Button>
      </Paper>
    </Box>
    {library && <NoticeLibrary close={() => setLibrary(false)} open={open} canPublish={Boolean(query.data?.can_publish)} create={() => setEditor(null)} />}
    {selected && <NoticeDetail key={`${selected.id}-${selected.revision}`} notice={selected} close={() => setSelected(null)} followTower={() => { setSelected(null); setLibrary(false); }} edit={() => setEditor(selected)} act={action => void act(action)} busy={change.isPending} error={error} />}
    {editor !== undefined && <NoticeEditor key={editor?.id || 'new'} notice={editor} onClose={() => { setEditor(undefined); setSelected(null); }} />}
    <Snackbar open={Boolean(toast)} message={toast} autoHideDuration={4500} onClose={() => setToast('')} />
  </>;
}
