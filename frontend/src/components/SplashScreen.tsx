import { useEffect, useState } from 'react';
import { Box, Button, Chip, Dialog, Divider, Grid, Stack, Typography } from '@mui/material';
import CellTowerRoundedIcon from '@mui/icons-material/CellTowerRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded';
import { useAuth } from '../auth/AuthContext';
import { useDashboardSummary } from '../api/hooks';

// Shown once per browser session (not every page navigation) — cleared on a fresh sign-in via
// AuthContext's logout, so the next person to use this device/tab sees it again too.
const SESSION_KEY = 'iip_splash_shown';

/** A one-time welcome screen for admins and team leaders when they open the app — the two company
 * logos, a quick "what's happened lately" snapshot, and a way in. Team members go straight to their
 * own missions instead (see Layout's isCrew split elsewhere) — this is deliberately not for them. */
export function SplashScreen() {
  const { user } = useAuth();
  const eligible = user?.role === 'admin' || user?.role === 'team_leader';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    setOpen(true);
  }, [eligible]);

  const { data } = useDashboardSummary(undefined, open);

  const dismiss = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // Private-window/blocked storage — just don't show it again this render; no functional loss.
    }
    setOpen(false);
  };

  if (!eligible) return null;

  const recentlyCompleted = (data?.rows || [])
    .filter((r) => r.latest_visit?.mission_status === 'completed')
    .sort((a, b) => (b.latest_visit?.inspection_date || '').localeCompare(a.latest_visit?.inspection_date || ''))
    .slice(0, 5);

  return (
    <Dialog open={open} onClose={dismiss} maxWidth="sm" fullWidth>
      <Box sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Stack direction="row" spacing={3} sx={{ alignItems: 'center', justifyContent: 'center', mb: 2 }}>
          <Box component="img" src="/branding/oetc.png" alt="Oman Electricity Transmission Company" sx={{ height: 56, objectFit: 'contain' }} />
          <Divider orientation="vertical" flexItem />
          <Box component="img" src="/branding/sky-green-line.png" alt="Sky Green Line" sx={{ height: 56, objectFit: 'contain' }} />
        </Stack>

        <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', mb: 3 }}>
          <Box
            sx={{
              width: 84,
              height: 84,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 0.5,
            }}
          >
            <CellTowerRoundedIcon sx={{ fontSize: 46 }} />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Welcome back, {user?.full_name || user?.username}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            132 kV OHL Field Inspections — Dufar Area &amp; beyond
          </Typography>
        </Stack>

        {data && (
          <Grid container spacing={1.5} sx={{ mb: 3 }}>
            <Grid size={4}>
              <Stack sx={{ alignItems: 'center', p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {data.tower_count}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Towers
                </Typography>
              </Stack>
            </Grid>
            <Grid size={4}>
              <Stack sx={{ alignItems: 'center', p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: 'error.main' }}>
                  {data.total_hotspots}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Open hotspots
                </Typography>
              </Stack>
            </Grid>
            <Grid size={4}>
              <Stack sx={{ alignItems: 'center', p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: 'warning.main' }}>
                  {data.total_images_pending}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Images pending
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        )}

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Latest work completed
        </Typography>
        {recentlyCompleted.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            No completed inspections yet — finished missions will show up here.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mb: 3 }}>
            {recentlyCompleted.map((r) => (
              <Stack
                key={r.tower.id}
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', p: 1, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
              >
                <CheckCircleRoundedIcon fontSize="small" color="success" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {r.tower.tower_id}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {r.tower.area || 'No area set'} · {r.latest_visit?.team_name || 'Unknown team'}
                  </Typography>
                </Box>
                {r.rollup && r.rollup.hotspots > 0 && (
                  <Chip
                    size="small"
                    color="error"
                    icon={<LocalFireDepartmentRoundedIcon />}
                    label={r.rollup.hotspots}
                  />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {r.latest_visit?.inspection_date}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}

        {data && data.total_images_pending > 0 && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 3, color: 'text.secondary' }}>
            <PendingActionsRoundedIcon fontSize="small" />
            <Typography variant="caption">
              {data.total_images_pending} evidence image{data.total_images_pending === 1 ? '' : 's'} still pending across every tower.
            </Typography>
          </Stack>
        )}

        <Button variant="contained" fullWidth size="large" onClick={dismiss}>
          Continue to Dashboard
        </Button>
      </Box>
    </Dialog>
  );
}
