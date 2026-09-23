import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Box, Button, Chip, Divider, FormControlLabel, IconButton, InputAdornment, LinearProgress, List, ListItemButton, ListItemText, Paper, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useTeams } from '../api/hooks';
import { useCommunityMessages } from '../api/community';
import { useAuth } from '../auth/AuthContext';
import { ChatBubble } from '../components/ChatBubble';
import { chatDate, initials } from '../utils/chat';
import { ChatComposer } from '../components/ChatComposer';

export function MessagesPage() {
  const { user } = useAuth();
  const { data: teams } = useTeams();
  const [team, setTeam] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [includeOps, setIncludeOps] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const olderHeight = useRef<{ height: number; top: number } | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setQuery(search.trim()), 300); return () => window.clearTimeout(t); }, [search]);
  const chat = useCommunityMessages(team, query, includeOps);
  const messages = useMemo(() => [...new Map((chat.data?.pages || []).flatMap(p => p.messages).map(m => [m.id,m])).values()].sort((a,b) => a.id-b.id), [chat.data]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    if (olderHeight.current) { el.scrollTop = olderHeight.current.top + el.scrollHeight - olderHeight.current.height; olderHeight.current = null; }
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const chooseTeam = (id?: number) => { stick.current = true; setTeam(id); setShowFilters(false); };
  const jump = () => { stick.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }); };
  const onSent = () => { stick.current = true; setTeam(undefined); setSearch(''); setQuery(''); jump(); };
  const activeTeams = (teams || []).filter(t => t.is_active);
  const teamName = activeTeams.find(t => t.id === team)?.name.replace(/_/g,' ');
  return <Stack spacing={2}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}><Box><Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>Messages</Typography><Typography variant="body2" color="text.secondary">Good work starts with a conversation.</Typography></Box><Chip icon={<GroupsRoundedIcon />} label="One shared space" variant="outlined" sx={{ display: { xs: 'none', sm: 'flex' } }} /></Stack>
    <Paper variant="outlined" sx={{ display: 'flex', height: { xs: 'calc(100dvh - 180px)', md: 'calc(100dvh - 205px)' }, minHeight: 360, borderRadius: '20px', overflow: 'hidden', boxShadow: '0 14px 50px rgba(18,58,64,0.06)' }}>
      <Stack sx={{ width: { xs: '100%', md: 255 }, flexShrink: 0, display: { xs: showFilters ? 'flex' : 'none', md: 'flex' }, borderRight: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ p: 2.5 }}><Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}><Typography variant="h6">Your community</Typography><IconButton aria-label="Close filters" onClick={() => setShowFilters(false)} sx={{ display: { md: 'none' } }}><CloseRoundedIcon /></IconButton></Stack><TextField size="small" placeholder="Find a team" value={teamSearch} onChange={e => setTeamSearch(e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Find a team' } }} /></Box>
        <List sx={{ px: 1.25, pt: 0, overflowY: 'auto', flex: 1 }}><ListItemButton selected={team === undefined} onClick={() => chooseTeam()} sx={{ borderRadius: 3, p: 1.5, mb: 2, gap: 1.5 }}><Avatar sx={{ bgcolor: '#147d72' }}><ForumRoundedIcon /></Avatar><ListItemText primary="Everyone" secondary="The common conversation" slotProps={{ primary: { sx: { fontWeight: 700 } }, secondary: { sx: { fontSize: 11 } } }} /></ListItemButton><Typography variant="overline" color="text.secondary" sx={{ px: 1.5, fontSize: 10, letterSpacing: 1.5 }}>FILTER BY TEAM</Typography>{activeTeams.filter(t => t.name.toLowerCase().includes(teamSearch.toLowerCase())).map(t => <ListItemButton selected={team === t.id} key={t.id} onClick={() => chooseTeam(t.id)} sx={{ borderRadius: 3, gap: 1.5, my: 0.5 }}><Avatar sx={{ bgcolor: 'action.selected', color: 'primary.main', width: 35, height: 35, fontSize: 11, fontWeight: 800 }}>{initials(t.name)}</Avatar><ListItemText primary={t.name.replace(/_/g,' ')} secondary={t.id === user?.team_id ? 'Your team' : 'Shared updates'} slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 600 } }, secondary: { sx: { fontSize: 10 } } }} /></ListItemButton>)}</List>
        <Box sx={{ p: 2.5, bgcolor: t => alpha(t.palette.primary.main,0.035) }}><Typography variant="subtitle2">Everyone belongs here</Typography><Typography variant="caption" color="text.secondary">Share a useful photo, ask a question, or send your crew some encouragement.</Typography><Divider sx={{ my: 1.5 }} /><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Avatar sx={{ width: 30, height: 30, bgcolor: '#147d72', fontSize: 11 }}>{initials(user?.full_name || user?.username || 'You')}</Avatar><Box><Typography variant="caption" sx={{ fontWeight: 700 }}>{user?.full_name || user?.username}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'capitalize' }}>{user?.role.replace(/_/g,' ')}</Typography></Box></Stack></Box>
      </Stack>
      <Stack sx={{ flex: 1, minWidth: 0, display: { xs: showFilters ? 'none' : 'flex', md: 'flex' } }}>
        <Stack direction="row" spacing={1.5} sx={{ p: { xs: 1.5, md: 2 }, bgcolor: t => t.palette.mode === 'dark' ? '#183a40' : '#f5faf8', alignItems: 'center' }}><IconButton aria-label="Show team filters" onClick={() => setShowFilters(true)} sx={{ display: { md: 'none' } }}><TuneRoundedIcon /></IconButton><Avatar sx={{ bgcolor: '#147d72', width: 42, height: 42, display: { xs: 'none', sm: 'flex' } }}><GroupsRoundedIcon /></Avatar><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 800 }}>Field community</Typography><Typography variant="caption" color="text.secondary">All teams, members & admins · shared conversation</Typography></Box><Tooltip title="Refresh conversation"><span><IconButton aria-label="Refresh conversation" disabled={chat.isFetching} onClick={() => void chat.refetch()}><RefreshRoundedIcon /></IconButton></span></Tooltip></Stack>
        <Stack direction="row" spacing={1} sx={{ px: 2, py: 1, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}><TextField size="small" value={search} placeholder="Search messages" onChange={e => { stick.current = true; setSearch(e.target.value); }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Search messages' } }} sx={{ flex: 1, minWidth: 140, '.MuiOutlinedInput-root': { fontSize: 12, borderRadius: 3 } }} /><FormControlLabel control={<Switch size="small" checked={includeOps} onChange={(_,v) => { stick.current = true; setIncludeOps(v); }} />} label={<Typography variant="caption">Tower updates</Typography>} sx={{ mr: 0 }} /></Stack>
        {team != null && <Alert severity="info" sx={{ py: 0, borderRadius: 0 }} action={<Button size="small" onClick={() => chooseTeam()}>Show all</Button>}>Viewing {teamName || 'this team'} · new messages still go to everyone.</Alert>}
        {chat.isFetching && <LinearProgress sx={{ height: 2 }} />}
        {chat.isError && <Alert severity="error" action={<Button onClick={() => void chat.refetch()}>Retry</Button>}>Conversation could not be refreshed. Check your connection.</Alert>}
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
          <Box ref={scroll} onScroll={() => { const el = scroll.current; if (el) { const bottom = el.scrollHeight-el.scrollTop-el.clientHeight < 100; stick.current = bottom; setAtBottom(bottom); } }} sx={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 1.5, p: { xs: 1.5, md: 3 }, bgcolor: t => t.palette.mode === 'dark' ? '#101f24' : '#edf3ef', backgroundImage: t => `radial-gradient(${alpha(t.palette.primary.main,0.045)} 1px, transparent 1px)`, backgroundSize: '18px 18px' }}>
            {chat.hasNextPage && <Button size="small" disabled={chat.isFetchingNextPage} sx={{ alignSelf: 'center', bgcolor: 'background.paper', borderRadius: 5 }} onClick={() => { if (scroll.current) olderHeight.current = { height: scroll.current.scrollHeight, top: scroll.current.scrollTop }; void chat.fetchNextPage().then(r => { if (r.isError) olderHeight.current = null; }); }}>{chat.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}</Button>}
            {!chat.isLoading && !chat.isError && !messages.length && <Stack sx={{ alignItems: 'center', justifyContent: 'center', flex: 1, textAlign: 'center', py: 4 }}><Avatar sx={{ width: 70, height: 70, bgcolor: t => alpha(t.palette.primary.main,0.1), color: 'primary.main', mb: 2 }}><ForumRoundedIcon sx={{ fontSize: 32 }} /></Avatar><Typography variant="h6">{query ? 'No messages found' : 'Make yourself at home'}</Typography><Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320, mt: 1 }}>{query ? 'Try another word or clear the team filter.' : 'A question, an idea, a moment from the field. This is your space to share it.'}</Typography></Stack>}
            {messages.map((m,i) => { const day = chatDate(m.created_at).toLocaleDateString(undefined,{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); const prev = i > 0 ? chatDate(messages[i-1].created_at).toLocaleDateString(undefined,{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''; return <Fragment key={m.id}>{day !== prev && <Chip label={day} size="small" sx={{ alignSelf: 'center', my: 1, bgcolor: 'background.paper', color: 'text.secondary', fontSize: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }} />}<ChatBubble message={m} own={m.created_by != null && m.created_by === user?.id} /></Fragment>; })}
          </Box>
          {!atBottom && <Button size="small" variant="contained" startIcon={<KeyboardArrowDownRoundedIcon />} onClick={jump} sx={{ position: 'absolute', bottom: 12, right: 18, borderRadius: 5 }}>Latest messages</Button>}
        </Box>
        <ChatComposer onSent={onSent} />
      </Stack>
    </Paper>
  </Stack>;
}
