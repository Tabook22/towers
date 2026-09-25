import { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Badge, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, LinearProgress, MenuItem, Paper, Portal, Stack, TextField, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ScreenShareRounded from '@mui/icons-material/ScreenShareRounded';
import StopScreenShareRounded from '@mui/icons-material/StopScreenShareRounded';
import HeadsetMicRounded from '@mui/icons-material/HeadsetMicRounded';
import MicRounded from '@mui/icons-material/MicRounded';
import MicOffRounded from '@mui/icons-material/MicOffRounded';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import CallEndRounded from '@mui/icons-material/CallEndRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import TouchAppRounded from '@mui/icons-material/TouchAppRounded';
import { apiClient } from '../api/client';
import { helpError, useLiveHelp, type HelpContact } from '../hooks/useLiveHelp';

function ShareVideo({ stream, label, onPoint, point }: { stream: MediaStream | null; label: string; onPoint?: (x: number, y: number) => void; point?: { x: number; y: number; at: number } | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [expiredPoint, setExpiredPoint] = useState<number | null>(null);
  useEffect(() => { if (video.current) video.current.srcObject = stream; }, [stream]);
  useEffect(() => { const timer = setTimeout(() => setExpiredPoint(point?.at || null), 3500); return () => clearTimeout(timer); }, [point]);
  return <Box sx={{ position: 'relative', bgcolor: '#08171d', borderRadius: 2, overflow: 'hidden' }}>
    <Box sx={{ position: 'relative', aspectRatio: aspect, maxHeight: '55vh', mx: 'auto', width: '100%' }}>
      <video ref={video} autoPlay muted playsInline aria-label={label} onLoadedMetadata={() => { if (video.current?.videoHeight) setAspect(video.current.videoWidth / video.current.videoHeight); }}
        onClick={e => { const v = video.current; if (!v || !onPoint || !v.videoWidth) return; const b = v.getBoundingClientRect(); const scale = Math.min(b.width / v.videoWidth, b.height / v.videoHeight); const w = v.videoWidth * scale, h = v.videoHeight * scale; const x = (e.clientX - b.left - (b.width - w) / 2) / w, y = (e.clientY - b.top - (b.height - h) / 2) / h; if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPoint(x, y); }}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: onPoint ? 'crosshair' : undefined }} />
      {point && point.at !== expiredPoint && <svg aria-label="Your colleague is pointing here" viewBox={`0 0 ${aspect * 1000} 1000`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}><circle cx={point.x * aspect * 1000} cy={point.y * 1000} r="24" fill="#f19724" stroke="white" strokeWidth="6" /></svg>}
    </Box>
    <Stack direction="row" sx={{ px: 1.5, py: 1, alignItems: 'center', justifyContent: 'space-between', color: '#d6ecef' }}><Typography variant="caption">{label}</Typography><Tooltip title="View full screen"><IconButton size="small" aria-label={`Full screen: ${label}`} sx={{ color: 'inherit' }} onClick={() => { void video.current?.requestFullscreen?.().catch(() => undefined); }}><OpenInFullRounded fontSize="small" /></IconButton></Tooltip></Stack>
  </Box>;
}

export function LiveHelp({ userId }: { userId: number }) {
  const help = useLiveHelp(userId);
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<HelpContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pointing, setPointing] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const supportsScreen = !!navigator.mediaDevices?.getDisplayMedia;
  const connected = help.connection === 'Connected';
  const active = help.room?.status === 'active';
  const perform = async (work: () => Promise<unknown>) => { setBusy(true); help.setError(''); try { await work(); } catch (e) { help.setError(helpError(e)); } finally { setBusy(false); } };
  useEffect(() => {
    if (!open || help.room) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const load = async () => { setLoading(true); try { const { data } = await apiClient.get<HelpContact[]>('/api/live-help/contacts', { timeout: 10000 }); if (alive) setContacts(data); } catch (e) { if (alive) help.setError(helpError(e)); } finally { if (alive) { setLoading(false); timer = setTimeout(load, 10000); } } };
    void load(); return () => { alive = false; clearTimeout(timer); };
  }, [open, help.room?.id]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [help.lines.length]);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [help.room?.id]);
  useEffect(() => { if (audio.current) { audio.current.srcObject = help.remote; if (help.remote) void audio.current.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true)); } }, [help.remote, help.remoteMic]);
  useEffect(() => { if (!help.room) { setMessage(''); setPointing(false); } }, [help.room?.id]);
  const filtered = contacts.filter(c => (!team || c.team === team) && `${c.name} ${c.team} ${c.role}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.online && !b.busy) - Number(a.online && !a.busy) || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  const send = () => { try { help.chat(message); setMessage(''); } catch { help.setError('Chat is reconnecting. Please try sending again.'); } };
  return <>
    <Tooltip title={help.room ? 'Return to your live session' : 'Ask a colleague for live guidance'}><Button color="inherit" aria-label="Live help" onClick={() => setOpen(true)} sx={{ minWidth: { xs: 38, md: 100 }, px: 1.25, borderRadius: 5, bgcolor: help.room ? '#21816f' : 'rgba(255,255,255,.12)' }}><Badge variant="dot" color="warning" invisible={!help.incoming && !help.room}><HeadsetMicRounded /></Badge><Box component="span" sx={{ display: { xs: 'none', md: 'inline' }, ml: 1 }}>{help.room ? 'Live session' : 'Live help'}</Box></Button></Tooltip>
    <audio ref={audio} autoPlay />
    <Dialog open={!!help.incoming} fullWidth maxWidth="xs" aria-labelledby="live-invitation-title">
      <DialogTitle id="live-invitation-title">Someone needs your guidance</DialogTitle><DialogContent><Stack spacing={2}><Avatar sx={{ width: 64, height: 64, bgcolor: '#187c73' }}><HeadsetMicRounded fontSize="large" /></Avatar><Typography variant="h6">{help.incoming?.peer_name}</Typography><Typography>{help.incoming?.subject || 'Invited you to a private live-help session.'}</Typography><Alert severity="info">Accept to connect. Your microphone, camera and screen stay off until you choose to share them.</Alert><Typography variant="caption" color="text.secondary">Invitation expires after 90 seconds. Only the two of you can join.</Typography>{help.error && <Alert severity="error">{help.error}</Alert>}</Stack></DialogContent><DialogActions sx={{ p: 2 }}><Button disabled={busy} onClick={() => void perform(() => help.answer(false))}>Decline</Button><Button variant="contained" disabled={busy} startIcon={<HeadsetMicRounded />} onClick={() => { setOpen(true); void perform(() => help.answer(true)); }}>Accept invitation</Button></DialogActions>
    </Dialog>
    <Dialog open={open && !help.incoming} onClose={() => setOpen(false)} fullWidth maxWidth={help.room ? 'lg' : 'md'} fullScreen={mobile} aria-labelledby="live-help-title">
      <DialogTitle component="div" sx={{ bgcolor: '#123f4d', color: 'white', p: 2.5 }}><Stack direction="row" sx={{ gap: 1.5, alignItems: 'center' }}><Avatar sx={{ bgcolor: '#28766f' }}><HeadsetMicRounded /></Avatar><Box sx={{ flex: 1 }}><Typography id="live-help-title" variant="h6" sx={{ fontWeight: 800 }}>{help.room ? `Live with ${help.room.peer_name}` : 'A colleague, right beside you'}</Typography><Typography variant="caption" sx={{ color: '#cbe5e5' }}>{help.room ? help.room.subject || 'Private live guidance' : 'Screen sharing · voice · private chat'}</Typography></Box><IconButton aria-label={help.room ? 'Minimize live session' : 'Close live help'} sx={{ color: 'white' }} onClick={() => setOpen(false)}><CloseRounded /></IconButton></Stack></DialogTitle>
      <DialogContent ref={content} sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
        <Stack spacing={2} sx={{ pt: 2 }}>
          {help.error && <Alert severity="warning" onClose={() => help.setError('')}>{help.error}</Alert>}
          {help.notice && <Alert severity="info" onClose={() => help.setNotice('')}>{help.notice}</Alert>}
          {!help.room ? <>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Typography sx={{ fontWeight: 700, mb: .75 }}>Choose a person. Ask permission. Work through it together.</Typography><Typography variant="body2" color="text.secondary">Filter by team or Administration, then invite a colleague. They will see the request anywhere in this app while it is open. Each session is private to two people.</Typography></Paper>
            {help.elsewhere && <Alert severity="info">You already have a session in another tab or device. End it there before starting another.</Alert>}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><TextField select label="Team or administration" value={team} onChange={e => setTeam(e.target.value)} size="small" sx={{ minWidth: 220 }}><MenuItem value="">All teams & staff</MenuItem>{[...new Set(contacts.map(c => c.team))].sort().map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField><TextField fullWidth size="small" label="Find a person" value={search} onChange={e => setSearch(e.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment> } }} /></Stack>
            <TextField label="What do you need help with? (optional)" placeholder="For example: checking a thermal image on tower ARSD-93" value={subject} onChange={e => setSubject(e.target.value)} slotProps={{ htmlInput: { maxLength: 160 } }} size="small" />
            {loading && <LinearProgress />}
            <Stack spacing={1} sx={{ maxHeight: 350, overflowY: 'auto' }}>{filtered.map(c => <Paper variant="outlined" key={c.id} sx={{ p: 1.75, borderRadius: 2.5 }}><Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}><Avatar sx={{ bgcolor: c.online ? '#d9eee7' : 'action.hover', color: '#226b5b' }}>{c.name.slice(0, 1).toUpperCase()}</Avatar><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{c.name}</Typography><Typography variant="caption" color="text.secondary">{c.team} · {c.role.replace(/_/g, ' ')}</Typography><Typography variant="caption" sx={{ display: 'block', color: c.busy ? 'warning.main' : c.online ? 'success.main' : 'text.secondary' }}>{c.busy ? 'In a session' : c.online ? 'App recently active' : 'Not recently active — ask them to open the app'}</Typography></Box><Button variant={c.online ? 'contained' : 'outlined'} size="small" disabled={busy || c.busy || help.elsewhere} aria-label={`Invite ${c.name}`} onClick={() => void perform(() => help.invite(c, subject))}>Invite</Button></Stack></Paper>)}{!loading && filtered.length === 0 && <Typography color="text.secondary">No staff match your search. Try another team or name.</Typography>}</Stack>
            <Typography variant="caption" color="text.secondary">You choose a browser tab, window or screen each time. On phones that cannot share a screen, use the camera to show the field situation, or watch your colleague’s screen. Live sessions are not recorded by this app and do not provide remote control.</Typography>
          </> : <>
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}><Chip color={connected ? 'success' : 'default'} size="small" label={help.connection} /><Chip size="small" variant="outlined" label={help.source ? `You are sharing your ${help.source}` : 'Your screen & camera are off'} /><Typography variant="caption" color="text.secondary">{help.mic ? 'Your microphone is on' : 'Your microphone is off'}</Typography></Stack>
            {!active ? <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}><HeadsetMicRounded sx={{ color: '#238b7c', fontSize: 60 }} /><Typography variant="h6" sx={{ mt: 2 }}>Waiting for {help.room.peer_name}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>They need to accept your invitation. Nothing is being captured.</Typography><Typography variant="caption">No answer? The invitation expires automatically after 90 seconds.</Typography></Paper> : <>
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}><Tooltip title={supportsScreen ? 'Choose what your colleague can see' : 'Screen capture is unavailable in this browser; use Camera instead'}><span><Button variant="contained" startIcon={<ScreenShareRounded />} disabled={!connected || busy || !supportsScreen} onClick={() => void perform(() => help.share('screen'))}>{help.source === 'screen' ? 'Change screen' : 'Share screen'}</Button></span></Tooltip><Button variant="outlined" startIcon={<VideocamRounded />} disabled={!connected || busy || !navigator.mediaDevices?.getUserMedia} onClick={() => void perform(() => help.share('camera'))}>Camera</Button><Button variant="outlined" startIcon={help.mic ? <MicOffRounded /> : <MicRounded />} disabled={!connected || busy} onClick={() => void perform(help.toggleMic)}>{help.mic ? 'Mute' : 'Enable microphone'}</Button>{help.source && <Button color="error" startIcon={<StopScreenShareRounded />} onClick={() => void perform(help.stopSharing)}>Stop sharing</Button>}</Stack>
              {!supportsScreen && <Alert severity="info">This browser cannot capture your screen. You can still view a shared screen, talk, chat, and use your camera.</Alert>}
              {audioBlocked && <Button variant="outlined" onClick={() => { void audio.current?.play().then(() => setAudioBlocked(false)).catch(() => help.setError('Audio playback is blocked by the browser. Check your sound permissions.')); }}>Tap to hear your colleague</Button>}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(0,2fr) minmax(250px,1fr)' }, gap: 2 }}>
                <Stack spacing={1.5} sx={{ minWidth: 0 }}>{help.remoteSource ? <><ShareVideo stream={help.remote} label={`${help.room.peer_name} · ${help.remoteSource}`} onPoint={pointing ? (x, y) => { try { help.pointAt(x, y); } catch { help.setError('Pointing is temporarily unavailable while reconnecting.'); } } : undefined} /><Button size="small" startIcon={<TouchAppRounded />} aria-pressed={pointing} onClick={() => setPointing(v => !v)}>{pointing ? 'Pointing on — tap the shared view' : 'Point to something'}</Button><Typography variant="caption" color="text.secondary">Points appear on your colleague’s preview inside Live Help; they do not control their mouse.</Typography></> : <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 3, minHeight: 180, display: 'grid', placeContent: 'center' }}><ScreenShareRounded sx={{ mx: 'auto', color: '#288778', fontSize: 50, mb: 1 }} /><Typography sx={{ fontWeight: 700 }}>Ready when you are</Typography><Typography variant="body2" color="text.secondary">Either person can share a screen or camera using the buttons above.</Typography></Paper>}
                  {help.local && <ShareVideo stream={help.local} label={`Your ${help.source} · visible to ${help.room.peer_name}`} point={help.point} />}
                </Stack>
                <Paper variant="outlined" sx={{ borderRadius: 3, p: 2, display: 'flex', flexDirection: 'column', minHeight: 320, maxHeight: 520 }}><Typography sx={{ fontWeight: 800 }}>Session chat</Typography><Typography variant="caption" color="text.secondary">{help.remoteMic ? 'Colleague’s microphone is on' : 'Colleague’s microphone is off'} · not saved</Typography><Stack role="log" aria-label="Private session chat" aria-live="polite" spacing={1} sx={{ flex: 1, overflowY: 'auto', my: 2 }}>{help.lines.length === 0 && <Typography variant="body2" color="text.secondary">Use this private chat for a tower number, a question, or a short instruction.</Typography>}{help.lines.map(line => <Box key={line.id} sx={{ p: 1.25, borderRadius: 2, bgcolor: line.own ? 'primary.main' : 'action.hover', color: line.own ? 'primary.contrastText' : 'text.primary', alignSelf: line.own ? 'flex-end' : 'flex-start', maxWidth: '95%' }}><Typography variant="caption" sx={{ fontWeight: 700 }}>{line.own ? 'You' : help.room?.peer_name}</Typography><Typography variant="body2" dir="auto" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{line.text}</Typography></Box>)}<div ref={chatEnd} /></Stack><Stack direction="row" spacing={1}><TextField size="small" fullWidth multiline maxRows={3} label="Private message" value={message} disabled={!connected} onChange={e => setMessage(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /><IconButton aria-label="Send private message" color="primary" disabled={!connected || !message.trim()} onClick={send}><SendRounded /></IconButton></Stack></Paper>
              </Box>
              <Typography variant="caption" color="text.secondary">Only share what is needed. Stop sharing at any time. Sessions end after 45 minutes; leaving or losing the connection stops capture. For urgent safety instructions, confirm them verbally.</Typography>
            </>}
          </>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>{help.room ? <><Button onClick={() => setOpen(false)}>Minimize</Button><Button variant="contained" color="error" startIcon={<CallEndRounded />} onClick={() => void help.end()}>{active ? 'End session' : 'Cancel invitation'}</Button></> : <Button onClick={() => setOpen(false)}>Close</Button>}</DialogActions>
    </Dialog>
    {help.room && !open && <Portal><Paper elevation={5} sx={{ position: 'fixed', top: { xs: 62, sm: 72 }, right: 12, left: { xs: 12, sm: 'auto' }, zIndex: 1290, p: 1.25, borderRadius: 2, border: '1px solid #55a68f' }}><Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}><Chip size="small" color={help.source ? 'success' : 'default'} label={help.source ? `Sharing ${help.source}` : 'Live help'} /><Typography variant="caption">{help.room.peer_name} · {help.mic ? 'Mic on' : 'Mic off'}</Typography><Button size="small" onClick={() => setOpen(true)}>Open</Button>{help.source && <Button color="error" size="small" onClick={() => void perform(help.stopSharing)}>Stop sharing</Button>}<IconButton color="error" size="small" aria-label="End live session" onClick={() => void help.end()}><CallEndRounded /></IconButton></Stack></Paper></Portal>}
  </>;
}
