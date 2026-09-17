import { useEffect, useState } from 'react';
import { Box, Button, Chip, Dialog, Divider, Grid, Stack, Typography } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded';
import { useAuth } from '../auth/AuthContext';
import { useBrandingSettings, useDashboardSummary } from '../api/hooks';
import { mediaUrl } from '../api/client';

// Shown once per browser session (not every page navigation) — cleared on a fresh sign-in via
// AuthContext's logout, so the next person to use this device/tab sees it again too.
const SESSION_KEY = 'iip_splash_shown';

/** A one-time welcome screen for admins and team leaders when they open the app — the OETC lockup
 * (logo + company name + Nama Group line) up front, the Sky Green Line logo as a small badge on the
 * dialog's corner, a quick "what's happened lately" snapshot, and a way in. Team members go straight
 * to their own missions instead (see Layout's isCrew split elsewhere) — this is deliberately not for
 * them. */
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
  const { data: branding } = useBrandingSettings(open);
  const oetcLogoSrc = branding?.oetc_logo_url ? mediaUrl(branding.oetc_logo_url) : '/branding/oetc.png';
  const skyGreenLogoSrc = branding?.sky_green_line_logo_url
    ? mediaUrl(branding.sky_green_line_logo_url)
    : '/branding/sky-green-line.png';
  const heroImageSrc = branding?.hero_image_url ? mediaUrl(branding.hero_image_url) : null;

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
    <Dialog
      open={open}
      onClose={dismiss}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { position: 'relative', overflow: 'visible' } } }}
    >
      {heroImageSrc && (
        <Box
          component="img"
          src={heroImageSrc}
          alt=""
          sx={{
            width: '100%',
            height: { xs: 140, sm: 180 },
            objectFit: 'cover',
            display: 'block',
            borderTopLeftRadius: 'inherit',
            borderTopRightRadius: 'inherit',
          }}
        />
      )}
      <Box
        component="img"
        src={skyGreenLogoSrc}
        alt="Sky Green Line"
        sx={{
          position: 'absolute',
          bottom: -14,
          right: -14,
          width: 72,
          height: 72,
          objectFit: 'contain',
          bgcolor: '#fff',
          borderRadius: 2,
          boxShadow: 3,
          p: 0.75,
        }}
      />
      <Box sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Stack spacing={0.25} sx={{ alignItems: 'center', textAlign: 'center', mb: 2 }}>
          <Box component="img" src={oetcLogoSrc} alt="Oman Electricity Transmission Company" sx={{ height: 110, objectFit: 'contain' }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#1a7a4c', mt: 1 }} dir="rtl">
            الشركة العُمانية لنقل الكهرباء ش.م.ع.م
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#1a7a4c' }}>
            OMAN ELECTRICITY TRANSMISSION COMPANY S.A.O.C
          </Typography>
          <Divider sx={{ width: '70%', my: 1 }} />
          <Typography variant="body2" sx={{ fontWeight: 700, color: '#c1272d' }} dir="rtl">
            إحدى شركات مجموعة نماء
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: '#c1272d' }}>
            Member of Nama Group
          </Typography>
        </Stack>

        {branding?.app_title && (
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', letterSpacing: 1.5, fontWeight: 700, mb: 1 }}
          >
            {branding.app_title}
          </Typography>
        )}

        <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', mb: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {branding?.splash_header || `Welcome back, ${user?.full_name || user?.username}`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {branding?.splash_subtitle || '132 kV OHL Field Inspections — Dufar Area & beyond'}
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
