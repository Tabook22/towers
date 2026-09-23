import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Fab, IconButton, Paper, Stack, Tooltip, Typography, Zoom } from '@mui/material';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import { HelpChatConversation } from './HelpChatWidget';

const DEFAULT_WIDTH = 380;
const DEFAULT_HEIGHT = 512;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 320;
// Roughly the header + padding + input row + internet checkbox — subtracted from the panel's
// total height so the message list (the part that actually needs the extra room) grows to fill
// whatever's left, instead of resizing just adding blank space below a fixed-height list.
const CHROME_HEIGHT = 210;

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
        top: Math.max(8, Math.min(window.innerHeight - 60, startTop + dy)),
        left: Math.max(8, Math.min(window.innerWidth - 60, startLeft + dx)),
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
          sx={{
            position: 'fixed',
            zIndex: (t) => t.zIndex.speedDial,
            ...(pos
              ? { top: pos.top, left: pos.left, bottom: 'auto', right: 'auto' }
              : { bottom: 96, right: 24, top: 'auto', left: 'auto' }),
            width: { xs: 'calc(100vw - 48px)', sm: width },
            height: { xs: 'auto', sm: height },
            maxWidth: '92vw',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            onPointerDown={startMove}
            sx={{
              alignItems: 'center',
              bgcolor: 'primary.main',
              color: '#fff',
              pl: 1,
              pr: 2,
              py: 1.5,
              flexShrink: 0,
              cursor: 'move',
              userSelect: 'none',
            }}
          >
            <DragIndicatorRoundedIcon sx={{ opacity: 0.6 }} />
            <SmartToyRoundedIcon />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>Help assistant</Typography>
              <Typography variant="caption" sx={{ opacity: 0.85 }}>
                Ask anything about the app — drag here to move
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: '#fff' }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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

      <Box sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (t) => t.zIndex.speedDial }}>
        <Tooltip title={open ? 'Close help assistant' : 'Need help? Ask the assistant'} placement="left">
          <Fab color="primary" onClick={() => setOpen((o) => !o)} aria-label="Help assistant">
            {open ? <CloseRoundedIcon /> : <SmartToyRoundedIcon />}
          </Fab>
        </Tooltip>
      </Box>
    </>
  );
}
