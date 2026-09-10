import { createTheme } from '@mui/material/styles';

// Severity / status color scale, reused across badges, map markers, and KPI tiles.
export const severityColors: Record<string, string> = {
  Normal: '#2e7d32',
  Low: '#9aa518',
  Medium: '#f57c00',
  High: '#d32f2f',
  Critical: '#6a1b9a',
};

export const evidenceColors: Record<string, string> = {
  'NOT REQUIRED': '#90a4ae',
  'PENDING CAPTURE': '#f9a825',
  COMPLETE: '#2e7d32',
  'RECAPTURE REQUIRED': '#d32f2f',
};

export const screeningColors: Record<string, string> = {
  'Not inspected': '#90a4ae',
  Normal: '#2e7d32',
  'Hotspot detected': '#d32f2f',
  Inconclusive: '#f57c00',
  'Not visible': '#78909c',
  'Not accessible': '#78909c',
  'Reinspection required': '#ef6c00',
  'Not installed': '#b0bec5',
  Corona: '#8e24aa',
  Contamination: '#6d4c41',
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0d475c',
      light: '#3a6f84',
      dark: '#062a38',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#f0a30a',
      contrastText: '#1a1a1a',
    },
    error: { main: '#d32f2f' },
    warning: { main: '#f57c00' },
    success: { main: '#2e7d32' },
    background: {
      default: '#f4f6f8',
      paper: '#ffffff',
    },
    text: {
      primary: '#1c2733',
      secondary: '#5a6b78',
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 1px 2px rgba(16,24,32,0.06)',
        },
      },
    },
  },
});
