import { useRef } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

const MIN_WIDTH = 40;

/** The in-editor rendering of a ResizableImage node — a plain <img> plus a drag handle on the
 * bottom-right corner that writes the node's `width` attribute as the user drags, and a
 * selected-state outline so it's obvious which image the toolbar's align buttons act on (see
 * RichTextEditor.tsx). What actually gets saved is just `<img width=".." data-align="..">`
 * (see ResizableImage.ts's renderHTML) — this component is editor-only presentation. */
export function ImageNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, width, align } = node.attrs as { src: string; alt: string | null; width: number | null; align: string };
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragState.current = { startX: e.clientX, startWidth: rect.width };

    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const next = Math.max(MIN_WIDTH, Math.round(dragState.current.startWidth + dx));
      updateAttributes({ width: next });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const isCenter = align === 'center';

  return (
    <NodeViewWrapper
      as="span"
      style={{
        display: isCenter ? 'block' : 'inline-block',
        position: 'relative',
        float: align === 'left' ? 'left' : align === 'right' ? 'right' : 'none',
        clear: isCenter ? 'both' : undefined,
        textAlign: isCenter ? 'center' : undefined,
        margin: align === 'left' ? '4px 12px 8px 0' : align === 'right' ? '4px 0 8px 12px' : '8px auto',
        maxWidth: '100%',
      }}
      data-drag-handle
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt || ''}
        draggable={false}
        style={{
          width: width ? `${width}px` : 'auto',
          maxWidth: '100%',
          display: 'block',
          outline: selected ? '2px solid #1976d2' : 'none',
          outlineOffset: 2,
        }}
      />
      <span
        onPointerDown={onResizeStart}
        contentEditable={false}
        style={{
          position: 'absolute',
          width: 14,
          height: 14,
          right: -2,
          bottom: -2,
          background: '#1976d2',
          border: '2px solid #fff',
          borderRadius: '50%',
          cursor: 'nwse-resize',
          boxShadow: '0 0 2px rgba(0,0,0,0.5)',
        }}
      />
    </NodeViewWrapper>
  );
}
