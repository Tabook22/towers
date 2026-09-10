import { forwardRef, useCallback, useRef, useState } from 'react';
import { Paper, type PaperProps } from '@mui/material';

const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;
const EDGE = 10; // px hit-area for the edge drag handles

type Axis = 'x' | 'y' | 'xy';

/**
 * Drop-in `PaperComponent` for MUI `<Dialog>` that adds drag-to-resize handles on the right edge,
 * bottom edge, and bottom-right corner, so the dialog's size becomes user-adjustable instead of
 * fixed by `maxWidth`/`fullWidth`. Usage: `<Dialog PaperComponent={ResizableDialogPaper} ...>`.
 *
 * Size is local state, reset each time the dialog re-opens (MUI unmounts the Paper on close) —
 * that's a deliberate simplification, not a bug: a resize is a one-off "give me more room right
 * now" action, not a preference worth persisting across opens.
 */
export const ResizableDialogPaper = forwardRef<HTMLDivElement, PaperProps>(function ResizableDialogPaper(
  { style, children, ...rest },
  forwardedRef,
) {
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const dragAxis = useRef<Axis | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      paperRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [forwardedRef],
  );

  const startDrag = useCallback((axis: Axis) => (e: React.PointerEvent) => {
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
  }, []);

  return (
    <Paper
      {...rest}
      ref={setRefs}
      style={{
        ...style,
        ...(size ? { width: size.width, height: size.height, maxWidth: 'none', maxHeight: 'none' } : {}),
        position: 'relative',
      }}
    >
      {children}
      <div
        onPointerDown={startDrag('x')}
        style={{ position: 'absolute', top: 0, right: 0, width: EDGE, height: '100%', cursor: 'ew-resize', zIndex: 10 }}
      />
      <div
        onPointerDown={startDrag('y')}
        style={{ position: 'absolute', bottom: 0, left: 0, height: EDGE, width: '100%', cursor: 'ns-resize', zIndex: 10 }}
      />
      <div
        onPointerDown={startDrag('xy')}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 18,
          height: 18,
          cursor: 'nwse-resize',
          zIndex: 11,
          backgroundImage:
            'repeating-linear-gradient(135deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 5px)',
          backgroundPosition: 'bottom right',
          backgroundSize: '10px 10px',
          backgroundRepeat: 'no-repeat',
        }}
      />
    </Paper>
  );
});
