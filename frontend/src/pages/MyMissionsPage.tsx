import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import PlaceIcon from '@mui/icons-material/PlaceRounded';
import ScheduleIcon from '@mui/icons-material/ScheduleRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import { useNavigate } from 'react-router-dom';
import { useMyMissions, useTeamJobMap, useTeamLive, useTeamTrails, useTowers } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { TeamSiteMap } from '../components/TeamSiteMap';
import { useTracking } from '../hooks/useFieldTracking';
import { VisitStatusChip } from '../components/Badges';

const MISSION_STATUS_COLORS: Record<string, 'default' | 'info' | 'success'> = {
  planned: 'default',
  in_progress: 'info',
  completed: 'success',
};

/** A team_member's whole workspace: just the missions their team leader has assigned to them —
 * nothing from the rest of the team, nothing from other members. Clicking one opens the same
 * VisitDetailPage a team_leader or admin uses — same full mission-control (positions, images,
 * screening, annotation, photos), just already scoped server-side to this one visit. */
export function MyMissionsPage() {
  const { user } = useAuth();
  const { data: missions, isLoading, isError } = useMyMissions();
  const navigate = useNavigate();
  const teamId = user?.team_id ?? undefined;
  const { data: jobMap } = useTeamJobMap(teamId);
  const { data: liveMembers } = useTeamLive(teamId);
  const { data: trails } = useTeamTrails(teamId);
  const { data: catalogTowers } = useTowers({ include_inactive: false, limit: 5000 });
  const { lastLatitude, lastLongitude } = useTracking();

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          My missions
        </Typography>
        <Typography color="text.secondary">
          {user?.full_name || user?.username} — the towers and inspections your team leader has assigned to you.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Site map
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {trails?.some((t) => t.is_previous)
              ? `Your team's last recorded outing (${trails.find((t) => t.field_date)?.field_date}). Live GPS appears when someone is signed in tonight.`
              : "Your location, the whole crew's GPS track, and every registered tower (number + Tower ID)."}
          </Typography>
          <TeamSiteMap
            towers={jobMap?.towers}
            liveMembers={liveMembers}
            trails={trails}
            myLocation={
              lastLatitude != null && lastLongitude != null
                ? { latitude: lastLatitude, longitude: lastLongitude }
                : null
            }
            myLabel={user?.full_name || user?.username || 'You'}
            height={380}
            catalogTowers={catalogTowers}
          />
        </CardContent>
      </Card>

      {isLoading && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <CircularProgress />
        </Box>
      )}
      {isError && <Alert severity="error">Could not load your missions.</Alert>}
      {!isLoading && !isError && (!missions || missions.length === 0) && (
        <Alert severity="info">
          No missions assigned to you yet — your team leader will assign one when it's ready.
        </Alert>
      )}

      <Grid container spacing={2}>
        {missions?.map((m) => (
          <Grid key={m.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card
              variant="outlined"
              sx={{ cursor: 'pointer', height: '100%', '&:hover': { borderColor: 'primary.main' } }}
              onClick={() => navigate(`/visits/${m.id}`)}
            >
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <CellTowerIcon color="action" fontSize="small" />
                    <Typography sx={{ fontWeight: 700 }}>{m.tower?.tower_id || `Tower #${m.tower_id}`}</Typography>
                  </Stack>
                  {m.mission_seq != null && <Chip size="small" label={`Mission ${m.mission_seq}`} variant="outlined" />}
                </Stack>
                {m.tower?.area && (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 1 }}>
                    <PlaceIcon fontSize="inherit" color="disabled" />
                    <Typography variant="caption" color="text.secondary">
                      {m.tower.area}
                      {m.tower.location_name ? ` — ${m.tower.location_name}` : ''}
                    </Typography>
                  </Stack>
                )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                  <Chip size="small" label={m.mission_status} color={MISSION_STATUS_COLORS[m.mission_status] || 'default'} />
                  <VisitStatusChip status={m.rollup?.visit_status} />
                  {(m.rollup?.hotspots ?? 0) > 0 && (
                    <Chip size="small" color="error" icon={<LocalFireDepartmentIcon />} label={`${m.rollup?.hotspots} hotspot(s)`} />
                  )}
                </Stack>
                {(m.inspection_date || m.start_time) && (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <ScheduleIcon fontSize="inherit" color="disabled" />
                    <Typography variant="caption" color="text.secondary">
                      {m.inspection_date || ''}
                      {m.start_time ? ` · ${m.start_time.slice(0, 5)}${m.end_time ? ` – ${m.end_time.slice(0, 5)}` : ''}` : ''}
                    </Typography>
                  </Stack>
                )}
                {m.rollup && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    {m.rollup.screened}/{m.rollup.installed} screened · {m.rollup.completion_pct}% complete
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
