import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import InsertEmoticonRoundedIcon from '@mui/icons-material/InsertEmoticonRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded';
import { useSendCommunityMessage } from '../api/community';
import { reportError } from '../utils/reportLibrary';
import { VoiceNoteControls } from './VoiceNoteControls';
import { isQueued } from '../offline/types';

const emojis = ['😀','😊','😂','😎','🤝','👍','👏','🙌','💪','🙏','✅','⚠️','❓','💡','📍','📸','🔧','⚡','🔥','🎉','❤️','👀','🚧','🗼'];
type Attachment = { file: File; kind: 'photo' | 'video' | 'file' | 'voice'; url: string; duration?: number };
export function ChatComposer({ onSent }: { onSent: () => void }) {
  const send = useSendCommunityMessage();
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [queued, setQueued] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [attachAnchor, setAttachAnchor] = useState<HTMLElement | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedType = useRef<'photo' | 'video' | 'file'>('photo');
  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url); }, [attachment]);
  const add = (file: File, kind: Attachment['kind'], duration?: number) => { setAttachment({ file, kind, duration, url: URL.createObjectURL(file) }); setError(''); };
  const submit = async () => {
    if (send.isPending || (!draft.trim() && !attachment && !location)) return;
    const form = new FormData();
    form.set('body', draft.trim() || (location ? '📍 Shared location' : ''));
    if (attachment) { form.set('file', attachment.file); form.set('attachment_type', attachment.kind); if (attachment.duration) form.set('duration_seconds', String(attachment.duration)); }
    if (location) { form.set('latitude', String(location.lat)); form.set('longitude', String(location.lng)); }
    setError('');
    try { const result = await send.mutateAsync(form); setQueued(isQueued(result)); setDraft(''); setAttachment(null); setLocation(null); onSent(); input.current?.focus(); }
    catch (err) { setError(await reportError(err, 'Message could not be sent. Your draft is still here; reconnect and try again.')); }
  };
  const choose = (kind: 'photo' | 'video' | 'file') => {
    selectedType.current = kind;
    if (fileInput.current) { fileInput.current.accept = kind === 'photo' ? 'image/*' : kind === 'video' ? 'video/*' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'; fileInput.current.click(); }
    setAttachAnchor(null);
  };
  const locate = () => {
    setAttachAnchor(null); setLocating(true); setError('');
    if (!navigator.geolocation) { setError('Location is not available on this device.'); setLocating(false); return; }
    navigator.geolocation.getCurrentPosition(p => { setLocation({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); }, () => { setError('Could not get your location. Check location permissions and try again.'); setLocating(false); }, { timeout: 15000, enableHighAccuracy: true });
  };
  return <Box sx={{ p: { xs: 1, md: 2 }, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider' }}>
    {send.isPending && <LinearProgress sx={{ mb: 1 }} />}
    {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1 }}>{error}</Alert>}
    {queued && <Alert severity="info" onClose={() => setQueued(false)} sx={{ mb: 1 }}>Saved on this device. Your message will send when the connection returns.</Alert>}
    {attachment && <Stack direction="row" spacing={1.5} sx={{ p: 1.25, mb: 1.5, bgcolor: 'action.hover', borderRadius: 2, alignItems: 'center' }}>
      {attachment.kind === 'photo' && <Box component="img" src={attachment.url} alt="Photo to send" sx={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 1 }} />}
      {attachment.kind === 'video' && <Box component="video" src={attachment.url} controls preload="metadata" sx={{ width: 140, maxHeight: 90, borderRadius: 1 }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption" color="primary" sx={{ fontWeight: 700 }}>Ready to send · {attachment.kind === 'voice' ? 'Voice note' : attachment.kind}</Typography><Typography variant="body2" noWrap>{attachment.file.name}</Typography>{attachment.kind === 'voice' && <Box component="audio" src={attachment.url} controls sx={{ width: '100%', height: 35 }} />}</Box>
      <IconButton disabled={send.isPending} aria-label="Remove attachment" onClick={() => setAttachment(null)}><CloseRoundedIcon /></IconButton>
    </Stack>}
    {location && <Chip size="small" icon={<LocationOnRoundedIcon />} label="Location ready to share" onDelete={send.isPending ? undefined : () => setLocation(null)} sx={{ mb: 1 }} />}
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-end' }}>
      <Tooltip title="Add emoji"><span><IconButton disabled={send.isPending} aria-label="Add emoji" onClick={e => setEmojiAnchor(e.currentTarget)}><InsertEmoticonRoundedIcon /></IconButton></span></Tooltip>
      <Tooltip title="Share attachment"><span><IconButton disabled={send.isPending || locating} aria-label="Share attachment" onClick={e => setAttachAnchor(e.currentTarget)}><AddRoundedIcon /></IconButton></span></Tooltip>
      <TextField inputRef={input} multiline minRows={1} maxRows={5} fullWidth placeholder="Message everyone…" value={draft} disabled={send.isPending} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); void submit(); } }} slotProps={{ htmlInput: { maxLength: 10000, 'aria-label': 'Message everyone' } }} sx={{ '.MuiOutlinedInput-root': { borderRadius: 3, bgcolor: 'action.hover', fontSize: 14, py: 1.25 }, '.MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' } }} />
      <VoiceNoteControls compact disabled={send.isPending} onRecorded={(blob,duration) => add(new File([blob], `Voice note.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`,{ type: blob.type }), 'voice', duration)} />
      <Tooltip title="Send message"><span><IconButton aria-label="Send message" disabled={send.isPending || (!draft.trim() && !attachment && !location)} onClick={() => void submit()} sx={{ width: 42, height: 42, color: '#fff', bgcolor: '#147d72', '&:hover': { bgcolor: '#10685f' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}><SendRoundedIcon sx={{ fontSize: 21 }} /></IconButton></span></Tooltip>
    </Stack>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, pl: 1, fontSize: 10 }}>{locating ? 'Getting your location…' : 'Shared with all teams · Photos, video, documents and voice notes'}</Typography>
    <input hidden type="file" ref={fileInput} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) add(f, selectedType.current); }} />
    <Popover open={!!emojiAnchor} anchorEl={emojiAnchor} onClose={() => setEmojiAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}><Box sx={{ p: 2, width: 265 }}><Typography variant="subtitle2" sx={{ mb: 1 }}>A little expression</Typography><Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)' }}>{emojis.map(emoji => <IconButton key={emoji} aria-label={`Insert ${emoji}`} sx={{ fontSize: 23 }} onClick={() => { const start = input.current?.selectionStart ?? draft.length; const end = input.current?.selectionEnd ?? start; setDraft(draft.slice(0,start) + emoji + draft.slice(end)); setEmojiAnchor(null); input.current?.focus(); }}>{emoji}</IconButton>)}</Box></Box></Popover>
    <Popover open={!!attachAnchor} anchorEl={attachAnchor} onClose={() => setAttachAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}><Stack spacing={0.5} sx={{ p: 1.5, minWidth: 190 }}><Button startIcon={<ImageRoundedIcon />} onClick={() => choose('photo')}>Photo</Button><Button startIcon={<VideocamRoundedIcon />} onClick={() => choose('video')}>Video</Button><Button startIcon={<DescriptionRoundedIcon />} onClick={() => choose('file')}>Document</Button><Button startIcon={<LocationOnRoundedIcon />} onClick={locate}>My location</Button></Stack></Popover>
  </Box>;
}
