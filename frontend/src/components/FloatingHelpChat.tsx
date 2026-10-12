import { tr, useLanguage } from '../i18n';
import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Fab, IconButton, Paper, Stack, Tooltip, Typography, Zoom } from '@mui/material';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import { HelpChatConversation } from './HelpChatWidget';

const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 640;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 320;
// Roughly the header + padding + input row + internet checkbox — subtracted from the panel's
// total height so the message list (the part that actually needs the extra room) grows to fill
// whatever's left, instead of resizing just adding blank space below a fixed-height list.
const CHROME_HEIGHT = 260;

type Axis = 'x' | 'y' | 'xy';

/** A "chat bubble" launcher fixed to the bottom-right corner of every page (see Layout.tsx) — the
 * same help assistant as the Help page's embedded widget, always one click away instead of a full
 * page navigation. Purely a UI shell around HelpChatConversation, which owns the actual chat.
 *
 * The panel itself is `position: fixed` (not nested inside the launcher's own small anchor box),
 * so it can be dragged anywhere on screen by its header — once moved, it switches from the default
 * bottom-right docking to an explicit top/left position and stays there for the rest of this
 * session (the launcher button itself never moves). It's also resizable by dragging the top or
 * left edge (or the top-left corner) — mirrored from ResizableDialogPaper's top-left-anchored
 * dialogs, since this panel grows "backwards" from its bottom-right-docked default. */
export function FloatingHelpChat() {
  useLanguage();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const dragAxis = useRef<Axis | null>(null);

  const startResize = (axis: Axis) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragAxis.current = axis;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = rect.width;
    const startH = rect.height;

    const onMove = (ev: PointerEvent) => {
      if (!dragAxis.current) return;
      // Docked bottom-right by default, so dragging the handle LEFT/UP is what grows the panel.
      const dx = startX - ev.clientX;
      const dy = startY - ev.clientY;
      setSize({
        width: dragAxis.current === 'y' ? startW : Math.max(MIN_WIDTH, Math.min(window.innerWidth - 48, startW + dx)),
        height: dragAxis.current === 'x' ? startH : Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 120, startH + dy)),
      });
    };
    const onUp = () => {
      dragAxis.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startMove = (e: React.PointerEvent) => {
    // Don't start a move when the pointer actually landed on the close button.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = rect.top;
    const startLeft = rect.left;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setPos({
        top: Math.max(8, Math.min(window.innerHeight - rect.height - 8, startTop + dy)),
        left: Math.max(8, Math.min(window.innerWidth - rect.width - 8, startLeft + dx)),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const width = size?.width ?? DEFAULT_WIDTH;
  const height = size?.height ?? DEFAULT_HEIGHT;

  // The launcher would cover the conversation's Send button on compact screens.
  if (location.pathname === '/messages') return null;

  return (
    <>
      <Zoom in={open}>
        <Paper
          ref={paperRef}
          elevation={6}
          role="region" aria-label={tr("Help assistant")}
          sx={{
            position: 'fixed',
            zIndex: (t) => t.zIndex.speedDial,
            ...(pos
              ? { top: pos.top, left: pos.left, bottom: 'auto', right: 'auto' }
              : { bottom: { xs: 84, sm: 96 }, right: { xs: 12, sm: 24 }, top: 'auto', left: 'auto' }),
            width: { xs: 'calc(100vw - 24px)', sm: width },
            height: { xs: 'min(680px, calc(100dvh - 112px))', sm: height },
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'calc(100dvh - 112px)',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 4,
            border: '1px solid', borderColor: 'divider', backgroundImage: 'none', boxShadow: '0 24px 70px rgba(8,42,57,.25), 0 4px 18px rgba(8,42,57,.12)',
            overflow: 'hidden',
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            onPointerDown={startMove}
            sx={{
              alignItems: 'center',
              background: 'linear-gradient(120deg, #0a3346, #176c79)',
              color: '#fff',
              pl: 1,
              pr: 2,
              py: 2,
              flexShrink: 0,
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
            <Tooltip title={tr("Drag to move")}><DragIndicatorRoundedIcon sx={{ opacity: 0.6 }} /></Tooltip>
            <Box sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 3, bgcolor: '#ffffff18', border: '1px solid #ffffff30', flexShrink: 0 }}><ForumRoundedIcon /></Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>{tr("Help assistant")}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.85 }}>{tr("Your guide to reports, inspections and the app")}</Typography>
            </Box>
            <IconButton size="small" aria-label={tr("Close help assistant")} onClick={() => setOpen(false)} sx={{ color: '#fff' }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: theme => theme.palette.mode === 'dark' ? 'background.default' : '#f6f9fb' }}>
            <HelpChatConversation listMaxHeight={Math.max(150, height - CHROME_HEIGHT)} listMinHeight={150} />
          </Box>

          {/* Resize handles — top/left edges and the top-left corner, matching this panel's
              bottom-right-docked default (see the component docstring). */}
          <Box
            onPointerDown={startResize('x')}
            sx={{ position: 'absolute', top: 0, left: 0, width: 10, height: '100%', cursor: 'ew-resize', zIndex: 10 }}
          />
          <Box
            onPointerDown={startResize('y')}
            sx={{ position: 'absolute', top: 0, left: 0, height: 10, width: '100%', cursor: 'ns-resize', zIndex: 10 }}
          />
          <Box
            onPointerDown={startResize('xy')}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 18,
              height: 18,
              cursor: 'nwse-resize',
              zIndex: 11,
              backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.6) 0 2px, transparent 2px 5px)',
              backgroundPosition: 'top left',
              backgroundSize: '10px 10px',
              backgroundRepeat: 'no-repeat',
            }}
          />
        </Paper>
      </Zoom>

      <Box sx={{ position: 'fixed', bottom: { xs: 16, sm: 24 }, right: { xs: 16, sm: 24 }, zIndex: (t) => t.zIndex.speedDial }}>
        <Tooltip title={open ? tr("Close help assistant") : tr("Need help? Ask the assistant")} placement="left">
          <Fab color="primary" onClick={() => setOpen((o) => !o)} aria-label={tr("Help assistant")} aria-expanded={open} sx={{ background: 'linear-gradient(135deg, #12516a, #258a91)', color: '#fff', boxShadow: '0 8px 24px rgba(16,75,96,.3)', border: '1px solid #ffffff55', '&:hover': { background: 'linear-gradient(135deg, #0b3d52, #19767d)' } }}>
            {open ? <CloseRoundedIcon /> : <ForumRoundedIcon />}
          </Fab>
        </Tooltip>
      </Box>
    </>
  );
}
