import { useRef, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';

type LogoBoxSx = { width: number | 'auto'; height: number | 'auto'; maxWidth: string; maxHeight?: number };

function logoBoxSx(width: number | null | undefined, height: number | null | undefined, fallbackMaxHeight: number): LogoBoxSx {
  if (width || height) {
    return { width: width || 'auto', height: height || 'auto', maxWidth: '45%' };
  }
  return { width: 'auto', height: 'auto', maxWidth: '45%', maxHeight: fallbackMaxHeight };
}

/** The banner photo with the main (company) logo overlaid on it — shared between the real splash
 * screen (read-only) and the Settings page's live preview, where the logo can be dragged to
 * reposition it (see onLogoPosChange). Positioning matches exactly between the two so what's
 * dragged here is what actually shows on the splash screen. When there's no banner, the logo falls
 * back to its own block instead (rendered by the caller — see BrandingNameRow's sibling usage). */
export function BrandingBanner({
  heroSrc,
  mainLogoSrc,
  mainLogoWidth,
  mainLogoHeight,
  mainLogoPosX,
  mainLogoPosY,
  editable = false,
  onLogoPosChange,
}: {
  heroSrc: string;
  mainLogoSrc: string | null;
  mainLogoWidth?: number | null;
  mainLogoHeight?: number | null;
  mainLogoPosX?: number | null;
  mainLogoPosY?: number | null;
  editable?: boolean;
  onLogoPosChange?: (x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasPos = mainLogoPosX != null && mainLogoPosY != null;

  const handlePointerMove = (e: PointerEvent) => {
    const container = containerRef.current;
    if (!container || !onLogoPosChange) return;
    const rect = container.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    onLogoPosChange(x, y);
  };
  const handlePointerUp = () => {
    setDragging(false);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!editable) return;
    e.preventDefault();
    setDragging(true);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <Box ref={containerRef} sx={{ position: 'relative', flexShrink: 0 }}>
      <Box
        component="img"
        src={heroSrc}
        alt=""
        sx={{
          width: '100%',
          height: 'auto',
          maxHeight: 220,
          objectFit: 'cover',
          display: 'block',
          borderTopLeftRadius: 'inherit',
          borderTopRightRadius: 'inherit',
        }}
      />
      {mainLogoSrc && (
        <Box
          component="img"
          src={mainLogoSrc}
          alt="Company logo"
          onPointerDown={handlePointerDown}
          sx={{
            position: 'absolute',
            ...(hasPos
              ? { left: `${mainLogoPosX}%`, top: `${mainLogoPosY}%`, transform: 'translate(-50%, -50%)' }
              : { top: 12, right: 12 }),
            ...logoBoxSx(mainLogoWidth, mainLogoHeight, 90),
            objectFit: 'contain',
            bgcolor: '#fff',
            borderRadius: 1,
            boxShadow: 3,
            p: 1,
            cursor: editable ? (dragging ? 'grabbing' : 'grab') : undefined,
            outline: editable ? '2px dashed rgba(255,255,255,0.8)' : undefined,
            outlineOffset: 2,
            touchAction: editable ? 'none' : undefined,
            userSelect: 'none',
          }}
        />
      )}
    </Box>
  );
}

/** The main logo shown as its own block (used only when there's no banner photo to overlay it
 * on) — same sizing rules as BrandingBanner's overlaid logo. */
export function BrandingLogoBlock({
  mainLogoSrc,
  mainLogoWidth,
  mainLogoHeight,
}: {
  mainLogoSrc: string;
  mainLogoWidth?: number | null;
  mainLogoHeight?: number | null;
}) {
  return (
    <Stack sx={{ alignItems: 'center', mb: 2 }}>
      <Box
        component="img"
        src={mainLogoSrc}
        alt="Company logo"
        sx={{
          ...(mainLogoWidth || mainLogoHeight
            ? { width: mainLogoWidth || 'auto', height: mainLogoHeight || 'auto', maxWidth: '100%' }
            : { width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: 160 }),
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </Stack>
  );
}

/** The Sky Green Line logo next to the app name/version — shared between the real splash screen
 * and the Settings preview. */
export function BrandingNameRow({
  skyLogoSrc,
  skyLogoWidth,
  skyLogoHeight,
  appTitle,
  appVersion,
}: {
  skyLogoSrc: string;
  skyLogoWidth?: number | null;
  skyLogoHeight?: number | null;
  appTitle: string | null;
  appVersion: string | null;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 3 }}>
      <Box
        component="img"
        src={skyLogoSrc}
        alt="Sky Green Line"
        sx={{
          width: skyLogoWidth || 56,
          height: skyLogoHeight || 56,
          objectFit: 'contain',
          bgcolor: '#fff',
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          p: 0.75,
          flexShrink: 0,
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.15 }} noWrap>
          {appTitle || 'Insulator Inspector Pro'}
        </Typography>
        {appVersion && (
          <Typography variant="body2" color="text.secondary">
            {appVersion}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
