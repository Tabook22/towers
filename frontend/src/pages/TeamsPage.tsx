import { useState } from 'react';
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
  start_date: new Date().toISOString().slice(0, 10),
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
  const { data: teams, isLoading } = useTeams();
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
  const { data: allUsers } = useUsers(isAdmin);
  const teamLeaders = (allUsers || []).filter((u) => u.role === 'team_leader');
  const teamById = new Map((teams || []).map((t) => [t.id, t.name]));

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
  });
  const [leaderError, setLeaderError] = useState<string | null>(null);

  const openCreateLeader = () => {
    setEditingLeader(null);
    setLeaderForm({ full_name: '', mobile: '', address: '', username: '', password: '', notes: '' });
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
    });
    setLeaderError(null);
    setLeaderDialogOpen(true);
  };

  const handleSaveLeader = async () => {
    setLeaderError(null);
    if (!editingLeader && (!leaderForm.username.trim() || leaderForm.password.length < 6)) {
      setLeaderError('Username is required, and password needs at least 6 characters.');
      return;
    }
    try {
      if (editingLeader) {
        if (leaderForm.password && leaderForm.password.length < 6) {
          setLeaderError('New password needs at least 6 characters.');
          return;
        }
        await updateUser.mutateAsync({
          id: editingLeader.id,
          payload: {
            full_name: leaderForm.full_name.trim() || undefined,
            mobile: leaderForm.mobile.trim() || undefined,
            address: leaderForm.address.trim() || undefined,
            notes: leaderForm.notes.trim() || undefined,
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
      setError('Team name is required');
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
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Teams
          </Typography>
          <Typography color="text.secondary">
            Field crews, their rosters, missions, and day-by-day progress along the line.
          </Typography>
        </Box>
        {canAddTeam && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Add team
          </Button>
        )}
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Team</TableCell>
              <TableCell>Leader</TableCell>
              <TableCell>Mission</TableCell>
              <TableCell>Dates</TableCell>
              <TableCell align="center">Members</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {teams?.map((t) => (
              <TableRow key={t.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/teams/${t.id}`)}>
                <TableCell sx={{ fontWeight: 700 }}>{t.name}</TableCell>
                <TableCell>
                  {t.leader_name || '-'}
                  {t.leader_phone && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t.leader_phone}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="body2" noWrap title={t.mission || ''}>
                    {t.mission || '-'}
                  </Typography>
                  {(t.mission_from || t.mission_to) && (
                    <Typography variant="caption" color="text.secondary">
                      {t.mission_from || '?'} → {t.mission_to || '?'}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {t.start_date || '-'} {t.end_date ? `→ ${t.end_date}` : ''}
                </TableCell>
                <TableCell align="center">{t.members.length}</TableCell>
                <TableCell>
                  <Chip size="small" label={t.status} color={STATUS_COLORS[t.status] || 'default'} />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={(e) => openMenu(e, `team:${t.id}`)}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (!teams || teams.length === 0) && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Stack spacing={1} sx={{ alignItems: 'center', py: 3 }}>
                    <GroupsIcon color="disabled" fontSize="large" />
                    <Typography color="text.secondary">
                      No teams yet. Add one to start tracking a crew's mission and daily progress.
                    </Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {isAdmin && (
        <Card>
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Team leaders
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Add a team leader's details and login once, then pick them from the dropdown when creating or
                  editing a team. A leader who isn't leading a team yet shows as "Unassigned".
                </Typography>
              </Box>
              <Button variant="outlined" startIcon={<BadgeIcon />} onClick={openCreateLeader}>
                Add team leader
              </Button>
            </Stack>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Mobile</TableCell>
                    <TableCell>Address</TableCell>
                    <TableCell>Username</TableCell>
                    <TableCell>Assigned team</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
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
                          <Chip size="small" color="primary" label={teamById.get(u.team_id) || `Team #${u.team_id}`} />
                        ) : (
                          <Chip size="small" variant="outlined" label="Unassigned" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={u.is_active ? 'success' : 'default'} label={u.is_active ? 'Active' : 'Deactivated'} />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={(e) => openMenu(e, `leader:${u.id}`)}>
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {teamLeaders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          No team leaders yet — add one above, then pick them when creating a team.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}>
        {menuTarget?.startsWith('team:') &&
          (() => {
            const t = teams?.find((x) => x.id === Number(menuTarget!.slice(5)));
            if (!t) return null;
            return [
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
                <ListItemText>Edit team</ListItemText>
              </MenuItem>,
              canManageTeams && <Divider key="div" />,
              canManageTeams && (
                <MenuItem key="delete" onClick={() => handleDeleteTeam(t)} sx={{ color: 'error.main' }}>
                  <ListItemIcon>
                    <DeleteIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  <ListItemText>Delete team</ListItemText>
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
                <ListItemText>Edit</ListItemText>
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
                  <ListItemText>Deactivate login</ListItemText>
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
                  <ListItemText>Reactivate login</ListItemText>
                </MenuItem>
              ),
              <Divider key="div" />,
              <MenuItem key="delete" onClick={() => handleDeleteLeader(u)} sx={{ color: 'error.main' }}>
                <ListItemIcon>
                  <DeleteIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText>Delete</ListItemText>
              </MenuItem>,
            ];
          })()}
      </Menu>

      <Dialog open={leaderDialogOpen} onClose={() => setLeaderDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingLeader ? `Edit ${editingLeader.full_name || editingLeader.username}` : 'Add a team leader'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {leaderError && <Alert severity="error">{leaderError}</Alert>}
            <TextField
              label="Full name"
              fullWidth
              value={leaderForm.full_name}
              onChange={(e) => setLeaderForm((f) => ({ ...f, full_name: e.target.value }))}
              autoFocus
            />
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  label="Mobile"
                  fullWidth
                  value={leaderForm.mobile}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, mobile: e.target.value }))}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Address"
                  fullWidth
                  value={leaderForm.address}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, address: e.target.value }))}
                />
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  label="Username"
                  fullWidth
                  value={leaderForm.username}
                  disabled={!!editingLeader}
                  helperText={editingLeader ? 'Username can’t be changed once created' : undefined}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, username: e.target.value }))}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label={editingLeader ? 'Reset password (optional)' : 'Password'}
                  type="password"
                  fullWidth
                  value={leaderForm.password}
                  helperText={editingLeader ? 'Leave blank to keep their current password' : 'At least 6 characters'}
                  onChange={(e) => setLeaderForm((f) => ({ ...f, password: e.target.value }))}
                />
              </Grid>
            </Grid>
            <TextField
              label="Notes"
              multiline
              minRows={2}
              value={leaderForm.notes}
              onChange={(e) => setLeaderForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Anything worth knowing about this leader"
            />
            {!editingLeader && (
              <Alert severity="info">
                This creates their login. Assign them to a team from the team's "Team leader" dropdown above.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaderDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveLeader} disabled={createUser.isPending || updateUser.isPending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add a new team'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Team name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
              required
            />
            {isAdmin && (
              <TextField
                select
                label="Team leader (linked login)"
                fullWidth
                value={form.leader_user_id}
                helperText="Pick from the team leaders you've added below — their name & mobile fill in automatically."
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
                <MenuItem value="">No linked login — enter name/phone manually below</MenuItem>
                {teamLeaders.map((u) => {
                  const assignedElsewhere = u.team_id != null && u.team_id !== editing?.id;
                  return (
                    <MenuItem key={u.id} value={String(u.id)} disabled={assignedElsewhere}>
                      {u.full_name || u.username} ({u.username})
                      {assignedElsewhere ? ` — leads ${teamById.get(u.team_id!) || 'another team'}` : ''}
                    </MenuItem>
                  );
                })}
              </TextField>
            )}
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  label="Team leader"
                  fullWidth
                  value={form.leader_name}
                  disabled={!!form.leader_user_id}
                  helperText={form.leader_user_id ? 'From the linked login' : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, leader_name: e.target.value }))}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Leader phone"
                  fullWidth
                  value={form.leader_phone}
                  disabled={!!form.leader_user_id}
                  helperText={form.leader_user_id ? 'From the linked login' : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, leader_phone: e.target.value }))}
                />
              </Grid>
            </Grid>
            <TextField
              label="Mission"
              multiline
              minRows={2}
              value={form.mission}
              onChange={(e) => setForm((f) => ({ ...f, mission: e.target.value }))}
              placeholder="e.g. Thermal + visual inspection of the OHL1/OHL2 insulator strings"
            />
            <Grid container spacing={2}>
              <Grid size={7}>
                <TextField
                  label="Primary line sector (optional)"
                  fullWidth
                  helperText="Which Tower 'Line sector' this team is primarily assigned to"
                  value={form.primary_sector}
                  onChange={(e) => setForm((f) => ({ ...f, primary_sector: e.target.value }))}
                />
              </Grid>
              <Grid size={5}>
                <TextField
                  label="Daily target (towers/day)"
                  type="number"
                  fullWidth
                  helperText="This team's working-plan quota — shown against actual daily progress"
                  value={form.daily_target}
                  onChange={(e) => setForm((f) => ({ ...f, daily_target: e.target.value }))}
                  slotProps={{ htmlInput: { min: 0, max: 500 } }}
                />
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid size={4}>
                <TextField
                  label="Start date"
                  type="date"
                  fullWidth
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={4}>
                <TextField
                  label="End date"
                  type="date"
                  fullWidth
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={4}>
                <TextField
                  label="Status"
                  select
                  fullWidth
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="paused">Paused</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                </TextField>
              </Grid>
            </Grid>
            <TextField
              label="Notes"
              multiline
              minRows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Anything else worth knowing about this team or mission"
            />

            <TowerAssignmentPicker
              towers={allTowers || []}
              areas={areas}
              currentTeamId={editing?.id}
              selected={selectedTowerIds}
              setSelected={setSelectedTowerIds}
            />

            {!editing && (
              <Alert severity="info">
                Add the team's roster (members, contacts) and link their login after creating — from the team's page.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={createTeam.isPending || updateTeam.isPending || bulkAssign.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
