import { useState, type ReactNode } from 'react';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/SpaceDashboardRounded';
import TowerIcon from '@mui/icons-material/CellTowerRounded';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibraryRounded';
import AssessmentIcon from '@mui/icons-material/AssessmentRounded';
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import LogoutIcon from '@mui/icons-material/LogoutRounded';
import BoltIcon from '@mui/icons-material/BoltRounded';
import MyLocationIcon from '@mui/icons-material/MyLocationRounded';
import LocationDisabledIcon from '@mui/icons-material/LocationDisabledRounded';
import AssignmentIcon from '@mui/icons-material/AssignmentTurnedInRounded';
import LockResetIcon from '@mui/icons-material/LockResetRounded';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTracking } from '../hooks/useFieldTracking';
import { useChangePassword } from '../api/hooks';

const drawerWidth = 232;

const navItems = [
  { label: 'Dashboard', to: '/', icon: <DashboardIcon /> },
  { label: 'Towers', to: '/towers', icon: <TowerIcon /> },
  { label: 'Image Archive', to: '/archive', icon: <PhotoLibraryIcon /> },
  { label: 'Reports', to: '/reports', icon: <AssessmentIcon /> },
];

// A team_member's whole app is their own assigned missions — no dashboard, towers list, archive,
// reports, or team management, all of which are scoped away server-side anyway (see
// routers/dashboard.py, archive.py, team_activity_report.py). One nav item, one workspace.
const memberNavItems = [{ label: 'My Missions', to: '/', icon: <AssignmentIcon /> }];

function TrackingChip() {
  const { enabled, setEnabled, status } = useTracking();
  const label = !enabled ? 'Location off' : status === 'watching' ? 'Tracking' : status === 'denied' ? 'Permission denied' : 'Locating…';
  const color = !enabled ? 'default' : status === 'watching' ? 'success' : status === 'denied' ? 'error' : 'warning';
  return (
    <Tooltip title={enabled ? 'Sharing your location with dispatch — click to stop' : 'Not sharing location — click to start'}>
      <Chip
        size="small"
        icon={enabled && status !== 'denied' ? <MyLocationIcon /> : <LocationDisabledIcon />}
        label={label}
        color={color}
        variant={enabled && status === 'watching' ? 'filled' : 'outlined'}
        onClick={() => setEnabled(!enabled)}
        sx={{ mr: 1, '& .MuiChip-icon': { color: 'inherit' } }}
      />
    </Tooltip>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    setError(null);
    if (newPassword.length < 6) {
      setError('New password needs at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation don’t match.');
      return;
    }
    changePassword.mutate(
      { current_password: currentPassword, new_password: newPassword },
      {
        onSuccess: () => {
          setSuccess(true);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || 'Could not change your password.');
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Change password</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">Password changed.</Alert>}
          <TextField
            label="Current password"
            type="password"
            fullWidth
            autoFocus
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <TextField
            label="New password"
            type="password"
            fullWidth
            helperText="At least 6 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <TextField
            label="Confirm new password"
            type="password"
            fullWidth
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={changePassword.isPending || !currentPassword || !newPassword || !confirmPassword}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isTeamMember = user?.role === 'team_member';
  // Teams: admin/reviewer see every team; a team_leader sees (and the backend scopes them to)
  // only their own — same nav entry either way. Field Tracker is the cross-team live board, so it
  // stays admin/reviewer only (a team_leader already has their own team's live map on their team page).
  const canSeeTeams = user?.role === 'admin' || user?.role === 'reviewer' || user?.role === 'team_leader';
  const canSeeFieldTracker = user?.role === 'admin' || user?.role === 'reviewer';
  const items = isTeamMember
    ? memberNavItems
    : [
        ...navItems,
        ...(canSeeTeams ? [{ label: 'Teams', to: '/teams', icon: <GroupsIcon /> }] : []),
        ...(canSeeFieldTracker ? [{ label: 'Field Tracker', to: '/field-tracker', icon: <MyLocationIcon /> }] : []),
      ];

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="primary"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, width: '100%' }}
      >
        <Toolbar sx={{ gap: 1.5 }}>
          <BoltIcon />
          <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 800, flexGrow: 1 }}>
            Insulator Inspector Pro
          </Typography>
          <TrackingChip />
          <Typography variant="body2" sx={{ opacity: 0.9, mr: 1 }}>
            {user?.full_name || user?.username} · {user?.role}
          </Typography>
          <Tooltip title="Log out">
            <IconButton
              color="inherit"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <LogoutIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ p: 0.5 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main', color: '#1a1a1a', fontWeight: 700 }}>
              {(user?.full_name || user?.username || '?').slice(0, 1).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                setPasswordDialogOpen(true);
              }}
            >
              <ListItemIcon>
                <LockResetIcon fontSize="small" />
              </ListItemIcon>
              Change password
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box', borderRight: '1px solid rgba(0,0,0,0.08)' },
        }}
      >
        <Toolbar />
        <List sx={{ px: 1, pt: 2 }}>
          {items.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.to === '/'}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                '&.active': {
                  bgcolor: 'primary.main',
                  color: 'white',
                  '& .MuiListItemIcon-root': { color: 'white' },
                },
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ mt: 'auto', p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            132 kV OHL Field Inspections
            <br />
            Dufar Area &amp; beyond
          </Typography>
        </Box>
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, p: 3, width: `calc(100% - ${drawerWidth}px)` }}>
        <Toolbar />
        {children}
      </Box>
      <ChangePasswordDialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} />
    </Box>
  );
}
