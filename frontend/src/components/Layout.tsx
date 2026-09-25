import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
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
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineRounded';
import SettingsIcon from '@mui/icons-material/SettingsRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import DarkModeIcon from '@mui/icons-material/DarkModeRounded';
import LightModeIcon from '@mui/icons-material/LightModeRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import NotificationsOffRoundedIcon from '@mui/icons-material/NotificationsOffRounded';

import LockResetIcon from '@mui/icons-material/LockResetRounded';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTracking } from '../hooks/useFieldTracking';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useChangePassword, useChannelUnread } from '../api/hooks';
import { useOffline } from '../offline/OfflineProvider';
import { OfflineBanner, OfflineChip } from '../offline/OfflineStatus';
import { useColorMode } from '../theme/ColorModeContext';
import { SplashScreen } from './SplashScreen';
import { FloatingHelpChat } from './FloatingHelpChat';
import { FieldNoticeboard } from './FieldNoticeboard';

const drawerWidth = 232;

const SEEN_KEY = 'iip_channel_seen_id';

/** Live unread-count badge for the Messages nav item — cheap poll (counts only, see
 * routers/channel.channel_unread_count), and marks everything read the moment you're actually
 * looking at the Messages page rather than requiring an explicit "mark read" action. */
function useMessagesUnreadCount() {
  const location = useLocation();
  const [seenId, setSeenId] = useState<number>(() => Number(localStorage.getItem(SEEN_KEY) || 0));
  const { data } = useChannelUnread(seenId);
  useEffect(() => {
    if (location.pathname === '/messages' && data?.latest_id != null && data.latest_id > seenId) {
      setSeenId(data.latest_id);
      localStorage.setItem(SEEN_KEY, String(data.latest_id));
    }
  }, [location.pathname, data?.latest_id, seenId]);
  return location.pathname === '/messages' ? 0 : data?.unread_count || 0;
}

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

/** One tap to turn on lock-screen notifications for new Messages traffic (see services/push.py
 * and public/sw.js) — per-browser/device, same as WhatsApp Web vs. the phone app. Hidden entirely
 * on a browser with no Push API support (e.g. iOS Safari unless added to the home screen). */
function NotificationBell() {
  const { status, busy, error, enable, disable } = usePushNotifications();
  if (status === 'unsupported') return null;
  const subscribed = status === 'subscribed';
  const label =
    error ||
    (status === 'denied'
      ? 'Notifications are blocked — allow them in your browser/site settings'
      : subscribed
        ? 'Notifications on for new messages — click to turn off'
        : 'Turn on notifications for new messages');
  return (
    <Tooltip title={label}>
      <span>
        <IconButton color="inherit" disabled={busy || status === 'denied'} onClick={() => (subscribed ? disable() : enable())}>
          {status === 'denied' ? (
            <NotificationsOffRoundedIcon />
          ) : subscribed ? (
            <NotificationsActiveRoundedIcon />
          ) : (
            <NotificationsNoneRoundedIcon />
          )}
        </IconButton>
      </span>
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
                : '1. Tap the green button.  2. Tap Allow on the popup at the top of the phone. After that, tracking runs by itself every 10 seconds — keep this screen open (don’t lock the phone) for it to stay live.'}
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
  const { mode, toggleMode } = useColorMode();
  const isClient = user?.role === 'client';
  const unreadMessages = useMessagesUnreadCount();

  // Every possible sidebar item, in display order — which ones actually render for this account
  // is driven entirely by user.menu_permissions (an item with no grant there is skipped below,
  // not just disabled). See backend deps.default_menu_permissions_for_role for the starting grant
  // each role gets, and routers/auth.py's create_user/update_user for how an admin customizes it —
  // this replaces what used to be a fixed role-based nav hardcoded here.
  const navItemDefs: { id: string; label: string; to: string; icon: ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', to: '/', icon: <DashboardIcon /> },
    { id: 'towers', label: 'Towers', to: '/towers', icon: <TowerIcon /> },
    { id: 'image_archive', label: 'Image Archive', to: '/archive', icon: <PhotoLibraryIcon /> },
    // A client (customer) login's report link goes to the portal page, not the staff one — see
    // App.tsx's route guard for the server-side-equivalent enforcement (app/client_guard.py).
    { id: 'reports', label: 'Reports', to: isClient ? '/client-reports' : '/reports', icon: <AssessmentIcon /> },
    {
      id: 'messages',
      label: 'Messages',
      to: '/messages',
      icon: (
        <Badge badgeContent={unreadMessages} color="error" max={99}>
          <ForumRoundedIcon />
        </Badge>
      ),
    },
    {
      id: 'teams',
      label: user?.team_id ? 'Our team' : 'Teams',
      to: user?.team_id ? `/teams/${user.team_id}` : '/teams',
      icon: <GroupsIcon />,
    },
    { id: 'field_tracker', label: 'Field Tracker', to: '/field-tracker', icon: <MyLocationIcon /> },
    { id: 'team_progress', label: 'Team Progress', to: '/team-progress', icon: <InsightsIcon /> },
    { id: 'knowledge_base', label: 'Knowledge base', to: '/knowledge-base', icon: <MenuBookRoundedIcon /> },
    { id: 'settings', label: 'Settings', to: '/settings', icon: <SettingsIcon /> },
  ];
  const items = navItemDefs.filter((def) => !!user?.menu_permissions?.[def.id]);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const drawerContent = (
    <>
      <Toolbar />
      <List sx={{ px: 1, pt: 2 }}>
        {items.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileNavOpen(false)}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              '&.active': {
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
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
    </>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="primary"
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, width: '100%' }}
      >
        <Toolbar sx={{ gap: { xs: 0.5, md: 1.5 }, px: { xs: 1, sm: 2 } }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setMobileNavOpen(true)}
            sx={{ display: { xs: 'inline-flex', md: 'none' } }}
          >
            <MenuRoundedIcon />
          </IconButton>
          <BoltIcon sx={{ display: { xs: 'none', sm: 'block' } }} />
          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{ fontWeight: 800, flexGrow: 1, display: { xs: 'none', sm: 'block' } }}
          >
            Insulator Inspector Pro
          </Typography>
          <Box sx={{ flexGrow: { xs: 1, sm: 0 } }} />

          {/* Desktop: every status/action visible inline, unchanged from before. */}
          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.5 }}>
            <OfflineChip />
            <TrackingChip />
            <Tooltip title="Step-by-step guides for the daily/mission routine">
              <Button
                color="inherit"
                size="small"
                startIcon={<HelpOutlineIcon />}
                onClick={() => navigate('/help')}
                sx={{ borderRadius: 5, px: 1.5, bgcolor: 'rgba(255,255,255,0.12)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
              >
                Help me
              </Button>
            </Tooltip>
            <Typography variant="body2" sx={{ opacity: 0.9, mr: 1 }}>
              {user?.full_name || user?.username} · {user?.role}
            </Typography>
            <NotificationBell />
            <Tooltip title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              <IconButton color="inherit" onClick={toggleMode}>
                {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
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
          </Box>

          {/* Mobile: only what needs to be glanceable at all times — GPS status and any offline/
              sync notice — everything else (help, theme, notifications, logout) moves into the
              avatar menu below so the toolbar never overflows a phone-width screen. */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center' }}>
            <OfflineChip />
            <TrackingChip />
          </Box>

          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ p: 0.5, ml: { xs: 0.5, md: 0 } }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main', color: 'secondary.contrastText', fontWeight: 700 }}>
              {(user?.full_name || user?.username || '?').slice(0, 1).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
            <MenuItem disabled sx={{ display: { xs: 'flex', md: 'none' }, opacity: '1 !important' }}>
              <Typography variant="body2" color="text.secondary">
                {user?.full_name || user?.username} · {user?.role}
              </Typography>
            </MenuItem>
            <Box sx={{ display: { xs: 'block', md: 'none' } }}>
              <Divider />
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  navigate('/help');
                }}
              >
                <ListItemIcon>
                  <HelpOutlineIcon fontSize="small" />
                </ListItemIcon>
                Help me
              </MenuItem>
              <MenuItem
                onClick={() => {
                  toggleMode();
                  setMenuAnchor(null);
                }}
              >
                <ListItemIcon>{mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}</ListItemIcon>
                {mode === 'dark' ? 'Light theme' : 'Dark theme'}
              </MenuItem>
            </Box>
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
            <Box sx={{ display: { xs: 'block', md: 'none' } }}>
              <Divider />
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  logout();
                  navigate('/login');
                }}
              >
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                Log out
              </MenuItem>
            </Box>
          </Menu>
        </Toolbar>
      </AppBar>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileNavOpen : true}
        onClose={() => setMobileNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box', borderRight: '1px solid', borderColor: 'divider' },
        }}
      >
        {drawerContent}
      </Drawer>
      <Box
        component="main"
        sx={{ flexGrow: 1, p: { xs: 1.5, sm: 3 }, width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` }, minWidth: 0 }}
      >
        <Toolbar />
        <Box sx={{ mx: { xs: -1.5, sm: -3 }, mt: { xs: -1.5, sm: -3 }, mb: 2 }}>
          <OfflineBanner />
          <LocationBanner />
        </Box>
        <FieldNoticeboard>{children}</FieldNoticeboard>
      </Box>
      <ChangePasswordDialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)} />
      <SplashScreen />
      <FloatingHelpChat />
    </Box>
  );
}
