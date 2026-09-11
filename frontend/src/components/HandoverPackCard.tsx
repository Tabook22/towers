import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import FlagIcon from '@mui/icons-material/FlagRounded';
import PlaceIcon from '@mui/icons-material/PlaceRounded';
import DirectionsIcon from '@mui/icons-material/DirectionsRounded';
import { mediaUrl } from '../api/client';
import { useContinueLastNight, useEndOuting, useTeamHandover } from '../api/hooks';
import type { HandoverPack, HandoverTower, HandoverTowerStatus } from '../api/types';

const STATUS_COLOR: Record<HandoverTowerStatus, 'success' | 'warning' | 'info' | 'default'> = {
  completed: 'success',
  skipped: 'warning',
  in_progress: 'info',
  pending: 'default',
};

const STATUS_LABEL: Record<HandoverTowerStatus, string> = {
  completed: 'Done',
  skipped: 'Skipped',
  in_progress: 'Open',
  pending: 'Not started',
};

const EVENT_LABEL: Record<string, string> = {
  access: 'Access',
  weather: 'Hold',
  skip: 'Skip',
  hotspot: 'Hotspot',
  help: 'Help',
};

function clock(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mapsHref(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function remainingRows(pack: HandoverPack): HandoverTower[] {
  return pack.towers.filter((t) => t.status !== 'completed');
}

export function HandoverPackCard({
  teamId,
  fieldDate,
  canManage,
  compact,
  onShowTower,
}: {
  teamId: number;
  fieldDate?: string;
  canManage?: boolean;
  compact?: boolean;
  onShowTower?: (towerPk: number, visitId: number | null) => void;
}) {
  const { data: pack, isLoading, error } = useTeamHandover(teamId, fieldDate);
  const endOuting = useEndOuting(teamId);
  const continueNight = useContinueLastNight(teamId);
  const [endOpen, setEndOpen] = useState(false);
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const errText = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;

  const handleEnd = () => {
    setActionError(null);
    endOuting.mutate(
      { note: note.trim() || undefined, field_date: fieldDate },
      {
        onSuccess: () => {
          setEndOpen(false);
          setNote('');
        },
        onError: (err) => setActionError(errText(err, 'Could not end the outing')),
      },
    );
  };

  const handleContinue = (replace = false) => {
    setActionError(null);
    continueNight.mutate(
      { field_date: fieldDate, from_date: pack?.previous_field_date || undefined, replace },
      { onError: (err) => setActionError(errText(err, 'Could not continue last night')) },
    );
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Handover
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Close tonight and leave the next crew a start point — unfinished towers, skips, hotspots, and notes.
            </Typography>
          </Box>
          {canManage && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {pack && pack.previous_remaining > 0 && (
                <Button
                  variant="outlined"
                  onClick={() => handleContinue(false)}
                  disabled={continueNight.isPending}
                >
                  Continue last night · {pack.previous_remaining}
                </Button>
              )}
              <Button variant="contained" onClick={() => setEndOpen(true)} disabled={endOuting.isPending}>
                End outing
              </Button>
            </Stack>
          )}
        </Stack>

        {isLoading && <LinearProgress sx={{ mb: 1 }} />}
        {error && <Alert severity="error">Could not load the handover pack.</Alert>}
        {actionError && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}

        {pack && (
          <>
            <Typography variant="body2" sx={{ mb: 1.5, fontWeight: 600 }}>
              {pack.headline}
            </Typography>
            {pack.ended_at && (
              <Alert severity="success" sx={{ mb: 1.5 }}>
                Outing closed {clock(pack.ended_at)}
                {pack.ended_by_name ? ` by ${pack.ended_by_name}` : ''}.
                {pack.handover_note ? ` ${pack.handover_note}` : ''}
              </Alert>
            )}
            {pack.continued_from && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                Tonight was seeded from {pack.continued_from}.
              </Alert>
            )}

            <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Chip color="success" label={`${pack.completed} done`} />
              <Chip color="warning" label={`${pack.skipped} skipped`} />
              <Chip color="info" label={`${pack.in_progress} open`} />
              <Chip label={`${pack.pending} not started`} />
            </Stack>

            {pack.recommended && (
              <Alert
                icon={<FlagIcon />}
                severity="info"
                sx={{ mb: 1.5 }}
                action={
                  <Stack direction="row" spacing={0.5}>
                    {onShowTower && (
                      <Button
                        size="small"
                        onClick={() => onShowTower(pack.recommended!.id, pack.recommended!.visit_id)}
                      >
                        Show
                      </Button>
                    )}
                    {pack.recommended.visit_id && (
                      <Button size="small" component={RouterLink} to={`/visits/${pack.recommended.visit_id}`}>
                        Open
                      </Button>
                    )}
                    <Button
                      size="small"
                      href={mapsHref(pack.recommended.latitude, pack.recommended.longitude)}
                      target="_blank"
                      rel="noreferrer"
                      startIcon={<DirectionsIcon />}
                    >
                      Go
                    </Button>
                  </Stack>
                }
              >
                Start next at <strong>{pack.recommended.tower_id}</strong>
                {pack.recommended.area ? ` · ${pack.recommended.area}` : ''}. {pack.recommended.reason}
              </Alert>
            )}

            {pack.last_gps && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                <PlaceIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'text-bottom' }} />
                Last GPS {clock(pack.last_gps.recorded_at)}
                {pack.last_gps.user_name ? ` · ${pack.last_gps.user_name}` : ''}
              </Typography>
            )}

            {!compact && remainingRows(pack).length > 0 && (
              <TableContainer sx={{ mb: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tower</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Why</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {remainingRows(pack).map((t) => (
                      <TableRow key={t.id} hover>
                        <TableCell sx={{ fontWeight: 700 }}>{t.tower_id}</TableCell>
                        <TableCell>
                          <Chip size="small" color={STATUS_COLOR[t.status]} label={STATUS_LABEL[t.status]} />
                        </TableCell>
                        <TableCell>
                          {t.skip_reason ||
                            (t.images_pending ? `${t.images_pending} images pending` : t.visit_status) ||
                            '—'}
                        </TableCell>
                        <TableCell align="right">
                          {t.visit_id ? (
                            <Button size="small" component={RouterLink} to={`/visits/${t.visit_id}`}>
                              Open
                            </Button>
                          ) : onShowTower ? (
                            <Button size="small" onClick={() => onShowTower(t.id, t.visit_id)}>
                              Show
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {!compact && pack.hotspots.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Open hotspots
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {pack.hotspots.map((h) => (
                    <Button
                      key={h.position_id}
                      component={RouterLink}
                      to={`/visits/${h.visit_id}`}
                      variant="outlined"
                      color="error"
                      size="small"
                      sx={{ textTransform: 'none', alignItems: 'center', gap: 1, py: 0.5 }}
                    >
                      {h.image_id && (
                        <Box
                          component="img"
                          src={mediaUrl(`/api/images/${h.image_id}/thumbnail`)}
                          alt=""
                          sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 0.5 }}
                        />
                      )}
                      <span>
                        {h.tower_id} {h.ohl}-{h.phase}-{h.string}
                        {h.delta_t != null ? ` · ΔT ${h.delta_t}°C` : ''}
                        {h.severity ? ` · ${h.severity}` : ''}
                      </span>
                    </Button>
                  ))}
                </Stack>
              </Box>
            )}

            {!compact && pack.events.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Ops events
                </Typography>
                {pack.events.slice(0, 8).map((e) => (
                  <Typography key={e.id} variant="body2" sx={{ mb: 0.5 }}>
                    <Chip size="small" label={EVENT_LABEL[e.kind] || e.kind} sx={{ mr: 1 }} />
                    {e.tower_id ? `${e.tower_id}: ` : ''}
                    {e.body}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}
                      · {clock(e.created_at)}
                    </Typography>
                  </Typography>
                ))}
              </Box>
            )}

            {!compact && pack.notes.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Voice / daily notes
                </Typography>
                {pack.notes.slice(0, 5).map((n) => (
                  <Typography key={n.id} variant="body2" sx={{ mb: 0.5 }}>
                    {n.has_audio ? '🎙 ' : ''}
                    {n.note || '(voice note)'}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}
                      · {clock(n.created_at)}
                      {n.created_by_name ? ` · ${n.created_by_name}` : ''}
                    </Typography>
                  </Typography>
                ))}
              </Box>
            )}

            {compact && remainingRows(pack).length > 0 && (
              <Typography variant="body2" color="text.secondary">
                Still open: {remainingRows(pack).map((t) => t.tower_id).join(', ')}
              </Typography>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={endOpen} onClose={() => setEndOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>End tonight&apos;s outing</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This does not delete tracking or visits. It stamps the night closed and stores a note the
            next crew will see when they tap Continue last night.
          </Typography>
          <TextField
            label="Handover note"
            placeholder="Gate at T52 locked. Start at T53. Drone battery low."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            multiline
            minRows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEndOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleEnd} disabled={endOuting.isPending}>
            End outing
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
