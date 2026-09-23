import { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import BoltIcon from '@mui/icons-material/BoltRounded';
import { useNavigate } from 'react-router-dom';
import { useLogin, usePublicBranding } from '../api/hooks';
import { mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { requestBrowserLocation, stashPendingPing } from '../hooks/useFieldTracking';

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const login = useLogin();
  const auth = useAuth();
  const navigate = useNavigate();
  const { data: branding } = usePublicBranding();
  const logoUrl = branding?.org_logo_url ? mediaUrl(branding.org_logo_url) : null;
  const backgroundUrl = branding?.login_background_url ? mediaUrl(branding.login_background_url) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    // One GPS call in this tap (iOS only shows Allow during a user gesture).
    requestBrowserLocation((lat, lng, acc) => stashPendingPing(lat, lng, acc));
    try {
      const data = await login.mutateAsync({ username, password });
      auth.login(data);
      navigate('/');
    } catch (err) {
      setLoginError(errorDetail(err, 'Invalid username or password.'));
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: backgroundUrl
          ? `linear-gradient(rgba(4,20,26,0.55), rgba(4,20,26,0.55)), url(${backgroundUrl})`
          : 'linear-gradient(135deg, #062a38 0%, #0d475c 55%, #17708f 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <Stack spacing={2} sx={{ alignItems: 'center' }}>
        <Paper elevation={6} sx={{ p: 5, width: 400, borderRadius: 3 }}>
          <Stack spacing={1} sx={{ mb: 3, alignItems: 'center' }}>
            {logoUrl ? (
              <Box
                component="img"
                src={logoUrl}
                alt={branding?.org_name_en || 'Organization logo'}
                sx={{ width: 72, height: 72, objectFit: 'contain' }}
              />
            ) : (
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                }}
              >
                <BoltIcon fontSize="large" />
              </Box>
            )}
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Insulator Inspector Pro
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              132 kV overhead-line insulator field inspection platform
            </Typography>
          </Stack>
          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              {loginError && <Alert severity="error">{loginError}</Alert>}
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={login.isPending} fullWidth>
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </form>
        </Paper>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
          © {new Date().getFullYear()} {branding?.org_name_en || 'Insulator Inspector Pro'}. All rights reserved.
        </Typography>
      </Stack>
    </Box>
  );
}
