import { tr, useLanguage } from '../i18n';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import GpsFixedRoundedIcon from '@mui/icons-material/GpsFixedRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import PendingActionsIcon from '@mui/icons-material/PendingActionsRounded';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { type ReactNode, useState } from 'react';
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
import { VisitStatusChip } from '../components/Badges';
import { mediaUrl } from '../api/client';

// A named, collapsible block with an icon and a one-line "what is this for" description, so a
// dashboard with several different kinds of information (live tracking, planning, priorities)
// reads as clearly labeled sections instead of a stack of look-alike cards — and each one can be
// collapsed once a leader knows they don't need to check it right now.
function DashboardSection({
  icon,
  title,
  description,
  defaultExpanded = true,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  useLanguage();
  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          </Box>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}

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
  const { data: liveMembers } = useLiveTeams(undefined, canMonitorField);
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
  // "Needing attention" means an actually open mission — a tower with no visit yet, or whose
  // visit is already Completed, isn't something to act on right now, so it drops off this list
  // automatically rather than sitting there forever once assigned (see mission_status on Visit).
  const needsAttentionRows = (data?.rows || []).filter(
    (row) => row.latest_visit?.mission_status === 'planned' || row.latest_visit?.mission_status === 'in_progress',
  );

  // Clicking "Inspection incomplete" opens this instead of navigating away, so a leader can see
  // exactly which positions still need screening without leaving the dashboard.
  const [incompleteDetail, setIncompleteDetail] = useState<{ visitId: number; towerId: string } | null>(null);
  const { data: incompleteVisit, isLoading: incompleteLoading } = useVisit(incompleteDetail?.visitId);
  const missingPositions = (incompleteVisit?.positions || []).filter(
    (p) => p.installed && (!p.screening_result || p.screening_result === 'Not inspected'),
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
            description={tr("Live counts across every tower in this view — towers, visits recorded, open hotspots, and images still pending upload.")}
          >
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <KpiTile label={tr("Towers")} value={data.tower_count} icon={<CellTowerIcon />} color="#0d475c" onClick={() => setTowerHistoryOpen(true)} hint={tr("View towers & visit history →")} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <KpiTile label={tr("Visits recorded")} value={data.visit_count} icon={<FactCheckIcon />} color="#3a6f84" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <KpiTile
                  label={tr("Open hotspots")}
                  value={data.total_hotspots}
                  icon={<LocalFireDepartmentIcon />}
                  color="#d32f2f"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <KpiTile
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
              description={tr("{0} live · {1} on map · {2} field logins", [liveActive.length, liveOnMap.length, (liveMembers || []).length])}
            >
              <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1.5 }}>
                <Button variant="contained" onClick={() => navigate('/field-tracker')}>{tr("Open Field Tracker")}</Button>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{tr("Positions update every minute from crew phones while their app is open. Open Field Tracker for the live map and the path since the mission started.")}</Typography>
              {(liveMembers || []).length > 0 && (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{tr("Crew")}</TableCell>
                        <TableCell>{tr("Team")}</TableCell>
                        <TableCell>{tr("Status")}</TableCell>
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
                            {m.latitude == null ? tr("Not reporting") : m.is_stale ? tr("Last seen (stale)") : tr("Live on site")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DashboardSection>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <DashboardSection
                icon={<MyLocationRoundedIcon />}
                title={tr("Site map")}
                description={tr("Live crew GPS, planned towers, and — for leaders and admins — claim or release a tower right from the map.")}
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
            <Grid size={{ xs: 12, md: 7 }}>
              <DashboardSection
                icon={<WarningAmberRoundedIcon />}
                title={tr("Towers needing attention")}
                description={tr("Assigned towers that are still planned or in progress, sorted by hotspot count first.")}
              >
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{tr("Tower")}</TableCell>
                          <TableCell>{tr("Area")}</TableCell>
                          <TableCell align="center">{tr("Hotspots")}</TableCell>
                          <TableCell align="center">{tr("Pending")}</TableCell>
                          <TableCell align="center">{tr("Completion")}</TableCell>
                          <TableCell>{tr("Status")}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {needsAttentionRows
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
                              <TableCell
                                onClick={(e) => {
                                  if (row.rollup?.visit_status !== 'Inspection incomplete' || !row.latest_visit) return;
                                  e.stopPropagation();
                                  setIncompleteDetail({ visitId: row.latest_visit.id, towerId: row.tower.tower_id });
                                }}
                              >
                                <VisitStatusChip status={row.rollup?.visit_status} />
                              </TableCell>
                            </TableRow>
                          ))}
                        {needsAttentionRows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} align="center">
                              {data.rows.length === 0 ? tr("No towers yet — add one from the Towers page.") : tr("Nothing needs attention right now — every assigned tower is either finished or hasn't been started yet.")}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
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
                      {p.ohl} · {p.phase} · {p.string}
                      {p.tower_proximity ? ` (${p.tower_proximity})` : ''}
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
