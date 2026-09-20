import { useRef, useState, type RefObject } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import AspectRatioRoundedIcon from '@mui/icons-material/AspectRatioRounded';

type LogoBoxSx = { width: number | 'auto'; height: number | 'auto'; maxWidth: string; maxHeight?: number };

function logoBoxSx(width: number | null | undefined, height: number | null | undefined, fallbackMaxHeight: number): LogoBoxSx {
  if (width || height) {
    // No maxWidth cap here — an explicit size (typed or dragged) is a deliberate choice, so honor
    // it in full rather than silently clipping it back down like the auto-sized fallback below.
    return { width: width || 'auto', height: height || 'auto', maxWidth: 'none' };
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

/** A corner handle that scales an image proportionally by dragging — reads the element's own
 * current rendered size at drag-start (via `imgRef`) rather than trusting the width/height props,
 * since those are often null (falling back to an intrinsic/auto size) until the first resize. */
function useResizable(
  imgRef: RefObject<HTMLImageElement | null>,
  editable: boolean,
  onChange?: (width: number, height: number) => void,
) {
  const [resizing, setResizing] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const el = imgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startW = rect.width;
    const startH = rect.height;
    const aspect = startW / startH || 1;
    setResizing(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const newW = Math.min(400, Math.max(24, Math.round(startW + dx)));
      const newH = Math.max(24, Math.round(newW / aspect));
      onChange(newW, newH);
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { resizing, onPointerDown };
}

/** The little handle rendered at an overlay's bottom-right corner for useResizable — a fixed-size
 * circle so it stays easy to grab regardless of how small the logo itself is scaled down to. */
function ResizeHandle({ onPointerDown, resizing }: { onPointerDown: (e: React.PointerEvent) => void; resizing: boolean }) {
  return (
    <Box
      onPointerDown={onPointerDown}
      sx={{
        position: 'absolute',
        right: -8,
        bottom: -8,
        width: 20,
        height: 20,
        borderRadius: '50%',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px solid #fff',
        boxShadow: 2,
        cursor: resizing ? 'nwse-resize' : 'nwse-resize',
        touchAction: 'none',
      }}
    >
      <AspectRatioRoundedIcon sx={{ fontSize: 12 }} />
    </Box>
  );
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
  onMainLogoSizeChange,
  onSkyLogoSizeChange,
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
  onMainLogoSizeChange?: (width: number, height: number) => void;
  onSkyLogoSizeChange?: (width: number, height: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainLogoRef = useRef<HTMLImageElement>(null);
  const skyLogoRef = useRef<HTMLImageElement>(null);
  const mainLogoDrag = useDraggable(containerRef, editable, onMainLogoPosChange);
  const skyLogoDrag = useDraggable(containerRef, editable, onSkyLogoPosChange);
  const titleDrag = useDraggable(containerRef, editable, onTitlePosChange);
  const mainLogoResize = useResizable(mainLogoRef, editable, onMainLogoSizeChange);
  const skyLogoResize = useResizable(skyLogoRef, editable, onSkyLogoSizeChange);

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
          sx={{
            position: 'absolute',
            ...(mainHasPos
              ? { left: `${mainLogoPosX}%`, top: `${mainLogoPosY}%`, transform: 'translate(-50%, -50%)' }
              : { top: 12, right: 12 }),
          }}
        >
          <Box
            ref={mainLogoRef}
            component="img"
            src={mainLogoSrc}
            alt="Company logo"
            draggable={false}
            onPointerDown={mainLogoDrag.onPointerDown}
            sx={{
              position: 'relative',
              display: 'block',
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
          {editable && onMainLogoSizeChange && (
            <ResizeHandle onPointerDown={mainLogoResize.onPointerDown} resizing={mainLogoResize.resizing} />
          )}
        </Box>
      )}
      {skyHasPos && skyLogoSrc && (
        <Box
          sx={{
            position: 'absolute',
            left: `${skyLogoPosX}%`,
            top: `${skyLogoPosY}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <Box
            ref={skyLogoRef}
            component="img"
            src={skyLogoSrc}
            alt="Sky Green Line"
            draggable={false}
            onPointerDown={skyLogoDrag.onPointerDown}
            sx={{
              position: 'relative',
              display: 'block',
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
          {editable && onSkyLogoSizeChange && (
            <ResizeHandle onPointerDown={skyLogoResize.onPointerDown} resizing={skyLogoResize.resizing} />
          )}
        </Box>
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
