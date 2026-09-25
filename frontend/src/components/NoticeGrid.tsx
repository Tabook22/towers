import { useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import DragIndicatorRounded from '@mui/icons-material/DragIndicatorRounded';
import type { FieldNotice } from '../api/notices';
import { useNoticeDesign } from './noticeDesignUtils';

/** Personal ordering never changes a notice's audience, priority or acknowledgement. */
export function NoticeGrid({ notes, render, compact = false }: { notes: FieldNotice[]; render: (note: FieldNotice) => ReactNode; compact?: boolean }) {
  const { prefs, setPrefs, t } = useNoticeDesign();
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; dx: number; dy: number; target: number | null } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const ordered = [...notes].sort((a, b) => {
    const ai = prefs.order.indexOf(a.id), bi = prefs.order.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });
  function move(id: number, target: number) {
    if (id === target) return;
    const ids = ordered.map(n => n.id), from = ids.indexOf(id), to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1); ids.splice(to, 0, id);
    setPrefs({ order: [...ids, ...prefs.order.filter(n => !ids.includes(n))].slice(0, 2000) });
    setAnnouncement(prefs.language === 'ar' ? `تم نقل الملاحظة إلى الموضع ${to + 1}` : `Note moved to position ${to + 1}`);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-notice-slot]');
    const targetId = target && grid.current?.contains(target) ? Number(target.dataset.noticeSlot) : null;
    setDrag({ ...drag, dx: event.clientX - drag.x, dy: event.clientY - drag.y, target: targetId });
    // Keep long boards usable while dragging on touch screens or with a mouse.
    let parent = grid.current?.parentElement;
    while (parent) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
        const rect = parent.getBoundingClientRect();
        if (event.clientY < rect.top + 48) parent.scrollTop -= 14;
        if (event.clientY > rect.bottom - 48) parent.scrollTop += 14;
        break;
      }
      parent = parent.parentElement;
    }
  }
  return <>
    {notes.length > 1 && <Typography variant="caption" sx={{ display: 'block', color: '#314d55', bgcolor: 'rgba(255,255,255,.85)', borderRadius: 1, px: 1, mb: 2 }}>{t('Drag the handle to arrange notes. Arrow keys work too.')}</Typography>}
    <Box ref={grid} sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.round((compact ? 240 : 310) * prefs.zoom / 100)}px), 1fr))`, gap: 3, alignItems: 'start', ...(compact ? { '@media (min-width: 1500px)': { gridTemplateColumns: 'minmax(0, 1fr)' } } : {}) }}>
      {ordered.map((note, index) => <Box key={note.id} data-notice-slot={note.id} sx={{ position: 'relative', minWidth: 0, borderRadius: 2, outline: drag?.target === note.id && drag.id !== note.id ? '3px dashed #167487' : undefined, outlineOffset: 5 }}>
        <Box sx={{ position: 'relative', transform: drag?.id === note.id ? `translate(${drag.dx}px, ${drag.dy}px) rotate(2deg)` : undefined, zIndex: drag?.id === note.id ? 4 : 0, pointerEvents: drag?.id === note.id ? 'none' : undefined, opacity: drag?.id === note.id ? .88 : 1 }}>
          {render(note)}
          <IconButton size="small" aria-label={`${prefs.language === 'ar' ? 'ترتيب الملاحظة' : 'Arrange note'}: ${note.title}`}
            title={t('Drag the handle to arrange notes. Arrow keys work too.')} disabled={notes.length < 2}
            sx={{ position: 'absolute', right: 9, top: 5, color: '#24343c', bgcolor: 'rgba(255,255,255,.45)', cursor: drag ? 'grabbing' : 'grab', touchAction: 'none', '&:hover': { bgcolor: 'rgba(255,255,255,.85)' } }}
            onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: note.id, x: event.clientX, y: event.clientY, dx: 0, dy: 0, target: null }); }}
            onPointerMove={pointerMove} onPointerUp={event => { if (drag?.target) move(note.id, drag.target); setDrag(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}
            onKeyDown={event => {
              if (event.key === 'Escape') { setDrag(null); return; }
              const delta = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0;
              if (!delta) return;
              event.preventDefault(); const target = ordered[index + delta]; if (target) move(note.id, target.id);
            }}><DragIndicatorRounded fontSize="small" /></IconButton>
        </Box>
      </Box>)}
    </Box>
    <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' }}>{announcement}</Box>
  </>;
}
