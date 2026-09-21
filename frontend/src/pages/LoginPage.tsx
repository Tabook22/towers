import { useState } from 'react';
import { Alert, Box, Button, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import BoltIcon from '@mui/icons-material/BoltRounded';
import { useNavigate } from 'react-router-dom';
import { useLogin, usePublicBranding, useRegister } from '../api/hooks';
import { mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { requestBrowserLocation, stashPendingPing } from '../hooks/useFieldTracking';

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const login = useLogin();
  const auth = useAuth();
  const navigate = useNavigate();
  const { data: branding } = usePublicBranding();
  const logoUrl = branding?.org_logo_url ? mediaUrl(branding.org_logo_url) : null;
  const backgroundUrl = branding?.login_background_url ? mediaUrl(branding.login_background_url) : null;

  // ---------- Sign up (public — see routers/auth.py's register()) ----------
  const register = useRegister();
  const [regUsername, setRegUsername] = useState('');
  const [regFullName, setRegFullName] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState(false);

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

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (regUsername.trim().length < 3) {
      setRegError('Username needs at least 3 characters.');
      return;
    }
    if (regPassword.length < 6) {
      setRegError('Password needs at least 6 characters.');
      return;
    }
    if (regPassword !== regConfirm) {
      setRegError("Passwords don't match.");
      return;
    }
    register.mutate(
      {
        username: regUsername.trim(),
        password: regPassword,
        full_name: regFullName.trim() || undefined,
        mobile: regMobile.trim() || undefined,
      },
      {
        onSuccess: () => setRegSuccess(true),
        onError: (err) => setRegError(errorDetail(err, 'Could not create this account.')),
      },
    );
  };

  const backToLogin = () => {
    setMode('login');
    setRegSuccess(false);
    setRegError(null);
    setRegUsername('');
    setRegFullName('');
    setRegMobile('');
    setRegPassword('');
    setRegConfirm('');
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
          {mode === 'login' ? (
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
                <Typography variant="body2" sx={{ textAlign: 'center' }}>
                  New here?{' '}
                  <Link component="button" type="button" onClick={() => setMode('register')}>
                    Create an account
                  </Link>
                </Typography>
              </Stack>
            </form>
          ) : regSuccess ? (
            <Stack spacing={2} sx={{ textAlign: 'center' }}>
              <Alert severity="success">
                Account created. An admin needs to approve it before you can sign in — check back soon.
              </Alert>
              <Button variant="contained" onClick={backToLogin}>
                Back to sign in
              </Button>
            </Stack>
          ) : (
            <form onSubmit={handleRegister}>
              <Stack spacing={2}>
                {regError && <Alert severity="error">{regError}</Alert>}
                <TextField
                  label="Username"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  autoFocus
                  fullWidth
                />
                <TextField label="Full name" value={regFullName} onChange={(e) => setRegFullName(e.target.value)} fullWidth />
                <TextField label="Mobile (optional)" value={regMobile} onChange={(e) => setRegMobile(e.target.value)} fullWidth />
                <TextField
                  label="Password"
                  type="password"
                  helperText="At least 6 characters"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Confirm password"
                  type="password"
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  fullWidth
                />
                <Button type="submit" variant="contained" size="large" disabled={register.isPending} fullWidth>
                  {register.isPending ? 'Creating account…' : 'Create account'}
                </Button>
                <Typography variant="body2" sx={{ textAlign: 'center' }}>
                  Already have an account?{' '}
                  <Link component="button" type="button" onClick={backToLogin}>
                    Sign in
                  </Link>
                </Typography>
              </Stack>
            </form>
          )}
        </Paper>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
          © {new Date().getFullYear()} {branding?.org_name_en || 'Insulator Inspector Pro'}. All rights reserved.
        </Typography>
      </Stack>
    </Box>
  );
}
