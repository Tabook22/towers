import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUploadRounded';
import AddIcon from '@mui/icons-material/AddRounded';
import EditIcon from '@mui/icons-material/EditRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import CheckCircleIcon from '@mui/icons-material/CheckCircleRounded';
import CancelIcon from '@mui/icons-material/CancelRounded';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmptyRounded';
import {
  useBrandingSettings,
  useCreateUser,
  useDeleteUser,
  useTeams,
  useUpdateBrandingSettings,
  useUpdateUser,
  useUsers,
} from '../api/hooks';
import { mediaUrl } from '../api/client';
import { ImageCropDialog } from '../components/ImageCropDialog';
import { BrandingBanner, BrandingLogoBlock, BrandingNameRow } from '../components/BrandingPreview';
import { useAuth } from '../auth/AuthContext';
import {
  ADMIN_PERMISSION_LABELS,
  getPermissionLevel,
  LEVELED_PERMISSIONS,
  PERMISSION_LEVEL_LABELS,
  PERMISSION_LEVELS,
  setPermissionLevel,
  type AdminUser,
  type PermissionLevel,
} from '../api/types';

function BrandingSection() {
  const { data: branding } = useBrandingSettings();
  const update = useUpdateBrandingSettings();
  const [appTitle, setAppTitle] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [header, setHeader] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [oetcLogo, setOetcLogo] = useState<File | null>(null);
  const [skyLogo, setSkyLogo] = useState<File | null>(null);
  const [oetcWidth, setOetcWidth] = useState('');
  const [oetcHeight, setOetcHeight] = useState('');
  const [skyWidth, setSkyWidth] = useState('');
  const [skyHeight, setSkyHeight] = useState('');
  const [logoPosX, setLogoPosX] = useState<number | null>(null);
  const [logoPosY, setLogoPosY] = useState<number | null>(null);
  const [skyLogoPosX, setSkyLogoPosX] = useState<number | null>(null);
  const [skyLogoPosY, setSkyLogoPosY] = useState<number | null>(null);
  const [titlePosX, setTitlePosX] = useState<number | null>(null);
  const [titlePosY, setTitlePosY] = useState<number | null>(null);
  const [heroImage, setHeroImage] = useState<File | null>(null);
  const [heroRawSrc, setHeroRawSrc] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropLoading, setCropLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const oetcInputRef = useRef<HTMLInputElement>(null);
  const skyInputRef = useRef<HTMLInputElement>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!branding) return;
    setAppTitle(branding.app_title || '');
    setAppVersion(branding.app_version || '');
    setHeader(branding.splash_header || '');
    setSubtitle(branding.splash_subtitle || '');
    setOetcWidth(branding.oetc_logo_width != null ? String(branding.oetc_logo_width) : '');
    setOetcHeight(branding.oetc_logo_height != null ? String(branding.oetc_logo_height) : '');
    setSkyWidth(branding.sky_green_line_logo_width != null ? String(branding.sky_green_line_logo_width) : '');
    setSkyHeight(branding.sky_green_line_logo_height != null ? String(branding.sky_green_line_logo_height) : '');
    setLogoPosX(branding.oetc_logo_pos_x);
    setLogoPosY(branding.oetc_logo_pos_y);
    setSkyLogoPosX(branding.sky_green_line_logo_pos_x);
    setSkyLogoPosY(branding.sky_green_line_logo_pos_y);
    setTitlePosX(branding.app_title_pos_x);
    setTitlePosY(branding.app_title_pos_y);
  }, [branding]);

  const oetcPreview = oetcLogo ? URL.createObjectURL(oetcLogo) : branding?.oetc_logo_url ? mediaUrl(branding.oetc_logo_url) : null;
  const skyPreview = skyLogo
    ? URL.createObjectURL(skyLogo)
    : branding?.sky_green_line_logo_url
      ? mediaUrl(branding.sky_green_line_logo_url)
      : null;
  const heroPreview = heroImage ? URL.createObjectURL(heroImage) : branding?.hero_image_url ? mediaUrl(branding.hero_image_url) : null;

  const handleSave = () => {
    setSaved(false);
    update.mutate(
      {
        app_title: appTitle,
        app_version: appVersion,
        splash_header: header,
        splash_subtitle: subtitle,
        oetc_logo_width: oetcWidth ? Number(oetcWidth) : null,
        oetc_logo_height: oetcHeight ? Number(oetcHeight) : null,
        sky_green_line_logo_width: skyWidth ? Number(skyWidth) : null,
        sky_green_line_logo_height: skyHeight ? Number(skyHeight) : null,
        oetc_logo_pos_x: logoPosX,
        oetc_logo_pos_y: logoPosY,
        sky_green_line_logo_pos_x: skyLogoPosX,
        sky_green_line_logo_pos_y: skyLogoPosY,
        app_title_pos_x: titlePosX,
        app_title_pos_y: titlePosY,
        oetc_logo: oetcLogo || undefined,
        sky_green_line_logo: skyLogo || undefined,
        hero_image: heroImage || undefined,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setOetcLogo(null);
          setSkyLogo(null);
          setHeroImage(null);
          setHeroRawSrc(null);
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          Branding & welcome splash
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Controls what admins and team leaders see on the one-time welcome screen when they open the app —
          the app title, the greeting text, both company logos, and a banner photo across the top.
        </Typography>

        {saved && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>
            Branding saved. It'll show next time the splash screen appears.
          </Alert>
        )}
        {update.isError && <Alert severity="error" sx={{ mb: 2 }}>Could not save branding.</Alert>}

        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="subtitle2">Live preview</Typography>
          <Typography variant="caption" color="text.secondary">
            This is exactly what the splash screen will look like with your changes below. Drag the
            main logo anywhere on the banner; for the Sky Green Line logo or the app name, click
            "Move onto banner" below them first, then drag to fine-tune. Nothing here is saved
            until you click "Save branding".
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {logoPosX != null && (
              <Button size="small" onClick={() => { setLogoPosX(null); setLogoPosY(null); }}>
                Reset logo position
              </Button>
            )}
            {skyLogoPosX != null && (
              <Button size="small" onClick={() => { setSkyLogoPosX(null); setSkyLogoPosY(null); }}>
                Reset Sky Green Line position
              </Button>
            )}
            {titlePosX != null && (
              <Button size="small" onClick={() => { setTitlePosX(null); setTitlePosY(null); }}>
                Reset app name position
              </Button>
            )}
          </Stack>
          <Box sx={{ maxWidth: 480 }}>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              {heroPreview ? (
                <BrandingBanner
                  heroSrc={heroPreview}
                  mainLogoSrc={oetcPreview}
                  mainLogoWidth={oetcWidth ? Number(oetcWidth) : null}
                  mainLogoHeight={oetcHeight ? Number(oetcHeight) : null}
                  mainLogoPosX={logoPosX}
                  mainLogoPosY={logoPosY}
                  skyLogoSrc={skyPreview || '/branding/sky-green-line.png'}
                  skyLogoWidth={skyWidth ? Number(skyWidth) : null}
                  skyLogoHeight={skyHeight ? Number(skyHeight) : null}
                  skyLogoPosX={skyLogoPosX}
                  skyLogoPosY={skyLogoPosY}
                  appTitle={appTitle}
                  appVersion={appVersion}
                  titlePosX={titlePosX}
                  titlePosY={titlePosY}
                  editable
                  onMainLogoPosChange={(x, y) => {
                    setLogoPosX(x);
                    setLogoPosY(y);
                  }}
                  onSkyLogoPosChange={(x, y) => {
                    setSkyLogoPosX(x);
                    setSkyLogoPosY(y);
                  }}
                  onTitlePosChange={(x, y) => {
                    setTitlePosX(x);
                    setTitlePosY(y);
                  }}
                  onMainLogoSizeChange={(w, h) => {
                    setOetcWidth(String(w));
                    setOetcHeight(String(h));
                  }}
                  onSkyLogoSizeChange={(w, h) => {
                    setSkyWidth(String(w));
                    setSkyHeight(String(h));
                  }}
                />
              ) : (
                oetcPreview && (
                  <Box sx={{ pt: 2 }}>
                    <BrandingLogoBlock
                      mainLogoSrc={oetcPreview}
                      mainLogoWidth={oetcWidth ? Number(oetcWidth) : null}
                      mainLogoHeight={oetcHeight ? Number(oetcHeight) : null}
                    />
                  </Box>
                )
              )}
              <Box sx={{ p: 2 }}>
                <BrandingNameRow
                  skyLogoSrc={skyPreview || '/branding/sky-green-line.png'}
                  skyLogoWidth={skyWidth ? Number(skyWidth) : null}
                  skyLogoHeight={skyHeight ? Number(skyHeight) : null}
                  appTitle={appTitle || null}
                  appVersion={appVersion || null}
                  hideSkyLogo={!!heroPreview && skyLogoPosX != null}
                  hideTitle={!!heroPreview && titlePosX != null}
                  onPinSkyLogoToBanner={heroPreview ? () => { setSkyLogoPosX(15); setSkyLogoPosY(85); } : undefined}
                  onPinTitleToBanner={heroPreview ? () => { setTitlePosX(50); setTitlePosY(85); } : undefined}
                />
              </Box>
            </Box>
          </Box>
        </Stack>

        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="subtitle2">Splash banner photo</Typography>
          <Typography variant="caption" color="text.secondary">
            After choosing a photo you can drag/zoom to pick exactly which part shows, and set its
            width and height — that framing is exactly what appears on the splash screen.
          </Typography>
          <Box
            sx={{
              width: '30%',
              maxHeight: 330,
              borderRadius: 2,
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
            }}
          >
            {heroPreview ? (
              <Box component="img" src={heroPreview} alt="" sx={{ width: '100%', height: 'auto', maxHeight: 330, display: 'block' }} />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                No banner set — a plain icon is shown instead
              </Typography>
            )}
          </Box>
          <input
            ref={heroInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              e.target.value = '';
              if (!file) return;
              if (file.type === 'image/svg+xml') {
                // Vector art has no fixed pixel content to crop — use it as-is.
                setHeroImage(file);
                setHeroRawSrc(null);
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                const src = reader.result as string;
                setHeroRawSrc(src);
                setCropSrc(src);
              };
              reader.readAsDataURL(file);
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<CloudUploadIcon />} onClick={() => heroInputRef.current?.click()}>
              {heroImage ? 'Replace banner photo' : 'Upload banner photo'}
            </Button>
            {(heroRawSrc || (!heroImage && branding?.hero_image_url)) && (
              <Button
                size="small"
                disabled={cropLoading}
                onClick={async () => {
                  if (heroRawSrc) {
                    setCropSrc(heroRawSrc);
                    return;
                  }
                  if (!branding?.hero_image_url) return;
                  setCropLoading(true);
                  try {
                    const resp = await fetch(mediaUrl(branding.hero_image_url));
                    const blob = await resp.blob();
                    const reader = new FileReader();
                    reader.onload = () => {
                      const src = reader.result as string;
                      setHeroRawSrc(src);
                      setCropSrc(src);
                    };
                    reader.readAsDataURL(blob);
                  } finally {
                    setCropLoading(false);
                  }
                }}
              >
                {cropLoading ? 'Loading…' : 'Adjust crop'}
              </Button>
            )}
          </Stack>
        </Stack>
        <ImageCropDialog
          open={!!cropSrc}
          imageSrc={cropSrc}
          fileName="banner.jpg"
          onCancel={() => setCropSrc(null)}
          onCropped={(file) => {
            setHeroImage(file);
            setCropSrc(null);
          }}
        />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Stack spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">Main logo</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mb: 0.5 }}>
                Shown at the top of the splash screen, at its own size — nothing shows until you upload one. If you
                want the company name/tagline text under the logo, include it in this image; nothing is drawn
                underneath it automatically.
              </Typography>
              <Avatar
                variant="rounded"
                src={oetcPreview || undefined}
                sx={{ width: Number(oetcWidth) || 120, height: Number(oetcHeight) || 70, bgcolor: 'action.hover' }}
              >
                {!oetcPreview && 'None set'}
              </Avatar>
              <input
                ref={oetcInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(e) => setOetcLogo(e.target.files?.[0] || null)}
              />
              <Button size="small" startIcon={<CloudUploadIcon />} onClick={() => oetcInputRef.current?.click()}>
                {oetcLogo ? oetcLogo.name : 'Upload logo'}
              </Button>
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Width (px)"
                  type="number"
                  size="small"
                  value={oetcWidth}
                  onChange={(e) => setOetcWidth(e.target.value)}
                  placeholder="120"
                  sx={{ width: 110 }}
                  slotProps={{ htmlInput: { min: 10 } }}
                />
                <TextField
                  label="Height (px)"
                  type="number"
                  size="small"
                  value={oetcHeight}
                  onChange={(e) => setOetcHeight(e.target.value)}
                  placeholder="70"
                  sx={{ width: 110 }}
                  slotProps={{ htmlInput: { min: 10 } }}
                />
              </Stack>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Stack spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">Sky Green Line logo</Typography>
              <Avatar
                variant="rounded"
                src={skyPreview || undefined}
                sx={{ width: Number(skyWidth) || 120, height: Number(skyHeight) || 70, bgcolor: 'action.hover' }}
              >
                {!skyPreview && 'SGL'}
              </Avatar>
              <input
                ref={skyInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(e) => setSkyLogo(e.target.files?.[0] || null)}
              />
              <Button size="small" startIcon={<CloudUploadIcon />} onClick={() => skyInputRef.current?.click()}>
                {skyLogo ? skyLogo.name : 'Upload logo'}
              </Button>
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Width (px)"
                  type="number"
                  size="small"
                  value={skyWidth}
                  onChange={(e) => setSkyWidth(e.target.value)}
                  placeholder="120"
                  sx={{ width: 110 }}
                  slotProps={{ htmlInput: { min: 10 } }}
                />
                <TextField
                  label="Height (px)"
                  type="number"
                  size="small"
                  value={skyHeight}
                  onChange={(e) => setSkyHeight(e.target.value)}
                  placeholder="70"
                  sx={{ width: 110 }}
                  slotProps={{ htmlInput: { min: 10 } }}
                />
              </Stack>
            </Stack>
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            <TextField
              label="App name"
              helperText="Shown next to the Sky Green Line logo on the splash screen"
              value={appTitle}
              onChange={(e) => setAppTitle(e.target.value)}
              fullWidth
            />
            <TextField
              label="Version"
              helperText='e.g. "ver. 1.0"'
              value={appVersion}
              onChange={(e) => setAppVersion(e.target.value)}
              sx={{ minWidth: 160 }}
            />
          </Stack>
          <TextField
            label="Welcome header"
            helperText='Defaults to "Welcome back, <name>" when left blank'
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            fullWidth
          />
          <TextField
            label="Subtitle"
            helperText="Defaults to the standard 132 kV line when left blank"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            fullWidth
          />
        </Stack>

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={handleSave} disabled={update.isPending}>
            Save branding
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

function OrganizationBrandingSection() {
  const { data: branding } = useBrandingSettings();
  const update = useUpdateBrandingSettings();
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [footerText, setFooterText] = useState('');
  const [reportFooter, setReportFooter] = useState('');
  const [contact, setContact] = useState('');
  const [orgLogo, setOrgLogo] = useState<File | null>(null);
  const [resetLogo, setResetLogo] = useState(false);
  const [loginBackground, setLoginBackground] = useState<File | null>(null);
  const [resetLoginBackground, setResetLoginBackground] = useState(false);
  const [saved, setSaved] = useState(false);
  const orgLogoInputRef = useRef<HTMLInputElement>(null);
  const loginBackgroundInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!branding) return;
    setNameEn(branding.org_name_en || '');
    setNameAr(branding.org_name_ar || '');
    setFooterText(branding.org_footer_text || '');
    setReportFooter(branding.org_report_footer || '');
    setContact(branding.org_contact || '');
  }, [branding]);

  const orgLogoPreview = orgLogo
    ? URL.createObjectURL(orgLogo)
    : !resetLogo && branding?.org_logo_url
      ? mediaUrl(branding.org_logo_url)
      : null;
  const loginBackgroundPreview = loginBackground
    ? URL.createObjectURL(loginBackground)
    : !resetLoginBackground && branding?.login_background_url
      ? mediaUrl(branding.login_background_url)
      : null;

  const handleSave = () => {
    setSaved(false);
    update.mutate(
      {
        org_name_en: nameEn,
        org_name_ar: nameAr,
        org_footer_text: footerText,
        org_report_footer: reportFooter,
        org_contact: contact,
        org_logo: orgLogo || undefined,
        reset_org_logo: resetLogo,
        login_background: loginBackground || undefined,
        reset_login_background: resetLoginBackground,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setOrgLogo(null);
          setResetLogo(false);
          setLoginBackground(null);
          setResetLoginBackground(false);
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          Organization Branding
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configure the display name, logo, and identity shown on generated inspection reports and the login page.
        </Typography>

        {saved && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>
            Organization branding saved. New reports will use it right away.
          </Alert>
        )}
        {update.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Could not save organization branding.
          </Alert>
        )}

        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="subtitle2">Current logo</Typography>
          <Box
            sx={{
              width: '100%',
              maxWidth: 360,
              height: 140,
              borderRadius: 2,
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
              p: 2,
            }}
          >
            {orgLogoPreview ? (
              <Box
                component="img"
                src={orgLogoPreview}
                alt=""
                sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No logo set
              </Typography>
            )}
          </Box>
          <input
            ref={orgLogoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              e.target.value = '';
              if (!file) return;
              setOrgLogo(file);
              setResetLogo(false);
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              startIcon={<CloudUploadIcon />}
              onClick={() => orgLogoInputRef.current?.click()}
            >
              {orgLogoPreview ? 'Replace logo' : 'Upload logo'}
            </Button>
            {orgLogoPreview && (
              <Button
                size="small"
                color="inherit"
                onClick={() => {
                  setOrgLogo(null);
                  setResetLogo(true);
                }}
              >
                Reset to default
              </Button>
            )}
          </Stack>
        </Stack>

        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="subtitle2">Login page background</Typography>
          <Typography variant="caption" color="text.secondary">
            Shown full-screen behind the sign-in form. Leave unset to use the default gradient.
          </Typography>
          <Box
            sx={{
              width: '100%',
              maxWidth: 360,
              height: 140,
              borderRadius: 2,
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
            }}
          >
            {loginBackgroundPreview ? (
              <Box
                component="img"
                src={loginBackgroundPreview}
                alt=""
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Default gradient
              </Typography>
            )}
          </Box>
          <input
            ref={loginBackgroundInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              e.target.value = '';
              if (!file) return;
              setLoginBackground(file);
              setResetLoginBackground(false);
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              startIcon={<CloudUploadIcon />}
              onClick={() => loginBackgroundInputRef.current?.click()}
            >
              {loginBackgroundPreview ? 'Replace image' : 'Upload image'}
            </Button>
            {loginBackgroundPreview && (
              <Button
                size="small"
                color="inherit"
                onClick={() => {
                  setLoginBackground(null);
                  setResetLoginBackground(true);
                }}
              >
                Reset to default
              </Button>
            )}
          </Stack>
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Stack spacing={2}>
          <TextField label="Company name (English)" required value={nameEn} onChange={(e) => setNameEn(e.target.value)} fullWidth />
          <TextField
            label="Company name (Arabic)"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            fullWidth
            slotProps={{ htmlInput: { dir: 'rtl' } }}
          />
          <TextField
            label="Footer text"
            helperText="A short description shown under the company name"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            fullWidth
          />
          <TextField
            label="Report footer"
            helperText='Shown at the bottom of every generated PDF report — defaults to "Confidential field inspection record" when left blank'
            value={reportFooter}
            onChange={(e) => setReportFooter(e.target.value)}
            fullWidth
          />
          <TextField
            label="Contact"
            helperText="Shown next to the report footer, e.g. an email or phone number"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            fullWidth
          />
        </Stack>

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={handleSave} disabled={update.isPending}>
            Save organization branding
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

interface AdminFormState {
  username: string;
  password: string;
  full_name: string;
  fullAdmin: boolean;
  permissions: string[];
}

const emptyAdminForm: AdminFormState = { username: '', password: '', full_name: '', fullAdmin: true, permissions: [] };

/** Towers/Teams/Users/Reports/Knowledge base each get a View / Add / Full grant; branding settings
 * stays a plain on/off checkbox since it's a single form with no add-vs-edit distinction. */
function PermissionEditor({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <Stack spacing={1.5}>
      {LEVELED_PERMISSIONS.map((perm) => {
        const level = getPermissionLevel(value, perm);
        return (
          <Box key={perm} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2">{ADMIN_PERMISSION_LABELS[perm]}</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={level}
              onChange={(_e, next: PermissionLevel | null) => next && onChange(setPermissionLevel(value, perm, next))}
            >
              {PERMISSION_LEVELS.map((lvl) => (
                <ToggleButton key={lvl} value={lvl}>
                  {PERMISSION_LEVEL_LABELS[lvl]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        );
      })}
      <Divider />
      <FormControlLabel
        control={
          <Checkbox
            checked={value.includes('manage_settings')}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, 'manage_settings'] : value.filter((p) => p !== 'manage_settings'),
              )
            }
          />
        }
        label={ADMIN_PERMISSION_LABELS.manage_settings}
      />
    </Stack>
  );
}

function PendingAccountsSection() {
  const { data: users } = useUsers();
  const { data: teams } = useTeams();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const pending = (users || []).filter((u) => !u.is_approved);

  const [approving, setApproving] = useState<AdminUser | null>(null);
  const [approveRole, setApproveRole] = useState<'team_member' | 'team_leader'>('team_member');
  const [approveTeamId, setApproveTeamId] = useState<number | ''>('');
  const [approveError, setApproveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openApprove = (u: AdminUser) => {
    setApproving(u);
    setApproveRole('team_member');
    setApproveTeamId('');
    setApproveError(null);
  };

  const confirmApprove = () => {
    if (!approving) return;
    setApproveError(null);
    updateUser.mutate(
      {
        id: approving.id,
        payload: {
          is_approved: true,
          role: approveRole,
          team_id: approveTeamId === '' ? null : approveTeamId,
        },
      },
      {
        onSuccess: () => setApproving(null),
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setApproveError(detail || 'Could not approve this account.');
        },
      },
    );
  };

  const reject = (u: AdminUser) => {
    setActionError(null);
    if (!window.confirm(`Reject and delete the pending account "${u.username}"? This can't be undone.`)) return;
    deleteUser.mutate(u.id, {
      onError: (err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setActionError(detail || `Could not reject "${u.username}".`);
      },
    });
  };

  if (pending.length === 0) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <HourglassEmptyIcon color="warning" fontSize="small" />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Pending sign-ups
          </Typography>
          <Chip size="small" color="warning" label={pending.length} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These accounts created themselves from the login page and can't sign in until you approve them.
        </Typography>
        {actionError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Username</TableCell>
                <TableCell>Full name</TableCell>
                <TableCell>Mobile</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pending.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>{u.username}</TableCell>
                  <TableCell>{u.full_name || '—'}</TableCell>
                  <TableCell>{u.mobile || '—'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="success" startIcon={<CheckCircleIcon />} onClick={() => openApprove(u)}>
                      Approve
                    </Button>
                    <Button size="small" color="error" startIcon={<CancelIcon />} onClick={() => reject(u)}>
                      Reject
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>

      <Dialog open={!!approving} onClose={() => setApproving(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Approve — {approving?.username}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {approveError && <Alert severity="error">{approveError}</Alert>}
            <FormControl fullWidth>
              <InputLabel id="approve-role-label">Role</InputLabel>
              <Select
                labelId="approve-role-label"
                label="Role"
                value={approveRole}
                onChange={(e) => setApproveRole(e.target.value as 'team_member' | 'team_leader')}
              >
                <MenuItem value="team_member">Team member</MenuItem>
                <MenuItem value="team_leader">Team leader</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="approve-team-label">Team (optional)</InputLabel>
              <Select
                labelId="approve-team-label"
                label="Team (optional)"
                value={approveTeamId === '' ? '' : String(approveTeamId)}
                onChange={(e) => setApproveTeamId(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <MenuItem value="">
                  <em>No team</em>
                </MenuItem>
                {(teams || []).map((t) => (
                  <MenuItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproving(null)}>Cancel</Button>
          <Button variant="contained" color="success" onClick={confirmApprove} disabled={updateUser.isPending}>
            Approve
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function AdminAccountsSection() {
  const { data: users } = useUsers();
  const { user: currentUser } = useAuth();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const admins = (users || []).filter((u) => u.role === 'admin');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<AdminFormState>(emptyAdminForm);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editFullAdmin, setEditFullAdmin] = useState(false);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = () => {
    setForm(emptyAdminForm);
    setError(null);
    setCreateOpen(true);
  };

  const submitCreate = () => {
    setError(null);
    if (form.username.trim().length < 3 || form.password.length < 6) {
      setError('Username needs 3+ characters and password needs 6+ characters.');
      return;
    }
    createUser.mutate(
      {
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim() || undefined,
        role: 'admin',
        is_super_admin: form.fullAdmin,
        permissions: form.fullAdmin ? [] : form.permissions,
      },
      {
        onSuccess: () => setCreateOpen(false),
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || 'Could not create this admin account.');
        },
      },
    );
  };

  const openEdit = (admin: AdminUser) => {
    setEditing(admin);
    setEditFullAdmin(admin.is_super_admin);
    setEditPerms(admin.permissions);
    setEditUsername(admin.username);
    setEditPassword('');
    setEditError(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    setEditError(null);
    if (editUsername.trim().length < 3) {
      setEditError('Username needs at least 3 characters.');
      return;
    }
    if (editPassword && editPassword.length < 6) {
      setEditError('New password needs at least 6 characters.');
      return;
    }
    updateUser.mutate(
      {
        id: editing.id,
        payload: {
          username: editUsername.trim(),
          is_super_admin: editFullAdmin,
          permissions: editFullAdmin ? [] : editPerms,
          ...(editPassword ? { password: editPassword } : {}),
        },
      },
      {
        onSuccess: () => setEditing(null),
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setEditError(detail || 'Could not save these changes.');
        },
      },
    );
  };

  const toggleActive = (admin: AdminUser) => {
    updateUser.mutate({ id: admin.id, payload: { is_active: !admin.is_active } });
  };

  const removeAdmin = (admin: AdminUser) => {
    setDeleteError(null);
    if (!window.confirm(`Permanently delete the admin account "${admin.username}"? This can't be undone.`)) {
      return;
    }
    deleteUser.mutate(admin.id, {
      onError: (err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setDeleteError(detail || `Could not delete "${admin.username}".`);
      },
    });
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Admin accounts
          </Typography>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
            New admin
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          A full admin has every permission. A restricted admin can be given View only (see it, no changes),
          Add (create new, but not edit or delete), or Full (everything) per category — useful for giving
          someone limited access without handing them everything.
        </Typography>
        {deleteError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
            {deleteError}
          </Alert>
        )}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Username</TableCell>
                <TableCell>Full name</TableCell>
                <TableCell>Access</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {admins.map((admin) => (
                <TableRow key={admin.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <AdminPanelSettingsIcon fontSize="small" color={admin.is_super_admin ? 'primary' : 'disabled'} />
                      {admin.username}
                    </Stack>
                  </TableCell>
                  <TableCell>{admin.full_name || '—'}</TableCell>
                  <TableCell>
                    {admin.is_super_admin ? (
                      <Chip size="small" color="primary" label="Full admin" />
                    ) : admin.permissions.length ? (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {admin.permissions.map((p) => {
                          const [name, level] = p.split(':');
                          const label = ADMIN_PERMISSION_LABELS[name as keyof typeof ADMIN_PERMISSION_LABELS] || name;
                          const isLeveled = (LEVELED_PERMISSIONS as readonly string[]).includes(name);
                          const levelLabel = PERMISSION_LEVEL_LABELS[(level as PermissionLevel) || 'full'];
                          return (
                            <Chip
                              key={p}
                              size="small"
                              variant="outlined"
                              label={isLeveled ? `${label} — ${levelLabel}` : label}
                            />
                          );
                        })}
                      </Stack>
                    ) : (
                      <Chip size="small" variant="outlined" color="default" label="No permissions" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={admin.is_active ? 'success' : 'default'} label={admin.is_active ? 'Active' : 'Deactivated'} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit access">
                      <IconButton size="small" onClick={() => openEdit(admin)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Button size="small" onClick={() => toggleActive(admin)}>
                      {admin.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                    {admin.id !== currentUser?.id && (
                      <Tooltip title="Delete this admin account">
                        <IconButton size="small" color="error" onClick={() => removeAdmin(admin)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {admins.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      No admin accounts yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New admin account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Username"
              fullWidth
              autoFocus
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
            <TextField
              label="Full name"
              fullWidth
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
            <TextField
              label="Password"
              type="password"
              fullWidth
              helperText="At least 6 characters"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.fullAdmin}
                  onChange={(e) => setForm((f) => ({ ...f, fullAdmin: e.target.checked }))}
                />
              }
              label="Full admin (every permission)"
            />
            {!form.fullAdmin && (
              <PermissionEditor
                value={form.permissions}
                onChange={(next) => setForm((f) => ({ ...f, permissions: next }))}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitCreate} disabled={createUser.isPending}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit access — {editing?.username}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {editError && <Alert severity="error">{editError}</Alert>}
            <TextField
              label="Username"
              fullWidth
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
            />
            <TextField
              label="Reset password (optional)"
              type="password"
              fullWidth
              helperText="Leave blank to keep their current password. At least 6 characters if set."
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
            />
            <FormControlLabel
              control={
                <Switch checked={editFullAdmin} onChange={(e) => setEditFullAdmin(e.target.checked)} />
              }
              label="Full admin (every permission)"
            />
            {!editFullAdmin && <PermissionEditor value={editPerms} onChange={setEditPerms} />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={updateUser.isPending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const canManageSettings = user?.role === 'admin' && (user.is_super_admin || user.permissions.includes('manage_settings'));
  const isSuperAdmin = user?.role === 'admin' && user.is_super_admin;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>
        Settings
      </Typography>
      <Stack spacing={3}>
        {user?.role === 'admin' && <PendingAccountsSection />}
        {canManageSettings && <BrandingSection />}
        {canManageSettings && <OrganizationBrandingSection />}
        {isSuperAdmin && <AdminAccountsSection />}
        {!canManageSettings && !isSuperAdmin && (
          <Alert severity="info">You don't have any settings permissions on this account yet — ask a full admin.</Alert>
        )}
      </Stack>
    </Box>
  );
}
