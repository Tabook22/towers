import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Paper, type PaperProps } from '@mui/material';

const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;
const EDGE = 10; // px hit-area for the edge drag handles

type Axis = 'x' | 'y' | 'xy';

/**
 * Like ResizableDialogPaper (drag-to-resize via right/bottom/corner handles), but also draggable
 * to reposition anywhere on screen. Mark whichever element should act as the "grab here to move"
 * handle — typically the DialogTitle — with a `data-drag-handle` attribute; this Paper finds that
 * real DOM element after mount and wires a plain pointerdown listener directly onto it, the same
 * way react-draggable's `handle` option works, rather than overlaying anything on top of it (an
 * overlay would block clicks on a close button that lives inside the handle).
 *
 * Size and position are local state, reset each time the dialog re-opens (MUI unmounts the Paper
 * on close) — a resize/move is a one-off "put this where I want it right now" action, not a
 * preference worth persisting across opens, same reasoning as ResizableDialogPaper's own comment.
 */
export const DraggableResizableDialogPaper = forwardRef<HTMLDivElement, PaperProps>(function DraggableResizableDialogPaper(
  { style, children, ...rest },
  forwardedRef,
) {
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const dragAxis = useRef<Axis | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      paperRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [forwardedRef],
  );

  const startResize = useCallback(
    (axis: Axis) => (e: React.PointerEvent) => {
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
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        setSize({
          width:
            dragAxis.current === 'y' ? startW : Math.max(MIN_WIDTH, Math.min(window.innerWidth - 32, startW + dx)),
          height:
            dragAxis.current === 'x' ? startH : Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 32, startH + dy)),
        });
      };
      const onUp = () => {
        dragAxis.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  // Finds the child marked as the drag handle and wires the move directly onto that real element
  // — see the component doc for why this beats a covering overlay.
  useEffect(() => {
    const handle = paperRef.current?.querySelector<HTMLElement>('[data-drag-handle]');
    if (!handle) return;
    const prevCursor = handle.style.cursor;
    const prevSelect = handle.style.userSelect;
    handle.style.cursor = 'move';
    handle.style.userSelect = 'none';

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input, textarea, [role="button"]')) return;
      const rect = paperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const startTop = rect.top;
      const startLeft = rect.left;

      const onMove = (ev: PointerEvent) => {
        setPos({
          top: Math.max(0, Math.min(window.innerHeight - 60, startTop + (ev.clientY - startY))),
          left: Math.max(0, Math.min(window.innerWidth - 60, startLeft + (ev.clientX - startX))),
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    handle.addEventListener('pointerdown', onPointerDown);
    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.style.cursor = prevCursor;
      handle.style.userSelect = prevSelect;
    };
  }, []);

  return (
    <Paper
      {...rest}
      ref={setRefs}
      style={{
        ...style,
        ...(size ? { width: size.width, height: size.height, maxWidth: 'none', maxHeight: 'none' } : {}),
        ...(pos ? { position: 'fixed', top: pos.top, left: pos.left, margin: 0 } : { position: 'relative' }),
      }}
    >
      {children}
      <div
        onPointerDown={startResize('x')}
        style={{ position: 'absolute', top: 0, right: 0, width: EDGE, height: '100%', cursor: 'ew-resize', zIndex: 10 }}
      />
      <div
        onPointerDown={startResize('y')}
        style={{ position: 'absolute', bottom: 0, left: 0, height: EDGE, width: '100%', cursor: 'ns-resize', zIndex: 10 }}
      />
      <div
        onPointerDown={startResize('xy')}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 18,
          height: 18,
          cursor: 'nwse-resize',
          zIndex: 11,
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 5px)',
          backgroundPosition: 'bottom right',
          backgroundSize: '10px 10px',
          backgroundRepeat: 'no-repeat',
        }}
      />
    </Paper>
  );
});
