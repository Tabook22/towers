import { createTheme, type PaletteMode, type Theme } from '@mui/material/styles';

// Severity / status color scale, reused across badges, map markers, and KPI tiles. Rendered as a
// translucent tint (see components/Badges.tsx's colorChip: `${color}1f` background, `${color}55`
// border, solid `color` text) rather than an opaque fill, which is why the same hex values read
// clearly on both a light and a dark page background without needing a separate dark-mode set.
export const severityColors: Record<string, string> = {
  Normal: '#43a047',
  Low: '#c0ca33',
  Medium: '#fb8c00',
  High: '#e53935',
  Critical: '#ab47bc',
};

export const evidenceColors: Record<string, string> = {
  'NOT REQUIRED': '#90a4ae',
  'PENDING CAPTURE': '#fbc02d',
  COMPLETE: '#43a047',
  'RECAPTURE REQUIRED': '#e53935',
};

export const screeningColors: Record<string, string> = {
  'Not inspected': '#90a4ae',
  Normal: '#43a047',
  'Hotspot detected': '#e53935',
  Inconclusive: '#fb8c00',
  'Not visible': '#78909c',
  'Not accessible': '#78909c',
  'Reinspection required': '#ff9800',
  'Not installed': '#b0bec5',
  Corona: '#ab47bc',
  Contamination: '#8d6e63',
};

// The one line that decides which theme greets a signed-out browser or a first-time visitor —
// see theme/ColorModeContext.tsx for how a saved per-browser choice overrides this afterward.
export const DEFAULT_MODE: PaletteMode = 'dark';

export function getTheme(mode: PaletteMode): Theme {
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: isDark
        ? { main: '#4fa8c9', light: '#7cc4de', dark: '#2c7896', contrastText: '#04141a' }
        : { main: '#0d475c', light: '#3a6f84', dark: '#062a38', contrastText: '#ffffff' },
      secondary: isDark
        ? { main: '#f0b429', contrastText: '#1a1a1a' }
        : { main: '#f0a30a', contrastText: '#1a1a1a' },
      error: { main: isDark ? '#f26a6a' : '#d32f2f' },
      warning: { main: isDark ? '#ffb454' : '#f57c00' },
      success: { main: isDark ? '#66bb6a' : '#2e7d32' },
      info: { main: isDark ? '#64b5f6' : '#0288d1' },
      background: isDark ? { default: '#0e161c', paper: '#16212a' } : { default: '#f4f6f8', paper: '#ffffff' },
      text: isDark ? { primary: '#e7eef2', secondary: '#9fb2bc' } : { primary: '#1c2733', secondary: '#5a6b78' },
      divider: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      h1: { fontWeight: 700 },
      h2: { fontWeight: 700 },
      h3: { fontWeight: 700, letterSpacing: '-0.035em' },
      h4: { fontWeight: 700, letterSpacing: '-0.025em' },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { colorScheme: mode },
          body: { backgroundImage: isDark ? 'radial-gradient(ellipse at top right, rgba(45,108,122,0.08), transparent 60%)' : 'radial-gradient(ellipse at top right, rgba(45,108,122,0.05), transparent 60%)', backgroundAttachment: 'fixed' },
          '*:focus-visible': { outline: '2px solid', outlineColor: isDark ? '#7cc4de' : '#287d91', outlineOffset: 3 },
        },
      },
      MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: '3px 3px 0 0' } } },
      MuiTab: { styleOverrides: { root: { minHeight: 54, fontWeight: 650 } } },
      MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: isDark ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.8)' } } },
      MuiAccordion: { styleOverrides: { root: { border: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(16,44,59,0.09)'}`, boxShadow: 'none', '&::before': { display: 'none' } } } },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: isDark ? '0 1px 3px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.12)',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 9, boxShadow: 'none', paddingInline: 16 },
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
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)'}`,
            boxShadow: isDark ? '0 1px 2px rgba(0,0,0,0.4)' : '0 1px 2px rgba(16,24,32,0.06)',
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)' },
          head: { backgroundColor: isDark ? '#1b2b35' : '#f1f5f7', color: isDark ? '#bdcdd5' : '#516776', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' },
        },
      },
    },
  });
}

// Kept for any leftover direct imports — prefer useTheme()/the ColorModeContext for anything
// mode-sensitive going forward, since this fixed instance is always the default-mode palette.
export const theme = getTheme(DEFAULT_MODE);
