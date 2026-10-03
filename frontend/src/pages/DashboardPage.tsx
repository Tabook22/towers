import { tr, useLanguage } from '../i18n';
import {
  Alert,
  Box,
  Chip,
  Avatar,
  CardActionArea,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  Button,
  LinearProgress,
} from '@mui/material';
import TransmissionTowerIcon from '../components/TransmissionTowerIcon';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LocationOffRoundedIcon from '@mui/icons-material/LocationOffRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { DashboardSection } from '../components/DashboardSection';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import GpsFixedRoundedIcon from '@mui/icons-material/GpsFixedRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import PendingActionsIcon from '@mui/icons-material/PendingActionsRounded';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAreas, useClaimTowerForTeam, useDashboardSummary, useLiveTeams, useOutingPlan, useReleaseTower, useShiftInfo, useTeamJobMap, useTeamLive, useTeams, useTeamTrails, useTowers, useVisit } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { KpiTile } from '../components/KpiTile';
import { DashboardTowersDialog } from '../components/DashboardTowersDialog';
import { TowersOverviewMap } from '../components/TowersOverviewMap';
import { TeamSiteMap } from '../components/TeamSiteMap';
import { OutingPlanCard } from '../components/OutingPlanCard';
import { MissionHistoryCard, missionDateLabel } from '../components/MissionHistoryCard';
import { useTracking } from '../hooks/useFieldTracking';
import { TowerAttentionBoard } from '../components/TowerAttentionBoard';
import { positionLabel } from '../utils/positionChanges';
import { mediaUrl } from '../api/client';

export function DashboardPage() {
  useLanguage();
  const [area, setArea] = useState<string>('');
  const [towerHistoryOpen, setTowerHistoryOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: areas } = useAreas();
  const { data, isLoading } = useDashboardSummary(area || undefined);
  const canMonitorField = user?.role === 'admin' || user?.role === 'reviewer';
  const isTeamLeader = user?.role === 'team_leader' || user?.role === 'team_member';
  const { data: liveMembers, isLoading: liveLoading, isError: liveError } = useLiveTeams(undefined, canMonitorField);
  const { data: myTeams } = useTeams();
  const teamId = user?.team_id ?? (isTeamLeader ? myTeams?.[0]?.id : undefined);
  const { data: teamJobMap } = useTeamJobMap(teamId);
  const { data: shift } = useShiftInfo();
  // Which field night the Mission plan card below is showing/editing — defaults to tonight, but
  // Mission history's Edit/Add can point it at any other date without leaving this page.
  const [missionPlanDate, setMissionPlanDate] = useState('');
  const effectiveMissionDate = missionPlanDate || shift?.field_date;
  const { data: outingPlan } = useOutingPlan(teamId, shift?.field_date);
  const { data: teamLive } = useTeamLive(teamId);
  const { data: teamTrails } = useTeamTrails(teamId);
  const { lastLatitude, lastLongitude } = useTracking();
  const liveOnMap = (liveMembers || []).filter((m) => m.latitude != null && m.longitude != null);
  const liveActive = liveOnMap.filter((m) => !m.is_stale);
  const canClaimTowers = user?.role === 'team_leader' || user?.role === 'admin' || user?.role === 'reviewer';
  const { data: catalogTowers } = useTowers({ include_inactive: false, limit: 5000 });
  const claimForTeam = useClaimTowerForTeam();
  const releaseTower = useReleaseTower();
  const [claimError, setClaimError] = useState<string | null>(null);
  const isCatalogAdmin = user?.role === 'admin' || user?.role === 'reviewer';
  const freeTowers = (catalogTowers || []).filter((t) => t.is_active && t.assigned_team_id == null);

  const reportUrl = mediaUrl(`/api/reports/overall.pdf${area ? `?area=${encodeURIComponent(area)}` : ''}`);
  // Clicking "Inspection incomplete" opens this instead of navigating away, so a leader can see
  // exactly which positions still need screening without leaving the dashboard.
  const [incompleteDetail, setIncompleteDetail] = useState<{ visitId: number; towerId: string } | null>(null);
  const { data: incompleteVisit, isLoading: incompleteLoading } = useVisit(incompleteDetail?.visitId);
  const missingPositions = (incompleteVisit?.positions || []).filter(
    (p) => p.in_scope !== false && p.installed && (!p.screening_result || p.screening_result === 'Not inspected'),
  );

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>{tr("Overview")}</Typography>
          <Typography color="text.secondary">{tr("All towers & latest field visits")}{area ? ` — ${area}` : ''}</Typography>
        </Box>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label={tr("Area")}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">{tr("All areas")}</MenuItem>
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
          >{tr("Overall report")}</Button>
        </Stack>
      </Stack>

      {teamId && (user?.role === 'team_leader' || user?.role === 'team_member' || user?.role === 'admin' || user?.role === 'reviewer') && (
        <MissionHistoryCard
          teamId={teamId}
          canEdit={user?.role === 'team_leader' || user?.role === 'admin' || user?.role === 'reviewer'}
          selectedDate={effectiveMissionDate}
          onSelectDate={(d) => setMissionPlanDate(d)}
        />
      )}

      {missionPlanDate && missionPlanDate !== shift?.field_date && (
        <Alert
          severity="info"
          action={
            <Button size="small" onClick={() => setMissionPlanDate('')}>{tr("Back to tonight")}</Button>
          }
        >{tr("Viewing the mission planned for ")}{missionDateLabel(missionPlanDate)}.
        </Alert>
      )}

      {teamId && (user?.role === 'team_leader' || user?.role === 'admin' || user?.role === 'reviewer') && (
        <OutingPlanCard
          teamId={teamId}
          fieldDate={effectiveMissionDate}
          assignedTowers={teamJobMap?.towers || []}
          catalogTowers={catalogTowers}
          canEdit={user?.role === 'team_leader' || user?.role === 'admin' || user?.role === 'reviewer'}
        />
      )}
      {teamId && user?.role === 'team_member' && (
        <OutingPlanCard
          teamId={teamId}
          fieldDate={effectiveMissionDate}
          assignedTowers={teamJobMap?.towers || []}
          canEdit={false}
        />
      )}

      {isLoading && <LinearProgress />}

      {data && (
        <>
          <DashboardSection
            icon={<InsightsRoundedIcon />}
            title={tr("At a glance")}
            eyebrow={tr("INSPECTION SNAPSHOT")}
            description={tr("Your tower coverage, recorded visits and outstanding evidence in one place.")}
          >
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <KpiTile illustrated label={tr("Towers")} value={data.tower_count} icon={<TransmissionTowerIcon />} color="#0d475c" onClick={() => setTowerHistoryOpen(true)} hint={tr("View towers & visit history →")} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <KpiTile illustrated label={tr("Visits recorded")} value={data.visit_count} icon={<FactCheckIcon />} color="#3a6f84" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <KpiTile illustrated
                  label={tr("Open hotspots")}
                  value={data.total_hotspots}
                  icon={<LocalFireDepartmentIcon />}
                  color="#d32f2f"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <KpiTile illustrated
                  label={tr("Images pending")}
                  value={data.total_images_pending}
                  icon={<PendingActionsIcon />}
                  color="#f57c00"
                />
              </Grid>
            </Grid>
          </DashboardSection>

          {canMonitorField && (
            <DashboardSection
              icon={<GpsFixedRoundedIcon />}
              title={tr("Field teams — live")}
              tone="green"
              eyebrow={tr("FIELD PRESENCE")}
              description={tr("See which crew members are reporting and open their latest map locations.")}
            >
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip icon={<GpsFixedRoundedIcon />} label={tr("Live: {0}", [liveActive.length])} color="success" variant="outlined" />
                  <Chip icon={<MyLocationRoundedIcon />} label={tr("On map: {0}", [liveOnMap.length])} variant="outlined" />
                  <Chip icon={<GroupsRoundedIcon />} label={tr("Field logins: {0}", [(liveMembers || []).length])} variant="outlined" />
                </Stack>
                <Button variant="contained" disableElevation startIcon={<MyLocationRoundedIcon />} onClick={() => navigate('/field-tracker')}>{tr("Open Field Tracker")}</Button>
              </Stack>
              {liveLoading && <LinearProgress />}
              {liveError && <Alert severity="warning">{tr("Live team information is unavailable. Open Field Tracker to try again.")}</Alert>}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 1.5 }}>
                {(liveMembers || []).slice(0, 8).map(m => {
                  const hasLocation = m.latitude != null && m.longitude != null;
                  const live = hasLocation && !m.is_stale;
                  return <Paper key={m.user_id} variant="outlined" sx={{ borderRadius: '18px', overflow: 'hidden' }}>
                    <CardActionArea onClick={() => navigate('/field-tracker')} aria-label={tr("Open tracker for {0}", [m.full_name || m.username])} sx={{ p: 2 }}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <Avatar sx={{ bgcolor: 'action.hover', color: 'primary.main' }}><GroupsRoundedIcon /></Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{m.full_name || m.username}</Typography><Typography variant="body2" color="text.secondary">{m.team_name || tr("Unassigned")}</Typography></Box>
                        <ArrowForwardRoundedIcon sx={{ color: 'text.secondary', transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />
                      </Stack>
                      <Chip size="small" variant="outlined" color={live ? 'success' : 'default'} icon={live ? <GpsFixedRoundedIcon /> : hasLocation ? <ScheduleRoundedIcon /> : <LocationOffRoundedIcon />} label={tr(!hasLocation ? 'Not reporting' : m.is_stale ? 'Last seen (stale)' : 'Live on site')} sx={{ mt: 1.5 }} />
                    </CardActionArea>
                  </Paper>;
                })}
              </Box>
              {!liveLoading && !liveError && !liveMembers?.length && <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', py: 3 }}><GroupsRoundedIcon sx={{ fontSize: 42, color: 'text.secondary' }} /><Typography sx={{ fontWeight: 700 }}>{tr("No field logins to show yet.")}</Typography></Stack>}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{tr("Locations refresh every minute while crew members share their location. Open the tracker for all members and route history.")}</Typography>
            </DashboardSection>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TowerAttentionBoard rows={data.rows} teams={myTeams || []}
                canOpenTeams={!!user?.menu_permissions?.teams}
                onMissingChecks={(visitId, towerId) => setIncompleteDetail({ visitId, towerId })} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <DashboardSection
                icon={<MyLocationRoundedIcon />}
                title={tr("Site map")}
                tone="blue"
                eyebrow={tr("TOWERS & ROUTES")}
                description={tr("Locate towers, check team coverage and explore recorded field routes.")}
              >
                  {teamTrails?.some((t) => t.is_previous) && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tr("Showing this team&apos;s last recorded outing")}{teamTrails.find((t) => t.field_date)?.field_date
                        ? ` (${teamTrails.find((t) => t.field_date)?.field_date})`
                        : ''}{tr(". Every crew login sees the same path. Live GPS overlays when someone is signed in tonight.")}</Typography>
                  )}
                  {teamId && !teamTrails?.some((t) => t.is_previous) && (user?.role === 'team_member' || user?.role === 'team_leader') && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tr("Live GPS for everyone on this team. Open Our team to review previous nights and daily progress.")}</Typography>
                  )}
                  {canClaimTowers && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{tr("Green pin: free, click to assign to your team. Each team has its own pin color — click one of your team&apos;s towers to unassign it. A ✓ marks a tower whose inspection is complete.")}</Typography>
                  )}
                  {claimError && (
                    <Alert severity="error" sx={{ mb: 1 }} onClose={() => setClaimError(null)}>
                      {tr(claimError)}
                    </Alert>
                  )}
                  {isTeamLeader || teamId ? (
                    <TeamSiteMap
                      plannedIds={outingPlan?.tower_ids}
                      towers={teamJobMap?.towers ?? []}
                      liveMembers={teamLive}
                      trails={teamTrails}
                      myLocation={
                        lastLatitude != null && lastLongitude != null
                          ? { latitude: lastLatitude, longitude: lastLongitude }
                          : null
                      }
                      myLabel={user?.full_name || user?.username || 'You'}
                      height={340}
                      freeTowers={canClaimTowers ? freeTowers : undefined}
                      catalogTowers={catalogTowers}
                      claiming={claimForTeam.isPending || releaseTower.isPending}
                      onCatalogTowerClick={
                        canClaimTowers && teamId
                          ? (t) => {
                              const errOf = (err: unknown) =>
                                (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                                'Could not update that tower';
                              setClaimError(null);
                              if (t.assigned_team_id == null) {
                                claimForTeam.mutate(
                                  { towerId: t.id, teamId },
                                  { onError: (err) => setClaimError(String(errOf(err))) },
                                );
                                return;
                              }
                              if (t.assigned_team_id === teamId) {
                                if (
                                  window.confirm(
                                    tr("Unassign {0} from this team so another team can inspect it?", [t.tower_id]),
                                  )
                                ) {
                                  releaseTower.mutate(t.id, {
                                    onError: (err) => setClaimError(String(errOf(err))),
                                  });
                                }
                                return;
                              }
                              if (isCatalogAdmin) {
                                if (
                                  window.confirm(
                                    tr("Give {0} to this team? It is currently assigned to {1}.", [t.tower_id, t.assigned_team_name || tr("another team")]),
                                  )
                                ) {
                                  claimForTeam.mutate(
                                    { towerId: t.id, teamId },
                                    { onError: (err) => setClaimError(String(errOf(err))) },
                                  );
                                }
                                return;
                              }
                              setClaimError(
                                tr("{0} belongs to {1}. That team or an admin must unassign it first.", [t.tower_id, t.assigned_team_name || tr("another team")]),
                              );
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <TowersOverviewMap rows={data.rows} />
                  )}
              </DashboardSection>
            </Grid>

          </Grid>
        </>
      )}

      {towerHistoryOpen && <DashboardTowersDialog open area={area || undefined} onClose={() => setTowerHistoryOpen(false)} />}
      <Dialog open={!!incompleteDetail} onClose={() => setIncompleteDetail(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr("What's missing — ")}{incompleteDetail?.towerId}</DialogTitle>
        <DialogContent>
          {incompleteLoading ? (
            <LinearProgress />
          ) : missingPositions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{tr("Every installed position on this visit has already been screened — the status may update once the page refreshes.")}</Typography>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {missingPositions.length}{tr(" position")}{missingPositions.length === 1 ? '' : tr("s")}{tr(" still")}{missingPositions.length === 1 ? tr(" hasn't") : tr(" haven't")}{tr(" been screened:")}</Typography>
              <Stack spacing={0.75}>
                {missingPositions.map((p) => (
                  <Stack
                    key={p.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {positionLabel(p).split(' · ').map(part => tr(part)).join(' · ')}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIncompleteDetail(null)}>{tr("Close")}</Button>
          {incompleteDetail && (
            <Button variant="contained" onClick={() => navigate(`/visits/${incompleteDetail.visitId}`)}>{tr("Go screen it")}</Button>
          )}
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
