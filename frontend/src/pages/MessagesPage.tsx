import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Chip,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/SendRounded';
import PhotoCameraIcon from '@mui/icons-material/PhotoCameraRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import RoomRoundedIcon from '@mui/icons-material/RoomRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import { useTeams, useTrackingChannel, usePostChannel } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { MessageBody } from '../components/NightChannel';
import { VoiceNoteControls } from '../components/VoiceNoteControls';
import { requestBrowserLocation } from '../hooks/useFieldTracking';
import type { ChannelKind } from '../api/types';

const KIND_CHIPS: { kind: ChannelKind; label: string; color: 'default' | 'warning' | 'error' | 'info' }[] = [
  { kind: 'access', label: 'Access', color: 'warning' },
  { kind: 'weather', label: 'Hold', color: 'warning' },
  { kind: 'skip', label: 'Skip', color: 'default' },
  { kind: 'hotspot', label: 'Hotspot', color: 'error' },
  { kind: 'help', label: 'Help', color: 'error' },
];

function useHere() {
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    requestBrowserLocation((lat, lng) => setHere({ lat, lng }), undefined, false);
  }, []);
  return here;
}

/** The company-wide "one open channel" team chat — every signed-in user sees every crew's
 * traffic (see routers/channel.tracking_channel_feed), same messages/photos/voice notes the
 * existing per-team "Tonight" widget (NightChannel.tsx) already sends, now with video and file
 * attachments too, in its own dedicated place instead of buried inside Field Tracker/Team Detail. */
export function MessagesPage() {
  const { user } = useAuth();
  const { data: teams } = useTeams();
  const here = useHere();
  const [selected, setSelected] = useState<number | 'all'>('all');
  const { data, isLoading } = useTrackingChannel(undefined, selected === 'all' ? undefined : selected);

  // Posting is still per-team (see routers/channel.py) — a crew member always posts as their own
  // team; an admin/reviewer with no home team must pick a specific team from the list first.
  const composeTeamId = selected === 'all' ? user?.team_id ?? null : selected;
  const canPost = composeTeamId != null;
  const channel = usePostChannel(composeTeamId || 0);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<ChannelKind>(user?.role === 'admin' || user?.role === 'reviewer' ? 'dispatch' : 'note');

  const listRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sending =
    channel.post.isPending ||
    channel.photo.isPending ||
    channel.voice.isPending ||
    channel.video.isPending ||
    channel.file.isPending;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [data?.length]);

  const loc = { latitude: here?.lat, longitude: here?.lng };

  const send = (k: ChannelKind, body?: string) => {
    if (!canPost) return;
    const text = (body ?? draft).trim();
    channel.post.mutate({ kind: k, body: text, ...loc }, { onSuccess: () => setDraft('') });
    setKind(k);
  };

  const activeTeams = useMemo(() => (teams || []).filter((t) => t.is_active), [teams]);
  const selectedTeamName = selected === 'all' ? 'All crews' : activeTeams.find((t) => t.id === selected)?.name || 'Team';

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Messages
        </Typography>
        <Typography color="text.secondary">
          One shared channel for every crew tonight — text, photos, video, files, voice notes, and
          location, all in one place instead of scattered across personal phones.
        </Typography>
      </Box>

      <Stack
        direction="row"
        spacing={0}
        sx={{
          height: 'calc(100vh - 230px)',
          minHeight: 480,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ width: 260, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider', overflowY: 'auto', bgcolor: 'background.paper' }}>
          <List dense disablePadding>
            <ListItemButton selected={selected === 'all'} onClick={() => setSelected('all')}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                  <ForumRoundedIcon fontSize="small" />
                </Avatar>
              </ListItemIcon>
              <ListItemText primary="All crews" secondary="Everyone, tonight" />
            </ListItemButton>
            {activeTeams.map((t) => (
              <ListItemButton key={t.id} selected={selected === t.id} onClick={() => setSelected(t.id)}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Avatar sx={{ width: 32, height: 32, bgcolor: 'action.selected', color: 'text.primary' }}>
                    <GroupsRoundedIcon fontSize="small" />
                  </Avatar>
                </ListItemIcon>
                <ListItemText primary={t.name} secondary={t.id === user?.team_id ? 'Your team' : undefined} />
              </ListItemButton>
            ))}
          </List>
        </Box>

        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontWeight: 700 }}>{selectedTeamName}</Typography>
            <Typography variant="caption" color="text.secondary">
              {selected === 'all' ? 'Read-only mix of every crew — posts go to your own team' : 'This team, tonight'}
            </Typography>
          </Box>

          {isLoading && <LinearProgress />}
          <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {!isLoading && (data || []).length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                No messages yet tonight. Send a note, a photo, or your location to get started.
              </Typography>
            )}
            {(data || []).map((msg) => (
              <MessageBody key={msg.id} msg={msg} showTeam={selected === 'all'} />
            ))}
          </Box>

          <Box sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
            {!canPost && (
              <Alert severity="info" sx={{ mb: 1 }}>
                Pick a team on the left to post as — you don't have a home team of your own.
              </Alert>
            )}
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', mb: 1 }}>
              {KIND_CHIPS.map((c) => (
                <Chip
                  key={c.kind}
                  size="small"
                  label={c.label}
                  color={c.color}
                  variant={kind === c.kind ? 'filled' : 'outlined'}
                  disabled={sending || !canPost}
                  onClick={() => send(c.kind, draft)}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                size="small"
                placeholder={canPost ? 'Message the crew…' : 'Select a team to post'}
                value={draft}
                disabled={!canPost}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (draft.trim()) send(kind === 'dispatch' ? 'dispatch' : 'note');
                  }
                }}
                sx={{ flex: 1 }}
              />
              <Tooltip title="Send">
                <span>
                  <IconButton
                    color="primary"
                    disabled={sending || !canPost || !draft.trim()}
                    onClick={() => send(kind === 'dispatch' ? 'dispatch' : 'note')}
                  >
                    <SendIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Photo">
                <span>
                  <IconButton disabled={sending || !canPost} onClick={() => photoRef.current?.click()}>
                    <PhotoCameraIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Video">
                <span>
                  <IconButton disabled={sending || !canPost} onClick={() => videoRef.current?.click()}>
                    <VideocamRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Attach file">
                <span>
                  <IconButton disabled={sending || !canPost} onClick={() => fileRef.current?.click()}>
                    <AttachFileRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={here ? 'Share my location' : 'Waiting for GPS…'}>
                <span>
                  <IconButton
                    disabled={sending || !canPost || !here}
                    onClick={() => send(kind === 'dispatch' ? 'dispatch' : 'note', draft.trim() || '📍 Shared location')}
                  >
                    <RoomRoundedIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <VoiceNoteControls
                disabled={sending || !canPost}
                saving={channel.voice.isPending}
                onRecorded={(blob, duration, live) => {
                  channel.voice.mutate({
                    file: blob,
                    duration_seconds: duration,
                    kind: kind === 'dispatch' ? 'dispatch' : 'note',
                    body: draft.trim() || live || undefined,
                    ...loc,
                  });
                  setDraft('');
                }}
              />
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    channel.photo.mutate({ file, kind: kind === 'dispatch' ? 'dispatch' : 'note', body: draft.trim() || undefined, ...loc });
                    setDraft('');
                  }
                  e.target.value = '';
                }}
              />
              <input
                ref={videoRef}
                type="file"
                accept="video/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    channel.video.mutate({ file, kind: kind === 'dispatch' ? 'dispatch' : 'note', body: draft.trim() || undefined, ...loc });
                    setDraft('');
                  }
                  e.target.value = '';
                }}
              />
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    channel.file.mutate({ file, kind: kind === 'dispatch' ? 'dispatch' : 'note', body: draft.trim() || undefined, ...loc });
                    setDraft('');
                  }
                  e.target.value = '';
                }}
              />
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </Stack>
  );
}
