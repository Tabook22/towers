import {
  Box,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Button,
  LinearProgress,
} from '@mui/material';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import PendingActionsIcon from '@mui/icons-material/PendingActionsRounded';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAreas, useDashboardSummary, useLiveTeams, useOutingPlan, useShiftInfo, useTeamJobMap, useTeamLive, useTeams, useTeamTrails } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { KpiTile } from '../components/KpiTile';
import { TowersOverviewMap } from '../components/TowersOverviewMap';
import { TeamSiteMap } from '../components/TeamSiteMap';
import { useTracking } from '../hooks/useFieldTracking';
import { VisitStatusChip } from '../components/Badges';
import { mediaUrl } from '../api/client';

export function DashboardPage() {
  const [area, setArea] = useState<string>('');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: areas } = useAreas();
  const { data, isLoading } = useDashboardSummary(area || undefined);
  const canMonitorField = user?.role === 'admin' || user?.role === 'reviewer';
  const isTeamLeader = user?.role === 'team_leader' || user?.role === 'team_member';
  const { data: liveMembers } = useLiveTeams(undefined, canMonitorField);
  const { data: myTeams } = useTeams();
  const teamId = user?.team_id ?? (isTeamLeader ? myTeams?.[0]?.id : undefined);
  const { data: teamJobMap } = useTeamJobMap(teamId);
  const { data: shift } = useShiftInfo();
  const { data: outingPlan } = useOutingPlan(teamId, shift?.field_date);
  const { data: teamLive } = useTeamLive(teamId);
  const { data: teamTrails } = useTeamTrails(teamId);
  const { lastLatitude, lastLongitude } = useTracking();
  const liveOnMap = (liveMembers || []).filter((m) => m.latitude != null && m.longitude != null);
  const liveActive = liveOnMap.filter((m) => !m.is_stale);

  const reportUrl = mediaUrl(`/api/reports/overall.pdf${area ? `?area=${encodeURIComponent(area)}` : ''}`);

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Overview
          </Typography>
          <Typography color="text.secondary">All towers &amp; latest field visits{area ? ` — ${area}` : ''}</Typography>
        </Box>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All areas</MenuItem>
            {areas?.map((a) => (
              <MenuItem key={a} value={a}>
                {a}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            component="a"
            href={reportUrl}
            target="_blank"
            rel="noreferrer"
          >
            Overall report
          </Button>
        </Stack>
      </Stack>

      {isLoading && <LinearProgress />}

      {data && (
        <>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile label="Towers" value={data.tower_count} icon={<CellTowerIcon />} color="#0d475c" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile label="Visits recorded" value={data.visit_count} icon={<FactCheckIcon />} color="#3a6f84" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile
                label="Open hotspots"
                value={data.total_hotspots}
                icon={<LocalFireDepartmentIcon />}
                color="#d32f2f"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile
                label="Images pending"
                value={data.total_images_pending}
                icon={<PendingActionsIcon />}
                color="#f57c00"
              />
            </Grid>
          </Grid>

          {canMonitorField && (
            <Card>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      Field teams — live
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {liveActive.length} live · {liveOnMap.length} on map · {(liveMembers || []).length} field logins
                    </Typography>
                  </Box>
                  <Button variant="contained" onClick={() => navigate('/field-tracker')}>
                    Open Field Tracker
                  </Button>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Positions update every minute from crew phones while their app is open. Open Field
                  Tracker for the live map and the path since the mission started.
                </Typography>
                {(liveMembers || []).length > 0 && (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Crew</TableCell>
                          <TableCell>Team</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(liveMembers || []).slice(0, 8).map((m) => (
                          <TableRow
                            key={m.user_id}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() => navigate('/field-tracker')}
                          >
                            <TableCell sx={{ fontWeight: 700 }}>{m.full_name || m.username}</TableCell>
                            <TableCell>{m.team_name || '—'}</TableCell>
                            <TableCell>
                              {m.latitude == null
                                ? 'Not reporting'
                                : m.is_stale
                                  ? 'Last seen (stale)'
                                  : 'Live on site'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                    Site map
                  </Typography>
                  {isTeamLeader || teamId ? (
                    <TeamSiteMap
                      plannedIds={outingPlan?.tower_ids}
                      towers={
                        teamJobMap?.towers && teamJobMap.towers.length > 0
                          ? teamJobMap.towers
                          : data.rows.map((row) => ({
                              id: row.tower.id,
                              tower_id: row.tower.tower_id,
                              area: row.tower.area,
                              latitude: row.tower.latitude,
                              longitude: row.tower.longitude,
                              status: row.rollup
                                ? row.rollup.visit_status === 'Ready for review'
                                  ? 'completed'
                                  : 'in_progress'
                                : 'pending',
                              visit_id: row.latest_visit?.id ?? null,
                            }))
                      }
                      liveMembers={teamLive}
                      trails={teamTrails}
                      myLocation={
                        lastLatitude != null && lastLongitude != null
                          ? { latitude: lastLatitude, longitude: lastLongitude }
                          : null
                      }
                      myLabel={user?.full_name || user?.username || 'You'}
                      height={340}
                    />
                  ) : (
                    <TowersOverviewMap rows={data.rows} />
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                    Towers needing attention
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Tower</TableCell>
                          <TableCell>Area</TableCell>
                          <TableCell align="center">Hotspots</TableCell>
                          <TableCell align="center">Pending</TableCell>
                          <TableCell align="center">Completion</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {[...data.rows]
                          .sort((a, b) => (b.rollup?.hotspots ?? 0) - (a.rollup?.hotspots ?? 0))
                          .map((row) => (
                            <TableRow
                              key={row.tower.id}
                              hover
                              onClick={() => navigate(`/towers/${row.tower.id}`)}
                              sx={{ cursor: 'pointer' }}
                            >
                              <TableCell sx={{ fontWeight: 700 }}>{row.tower.tower_id}</TableCell>
                              <TableCell>{row.tower.area || '-'}</TableCell>
                              <TableCell align="center">{row.rollup?.hotspots ?? '-'}</TableCell>
                              <TableCell align="center">{row.rollup?.images_pending ?? '-'}</TableCell>
                              <TableCell align="center">
                                {row.rollup ? `${row.rollup.completion_pct}%` : '-'}
                              </TableCell>
                              <TableCell>
                                <VisitStatusChip status={row.rollup?.visit_status} />
                              </TableCell>
                            </TableRow>
                          ))}
                        {data.rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} align="center">
                              No towers yet — add one from the Towers page.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Stack>
  );
}
