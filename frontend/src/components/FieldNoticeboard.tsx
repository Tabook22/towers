import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { alpha, useTheme } from '@mui/material/styles';
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

const appearance = {
  urgent: { label: 'Urgent', colour: '#ad3434', paper: '#fff0ec', dark: '#3c2529', icon: CampaignRounded },
  action: { label: 'Action required', colour: '#8c5c0b', paper: '#fff7d9', dark: '#373022', icon: AssignmentTurnedInRounded },
  update: { label: 'Field update', colour: '#226879', paper: '#eaf5f7', dark: '#20343b', icon: StickyNote2Rounded },
};
const omanDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function day(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
function time(value: string) { return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

function NoteCard({ note, open }: { note: FieldNotice; open: () => void }) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const style = appearance[note.category];
  const Icon = style.icon;
  const overdue = note.status === 'active' && note.due_on && note.due_on < omanDay();
  return <Box component="button" type="button" onClick={open} aria-label={`Open notice: ${note.title}`} sx={{
    display: 'block', width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer', position: 'relative',
    color: 'text.primary', bgcolor: dark ? style.dark : style.paper, p: 2.25, pt: 2.5, border: '1px solid', borderColor: alpha(style.colour, 0.2),
    borderRadius: '8px 8px 22px 8px', boxShadow: '0 3px 7px rgba(20, 48, 58, .05)',
    transition: 'box-shadow .18s, transform .18s', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 7px 18px rgba(20, 48, 58, .12)' },
    '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 3 },
    '&:after': { content: '""', position: 'absolute', right: 0, bottom: 0, width: 17, height: 17, background: `linear-gradient(135deg, ${alpha(style.colour, .2)} 50%, transparent 50%)`, borderRadius: '3px 0 20px 0' },
  }}>
    <Box sx={{ position: 'absolute', left: '50%', top: -7, transform: 'rotate(-12deg)', color: dark ? '#bbd3d8' : style.colour }}><PushPinRounded sx={{ fontSize: 19 }} /></Box>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
      <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center', color: dark ? '#e5dcbd' : style.colour }}><Icon sx={{ fontSize: 17 }} /><Typography component="span" variant="caption" sx={{ fontWeight: 800, letterSpacing: .3 }}>{style.label}</Typography></Stack>
      {note.status !== 'active' ? <Chip size="small" label={note.status} sx={{ height: 21, fontSize: 10 }} /> : note.acknowledged && <Tooltip title="You acknowledged this version"><CheckCircleOutlineRounded sx={{ fontSize: 17, color: 'success.main' }} /></Tooltip>}
    </Stack>
    <Typography component="span" sx={{ display: 'block', fontSize: 15, fontWeight: 800, lineHeight: 1.4, mt: 1.2, overflowWrap: 'anywhere' }}>{note.title}</Typography>
    <Typography component="span" variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap', color: 'text.secondary', mt: .8, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{note.body}</Typography>
    <Stack direction="row" sx={{ gap: .75, flexWrap: 'wrap', mt: 1.5 }}>
      <Chip size="small" label={note.team_name || 'Everyone'} sx={{ bgcolor: dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.65)', fontSize: 11, maxWidth: '100%' }} />
      {note.tower_name && <Chip size="small" icon={<CellTowerRounded />} label={note.tower_name} sx={{ fontSize: 11, maxWidth: '100%' }} />}
    </Stack>
    {note.owner_name && <Typography component="span" variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>For {note.owner_name}</Typography>}
    {note.due_on && <Typography component="span" variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: .5, color: overdue ? 'error.main' : 'text.secondary', mt: .7 }}><ScheduleRounded sx={{ fontSize: 14 }} />{overdue ? 'Overdue' : 'Due'} · {day(note.due_on)}</Typography>}
    <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1.5, gap: 1, color: 'text.secondary' }}><Typography component="span" variant="caption" sx={{ fontSize: 10.5 }}>{note.author_name} · {time(note.updated_at)}</Typography><ArrowForwardRounded sx={{ fontSize: 16, flexShrink: 0 }} /></Stack>
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
  const style = appearance[notice.category];
  return <Dialog open onClose={busy ? undefined : close} fullWidth maxWidth="sm">
    <DialogTitle sx={{ pr: 7 }}><Chip size="small" label={style.label} color={notice.category === 'urgent' ? 'error' : notice.category === 'action' ? 'warning' : 'info'} /><Typography variant="h6" sx={{ mt: 1.5, fontWeight: 800, overflowWrap: 'anywhere' }}>{notice.title}</Typography><IconButton onClick={close} aria-label="Close notice" sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded /></IconButton></DialogTitle>
    <DialogContent><Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {notice.status !== 'active' && <Alert severity={notice.status === 'completed' ? 'success' : 'info'}>This notice is {notice.status}.{notice.completed_at && ` Completed by ${notice.completed_by_name || 'a team member'} on ${time(notice.completed_at)}.`}</Alert>}
      <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.75, overflowWrap: 'anywhere' }}>{notice.body}</Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}><Chip label={notice.team_name || 'Everyone · all field staff'} />{notice.tower_id && <Button component={Link} to={`/towers/${notice.tower_id}`} startIcon={<CellTowerRounded />} onClick={followTower}>{notice.tower_name}</Button>}</Stack>
      {(notice.owner_name || notice.due_on || notice.expires_on) && <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 2 }}>
        {notice.owner_name && <Typography variant="body2"><b>Action owner:</b> {notice.owner_name}</Typography>}
        {notice.due_on && <Typography variant="body2"><b>Due:</b> {notice.due_on}</Typography>}
        {notice.expires_on && <Typography variant="body2"><b>Visible through:</b> {notice.expires_on} (Oman)</Typography>}
      </Box>}
      <Typography variant="caption" color="text.secondary">Posted by {notice.author_name} · {time(notice.created_at)}{notice.revision > 1 ? ` · Edited ${time(notice.updated_at)} · Version ${notice.revision}` : ''}</Typography>
      {notice.can_manage && <><Divider /><Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<EditRounded />} disabled={busy} onClick={edit}>Edit notice</Button>
        <Button size="small" disabled={busy} onClick={() => setReceipts(v => !v)}>{receipts ? 'Hide acknowledgements' : `Acknowledgements (${notice.acknowledgement_count})`}</Button>
        <Button size="small" startIcon={<Inventory2Outlined />} disabled={busy} onClick={() => act(notice.status === 'archived' ? 'restore' : 'archive')}>{notice.status === 'archived' ? 'Restore' : 'Archive'}</Button>
        {notice.completed_at && <Button size="small" disabled={busy} onClick={() => act('reopen')}>Reopen action</Button>}
      </Stack>{receipts && <NoticeReceipts notice={notice} />}</>}
    </Stack></DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>{notice.status === 'active' && <>
      <Button variant={notice.can_complete ? 'outlined' : 'contained'} startIcon={<CheckCircleOutlineRounded />} disabled={busy || notice.acknowledged} onClick={() => act('acknowledge')}>{notice.acknowledged ? 'Acknowledged' : 'Acknowledge'}</Button>
      {notice.can_complete && <Button variant="contained" color="success" startIcon={<AssignmentTurnedInRounded />} disabled={busy} onClick={() => act('complete')}>Mark action done</Button>}
    </>}<Button disabled={busy} onClick={close}>Close</Button></DialogActions>
  </Dialog>;
}

function NoticeLibrary({ close, open, create, canPublish }: { close: () => void; open: (notice: FieldNotice) => void; create: () => void; canPublish: boolean }) {
  const [state, setState] = useState('active');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useNotices({ state, search, category, offset, limit: 20 });
  return <Dialog open onClose={close} fullWidth maxWidth="md">
    <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>Field Noticeboard<IconButton onClick={close} aria-label="Close noticeboard"><CloseRounded /></IconButton></DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Tabs value={state} onChange={(_, value) => { setState(value); setOffset(0); }}><Tab value="active" label="Active notices" /><Tab value="history" label="History" /></Tabs>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><TextField fullWidth size="small" label="Search notices" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} slotProps={{ input: { startAdornment: <SearchRounded sx={{ mr: 1, color: 'text.secondary' }} /> } }} /><TextField size="small" select label="Type" value={category} onChange={e => { setCategory(e.target.value); setOffset(0); }} sx={{ minWidth: 170 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}><MenuItem value="">All types</MenuItem>{Object.entries(appearance).map(([key, value]) => <MenuItem key={key} value={key}>{value.label}</MenuItem>)}</TextField></Stack>
      {state === 'history' && <Typography variant="body2" color="text.secondary">Completed, expired and archived notices stay here for reference.</Typography>}
      {query.isFetching && <LinearProgress />}{query.isError && <Alert severity="error" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>Could not load notices.</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, pt: 1 }}>{query.data?.items.map(note => <NoteCard key={note.id} note={note} open={() => open(note)} />)}</Box>
      {query.data?.total === 0 && <Typography sx={{ textAlign: 'center', py: 5 }} color="text.secondary">{search || category ? 'No notices match these filters.' : state === 'history' ? 'No past notices yet.' : 'No active notices. You’re up to date.'}</Typography>}
      {query.data && query.data.total > 20 && <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Button disabled={!offset} onClick={() => setOffset(v => Math.max(0, v - 20))}>Previous</Button><Typography variant="caption">{offset + 1}–{Math.min(offset + 20, query.data.total)} of {query.data.total}</Typography><Button disabled={offset + 20 >= query.data.total} onClick={() => setOffset(v => v + 20)}>Next</Button></Stack>}
    </Stack></DialogContent><DialogActions sx={{ px: 3, pb: 2 }}>{canPublish && <Button variant="contained" startIcon={<AddRounded />} onClick={create}>New notice</Button>}<Button onClick={close}>Close</Button></DialogActions>
  </Dialog>;
}

export function FieldNoticeboard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
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
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}><Box><Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 1 }}>FIELD ALERT{(query.data?.urgent_unacknowledged || 0) > 1 ? ` · ${query.data?.urgent_unacknowledged} need acknowledgement` : ''}</Typography><Typography sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{urgent.title}</Typography><Typography variant="caption">{urgent.team_name || 'All field staff'} · Please read before continuing your work.</Typography></Box><Button variant="contained" color="error" size="small" sx={{ flexShrink: 0 }} onClick={() => open(urgent)}>Read urgent notice</Button></Stack>
    </Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3, '@media (min-width: 1500px)': { gridTemplateColumns: 'minmax(0, 1fr) 330px', alignItems: 'start' } }}>
      <Box sx={{ minWidth: 0, gridRow: 2, '@media (min-width: 1500px)': { gridRow: 1, gridColumn: 1 } }}>{children}</Box>
      <Paper component="aside" aria-label="Field Noticeboard" variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', gridRow: 1, '@media (min-width: 1500px)': { gridColumn: 2, position: 'sticky', top: 88 }, bgcolor: 'background.paper' }}>
        <Box sx={{ px: 2.25, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Box sx={{ display: 'grid', placeItems: 'center', width: 35, height: 35, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}><PushPinRounded sx={{ fontSize: 19 }} /></Box><Box><Typography sx={{ fontWeight: 800, fontSize: 17 }}>Field Noticeboard</Typography><Typography variant="caption" color="text.secondary">The briefing before the work.</Typography></Box></Stack>{query.data?.can_publish && <Tooltip title="Publish a notice"><IconButton aria-label="New notice" onClick={() => setEditor(null)} size="small" sx={{ bgcolor: 'action.hover' }}><AddRounded /></IconButton></Tooltip>}</Stack>
        </Box>
        <Box sx={{ p: 2.25, backgroundImage: 'radial-gradient(rgba(110,140,145,.13) .7px, transparent .7px)', backgroundSize: '9px 9px', '@media (min-width: 1500px)': { maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' } }}>
          {query.isLoading && <LinearProgress aria-label="Loading noticeboard" />}
          {query.isError && <Alert severity="warning" action={<Button size="small" onClick={() => void query.refetch()}>Retry</Button>}>Noticeboard unavailable. Check your connection.</Alert>}
          {query.data && query.data.items.length === 0 && <Stack spacing={1.5} sx={{ textAlign: 'center', alignItems: 'center', py: 2 }}><StickyNote2Rounded sx={{ fontSize: 42, color: 'primary.light', transform: 'rotate(-8deg)' }} /><Typography sx={{ fontWeight: 750 }}>{query.data.can_publish ? 'Your next field briefing starts here' : 'You’re up to date'}</Typography><Typography variant="body2" color="text.secondary">{query.data.can_publish ? 'Pin a clear instruction, an important update, or the next action for your crew.' : 'Important instructions and team actions will be pinned here.'}</Typography>{query.data.can_publish && <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={() => setEditor(null)}>Create first notice</Button>}</Stack>}
          <Box sx={{ display: 'grid', gap: 2.25, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, '@media (min-width: 1500px)': { gridTemplateColumns: '1fr' } }}>{query.data?.items.map((note, index) => <Box key={note.id} sx={{ display: { xs: index === 0 ? 'block' : 'none', sm: 'block' } }}><NoteCard note={note} open={() => open(note)} /></Box>)}</Box>
        </Box>
        <Button fullWidth endIcon={<ArrowForwardRounded />} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider', borderRadius: 0 }} onClick={() => setLibrary(true)}>View all notices{query.data?.active_count ? ` · ${query.data.active_count} active` : ''}</Button>
      </Paper>
    </Box>
    {library && <NoticeLibrary close={() => setLibrary(false)} open={open} canPublish={Boolean(query.data?.can_publish)} create={() => setEditor(null)} />}
    {selected && <NoticeDetail key={`${selected.id}-${selected.revision}`} notice={selected} close={() => setSelected(null)} followTower={() => { setSelected(null); setLibrary(false); }} edit={() => setEditor(selected)} act={action => void act(action)} busy={change.isPending} error={error} />}
    {editor !== undefined && <NoticeEditor key={editor?.id || 'new'} notice={editor} onClose={() => { setEditor(undefined); setSelected(null); }} />}
    <Snackbar open={Boolean(toast)} message={toast} autoHideDuration={4500} onClose={() => setToast('')} />
  </>;
}
