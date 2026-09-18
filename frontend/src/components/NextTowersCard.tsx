import { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  MenuItem,
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
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import NavigationIcon from '@mui/icons-material/NavigationRounded';
import FlagIcon from '@mui/icons-material/FlagRounded';
import PlaceIcon from '@mui/icons-material/PlaceRounded';
import { Link as RouterLink } from 'react-router-dom';
import type { NextTowerStop, NextTowersPlan, NightClaimStatus } from '../api/types';
import { StepBadge } from './StepBadge';

function hoursLabel(minutes: number, stillNight: boolean): string {
  const h = minutes / 60;
  const n = h >= 10 ? h.toFixed(0) : h.toFixed(1);
  return stillNight ? `${n} h darkness` : `${n} h left`;
}

const CLAIM_LABEL: Record<string, string> = {
  claimed: 'Claimed',
  en_route: 'On the way',
  on_site: 'On site',
  done: 'Done',
  skipped: 'Skipped',
};

export function NextTowersCard({
  plan,
  loading,
  canStart,
  canAssign,
  currentUserId,
  busy,
  onShow,
  onStart,
  onClaim,
  onStatus,
  compact,
  step,
}: {
  plan: NextTowersPlan | undefined;
  loading?: boolean;
  canStart?: boolean;
  canAssign?: boolean;
  currentUserId?: number | null;
  busy?: boolean;
  onShow?: (stop: NextTowerStop) => void;
  onStart?: (stop: NextTowerStop) => void;
  onClaim?: (stop: NextTowerStop, assignedUserId?: number) => void;
  onStatus?: (stop: NextTowerStop, status: NightClaimStatus, skipReason?: string) => void;
  compact?: boolean;
  step?: number;
}) {
  if (loading && !plan) return <LinearProgress />;
  if (!plan) return null;

  const mapsUrl = (stop: NextTowerStop) => {
    const origin =
      plan.origin_latitude != null && plan.origin_longitude != null
        ? `${plan.origin_latitude},${plan.origin_longitude}`
        : '';
    const dest = `${stop.latitude},${stop.longitude}`;
    return origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`
      : `https://www.google.com/maps/search/?api=1&query=${dest}`;
  };

  return (
    <Accordion defaultExpanded disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', width: '100%', pr: 1 }}>
          <Stack direction="row" spacing={1.5}>
            {step != null && <StepBadge n={step} />}
            <NavigationIcon color="primary" sx={{ mt: 0.5 }} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Next towers tonight
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {plan.headline}
              </Typography>
              {onClaim && (
                <Typography variant="caption" color="text.secondary">
                  Claim a tower so the other car doesn&apos;t drive there too. Skip posts to Tonight.
                </Typography>
              )}
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Chip size="small" icon={<PlaceIcon />} label={hoursLabel(plan.minutes_left, plan.still_night)} variant="outlined" />
            {plan.daily_target != null && (
              <Chip
                size="small"
                icon={<FlagIcon />}
                color={plan.behind_by != null && plan.behind_by > 0 ? 'warning' : 'success'}
                label={`${plan.towers_done_tonight}/${plan.daily_target} tonight`}
              />
            )}
            <Chip size="small" label={`${plan.remaining_assigned} still open`} />
          </Stack>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>

        {plan.remaining_assigned === 0 && (
          <Alert severity="success">No assigned towers left open for this team.</Alert>
        )}
        {plan.remaining_assigned > 0 && plan.stops.length === 0 && (
          <Alert severity="info">
            {plan.skipped_no_gps
              ? `${plan.skipped_no_gps} open tower${plan.skipped_no_gps === 1 ? '' : 's'} have no GPS pin yet — add coordinates on the Towers page.`
              : 'Waiting for a GPS fix to rank the next stops.'}
          </Alert>
        )}

        {plan.stops.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Tower</TableCell>
                  {!compact && <TableCell>Drive</TableCell>}
                  <TableCell>Why / who</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {plan.stops.map((stop) => (
                  <TableRow
                    key={stop.id}
                    hover
                    sx={{
                      cursor: onShow ? 'pointer' : 'default',
                      opacity: stop.fits_tonight ? 1 : 0.7,
                    }}
                    onClick={() => onShow?.(stop)}
                  >
                    <TableCell sx={{ fontWeight: 800, color: stop.status === 'in_progress' ? 'info.main' : 'primary.main' }}>
                      {stop.rank}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>
                      {stop.tower_id}
                      {stop.area && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {stop.area}
                        </Typography>
                      )}
                      {!stop.fits_tonight && (
                        <Chip size="small" label="After tonight's window" variant="outlined" sx={{ mt: 0.5 }} />
                      )}
                    </TableCell>
                    {!compact && (
                      <TableCell>
                        {stop.travel_minutes} min
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {stop.travel_km} km
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell>
                      <Typography variant="body2">{stop.reason}</Typography>
                      {stop.claim_status && (
                        <Chip
                          size="small"
                          color={stop.mine ? 'primary' : stop.claim_status === 'on_site' ? 'info' : 'default'}
                          label={
                            stop.mine
                              ? CLAIM_LABEL[stop.claim_status] || stop.claim_status
                              : `${CLAIM_LABEL[stop.claim_status] || stop.claim_status}${stop.claimed_by_name ? ` · ${stop.claimed_by_name}` : ''}`
                          }
                          sx={{ mt: 0.5 }}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <StopActions
                        stop={stop}
                        plan={plan}
                        mapsUrl={mapsUrl(stop)}
                        canStart={canStart}
                        canAssign={canAssign}
                        currentUserId={currentUserId}
                        busy={busy}
                        onStart={onStart}
                        onClaim={onClaim}
                        onStatus={onStatus}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {plan.can_fit_tonight > 0 && plan.stops.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {plan.can_fit_tonight} of these {plan.can_fit_tonight === 1 ? 'fits' : 'fit'} in the time left
            (about {plan.dwell_minutes} min on each tower plus driving).
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function StopActions({
  stop,
  plan,
  mapsUrl,
  canStart,
  canAssign,
  currentUserId,
  busy,
  onStart,
  onClaim,
  onStatus,
}: {
  stop: NextTowerStop;
  plan: NextTowersPlan;
  mapsUrl: string;
  canStart?: boolean;
  canAssign?: boolean;
  currentUserId?: number | null;
  busy?: boolean;
  onStart?: (stop: NextTowerStop) => void;
  onClaim?: (stop: NextTowerStop, assignedUserId?: number) => void;
  onStatus?: (stop: NextTowerStop, status: NightClaimStatus, skipReason?: string) => void;
}) {
  const [assignTo, setAssignTo] = useState('');
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const mine = stop.mine || (currentUserId != null && stop.claimed_by_id === currentUserId);
  const taken = Boolean(stop.claim_id && stop.claim_status && !['done', 'skipped'].includes(stop.claim_status) && !mine);
  const openSkip = () => {
    setSkipReason('');
    setSkipOpen(true);
  };
  const confirmSkip = () => {
    const reason = skipReason.trim();
    if (!reason) return;
    onStatus?.(stop, 'skipped', reason);
    setSkipOpen(false);
  };

  return (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<NavigationIcon />} href={mapsUrl} target="_blank" rel="noopener noreferrer">
          Go
        </Button>
        {!stop.claim_id && onClaim && (
          <Button size="small" variant="contained" disabled={busy} onClick={() => onClaim(stop)}>
            I&apos;ll take it
          </Button>
        )}
        {mine && stop.claim_status === 'claimed' && (
          <Button size="small" variant="contained" disabled={busy} onClick={() => onStatus?.(stop, 'en_route')}>
            On my way
          </Button>
        )}
        {mine && stop.claim_status === 'en_route' && (
          <Button size="small" variant="contained" disabled={busy} onClick={() => onStatus?.(stop, 'on_site')}>
            On site
          </Button>
        )}
        {mine && stop.claim_status === 'on_site' && (
          <Button size="small" variant="contained" color="success" disabled={busy} onClick={() => onStatus?.(stop, 'done')}>
            Done
          </Button>
        )}
        {mine && stop.claim_status && !['done', 'skipped'].includes(stop.claim_status) && (
          <Button size="small" color="warning" disabled={busy} onClick={openSkip}>
            Skip
          </Button>
        )}
        {taken && canAssign && onClaim && (
          <Button size="small" disabled={busy} onClick={() => onClaim(stop, currentUserId || undefined)}>
            Take over
          </Button>
        )}
        {stop.visit_id ? (
          <Button size="small" component={RouterLink} to={`/visits/${stop.visit_id}`}>
            Open
          </Button>
        ) : canStart && (mine || !stop.claim_id) ? (
          <Button size="small" onClick={() => onStart?.(stop)}>
            Start
          </Button>
        ) : null}
      </Stack>
      {canAssign && onClaim && plan.crew.length > 0 && !mine && (
        <TextField
          select
          size="small"
          label="Assign"
          value={assignTo}
          onChange={(e) => {
            const id = Number(e.target.value);
            setAssignTo(e.target.value);
            if (id) onClaim(stop, id);
          }}
          sx={{ minWidth: 140 }}
          disabled={busy}
        >
          <MenuItem value="">Someone…</MenuItem>
          {plan.crew.map((c) => (
            <MenuItem key={c.user_id} value={c.user_id}>
              {c.full_name || c.username}
            </MenuItem>
          ))}
        </TextField>
      )}
      <Dialog open={skipOpen} onClose={() => setSkipOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Why skip {stop.tower_id || 'this tower'}?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            The admin sees this explanation in the crew channel, so please be specific (e.g. "Gate locked,
            no keyholder answered" rather than "Skipping this tower").
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            placeholder="Explain why you're skipping this tower…"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSkipOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" disabled={!skipReason.trim()} onClick={confirmSkip}>
            Skip tower
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
