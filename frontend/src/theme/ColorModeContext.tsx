import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import rtlPlugin from '@mui/stylis-plugin-rtl';
import { prefixer } from 'stylis';
import { useLanguage } from '../i18n';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider, type PaletteMode } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { DEFAULT_MODE, getTheme } from './theme';

const ltrCache = createCache({ key: 'iip-ltr' });
const rtlCache = createCache({ key: 'iip-rtl', stylisPlugins: [prefixer, rtlPlugin] });

const STORAGE_KEY = 'iip_color_mode';

function loadStoredMode(): PaletteMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    // Private window / blocked storage — fall back to the default every load, no functional loss.
    return null;
  }
}

const ColorModeContext = createContext<{ mode: PaletteMode; toggleMode: () => void; setMode: (m: PaletteMode) => void }>({
  mode: DEFAULT_MODE,
  toggleMode: () => {},
  setMode: () => {},
});

export function useColorMode() {
  useLanguage();
  return useContext(ColorModeContext);
}

/** Wraps the app in a MUI theme that can switch between the light and dark palettes defined in
 * theme.ts. Dark is the default for anyone who hasn't chosen yet (see DEFAULT_MODE) — once someone
 * picks a mode via the toggle in the top bar, that choice is remembered per browser and wins over
 * the default on every later visit. */
export function ColorModeProvider({ children }: { children: ReactNode }) {
  const language = useLanguage();
  const [mode, setModeState] = useState<PaletteMode>(() => loadStoredMode() ?? DEFAULT_MODE);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Nothing to persist to — the choice just won't survive a reload this session.
    }
  }, [mode]);

  const setMode = (m: PaletteMode) => setModeState(m);
  const toggleMode = () => setModeState((m) => (m === 'dark' ? 'light' : 'dark'));

  const theme = useMemo(() => getTheme(mode, language), [mode, language]);
  const ctxValue = useMemo(() => ({ mode, toggleMode, setMode }), [mode]);

  return (
    <ColorModeContext.Provider value={ctxValue}>
      <CacheProvider value={language === 'ar' ? rtlCache : ltrCache}><ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider></CacheProvider>
    </ColorModeContext.Provider>
  );
}
