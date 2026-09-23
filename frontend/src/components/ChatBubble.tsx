import { useState } from 'react';
import { Avatar, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import type { ChannelMessage } from '../api/types';
import { mediaUrl } from '../api/client';
import { ImageLightbox } from './ImageLightbox';
import { chatDate, initials } from '../utils/chat';
const colors = ['#176b6a', '#836028', '#6864a5', '#a65767', '#3a718e'];
export function ChatBubble({ message: m, own }: { message: ChannelMessage; own: boolean }) {
  const [photoOpen, setPhotoOpen] = useState(false);
  const base = `/api/community/channel/${m.id}`;
  const time = chatDate(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (m.kind === 'assign' || m.kind === 'unassign') return <Box sx={{ textAlign: 'center', my: 1 }}><Chip size="small" variant="outlined" label={`${m.author_name || 'Dispatch'} · ${m.kind === 'assign' ? 'assigned' : 'released'} ${m.tower_code || 'a tower'} · ${time}`} sx={{ maxWidth: '100%', height: 'auto', py: 0.5, '.MuiChip-label': { whiteSpace: 'normal' }, bgcolor: 'background.paper' }} /></Box>;
  return <Stack direction="row" spacing={1} sx={{ alignSelf: own ? 'flex-end' : 'flex-start', width: 'fit-content', maxWidth: { xs: '96%', md: '82%' }, alignItems: 'flex-end' }}>
    {!own && <Avatar sx={{ width: 30, height: 30, fontSize: 11, bgcolor: colors[(m.created_by || 0) % colors.length], display: { xs: 'none', sm: 'flex' } }}>{initials(m.author_name || 'Team')}</Avatar>}
    <Box sx={{ minWidth: 120, maxWidth: '100%', px: 1.75, py: 1.25, borderRadius: own ? '16px 16px 4px 16px' : '16px 16px 16px 4px', bgcolor: t => own ? (t.palette.mode === 'dark' ? '#174c43' : '#ddf3e9') : t.palette.background.paper, border: '1px solid', borderColor: t => alpha(t.palette.primary.main, 0.06), boxShadow: '0 2px 4px rgba(18,45,47,0.04)' }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'baseline', mb: 0.5 }}><Typography variant="caption" sx={{ fontWeight: 800, color: 'primary.main' }}>{own ? 'You' : m.author_name || 'Team member'}</Typography><Typography variant="caption" color="text.secondary">{m.team_name?.replace(/_/g,' ') || (m.author_role === 'admin' ? 'Admin' : 'Staff')}</Typography>{!['note','dispatch'].includes(m.kind) && <Chip size="small" color={['hotspot','help'].includes(m.kind) ? 'error' : 'warning'} variant="outlined" label={m.kind} sx={{ height: 20, fontSize: 10 }} />}</Stack>
      {m.has_photo && <Box component="button" aria-label={`View photo from ${m.author_name || 'team member'}`} onClick={() => setPhotoOpen(true)} sx={{ display: 'block', width: '100%', border: 0, p: 0, mt: 0.75, borderRadius: 2, overflow: 'hidden', bgcolor: '#152b32', cursor: 'zoom-in' }}><Box component="img" loading="lazy" alt="Shared photo" src={mediaUrl(`${base}/photo?thumb=true`,m.created_at)} sx={{ display: 'block', maxWidth: '100%', width: 340, maxHeight: 260, objectFit: 'contain' }} /></Box>}
      {m.has_video && <Box component="video" aria-label="Shared video" src={mediaUrl(`${base}/video`)} controls preload="metadata" sx={{ display: 'block', width: 340, maxWidth: '100%', maxHeight: 260, borderRadius: 2, bgcolor: '#152b32', my: 1 }} />}
      {m.has_audio && <Box sx={{ my: 1 }}><Typography variant="caption" color="text.secondary">Voice message{m.duration_seconds ? ` · ${Math.round(m.duration_seconds)}s` : ''}</Typography><Box component="audio" aria-label={`Voice message from ${m.author_name}`} src={mediaUrl(`${base}/audio`)} controls preload="none" sx={{ display: 'block', width: 290, maxWidth: '100%', height: 40 }} /></Box>}
      {m.has_file && <Button component="a" href={mediaUrl(`${base}/file`)} target="_blank" rel="noreferrer" startIcon={<InsertDriveFileRoundedIcon />} endIcon={<DownloadRoundedIcon />} sx={{ bgcolor: t => alpha(t.palette.primary.main,0.06), my: 1, p: 1.5, maxWidth: '100%', textAlign: 'left', textTransform: 'none', overflowWrap: 'anywhere' }}>{m.file_name || 'Download document'}{m.file_size ? ` · ${(m.file_size/1024).toFixed(0)} KB` : ''}</Button>}
      {m.body && !((m.has_photo && m.body === 'Photo') || (m.has_video && m.body === 'Video') || (m.has_audio && m.body === 'Voice note') || (m.has_file && m.body === m.file_name)) && <Typography variant="body2" dir="auto" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65, mt: 0.25 }}>{m.body}</Typography>}
      {m.latitude != null && m.longitude != null && <Button size="small" component="a" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${m.latitude},${m.longitude}`} startIcon={<LocationOnRoundedIcon />}>Shared location{m.tower_code ? ` · ${m.tower_code}` : ''}</Button>}
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center', mt: 0.5 }}><Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{time}</Typography>{own && <Tooltip title="Saved to the shared channel"><DoneRoundedIcon sx={{ fontSize: 14, color: 'primary.main' }} /></Tooltip>}</Stack>
    </Box>
    {photoOpen && <ImageLightbox open onClose={() => setPhotoOpen(false)} title={`Photo · ${m.author_name || 'Team member'}`} imageUrl={mediaUrl(`${base}/photo`,m.created_at)} />}
  </Stack>;
}
