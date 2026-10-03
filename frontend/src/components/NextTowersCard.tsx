import { tr, useLanguage } from '../i18n';
import { useState } from 'react';
import {
  Alert,
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
import NavigationIcon from '@mui/icons-material/DirectionsCarRounded';
import FlagIcon from '@mui/icons-material/FlagRounded';
import PlaceIcon from '@mui/icons-material/PlaceRounded';
import { Link as RouterLink } from 'react-router-dom';
import type { NextTowerStop, NextTowersPlan, NightClaimStatus } from '../api/types';
import { StepBadge } from './StepBadge';
import { DashboardSection } from './DashboardSection';

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
  useLanguage();
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
    <DashboardSection icon={<NavigationIcon />} tone="blue" title={tr("Next towers tonight")}
      description={tr("See suggested next stops and coordinate which crew goes to each tower.")}
      badge={step != null ? <StepBadge n={step} /> : undefined}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{plan.headline}</Typography>
      {onClaim && <Alert severity="info" sx={{ mb: 1.5 }}>{tr("Claim a tower so the other car doesn&apos;t drive there too. Skip posts to Tonight.")}</Alert>}
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <Chip size="small" icon={<PlaceIcon />} label={hoursLabel(plan.minutes_left, plan.still_night)} variant="outlined" />
        {plan.daily_target != null && <Chip size="small" icon={<FlagIcon />} color={plan.behind_by != null && plan.behind_by > 0 ? 'warning' : 'success'} label={tr("{0}/{1} tonight", [plan.towers_done_tonight, plan.daily_target])} />}
        <Chip size="small" label={tr("{0} still open", [plan.remaining_assigned])} />
      </Stack>

        {plan.remaining_assigned === 0 && (
          <Alert severity="success">{tr("No assigned towers left open for this team.")}</Alert>
        )}
        {plan.remaining_assigned > 0 && plan.stops.length === 0 && (
          <Alert severity="info">
            {plan.skipped_no_gps ? tr("{0} open tower{1} have no GPS pin yet — add coordinates on the Towers page.", [plan.skipped_no_gps, plan.skipped_no_gps === 1 ? '' : tr("s")]) : tr("Waiting for a GPS fix to rank the next stops.")}
          </Alert>
        )}

        {plan.stops.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>{tr("Tower")}</TableCell>
                  {!compact && <TableCell>{tr("Drive")}</TableCell>}
                  <TableCell>{tr("Why / who")}</TableCell>
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
                        <Chip size="small" label={tr("After tonight's window")} variant="outlined" sx={{ mt: 0.5 }} />
                      )}
                    </TableCell>
                    {!compact && (
                      <TableCell>
                        {stop.travel_minutes}{tr(" min")}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {stop.travel_km}{tr(" km")}</Typography>
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
            {plan.can_fit_tonight}{tr(" of these ")}{plan.can_fit_tonight === 1 ? tr("fits") : tr("fit")}{tr(" in the time left (about ")}{plan.dwell_minutes}{tr(" min on each tower plus driving).")}</Typography>
        )}
    </DashboardSection>
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
  useLanguage();
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
        <Button size="small" startIcon={<NavigationIcon />} href={mapsUrl} target="_blank" rel="noopener noreferrer">{tr("Go")}</Button>
        {!stop.claim_id && onClaim && (
          <Button size="small" variant="contained" disabled={busy} onClick={() => onClaim(stop)}>{tr("I&apos;ll take it")}</Button>
        )}
        {mine && stop.claim_status === 'claimed' && (
          <Button size="small" variant="contained" disabled={busy} onClick={() => onStatus?.(stop, 'en_route')}>{tr("On my way")}</Button>
        )}
        {mine && stop.claim_status === 'en_route' && (
          <Button size="small" variant="contained" disabled={busy} onClick={() => onStatus?.(stop, 'on_site')}>{tr("On site")}</Button>
        )}
        {mine && stop.claim_status === 'on_site' && (
          <Button size="small" variant="contained" color="success" disabled={busy} onClick={() => onStatus?.(stop, 'done')}>{tr("Done")}</Button>
        )}
        {mine && stop.claim_status && !['done', 'skipped'].includes(stop.claim_status) && (
          <Button size="small" color="warning" disabled={busy} onClick={openSkip}>{tr("Skip")}</Button>
        )}
        {taken && canAssign && onClaim && (
          <Button size="small" disabled={busy} onClick={() => onClaim(stop, currentUserId || undefined)}>{tr("Take over")}</Button>
        )}
        {stop.visit_id ? (
          <Button size="small" component={RouterLink} to={`/visits/${stop.visit_id}`}>{tr("Open")}</Button>
        ) : canStart && (mine || !stop.claim_id) ? (
          <Button size="small" onClick={() => onStart?.(stop)}>{tr("Start")}</Button>
        ) : null}
      </Stack>
      {canAssign && onClaim && plan.crew.length > 0 && !mine && (
        <TextField
          select
          size="small"
          label={tr("Assign")}
          value={assignTo}
          onChange={(e) => {
            const id = Number(e.target.value);
            setAssignTo(e.target.value);
            if (id) onClaim(stop, id);
          }}
          sx={{ minWidth: 140 }}
          disabled={busy}
        >
          <MenuItem value="">{tr("Someone…")}</MenuItem>
          {plan.crew.map((c) => (
            <MenuItem key={c.user_id} value={c.user_id}>
              {c.full_name || c.username}
            </MenuItem>
          ))}
        </TextField>
      )}
      <Dialog open={skipOpen} onClose={() => setSkipOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr("Why skip ")}{stop.tower_id || tr("this tower")}?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{tr("The admin sees this explanation in the crew channel, so please be specific (e.g. \"Gate locked, no keyholder answered\" rather than \"Skipping this tower\").")}</DialogContentText>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            placeholder={tr("Explain why you're skipping this tower…")}
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSkipOpen(false)}>{tr("Cancel")}</Button>
          <Button variant="contained" color="warning" disabled={!skipReason.trim()} onClick={confirmSkip}>{tr("Skip tower")}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
