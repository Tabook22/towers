import { useEffect, useState } from 'react';
import { Button, Slide, Snackbar } from '@mui/material';

const ASSET_RE = /\/assets\/index-[\w-]+\.js/;

/** Catches the exact confusion that kept hitting us during today's rapid deploys: an admin has the
 * app open in a tab from before a deploy, a plain reload sometimes still serves a service-worker- or
 * browser-cached shell, and the "new" feature they were just told about doesn't appear — with no
 * error, just old UI. Polls the live index.html (bypassing all caches) and compares which built JS
 * bundle it references against the one actually running in this tab; a mismatch means a newer build
 * has been deployed since this tab was opened, so prompt a reload instead of leaving that silent. */
export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const currentScript = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
    const currentSrc = currentScript?.getAttribute('src') || null;
    if (!currentSrc) return;

    let cancelled = false;
    const checkForUpdate = async () => {
      try {
        const res = await fetch('/index.html', { cache: 'no-store' });
        const html = await res.text();
        const match = html.match(ASSET_RE);
        if (!cancelled && match && match[0] !== currentSrc) {
          setUpdateAvailable(true);
        }
      } catch {
        // offline or a blip — just try again next tick, nothing to show for it
      }
    };

    const intervalId = window.setInterval(checkForUpdate, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisible);
    void checkForUpdate();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <Snackbar
      open={updateAvailable}
      slots={{ transition: Slide }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      message="A new version of this app is available"
      action={
        <Button color="inherit" size="small" onClick={() => window.location.reload()}>
          Reload
        </Button>
      }
    />
  );
}
