import { tr, useLanguage } from '../i18n';
import { localInspectionDate } from '../utils/teamTowerWork';
import { TeamInspectionGuide } from '../components/TeamInspectionGuide';
import { useState } from 'react';
import {
  Alert,
  Box,
  Avatar,
  LinearProgress,
  InputAdornment,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
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
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import EditIcon from '@mui/icons-material/EditRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import ArchiveIcon from '@mui/icons-material/InventoryRounded';
import MoreVertIcon from '@mui/icons-material/MoreVertRounded';
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import BadgeIcon from '@mui/icons-material/BadgeRounded';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import TransmissionTowerIcon from '../components/TransmissionTowerIcon';
import SearchRounded from '@mui/icons-material/SearchRounded';
import InsightsRounded from '@mui/icons-material/InsightsRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import { DashboardSection } from '../components/DashboardSection';
import { TeamJourney } from '../components/TeamJourney';
import { useNavigate } from 'react-router-dom';
import {
  useAreas,
  useBulkAssignTowers,
  useCreateTeam,
  useCreateUser,
  useDeleteTeam,
  useDeleteUser,
  useTeams,
  useTowers,
  useUpdateTeam,
  useUpdateUser,
  useUsers,
} from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { getPermissionLevel, type AdminUser, type Team } from '../api/types';
import { TowerAssignmentPicker } from '../components/TowerAssignmentPicker';
import { MenuPermissionsEditor } from '../components/MenuPermissionsEditor';
import { TeamActivitySummary } from '../components/TeamActivitySummary';
import {useOffline} from '../offline/OfflineProvider';
import {queryNotice} from '../utils/queryNotice';
import RefreshRounded from '@mui/icons-material/RefreshRounded';

// Mirrors backend deps.default_menu_permissions_for_role("team_leader") — the starting grant a
// new team-leader login gets before an admin customizes it in the editor below.
const DEFAULT_LEADER_MENU_PERMISSIONS: Record<string, string> = {
  dashboard: 'full',
  messages: 'full',
  towers: 'full',
  teams: 'full',
  knowledge_base: 'full',
};

interface TeamFormState {
  name: string;
  leader_name: string;
  leader_phone: string;
  leader_user_id: string;
  mission: string;
  mission_from: string;
  mission_to: string;
  primary_sector: string;
  daily_target: string;
  start_date: string;
  end_date: string;
  status: string;
  notes: string;
}

const emptyForm: TeamFormState = {
  name: '',
  leader_name: '',
  leader_phone: '',
  leader_user_id: '',
  mission: '',
  mission_from: '',
  mission_to: '',
  primary_sector: '',
  daily_target: '',
  start_date: localInspectionDate(),
  end_date: '',
  status: 'active',
  notes: '',
};

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  paused: 'warning',
  completed: 'default',
};

export function TeamsPage() {
  useLanguage();
  const { data: teams, isLoading, isError, error: teamsError, fetchStatus, isFetching, refetch } = useTeams();
  const {online}=useOffline();
  const notice=queryNotice({error:teamsError,hasData:!!teams,online,paused:fetchStatus==='paused',isError});
  const blocked=!teams||!!notice?.hideData;
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const deleteUser = useDeleteUser();
  const navigate = useNavigate();
  const { user } = useAuth();
  // A restricted admin's "manage_teams" level: creating a team needs "add", archiving/deleting one
  // needs "full" (routers/teams.py's create_team vs. delete_team) — a team_leader's own PATCH
  // access (edit) still works via the backend's per-team scoping regardless of this.
  const teamsLevel =
    user?.role === 'admin'
      ? user.is_super_admin
        ? 'full'
        : getPermissionLevel(user.permissions, 'manage_teams')
      : user?.role === 'reviewer'
        ? 'full'
        : 'view';
  const canAddTeam = teamsLevel === 'add' || teamsLevel === 'full';
  const canManageTeams = teamsLevel === 'full';
  // Managing team-leader logins (creating them, seeing every username) is admin-only on the
  // backend — a reviewer can manage team fields but not accounts.
  const isAdmin = user?.role === 'admin';
  // A restricted admin's "manage_users" level — routers/auth.py's create_user needs "add" to
  // create a team leader, and update_user/delete_user need "full" to edit/deactivate/delete one.
  // A super admin always has "full"; nobody else (reviewer, team_leader) reaches this section at
  // all (see the isAdmin gate around the "Team leaders" card below), so this only ever matters for
  // an admin sub-account.
  const usersLevel = isAdmin ? (user!.is_super_admin ? 'full' : getPermissionLevel(user!.permissions, 'manage_users')) : 'view';
  const canAddUsers = usersLevel === 'add' || usersLevel === 'full';
  const canManageUsers = usersLevel === 'full';
  const { data: allUsers } = useUsers(isAdmin);
  const teamLeaders = (allUsers || []).filter((u) => u.role === 'team_leader');
  const teamById = new Map((teams || []).map((t) => [t.id, t.name]));

  const [teamSearch, setTeamSearch] = useState('');
  const [teamStatus,setTeamStatus]=useState('all');
  const visibleTeams = (teams || []).filter(team => (teamStatus==='all'||team.status===teamStatus)&&`${team.name} ${team.leader_name || ''} ${team.mission || ''}`.toLocaleLowerCase().includes(teamSearch.trim().toLocaleLowerCase()));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [form, setForm] = useState<TeamFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // ---------- Row action menus (Teams table + Team leaders table) — one shared anchor, keyed by a
  // "kind:id" string so both tables' kebab menus can reuse the same state/handlers. ----------
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>, target: string) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuTarget(target);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuTarget(null);
  };

  const handleDeleteTeam = (t: Team) => {
    closeMenu();
    const parts = [`Delete "${t.name}" permanently?`];
    if (t.mission_count > 0) {
      parts.push(`This destroys all ${t.mission_count} mission${t.mission_count === 1 ? '' : 's'} it ever ran — every position, image, and photo on them.`);
    }
    if (t.linked_user_count > 0) {
      parts.push(`Its ${t.linked_user_count} linked login${t.linked_user_count === 1 ? '' : 's'} (leader and/or members) will be deleted too.`);
    }
    parts.push('Towers assigned to it are kept, just unassigned. This cannot be undone.');
    if (window.confirm(parts.join(' '))) deleteTeam.mutate(t.id);
  };

  const handleDeleteLeader = (u: AdminUser) => {
    closeMenu();
    const message = `Delete ${u.full_name || u.username}'s login? If they've already been assigned real missions, this deactivates their account instead of deleting it.`;
    if (window.confirm(message)) deleteUser.mutate(u.id);
  };

  // ---------- Group tower assignment, right from the create/edit dialog — the tick-box picker
  // (TowerAssignmentPicker) handles filtering/selection; applied as a bulk-assign delta right after
  // the team itself is saved (see handleSave below). ----------
  const { data: allTowers } = useTowers();
  const { data: areas } = useAreas();
  const bulkAssign = useBulkAssignTowers();
  const [selectedTowerIds, setSelectedTowerIds] = useState<Set<number>>(new Set());
  const [initialTowerIds, setInitialTowerIds] = useState<Set<number>>(new Set());

  // ---------- Team leader profiles (created independently, then picked from the dropdown above) ----------
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const [leaderDialogOpen, setLeaderDialogOpen] = useState(false);
  const [editingLeader, setEditingLeader] = useState<AdminUser | null>(null);
  const [leaderForm, setLeaderForm] = useState({
    full_name: '',
    mobile: '',
    address: '',
    username: '',
    password: '',
    notes: '',
    menu_permissions: DEFAULT_LEADER_MENU_PERMISSIONS,
  });
  const [leaderError, setLeaderError] = useState<string | null>(null);

  const openCreateLeader = () => {
    setEditingLeader(null);
    setLeaderForm({
      full_name: '',
      mobile: '',
      address: '',
      username: '',
      password: '',
      notes: '',
      menu_permissions: DEFAULT_LEADER_MENU_PERMISSIONS,
    });
    setLeaderError(null);
    setLeaderDialogOpen(true);
  };

  const openEditLeader = (u: AdminUser) => {
    setEditingLeader(u);
    setLeaderForm({
      full_name: u.full_name || '',
      mobile: u.mobile || '',
      address: u.address || '',
      username: u.username,
      password: '',
      notes: u.notes || '',
      menu_permissions: u.menu_permissions ?? DEFAULT_LEADER_MENU_PERMISSIONS,
    });
    setLeaderError(null);
    setLeaderDialogOpen(true);
  };

  const handleSaveLeader = async () => {
    setLeaderError(null);
    if (leaderForm.username.trim().length < 3) {
      setLeaderError(tr("Username needs at least 3 characters."));
      return;
    }
    if (!editingLeader && leaderForm.password.length < 6) {
      setLeaderError(tr("Password needs at least 6 characters."));
      return;
    }
    try {
      if (editingLeader) {
        if (leaderForm.password && leaderForm.password.length < 6) {
          setLeaderError(tr("New password needs at least 6 characters."));
          return;
        }
        await updateUser.mutateAsync({
          id: editingLeader.id,
          payload: {
            username: leaderForm.username.trim(),
            full_name: leaderForm.full_name.trim() || undefined,
            mobile: leaderForm.mobile.trim() || undefined,
            address: leaderForm.address.trim() || undefined,
            notes: leaderForm.notes.trim() || undefined,
            menu_permissions: leaderForm.menu_permissions,
            ...(leaderForm.password ? { password: leaderForm.password } : {}),
          },
        });
      } else {
        await createUser.mutateAsync({
          username: leaderForm.username.trim(),
          password: leaderForm.password,
          full_name: leaderForm.full_name.trim() || undefined,
          mobile: leaderForm.mobile.trim() || undefined,
          address: leaderForm.address.trim() || undefined,
          notes: leaderForm.notes.trim() || undefined,
          role: 'team_leader',
          team_id: null,
          menu_permissions: leaderForm.menu_permissions,
        });
      }
      setLeaderDialogOpen(false);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not save this team leader';
      setLeaderError(message);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setSelectedTowerIds(new Set());
    setInitialTowerIds(new Set());
    setOpen(true);
  };

  const openEdit = (t: Team, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(t);
    setForm({
      name: t.name,
      leader_name: t.leader_name || '',
      leader_phone: t.leader_phone || '',
      leader_user_id: t.leader_user_id != null ? String(t.leader_user_id) : '',
      mission: t.mission || '',
      mission_from: t.mission_from || '',
      mission_to: t.mission_to || '',
      primary_sector: t.primary_sector || '',
      daily_target: t.daily_target != null ? String(t.daily_target) : '',
      start_date: t.start_date || '',
      end_date: t.end_date || '',
      status: t.status,
      notes: t.notes || '',
    });
    setError(null);
    const alreadyAssigned = new Set((allTowers || []).filter((tw) => tw.assigned_team_id === t.id).map((tw) => tw.id));
    setSelectedTowerIds(alreadyAssigned);
    setInitialTowerIds(alreadyAssigned);
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError(tr("Team name is required"));
      return;
    }
    const payload = {
      name: form.name.trim(),
      leader_name: form.leader_name.trim() || null,
      leader_phone: form.leader_phone.trim() || null,
      leader_user_id: form.leader_user_id ? Number(form.leader_user_id) : null,
      mission: form.mission.trim() || null,
      mission_from: form.mission_from.trim() || null,
      mission_to: form.mission_to.trim() || null,
      primary_sector: form.primary_sector.trim() || null,
      daily_target: form.daily_target.trim() ? Number(form.daily_target) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };
    try {
      const teamId = editing ? editing.id : (await createTeam.mutateAsync(payload)).id;
      if (editing) {
        await updateTeam.mutateAsync({ id: editing.id, payload });
      }
      // Apply the tower-selection delta as one or two bulk-assign calls — this is what actually
      // makes the team responsible for these towers (Tower.assigned_team_id), same mechanism as
      // the Towers page's own bulk-assign action.
      const added = Array.from(selectedTowerIds).filter((id) => !initialTowerIds.has(id));
      const removed = Array.from(initialTowerIds).filter((id) => !selectedTowerIds.has(id));
      if (added.length > 0) await bulkAssign.mutateAsync({ tower_ids: added, team_id: teamId });
      if (removed.length > 0) await bulkAssign.mutateAsync({ tower_ids: removed, team_id: null });
      setOpen(false);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not save team';
      setError(message);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><Avatar sx={{ width: 54, height: 54, bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: '18px' }}><EngineeringRounded sx={{ fontSize: 34 }} /></Avatar><Typography variant="h4" sx={{ fontWeight: 800 }}>{tr("Teams")}</Typography></Stack>
          <Typography color="text.secondary">{tr("Open a team to assign towers, continue inspections and review its work.")}</Typography>
        </Box>
        {canAddTeam && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{tr("Add team")}</Button>
        )}
      </Stack>

      {notice&&<Alert severity={notice.kind==='permission'?'error':'warning'} action={notice.kind!=='permission'&&<Button color="inherit" disabled={!online||isFetching} onClick={()=>void refetch()} startIcon={<RefreshRounded/>}>{tr('Try again')}</Button>}>{tr(notice.message)}</Alert>}
      {isLoading&&!notice&&<Box role="status"><LinearProgress/><Typography variant="body2" color="text.secondary" sx={{mt:1}}>{tr('Loading your teams…')}</Typography></Box>}

      {!blocked && <TeamJourney teams={teams || []} canPlan={canManageTeams || user?.role === 'team_leader'} />}
      {!blocked && <TeamInspectionGuide teams={teams || []} />}

      {!blocked && (
      <DashboardSection icon={<GroupsIcon />} title={tr("Choose your team")} eyebrow={tr("YOUR FIELD CREWS")} tone="green"
        description={tr("Open a crew to plan its route, continue tower visits and review completed work.")}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
          <TextField size="small" label={tr("Find a team or leader")} value={teamSearch} onChange={event => setTeamSearch(event.target.value)} sx={{ flex: 1 }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded /></InputAdornment> } }} />
          <Chip icon={<GroupsIcon />} label={tr("Teams: {0}", [visibleTeams.length])} variant="outlined" />
        </Stack>
        <Stack direction="row" role="group" aria-label={tr('Filter teams by status')} sx={{gap:1,flexWrap:'wrap',mb:2}}>{['all','active','paused','completed'].map(status=><Chip key={status} label={tr(status==='all'?'All teams':status==='active'?'Active':status==='paused'?'Paused':'Completed')} variant={teamStatus===status?'filled':'outlined'} color={teamStatus===status?'primary':'default'} onClick={()=>setTeamStatus(status)} aria-pressed={teamStatus===status}/>)}</Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 330px), 1fr))', gap: 2 }}>
          {visibleTeams.map(t => <Paper component="article" key={t.id} variant="outlined" sx={{ p: 2.5, borderRadius: '22px', borderTop: '3px solid', borderTopColor: t.status === 'active' ? 'success.main' : 'divider', display: 'flex', flexDirection: 'column', gap: 1.8 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ width: 48, height: 48, bgcolor: 'action.hover', color: 'primary.main', borderRadius: '16px' }}><EngineeringRounded sx={{ fontSize: 30 }} /></Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontSize: '1.12rem', fontWeight: 800, overflowWrap: 'anywhere' }}>{t.name}</Typography><Chip size="small" label={tr(t.status === 'active' ? 'Active' : t.status === 'paused' ? 'Paused' : t.status === 'completed' ? 'Completed' : t.status)} color={STATUS_COLORS[t.status] || 'default'} sx={{ mt: .5 }} /></Box>
              {canManageTeams && <IconButton size="small" aria-label={tr("Team actions: {0}", [t.name])} onClick={event => openMenu(event, `team:${t.id}`)}><MoreVertIcon /></IconButton>}
            </Stack>
            <Box sx={{ p: 1.5, borderRadius: '14px', bgcolor: 'action.hover' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><BadgeIcon color="primary" /><Box><Typography variant="caption" color="text.secondary">{tr("Team leader")}</Typography><Typography sx={{ fontWeight: 700 }}>{t.leader_name || tr("Leader not assigned")}</Typography>{t.leader_phone && <Typography variant="caption" dir="ltr">{t.leader_phone}</Typography>}</Box></Stack></Box>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}><Chip icon={<TransmissionTowerIcon />} variant="outlined" label={tr("Assigned towers: {0}", [allTowers ? allTowers.filter(tower => tower.is_active && tower.assigned_team_id === t.id).length : '—'])} /><Chip icon={<GroupsIcon />} variant="outlined" label={tr("Members: {0}", [t.members.length])} /></Stack>
            {t.mission && <Box><Typography variant="caption" color="text.secondary">{tr("Team brief")}</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{t.mission}</Typography></Box>}
            {(t.mission_from || t.mission_to) && <Typography variant="caption" color="text.secondary">{t.mission_from || '—'} → {t.mission_to || '—'}</Typography>}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}><CalendarMonthRounded fontSize="small" /><Typography variant="caption">{t.start_date || tr("Date not set")}{t.end_date ? ` → ${t.end_date}` : ''}</Typography></Stack>
            <Button variant="contained" disableElevation onClick={() => navigate(`/teams/${t.id}`)} aria-label={tr("Open team: {0}", [t.name])} endIcon={<ArrowForwardRounded sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />} sx={{ mt: 'auto', alignSelf: 'flex-start' }}>{tr("Open team")}</Button>
          </Paper>)}
        </Box>
        {!isLoading && !visibleTeams.length && <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', py: 4 }}><GroupsIcon sx={{ fontSize: 48, color: 'text.secondary' }} /><Typography color="text.secondary">{tr(teams?.length ? "No teams match your search." : "No teams yet. Add one to start tracking a crew's mission and daily progress.")}</Typography>{(teamSearch||teamStatus!=='all')&&<Button onClick={()=>{setTeamSearch('');setTeamStatus('all')}}>{tr('Clear filters')}</Button>}</Stack>}
      </DashboardSection>
      )}

      {!blocked && <DashboardSection defaultExpanded={false} icon={<InsightsRounded />} tone="violet" title={tr('Performance')} description={tr("Compare recorded team activity and see where follow-up is needed.")}><TeamActivitySummary /></DashboardSection>}

      {isAdmin && !blocked && (
        <DashboardSection defaultExpanded={false} icon={<BadgeIcon />} tone="amber" title={tr("Team leaders & logins")} description={tr("Set up leader accounts once, then connect each leader to their team.")}><Card sx={{ boxShadow: 'none' }}>
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{tr("Team leaders")}</Typography>
                <Typography variant="body2" color="text.secondary">{tr("Add a team leader's details and login once, then pick them from the dropdown when creating or editing a team. A leader who isn't leading a team yet shows as \"Unassigned\".")}</Typography>
              </Box>
              {canAddUsers && (
                <Button variant="outlined" startIcon={<BadgeIcon />} onClick={openCreateLeader}>{tr("Add team leader")}</Button>
              )}
            </Stack>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{tr("Name")}</TableCell>
                    <TableCell>{tr("Mobile")}</TableCell>
                    <TableCell>{tr("Address")}</TableCell>
                    <TableCell>{tr("Username")}</TableCell>
                    <TableCell>{tr("Assigned team")}</TableCell>
                    <TableCell>{tr("Status")}</TableCell>
                    <TableCell align="right">{tr("Actions")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {teamLeaders.map((u) => (
                    <TableRow key={u.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{u.full_name || '-'}</TableCell>
                      <TableCell>{u.mobile || '-'}</TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        <Typography variant="body2" noWrap title={u.address || ''}>
                          {u.address || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>{u.username}</TableCell>
                      <TableCell>
                        {u.team_id != null ? (
                          <Chip size="small" color="primary" label={teamById.get(u.team_id) || tr("Team #{0}", [u.team_id])} />
                        ) : (
                          <Chip size="small" variant="outlined" label={tr("Unassigned")} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={u.is_active ? 'success' : 'default'} label={u.is_active ? tr("Active") : tr("Deactivated")} />
                      </TableCell>
                      <TableCell align="right">
                        {canManageUsers && (
                          <IconButton size="small" onClick={(e) => openMenu(e, `leader:${u.id}`)}>
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {teamLeaders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography color="text.secondary" sx={{ py: 2 }}>{tr("No team leaders yet — add one above, then pick them when creating a team.")}</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card></DashboardSection>
      )}

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}>
        {menuTarget?.startsWith('team:') &&
          (() => {
            const t = teams?.find((x) => x.id === Number(menuTarget!.slice(5)));
            if (!t) return null;
            return [
              // Editing an existing team's details needs "full" on the backend, same as deleting
              // one (routers/teams.py's update_team) — a restricted admin with only "view" or "add"
              // never gets past that PATCH, so don't offer a button that will just 403.
              canManageTeams && (
                <MenuItem
                  key="edit"
                  onClick={(e) => {
                    closeMenu();
                    openEdit(t, e as unknown as React.MouseEvent);
                  }}
                >
                  <ListItemIcon>
                    <EditIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{tr("Edit team")}</ListItemText>
                </MenuItem>
              ),
              canManageTeams && <Divider key="div" />,
              canManageTeams && (
                <MenuItem key="delete" onClick={() => handleDeleteTeam(t)} sx={{ color: 'error.main' }}>
                  <ListItemIcon>
                    <DeleteIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  <ListItemText>{tr("Delete team")}</ListItemText>
                </MenuItem>
              ),
            ];
          })()}
        {menuTarget?.startsWith('leader:') &&
          (() => {
            const u = teamLeaders.find((x) => x.id === Number(menuTarget!.slice(7)));
            if (!u) return null;
            return [
              <MenuItem
                key="edit"
                onClick={() => {
                  closeMenu();
                  openEditLeader(u);
                }}
              >
                <ListItemIcon>
                  <EditIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{tr("Edit")}</ListItemText>
              </MenuItem>,
              u.is_active && (
                <MenuItem
                  key="deactivate"
                  onClick={() => {
                    closeMenu();
                    updateUser.mutate({ id: u.id, payload: { is_active: false } });
                  }}
                >
                  <ListItemIcon>
                    <ArchiveIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{tr("Deactivate login")}</ListItemText>
                </MenuItem>
              ),
              !u.is_active && (
                <MenuItem
                  key="reactivate"
                  onClick={() => {
                    closeMenu();
                    updateUser.mutate({ id: u.id, payload: { is_active: true } });
                  }}
                >
                  <ListItemIcon>
                    <ArchiveIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{tr("Reactivate login")}</ListItemText>
                </MenuItem>
              ),
              <Divider key="div" />,
              <MenuItem key="delete" onClick={() => handleDeleteLeader(u)} sx={{ color: 'error.main' }}>
                <ListItemIcon>
                  <DeleteIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText>{tr("Delete")}</ListItemText>
              </MenuItem>,
            ];
          })()}
      </Menu>

      <Dialog open={leaderDialogOpen} onClose={() => setLeaderDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingLeader ? tr("Edit {0}", [editingLeader.full_name || editingLeader.username]) : tr("Add a team leader")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {leaderError && <Alert severity="error">{tr(leaderError)}</Alert>}
            <TextField
              label={tr("Full name")}
              fullWidth
              value={leaderForm.full_name}
              onChange={(e) => setLeaderForm((f) => ({ ...f, full_name: e.target.value }))}
              autoFocus
            />
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  label={tr("Mobile")}
                  fullWidth
                  value={leaderForm.mobile}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, mobile: e.target.value }))}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label={tr("Address")}
                  fullWidth
                  value={leaderForm.address}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, address: e.target.value }))}
                />
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  label={tr("Username")}
                  fullWidth
                  value={leaderForm.username}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, username: e.target.value }))}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label={editingLeader ? tr("Reset password (optional)") : tr("Password")}
                  type="password"
                  fullWidth
                  value={leaderForm.password}
                  helperText={editingLeader ? tr("Leave blank to keep their current password") : tr("At least 6 characters")}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, password: e.target.value }))}
                />
              </Grid>
            </Grid>
            <TextField
              label={tr("Notes")}
              multiline
              minRows={2}
              value={leaderForm.notes}
              onChange={(e) => setLeaderForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={tr("Anything worth knowing about this leader")}
            />
            <Divider />
            <MenuPermissionsEditor
              value={leaderForm.menu_permissions}
              onChange={(next) => setLeaderForm((f) => ({ ...f, menu_permissions: next }))}
            />
            {!editingLeader && (
              <Alert severity="info">{tr("This creates their login. Assign them to a team from the team's \"Team leader\" dropdown above.")}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaderDialogOpen(false)}>{tr("Cancel")}</Button>
          <Button variant="contained" onClick={handleSaveLeader} disabled={createUser.isPending || updateUser.isPending}>{tr("Save")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? tr("Edit {0}", [editing.name]) : tr("Add a new team")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{tr(error)}</Alert>}
            <TextField
              label={tr("Team name")}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
              required
            />
            {isAdmin && (
              <TextField
                select
                label={tr("Team leader (linked login)")}
                fullWidth
                value={form.leader_user_id}
                helperText={tr("Pick from the team leaders you've added below — their name & mobile fill in automatically.")}
                onChange={(e) => {
                  const value = e.target.value;
                  const picked = teamLeaders.find((u) => String(u.id) === value);
                  setForm((f) => ({
                    ...f,
                    leader_user_id: value,
                    leader_name: picked ? picked.full_name || picked.username : f.leader_name,
                    leader_phone: picked ? picked.mobile || '' : f.leader_phone,
                  }));
                }}
              >
                <MenuItem value="">{tr("No linked login — enter name/phone manually below")}</MenuItem>
                {teamLeaders.map((u) => {
                  const assignedElsewhere = u.team_id != null && u.team_id !== editing?.id;
                  return (
                    <MenuItem key={u.id} value={String(u.id)} disabled={assignedElsewhere}>
                      {u.full_name || u.username} ({u.username})
                      {assignedElsewhere ? tr(" — leads {0}", [teamById.get(u.team_id!) || tr("another team")]) : ''}
                    </MenuItem>
                  );
                })}
              </TextField>
            )}
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  label={tr("Team leader")}
                  fullWidth
                  value={form.leader_name}
                  disabled={!!form.leader_user_id}
                  helperText={form.leader_user_id ? tr("From the linked login") : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, leader_name: e.target.value }))}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label={tr("Leader phone")}
                  fullWidth
                  value={form.leader_phone}
                  disabled={!!form.leader_user_id}
                  helperText={form.leader_user_id ? tr("From the linked login") : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, leader_phone: e.target.value }))}
                />
              </Grid>
            </Grid>
            <TextField
              label={tr("Team brief")}
              multiline
              minRows={2}
              value={form.mission}
              onChange={(e) => setForm((f) => ({ ...f, mission: e.target.value }))}
              placeholder={tr("e.g. Thermal + visual inspection of the OHL1/OHL2 insulator strings")}
            />
            <Grid container spacing={2}>
              <Grid size={7}>
                <TextField
                  label={tr("Primary line sector (optional)")}
                  fullWidth
                  helperText={tr("Which Tower 'Line sector' this team is primarily assigned to")}
                  value={form.primary_sector}
                  onChange={(e) => setForm((f) => ({ ...f, primary_sector: e.target.value }))}
                />
              </Grid>
              <Grid size={5}>
                <TextField
                  label={tr("Daily target (towers/day)")}
                  type="number"
                  fullWidth
                  helperText={tr("This team's working-plan quota — shown against actual daily progress")}
                  value={form.daily_target}
                  onChange={(e) => setForm((f) => ({ ...f, daily_target: e.target.value }))}
                  slotProps={{ htmlInput: { min: 0, max: 500 } }}
                />
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid size={4}>
                <TextField
                  label={tr("Start date")}
                  type="date"
                  fullWidth
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={4}>
                <TextField
                  label={tr("End date")}
                  type="date"
                  fullWidth
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={4}>
                <TextField
                  label={tr("Status")}
                  select
                  fullWidth
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <MenuItem value="active">{tr("Active")}</MenuItem>
                  <MenuItem value="paused">{tr("Paused")}</MenuItem>
                  <MenuItem value="completed">{tr("Completed")}</MenuItem>
                </TextField>
              </Grid>
            </Grid>
            <TextField
              label={tr("Notes")}
              multiline
              minRows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={tr("Anything else worth knowing about this team or mission")}
            />

            <TowerAssignmentPicker
              towers={allTowers || []}
              areas={areas}
              currentTeamId={editing?.id}
              selected={selectedTowerIds}
              setSelected={setSelectedTowerIds}
            />

            {!editing && (
              <Alert severity="info">{tr("Add the team's roster (members, contacts) and link their login after creating — from the team's page.")}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={createTeam.isPending || updateTeam.isPending || bulkAssign.isPending}
          >{tr("Save")}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
