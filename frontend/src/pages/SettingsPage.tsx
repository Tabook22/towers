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
  FormControlLabel,
  FormGroup,
  Grid,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUploadRounded';
import AddIcon from '@mui/icons-material/AddRounded';
import EditIcon from '@mui/icons-material/EditRounded';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import { useBrandingSettings, useCreateUser, useUpdateBrandingSettings, useUpdateUser, useUsers } from '../api/hooks';
import { mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ADMIN_PERMISSIONS, ADMIN_PERMISSION_LABELS, type AdminPermission, type AdminUser } from '../api/types';

function BrandingSection() {
  const { data: branding } = useBrandingSettings();
  const update = useUpdateBrandingSettings();
  const [appTitle, setAppTitle] = useState('');
  const [header, setHeader] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [oetcLogo, setOetcLogo] = useState<File | null>(null);
  const [skyLogo, setSkyLogo] = useState<File | null>(null);
  const [heroImage, setHeroImage] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const oetcInputRef = useRef<HTMLInputElement>(null);
  const skyInputRef = useRef<HTMLInputElement>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!branding) return;
    setAppTitle(branding.app_title || '');
    setHeader(branding.splash_header || '');
    setSubtitle(branding.splash_subtitle || '');
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
        splash_header: header,
        splash_subtitle: subtitle,
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
          <Typography variant="subtitle2">Splash banner photo</Typography>
          <Box
            sx={{
              width: '100%',
              height: 160,
              borderRadius: 2,
              bgcolor: 'action.hover',
              backgroundImage: heroPreview ? `url(${heroPreview})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            {!heroPreview && (
              <Typography variant="body2" color="text.secondary">
                No banner set — a plain icon is shown instead
              </Typography>
            )}
          </Box>
          <input
            ref={heroInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hidden
            onChange={(e) => setHeroImage(e.target.files?.[0] || null)}
          />
          <Box>
            <Button size="small" startIcon={<CloudUploadIcon />} onClick={() => heroInputRef.current?.click()}>
              {heroImage ? heroImage.name : 'Upload banner photo'}
            </Button>
          </Box>
        </Stack>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Stack spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">Main logo</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mb: 0.5 }}>
                Shown at the top of the splash screen, at its own size — nothing shows until you upload one. If you
                want the company name/tagline text under the logo, include it in this image; nothing is drawn
                underneath it automatically.
              </Typography>
              <Avatar variant="rounded" src={oetcPreview || undefined} sx={{ width: 120, height: 70, bgcolor: 'action.hover' }}>
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
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Stack spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">Sky Green Line logo</Typography>
              <Avatar variant="rounded" src={skyPreview || undefined} sx={{ width: 120, height: 70, bgcolor: 'action.hover' }}>
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
            </Stack>
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Stack spacing={2}>
          <TextField
            label="App title"
            helperText="Shown as a small masthead line on the splash screen"
            value={appTitle}
            onChange={(e) => setAppTitle(e.target.value)}
            fullWidth
          />
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

interface AdminFormState {
  username: string;
  password: string;
  full_name: string;
  fullAdmin: boolean;
  permissions: AdminPermission[];
}

const emptyAdminForm: AdminFormState = { username: '', password: '', full_name: '', fullAdmin: true, permissions: [] };

function PermissionChecklist({
  value,
  onChange,
}: {
  value: AdminPermission[];
  onChange: (next: AdminPermission[]) => void;
}) {
  return (
    <FormGroup>
      {ADMIN_PERMISSIONS.map((perm) => (
        <FormControlLabel
          key={perm}
          control={
            <Checkbox
              checked={value.includes(perm)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, perm] : value.filter((p) => p !== perm))
              }
            />
          }
          label={ADMIN_PERMISSION_LABELS[perm]}
        />
      ))}
    </FormGroup>
  );
}

function AdminAccountsSection() {
  const { data: users } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const admins = (users || []).filter((u) => u.role === 'admin');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<AdminFormState>(emptyAdminForm);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editPerms, setEditPerms] = useState<AdminPermission[]>([]);

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
    setEditPerms(admin.permissions as AdminPermission[]);
  };

  const saveEdit = () => {
    if (!editing) return;
    updateUser.mutate(
      { id: editing.id, payload: { permissions: editPerms } },
      { onSuccess: () => setEditing(null) },
    );
  };

  const toggleActive = (admin: AdminUser) => {
    updateUser.mutate({ id: admin.id, payload: { is_active: !admin.is_active } });
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
          A full admin has every permission. A restricted admin can only do what's checked below — useful for
          giving someone limited access (e.g. only reports, or only towers) without handing them everything.
        </Typography>

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
                        {admin.permissions.map((p) => (
                          <Chip key={p} size="small" variant="outlined" label={ADMIN_PERMISSION_LABELS[p as AdminPermission] || p} />
                        ))}
                      </Stack>
                    ) : (
                      <Chip size="small" variant="outlined" color="default" label="No permissions" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={admin.is_active ? 'success' : 'default'} label={admin.is_active ? 'Active' : 'Deactivated'} />
                  </TableCell>
                  <TableCell align="right">
                    {!admin.is_super_admin && (
                      <Tooltip title="Edit permissions">
                        <IconButton size="small" onClick={() => openEdit(admin)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Button size="small" onClick={() => toggleActive(admin)}>
                      {admin.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
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
              <PermissionChecklist
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
        <DialogTitle>Edit permissions — {editing?.username}</DialogTitle>
        <DialogContent>
          <PermissionChecklist value={editPerms} onChange={setEditPerms} />
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
        {canManageSettings && <BrandingSection />}
        {isSuperAdmin && <AdminAccountsSection />}
        {!canManageSettings && !isSuperAdmin && (
          <Alert severity="info">You don't have any settings permissions on this account yet — ask a full admin.</Alert>
        )}
      </Stack>
    </Box>
  );
}
