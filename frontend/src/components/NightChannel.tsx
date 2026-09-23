import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import SendIcon from '@mui/icons-material/SendRounded';
import PhotoCameraIcon from '@mui/icons-material/PhotoCameraRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import RoomRoundedIcon from '@mui/icons-material/RoomRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { mediaUrl } from '../api/client';
import { usePostChannel, useTeamChannel, useTrackingChannel } from '../api/hooks';
import type { ChannelKind, ChannelMessage } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { requestBrowserLocation } from '../hooks/useFieldTracking';
import { VoiceNoteControls, VoiceNotePlayer } from './VoiceNoteControls';
import { matchingMessages, type OpsFilter } from '../utils/opsEvents';
import { StepBadge } from './StepBadge';

const KIND_CHIPS: { kind: ChannelKind; label: string; color: 'default' | 'warning' | 'error' | 'info' }[] = [
  { kind: 'access', label: 'Access', color: 'warning' },
  { kind: 'weather', label: 'Hold', color: 'warning' },
  { kind: 'skip', label: 'Skip', color: 'default' },
  { kind: 'hotspot', label: 'Hotspot', color: 'error' },
  { kind: 'help', label: 'Help', color: 'error' },
];

const KIND_LABEL: Record<string, string> = {
  note: 'Note',
  dispatch: 'Dispatch',
  access: 'Access',
  weather: 'Hold',
  skip: 'Skip',
  hotspot: 'Hotspot',
  help: 'Help',
  assign: 'Assigned',
  unassign: 'Unassigned',
};

function clock(iso: string) {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// wa.me wants digits only (no "+", spaces or dashes) — mobile numbers on file may have any of
// those, so strip everything but digits before building the deep link.
function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useHere() {
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    requestBrowserLocation((lat, lng) => setHere({ lat, lng }), undefined, false);
  }, []);
  return here;
}

export function MessageBody({
  msg,
  showTeam,
  onTower,
}: {
  msg: ChannelMessage;
  showTeam?: boolean;
  onTower?: (towerId: number, visitId: number | null) => void;
}) {
  const photo = msg.has_photo
    ? mediaUrl(`/api/community/channel/${msg.id}/photo?thumb=true`, msg.created_at)
    : null;
  const audio = msg.has_audio ? mediaUrl(`/api/community/channel/${msg.id}/audio`) : null;
  const video = msg.has_video ? mediaUrl(`/api/community/channel/${msg.id}/video`, msg.created_at) : null;
  const file = msg.has_file ? mediaUrl(`/api/community/channel/${msg.id}/file`, msg.created_at) : null;
  const hasLocation = msg.latitude != null && msg.longitude != null;
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 1.5,
        bgcolor:
          msg.kind === 'help' || msg.kind === 'hotspot' || msg.kind === 'unassign'
            ? 'rgba(211,47,47,0.08)'
            : msg.kind === 'assign'
              ? 'rgba(46,125,50,0.08)'
              : msg.kind === 'dispatch'
                ? 'rgba(2,136,209,0.08)'
                : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor:
          msg.kind === 'help' || msg.kind === 'hotspot' || msg.kind === 'unassign'
            ? 'error.light'
            : msg.kind === 'assign'
              ? 'success.light'
              : 'rgba(0,0,0,0.08)',
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.25 }}>
        {showTeam && msg.team_name && (
          <Chip size="small" label={msg.team_name} color="primary" variant="outlined" />
        )}
        <Chip size="small" label={KIND_LABEL[msg.kind] || msg.kind} />
        {msg.tower_code && (
          <Chip
            size="small"
            color="primary"
            label={msg.tower_code}
            clickable={Boolean(onTower && msg.tower_id)}
            onClick={() => {
              if (msg.tower_id && onTower) onTower(msg.tower_id, msg.visit_id);
            }}
          />
        )}
        {hasLocation && (
          <Chip
            size="small"
            icon={<RoomRoundedIcon fontSize="small" />}
            label="Location"
            component="a"
            href={`https://www.google.com/maps/search/?api=1&query=${msg.latitude},${msg.longitude}`}
            target="_blank"
            rel="noreferrer"
            clickable
            variant="outlined"
          />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {msg.author_name || 'Unknown'} · {clock(msg.created_at)}
        </Typography>
        {msg.author_mobile && (
          <Stack direction="row" spacing={0.25}>
            <Tooltip title={`Call ${msg.author_name || 'them'}`}>
              <IconButton size="small" component="a" href={`tel:${msg.author_mobile}`}>
                <CallRoundedIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
            <Tooltip title={`WhatsApp ${msg.author_name || 'them'}`}>
              <IconButton
                size="small"
                component="a"
                href={`https://wa.me/${digitsOnly(msg.author_mobile)}`}
                target="_blank"
                rel="noreferrer"
              >
                <WhatsAppIcon fontSize="inherit" sx={{ color: '#25D366' }} />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Stack>
      {msg.body && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {msg.body}
        </Typography>
      )}
      {photo && (
        <Box
          component="a"
          href={mediaUrl(`/api/community/channel/${msg.id}/photo`, msg.created_at)}
          target="_blank"
          rel="noreferrer"
          sx={{ display: 'block', mt: 0.75 }}
        >
          <Box
            component="img"
            src={photo}
            alt=""
            sx={{ maxWidth: '100%', maxHeight: 160, borderRadius: 1, objectFit: 'cover' }}
          />
        </Box>
      )}
      {video && (
        <Box
          component="video"
          controls
          preload="metadata"
          src={video}
          sx={{ display: 'block', mt: 0.75, maxWidth: '100%', maxHeight: 220, borderRadius: 1, bgcolor: 'common.black' }}
        />
      )}
      {file && (
        <Box
          component="a"
          href={file}
          download={msg.file_name || undefined}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: 0.75,
            p: 1,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            textDecoration: 'none',
            color: 'text.primary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <InsertDriveFileRoundedIcon color="action" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {msg.file_name || 'File'}
            </Typography>
            {msg.file_size != null && (
              <Typography variant="caption" color="text.secondary">
                {formatBytes(msg.file_size)}
              </Typography>
            )}
          </Box>
        </Box>
      )}
      {audio && <VoiceNotePlayer src={audio} duration={msg.duration_seconds} />}
    </Box>
  );
}

export function NightChannel({
  teamId,
  fieldDate,
  towers,
  compact,
  kindFilter,
  onTower,
  step,
}: {
  teamId: number;
  fieldDate?: string;
  towers?: { id: number; tower_id: string }[];
  compact?: boolean;
  kindFilter?: OpsFilter;
  onTower?: (towerId: number, visitId: number | null) => void;
  step?: number;
}) {
  const { user } = useAuth();
  const here = useHere();
  const { data, isLoading } = useTeamChannel(teamId, fieldDate);
  const channel = usePostChannel(teamId);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<ChannelKind>(user?.role === 'admin' || user?.role === 'reviewer' ? 'dispatch' : 'note');
  const [towerId, setTowerId] = useState('');
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
  const visible = matchingMessages(data || [], kindFilter || 'all');

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [visible.length]);

  const loc = {
    latitude: here?.lat,
    longitude: here?.lng,
    tower_id: towerId ? Number(towerId) : undefined,
  };

  const send = (k: ChannelKind, body?: string) => {
    const text = (body ?? draft).trim();
    channel.post.mutate(
      { kind: k, body: text, ...loc },
      { onSuccess: () => setDraft('') },
    );
    setKind(k);
  };

  return (
    <Accordion defaultExpanded disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, width: '100%', pr: 1 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            {step != null && <StepBadge n={step} />}
            <ForumRoundedIcon color="primary" />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Tonight
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Shared with dispatch. Tagged to the nearest tower when GPS is on.
              </Typography>
            </Box>
          </Stack>
          <Chip size="small" label={`${data?.length || 0} messages`} variant="outlined" />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        {isLoading && <LinearProgress sx={{ mb: 1 }} />}
        <Box
          ref={listRef}
          sx={{
            maxHeight: compact ? 220 : 320,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            mb: 1.5,
            pr: 0.5,
          }}
        >
          {(data || []).length === 0 && !isLoading && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No messages yet tonight. Access problem, wind hold, or a hotspot — send it here instead of WhatsApp.
            </Typography>
          )}
          {visible.length === 0 && (data || []).length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: 'center' }}>
              No {kindFilter} messages in this filter.
            </Typography>
          )}
          {visible.map((msg) => (
            <MessageBody key={msg.id} msg={msg} onTower={onTower} />
          ))}
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', mb: 1 }}>
          {KIND_CHIPS.map((c) => (
            <Chip
              key={c.kind}
              size="small"
              label={c.label}
              color={c.color}
              variant={kind === c.kind ? 'filled' : 'outlined'}
              disabled={sending}
              onClick={() => send(c.kind, draft)}
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {towers && towers.length > 0 && (
            <TextField
              select
              size="small"
              label="Tower"
              value={towerId}
              onChange={(e) => setTowerId(e.target.value)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">Auto (GPS)</MenuItem>
              {towers.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.tower_id}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            size="small"
            placeholder="Message dispatch / the rest of the crew"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) send(kind === 'dispatch' ? 'dispatch' : 'note');
              }
            }}
            sx={{ flex: 1, minWidth: 160 }}
          />
          <Tooltip title="Send">
            <span>
              <IconButton
                color="primary"
                disabled={sending || !draft.trim()}
                onClick={() => send(kind === 'dispatch' ? 'dispatch' : 'note')}
              >
                <SendIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Photo">
            <span>
              <IconButton disabled={sending} onClick={() => photoRef.current?.click()}>
                <PhotoCameraIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Video">
            <span>
              <IconButton disabled={sending} onClick={() => videoRef.current?.click()}>
                <VideocamRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Attach file">
            <span>
              <IconButton disabled={sending} onClick={() => fileRef.current?.click()}>
                <AttachFileRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={here ? 'Share my location' : 'Waiting for GPS…'}>
            <span>
              <IconButton
                disabled={sending || !here}
                onClick={() => send(kind === 'dispatch' ? 'dispatch' : 'note', draft.trim() || '📍 Shared location')}
              >
                <RoomRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <VoiceNoteControls
            disabled={sending}
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
                channel.photo.mutate({
                  file,
                  kind: kind === 'dispatch' ? 'dispatch' : 'note',
                  body: draft.trim() || undefined,
                  ...loc,
                });
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
                channel.video.mutate({
                  file,
                  kind: kind === 'dispatch' ? 'dispatch' : 'note',
                  body: draft.trim() || undefined,
                  ...loc,
                });
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
                channel.file.mutate({
                  file,
                  kind: kind === 'dispatch' ? 'dispatch' : 'note',
                  body: draft.trim() || undefined,
                  ...loc,
                });
                setDraft('');
              }
              e.target.value = '';
            }}
          />
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function DispatchChannelFeed({
  fieldDate,
  teamId,
  kindFilter,
  messages,
  onTower,
}: {
  fieldDate?: string;
  teamId?: number;
  kindFilter?: OpsFilter;
  messages?: ChannelMessage[];
  onTower?: (towerId: number, visitId: number | null, teamId: number) => void;
}) {
  const query = useTrackingChannel(fieldDate, teamId, messages === undefined);
  const data = messages ?? query.data;
  const isLoading = messages ? false : query.isLoading;
  const listRef = useRef<HTMLDivElement>(null);
  const visible = matchingMessages(data || [], kindFilter || 'all');
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [visible.length]);
  const helpCount = (data || []).filter((m) => m.kind === 'help' || m.kind === 'hotspot').length;
  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Crew channel
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {teamId ? 'This team tonight' : 'All crews tonight'} — same thread they see on their phones.
            </Typography>
          </Box>
          {helpCount > 0 && <Chip size="small" color="error" label={`${helpCount} hotspot/help`} />}
        </Stack>
        {isLoading && <LinearProgress sx={{ mb: 1 }} />}
        <Box ref={listRef} sx={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {(data || []).length === 0 && !isLoading && (
            <Alert severity="info">No crew messages yet this field night.</Alert>
          )}
          {visible.length === 0 && (data || []).length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: 'center' }}>
              No messages match this filter.
            </Typography>
          )}
          {visible.map((msg) => (
            <MessageBody
              key={msg.id}
              msg={msg}
              showTeam={!teamId}
              onTower={(tid, vid) => { if (msg.team_id != null) onTower?.(tid, vid, msg.team_id); }}
            />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
