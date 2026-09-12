import { useEffect, useState, type ReactNode } from 'react';
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
import InsightsIcon from '@mui/icons-material/InsightsRounded';
import LocationDisabledIcon from '@mui/icons-material/LocationDisabledRounded';

import LockResetIcon from '@mui/icons-material/LockResetRounded';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTracking } from '../hooks/useFieldTracking';
import { useChangePassword } from '../api/hooks';
import { useOffline } from '../offline/OfflineProvider';
import { OfflineBanner, OfflineChip } from '../offline/OfflineStatus';

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
function TrackingChip() {
  const { enabled, setEnabled, status, requestNow, lastSentAt, required } = useTracking();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const ago = lastSentAt
    ? Math.max(0, Math.round((Date.now() - lastSentAt.getTime()) / 1000))
    : null;
  const liveLabel = ago == null ? 'Tracking' : ago < 60 ? `Live · ${ago}s` : `Live · ${Math.round(ago / 60)}m`;
  const label = !enabled
    ? 'Location off'
    : status === 'watching'
      ? liveLabel
      : status === 'denied'
        ? 'Permission denied'
        : 'Locating…';
  const color = !enabled ? 'default' : status === 'watching' ? 'success' : status === 'denied' ? 'error' : 'warning';
  return (
    <Tooltip
      title={
        required
          ? 'Location starts when you sign in. The path is saved on the daily team log so dispatch can follow this crew live.'
          : enabled
            ? 'Sharing your location with dispatch — click to stop'
            : 'Not sharing location — click to start'
      }
    >
      <Chip
        size="small"
        icon={enabled && status !== 'denied' ? <MyLocationIcon /> : <LocationDisabledIcon />}
        label={label}
        color={color}
        variant={enabled && status === 'watching' ? 'filled' : 'outlined'}
        onPointerDown={() => {
          if (required || !enabled || status !== 'watching') {
            if (!enabled) setEnabled(true);
            requestNow();
          }
        }}
        onClick={() => {
          if (required || !enabled || status !== 'watching') {
            if (!enabled) setEnabled(true);
            requestNow();
            return;
          }
          setEnabled(false);
        }}
        sx={{ mr: 1, '& .MuiChip-icon': { color: 'inherit' } }}
      />
    </Tooltip>
  );
}

function LocationBanner() {
  const { status, requestNow, required, needsAllow, insecure, waitingForPrompt } = useTracking();
  const { online } = useOffline();
  if (!online || !required) return null;
  if (insecure) {
    return (
      <Alert severity="error" sx={{ borderRadius: 0 }}>
        Location does not work on plain http:// — open this app with https:// (or localhost). Until
        then dispatch cannot see this team.
      </Alert>
    );
  }
  if (needsAllow || status === 'denied' || status === 'locating' || waitingForPrompt) {
    return (
      <Alert
        severity={status === 'denied' ? 'error' : waitingForPrompt ? 'info' : 'warning'}
        sx={{ borderRadius: 0, '& .MuiAlert-message': { width: '100%' } }}
      >
        <Stack spacing={1} sx={{ width: '100%' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {waitingForPrompt
              ? 'Look at the TOP of the phone now'
              : status === 'denied'
                ? 'GPS is blocked on this phone'
                : 'Dispatch needs this team’s location'}
          </Typography>
          <Typography variant="body2">
            {waitingForPrompt
              ? 'A small popup should appear at the top of the screen (or next to the lock in the address bar). Tap Allow. If nothing appears, tap the green button again.'
              : status === 'denied'
                ? 'Open the browser menu → this site’s settings → Location → Allow. Then tap the green button below.'
                : '1. Tap the green button.  2. Tap Allow on the popup at the top of the phone. After that, tracking runs by itself every minute.'}
          </Typography>
          <Button
            variant="contained"
            color="success"
            size="large"
            onPointerDown={() => requestNow()}
            onClick={() => requestNow()}
            sx={{ alignSelf: 'flex-start', fontWeight: 800, px: 2.5 }}
          >
            {waitingForPrompt ? 'Waiting for Allow… tap again if no popup' : 'Allow GPS tracking'}
          </Button>
        </Stack>
      </Alert>
    );
  }
  return null;
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
  const isCrew = user?.role === 'team_member' || user?.role === 'team_leader';
  // Teams: admin/reviewer see every team; a crew login sees (and the backend scopes them to)
  // only their own. Field Tracker is the cross-team live board, so it stays admin/reviewer only.
  const canSeeTeams = user?.role === 'admin' || user?.role === 'reviewer' || isCrew;
  const canSeeFieldTracker = user?.role === 'admin' || user?.role === 'reviewer';
  const crewNav = [
    { label: 'Dashboard', to: '/', icon: <DashboardIcon /> },
    { label: 'Towers', to: '/towers', icon: <TowerIcon /> },
    ...(user?.team_id
      ? [{ label: 'Our team', to: `/teams/${user.team_id}`, icon: <GroupsIcon /> }]
      : [{ label: 'Teams', to: '/teams', icon: <GroupsIcon /> }]),
  ];
  const items = isCrew
    ? crewNav
    : [
        ...navItems,
        ...(canSeeTeams ? [{ label: 'Teams', to: '/teams', icon: <GroupsIcon /> }] : []),
        ...(canSeeFieldTracker
          ? [
              { label: 'Field Tracker', to: '/field-tracker', icon: <MyLocationIcon /> },
              { label: 'Team Progress', to: '/team-progress', icon: <InsightsIcon /> },
            ]
          : []),
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
          <OfflineChip />
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
        <Box sx={{ mx: -3, mt: -3, mb: 2 }}>
          <OfflineBanner />
          <LocationBanner />
        </Box>
        {children}
      </Box>
      <ChangePasswordDialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} />
    </Box>
  );
}
