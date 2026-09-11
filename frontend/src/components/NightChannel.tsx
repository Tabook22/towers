import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import SendIcon from '@mui/icons-material/SendRounded';
import PhotoCameraIcon from '@mui/icons-material/PhotoCameraRounded';
import { mediaUrl } from '../api/client';
import { usePostChannel, useTeamChannel, useTrackingChannel } from '../api/hooks';
import type { ChannelKind, ChannelMessage } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { requestBrowserLocation } from '../hooks/useFieldTracking';
import { VoiceNoteControls, VoiceNotePlayer } from './VoiceNoteControls';
import { matchingMessages, type OpsFilter } from '../utils/opsEvents';

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
};

function clock(iso: string) {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function useHere() {
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    requestBrowserLocation((lat, lng) => setHere({ lat, lng }), undefined, false);
  }, []);
  return here;
}

function MessageBody({
  msg,
  showTeam,
  onTower,
}: {
  msg: ChannelMessage;
  showTeam?: boolean;
  onTower?: (towerId: number, visitId: number | null) => void;
}) {
  const photo = msg.has_photo
    ? mediaUrl(`/api/teams/${msg.team_id}/channel/${msg.id}/photo?thumb=true`, msg.created_at)
    : null;
  const audio = msg.has_audio ? mediaUrl(`/api/teams/${msg.team_id}/channel/${msg.id}/audio`) : null;
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 1.5,
        bgcolor:
          msg.kind === 'help' || msg.kind === 'hotspot'
            ? 'rgba(211,47,47,0.08)'
            : msg.kind === 'dispatch'
              ? 'rgba(2,136,209,0.08)'
              : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: msg.kind === 'help' || msg.kind === 'hotspot' ? 'error.light' : 'rgba(0,0,0,0.08)',
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
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {msg.author_name || 'Unknown'} · {clock(msg.created_at)}
        </Typography>
      </Stack>
      {msg.body && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {msg.body}
        </Typography>
      )}
      {photo && (
        <Box
          component="a"
          href={mediaUrl(`/api/teams/${msg.team_id}/channel/${msg.id}/photo`, msg.created_at)}
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
}: {
  teamId: number;
  fieldDate?: string;
  towers?: { id: number; tower_id: string }[];
  compact?: boolean;
  kindFilter?: OpsFilter;
  onTower?: (towerId: number, visitId: number | null) => void;
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
  const sending = channel.post.isPending || channel.photo.isPending || channel.voice.isPending;
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
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Tonight
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Shared with dispatch. Tagged to the nearest tower when GPS is on.
            </Typography>
          </Box>
          <Chip size="small" label={`${data?.length || 0} messages`} variant="outlined" />
        </Stack>
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
        </Stack>
      </CardContent>
    </Card>
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
              onTower={(tid, vid) => onTower?.(tid, vid, msg.team_id)}
            />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
