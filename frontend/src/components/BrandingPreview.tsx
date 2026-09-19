import { useRef, useState, type RefObject } from 'react';
import { Box, Stack, Typography } from '@mui/material';

type LogoBoxSx = { width: number | 'auto'; height: number | 'auto'; maxWidth: string; maxHeight?: number };

function logoBoxSx(width: number | null | undefined, height: number | null | undefined, fallbackMaxHeight: number): LogoBoxSx {
  if (width || height) {
    return { width: width || 'auto', height: height || 'auto', maxWidth: '45%' };
  }
  return { width: 'auto', height: 'auto', maxWidth: '45%', maxHeight: fallbackMaxHeight };
}

/** Turns any element into a drag-to-reposition handle within `containerRef`, reporting the drop
 * point as a percentage (0-100) of the container's own width/height. Shared by the main logo, the
 * Sky Green Line logo, and the name/version text — each drags independently over the same banner
 * canvas. No-op (returns a plain, non-interactive handler) when `editable` or `onChange` is unset,
 * so the same JSX renders identically in the read-only real splash screen. */
function useDraggable(containerRef: RefObject<HTMLDivElement | null>, editable: boolean, onChange?: (x: number, y: number) => void) {
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100));
      onChange(x, y);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { dragging, onPointerDown };
}

/** The banner photo, with the main logo, the Sky Green Line logo, and the name/version text all
 * able to sit on top of it as independently draggable overlays — shared between the real splash
 * screen (read-only) and the Settings page's live preview (editable). The main logo always
 * overlays the banner (falling back to a built-in corner spot when its position isn't set); the
 * Sky Green Line logo and the name/version text only overlay it once a position has actually been
 * dragged onto it — until then the caller renders them in the row below instead (see
 * BrandingNameRow), exactly as this always worked before this feature existed. */
export function BrandingBanner({
  heroSrc,
  mainLogoSrc,
  mainLogoWidth,
  mainLogoHeight,
  mainLogoPosX,
  mainLogoPosY,
  skyLogoSrc,
  skyLogoWidth,
  skyLogoHeight,
  skyLogoPosX,
  skyLogoPosY,
  appTitle,
  appVersion,
  titlePosX,
  titlePosY,
  editable = false,
  onMainLogoPosChange,
  onSkyLogoPosChange,
  onTitlePosChange,
}: {
  heroSrc: string;
  mainLogoSrc: string | null;
  mainLogoWidth?: number | null;
  mainLogoHeight?: number | null;
  mainLogoPosX?: number | null;
  mainLogoPosY?: number | null;
  skyLogoSrc?: string | null;
  skyLogoWidth?: number | null;
  skyLogoHeight?: number | null;
  skyLogoPosX?: number | null;
  skyLogoPosY?: number | null;
  appTitle?: string | null;
  appVersion?: string | null;
  titlePosX?: number | null;
  titlePosY?: number | null;
  editable?: boolean;
  onMainLogoPosChange?: (x: number, y: number) => void;
  onSkyLogoPosChange?: (x: number, y: number) => void;
  onTitlePosChange?: (x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainLogoDrag = useDraggable(containerRef, editable, onMainLogoPosChange);
  const skyLogoDrag = useDraggable(containerRef, editable, onSkyLogoPosChange);
  const titleDrag = useDraggable(containerRef, editable, onTitlePosChange);

  const mainHasPos = mainLogoPosX != null && mainLogoPosY != null;
  const skyHasPos = skyLogoPosX != null && skyLogoPosY != null;
  const titleHasPos = titlePosX != null && titlePosY != null;

  return (
    <Box ref={containerRef} sx={{ position: 'relative', flexShrink: 0 }}>
      <Box
        component="img"
        src={heroSrc}
        alt=""
        draggable={false}
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
          draggable={false}
          onPointerDown={mainLogoDrag.onPointerDown}
          sx={{
            position: 'absolute',
            ...(mainHasPos
              ? { left: `${mainLogoPosX}%`, top: `${mainLogoPosY}%`, transform: 'translate(-50%, -50%)' }
              : { top: 12, right: 12 }),
            ...logoBoxSx(mainLogoWidth, mainLogoHeight, 90),
            objectFit: 'contain',
            bgcolor: '#fff',
            borderRadius: 1,
            boxShadow: 3,
            p: 1,
            cursor: editable ? (mainLogoDrag.dragging ? 'grabbing' : 'grab') : undefined,
            outline: editable ? '2px dashed rgba(255,255,255,0.8)' : undefined,
            outlineOffset: 2,
            touchAction: editable ? 'none' : undefined,
            userSelect: 'none',
          }}
        />
      )}
      {skyHasPos && skyLogoSrc && (
        <Box
          component="img"
          src={skyLogoSrc}
          alt="Sky Green Line"
          draggable={false}
          onPointerDown={skyLogoDrag.onPointerDown}
          sx={{
            position: 'absolute',
            left: `${skyLogoPosX}%`,
            top: `${skyLogoPosY}%`,
            transform: 'translate(-50%, -50%)',
            width: skyLogoWidth || 56,
            height: skyLogoHeight || 56,
            objectFit: 'contain',
            bgcolor: '#fff',
            borderRadius: 1.5,
            boxShadow: 3,
            p: 0.75,
            cursor: editable ? (skyLogoDrag.dragging ? 'grabbing' : 'grab') : undefined,
            outline: editable ? '2px dashed rgba(255,255,255,0.8)' : undefined,
            outlineOffset: 2,
            touchAction: editable ? 'none' : undefined,
            userSelect: 'none',
          }}
        />
      )}
      {titleHasPos && (
        <Box
          onPointerDown={titleDrag.onPointerDown}
          sx={{
            position: 'absolute',
            left: `${titlePosX}%`,
            top: `${titlePosY}%`,
            transform: 'translate(-50%, -50%)',
            bgcolor: 'rgba(255,255,255,0.92)',
            borderRadius: 1,
            boxShadow: 3,
            px: 1.5,
            py: 0.75,
            maxWidth: '80%',
            cursor: editable ? (titleDrag.dragging ? 'grabbing' : 'grab') : undefined,
            outline: editable ? '2px dashed rgba(255,255,255,0.8)' : undefined,
            outlineOffset: 2,
            touchAction: editable ? 'none' : undefined,
            userSelect: 'none',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.15 }} noWrap>
            {appTitle || 'Insulator Inspector Pro'}
          </Typography>
          {appVersion && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {appVersion}
            </Typography>
          )}
        </Box>
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

/** The Sky Green Line logo next to the app name/version, in their own row below the banner — used
 * whenever one of them hasn't been dragged onto the banner itself (see BrandingBanner). Either
 * half can be hidden independently once its own position has moved it up onto the banner. */
export function BrandingNameRow({
  skyLogoSrc,
  skyLogoWidth,
  skyLogoHeight,
  appTitle,
  appVersion,
  hideSkyLogo = false,
  hideTitle = false,
  onPinSkyLogoToBanner,
  onPinTitleToBanner,
}: {
  skyLogoSrc: string;
  skyLogoWidth?: number | null;
  skyLogoHeight?: number | null;
  appTitle: string | null;
  appVersion: string | null;
  hideSkyLogo?: boolean;
  hideTitle?: boolean;
  onPinSkyLogoToBanner?: () => void;
  onPinTitleToBanner?: () => void;
}) {
  if (hideSkyLogo && hideTitle) return null;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 3 }}>
      {!hideSkyLogo && (
        <Stack sx={{ alignItems: 'center', gap: 0.25 }}>
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
          {onPinSkyLogoToBanner && (
            <Typography
              variant="caption"
              component="button"
              onClick={onPinSkyLogoToBanner}
              sx={{ border: 0, bgcolor: 'transparent', color: 'primary.main', cursor: 'pointer', p: 0, whiteSpace: 'nowrap' }}
            >
              Move onto banner
            </Typography>
          )}
        </Stack>
      )}
      {!hideTitle && (
        <Stack sx={{ minWidth: 0, alignItems: 'flex-start', gap: 0.25 }}>
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
          {onPinTitleToBanner && (
            <Typography
              variant="caption"
              component="button"
              onClick={onPinTitleToBanner}
              sx={{ border: 0, bgcolor: 'transparent', color: 'primary.main', cursor: 'pointer', p: 0, whiteSpace: 'nowrap' }}
            >
              Move onto banner
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}
