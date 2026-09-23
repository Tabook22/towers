import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Stack, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/CloseRounded';
import ZoomInIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutIcon from '@mui/icons-material/ZoomOutRounded';
import RestartAltIcon from '@mui/icons-material/RestartAltRounded';
import { ResizableDialogPaper } from './ResizableDialogPaper';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  imageUrl: string;
  /** Small line under the title — e.g. capture date/time, or "Annotated" vs "Original" context. */
  subtitle?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_STEP = 0.5;

/** A click-to-enlarge viewer with scroll/pinch zoom and drag-to-pan — used wherever a thumbnail
 * elsewhere in the app needs a "click to see it full-size, then magnify details" affordance
 * without leaving the current page. Opens at 80% of the screen and can be dragged bigger/smaller
 * from there via ResizableDialogPaper's edge handles; zoom/pan resets every time it (re)opens or
 * the image changes, so a stale magnified state never carries over to the next photo. */
export function ImageLightbox({ open, onClose, title, imageUrl, subtitle }: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (open) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open, imageUrl]);

  const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

  const zoomBy = (delta: number) => {
    setScale((s) => {
      const next = clampScale(s + delta);
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  };

  const handleDoubleClick = () => {
    setScale((s) => (s > MIN_SCALE ? MIN_SCALE : 2.5));
    setOffset({ x: 0, y: 0 });
  };

  const handleMouseDown: React.MouseEventHandler<HTMLImageElement> = (e) => {
    if (scale <= MIN_SCALE) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const { startX, startY, startOffset } = dragState.current;
      setOffset({ x: startOffset.x + (e.clientX - startX), y: startOffset.y + (e.clientY - startY) });
    };
    const handleUp = () => {
      dragState.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperComponent={ResizableDialogPaper}
      slotProps={{ paper: { sx: { width: '80vw', height: '80vh', maxWidth: '96vw', maxHeight: '96vh', display: 'flex', flexDirection: 'column' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexShrink: 0 }}>
        <Box>
          <Typography variant="h6" component="span" sx={{ fontWeight: 700, display: 'block' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Tooltip title="Zoom out">
            <span>
              <IconButton onClick={() => zoomBy(-ZOOM_STEP)} size="small" disabled={scale <= MIN_SCALE}>
                <ZoomOutIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </Typography>
          <Tooltip title="Zoom in">
            <span>
              <IconButton onClick={() => zoomBy(ZOOM_STEP)} size="small" disabled={scale >= MAX_SCALE}>
                <ZoomInIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Reset zoom">
            <span>
              <IconButton onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} size="small" disabled={scale === MIN_SCALE}>
                <RestartAltIcon />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent
        onWheel={handleWheel}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.900',
          p: 0,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        <Box
          component="img"
          src={imageUrl}
          alt={title}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
          draggable={false}
          sx={{
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'block',
            objectFit: 'contain',
            transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
            transition: dragging ? 'none' : 'transform 0.15s ease-out',
            cursor: scale > MIN_SCALE ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            userSelect: 'none',
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
