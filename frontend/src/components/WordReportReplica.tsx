import { useAuth } from '../auth/AuthContext';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, LinearProgress, MenuItem, TextField, Stack, Typography } from '@mui/material';
import { apiClient } from '../api/client';
import { tr, useLanguage } from '../i18n';
import { reportError } from '../utils/reportLibrary';

type DrawingTool = 'pan' | 'pen' | 'highlight' | 'circle' | 'line';
interface Mark { tool: DrawingTool; color: string; width: number; points: [number, number][] }
interface FindingGroup { name: string; keys: string[] }
interface Props {
  reportId: number;
  groups: FindingGroup[];
  jumpKey?: string;
  onSelect: (key: string, checked: boolean) => void;
  selected: string[];
  section?: 'findings' | 'overview' | 'measurements';
  onOpenFinding?: (key: string) => void;
  onOpenTower?: (key: string) => void;
}

/** Render copied original Word tables with their original styles and embedded photographs. */
export function WordReportReplica({ reportId, groups, jumpKey, selected, onSelect, onOpenFinding, onOpenTower, section: documentSection = 'findings' }: Props) {
  useLanguage();
  const { user } = useAuth();
  const canAnnotate = user?.role !== 'client';
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<number | null>(null);
  const [gallery, setGallery] = useState<{ title: string; images: { src: string; caption: string }[]; index: number } | null>(null);
  const [windowWidth, setWindowWidth] = useState(90);
  const [windowHeight, setWindowHeight] = useState(90);
  const [maximized, setMaximized] = useState(false);
  const [tool, setTool] = useState<DrawingTool>('pan');
  const [penColor, setPenColor] = useState('#ff3030');
  const [penSize, setPenSize] = useState(6);
  const [viewportHeight, setViewportHeight] = useState(500);
  const [imageHeight, setImageHeight] = useState(1);
  const [marks, setMarks] = useState<Record<number, Mark[]>>({});
  const [draft, setDraft] = useState<Mark | null>(null);
  const draftRef = useRef<Mark | null>(null);
  const clearDrawing = () => { draftRef.current = null; setDraft(null); };
  const closeGallery = () => { setGallery(null); setMarks({}); clearDrawing(); setTool('pan'); };
  const imageViewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number; fractionX: number; fractionY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [imageZoom, setImageZoom] = useState<number | null>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const moveImage = (offset: number) => {
    clearDrawing();
    setGallery(old => old ? { ...old, index: Math.max(0, Math.min(old.images.length - 1, old.index + offset)) } : null);
    setImageZoom(null); setImageWidth(0); setImageFailed(false);
  };
  const [fit, setFit] = useState(1);
  const signature = JSON.stringify(groups);
  const groupsRef = useRef(groups);
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const openFindingRef = useRef(onOpenFinding);
  const openTowerRef = useRef(onOpenTower);
  useEffect(() => {
    groupsRef.current = groups;
    selectRef.current = onSelect;
    selectedRef.current = selected;
    openFindingRef.current = onOpenFinding;
    openTowerRef.current = onOpenTower;
  }, [groups, onSelect, selected, onOpenFinding, onOpenTower]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    host.current?.replaceChildren();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError(''); setGallery(null); setMarks({}); draftRef.current = null; setDraft(null); setTool('pan');
      try {
        const keys: string[] = (JSON.parse(signature) as FindingGroup[]).flatMap(group => group.keys);
        if (!keys.length && documentSection !== 'overview') { setLoading(false); return; }
        const response = await apiClient.post(`/api/reports/oetc-line-report/${reportId}/digital-document`, { finding_keys: keys, section: documentSection }, { responseType: 'blob', signal: controller.signal });
        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        const rendered = document.createElement('div');
        const word = await renderAsync(response.data, rendered, rendered, {
          className: 'issued-word', inWrapper: true, breakPages: false,
          ignoreLastRenderedPageBreak: true, renderHeaders: false, renderFooters: false,
          useBase64URL: true, renderAltChunks: false,
        });
        // docx-preview applies the default paragraph font to <p>, but its generic
        // span rule can override it. Explicitly attach the document's own default
        // style to unstyled paragraphs so Arial/etc. is inherited as in Word.
        const defaultStyle = (word.stylesPart?.styles as { isDefault?: boolean; target?: string; cssName?: string }[] | undefined)?.find(style => style.isDefault && style.target === 'p');
        if (defaultStyle?.cssName) rendered.querySelectorAll('p:not([class])').forEach(paragraph => paragraph.classList.add(defaultStyle.cssName!));
        if (cancelled || !host.current) return;
        const article = rendered.querySelector('section.issued-word > article');
        const tables = article ? Array.from(article.children).filter(child => child.tagName === 'TABLE') : [];
        if (documentSection === 'findings' && tables.length !== keys.length) throw new Error(tr('The original Word layout could not be loaded. Use View issued Word.'));
        const tableMap = new Map(keys.map((key, index) => [key, tables[index]]));
        const section = rendered.querySelector<HTMLElement>('section.issued-word');
        if (article && section) {
          if (documentSection === 'findings') {
          article.replaceChildren();
          section.style.minHeight = '0';
          for (const group of groupsRef.current) {
            if (group.name) {
              const heading = document.createElement('h2'); heading.textContent = group.name;
              heading.className = 'replica-group'; article.append(heading);
            }
            for (const key of group.keys) {
              const wrapper = document.createElement('div'); wrapper.dataset.findingKey = key;
              wrapper.className = 'replica-finding';
              wrapper.tabIndex = -1;
              const tools = document.createElement('label'); tools.className = 'replica-tools';
              const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
              checkbox.checked = selectedRef.current.includes(key);
              checkbox.dataset.selectionKey = key;
              checkbox.setAttribute('aria-label', `${tr('Select finding')} ${key}`);
              checkbox.addEventListener('change', () => selectRef.current(key, checkbox.checked));
              tools.append(checkbox, document.createTextNode(tr('Select finding')));
              if (openTowerRef.current) {
                const towerButton = document.createElement('button');
                towerButton.type = 'button'; towerButton.className = 'replica-tower-button';
                towerButton.textContent = tr('Visual tower form');
                towerButton.setAttribute('aria-label', tr('View tower for finding {0}', [key]));
                towerButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openTowerRef.current?.(key); });
                tools.append(towerButton);
              }
              const findingTable = tableMap.get(key)!;
              const photos = Array.from(findingTable.querySelectorAll<HTMLImageElement>('img'));
              const images = photos.map(photo => ({ src: photo.src, caption: photo.closest('td')?.textContent?.trim() || tr('Report photograph') }));
              const detailRows = findingTable.querySelectorAll('tr');
              const towerCells = detailRows[2]?.querySelectorAll('td');
              const phaseCells = detailRows[3]?.querySelectorAll('td');
              const title = [detailRows[0]?.textContent?.trim(), towerCells?.[1]?.textContent?.trim(), phaseCells?.[1]?.textContent?.trim(), towerCells?.[3]?.textContent?.trim()].filter(Boolean).join(' · ');
              photos.forEach((photo, index) => {
                photo.style.cursor = 'zoom-in';
                photo.tabIndex = 0; photo.setAttribute('role', 'button');
                photo.setAttribute('aria-label', `${tr('Open report photograph')}: ${images[index].caption}`);
                const open = () => { setMarks({}); draftRef.current = null; setDraft(null); setTool('pan'); setGallery({ title, images, index }); setImageZoom(null); setImageWidth(0); setImageFailed(false); };
                photo.addEventListener('click', open);
                photo.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
              });
              wrapper.append(tools, findingTable); article.append(wrapper);
            }
          }
          }
          if (documentSection === 'measurements') {
            const nativeRows = tables.flatMap(table => Array.from(table.querySelectorAll(':scope > tr, :scope > tbody > tr')).slice(1));
            if (nativeRows.length !== keys.length || !tables.length) throw new Error(tr('The original Word layout could not be loaded. Use View issued Word.'));
            const rowMap = new Map(keys.map((key, index) => [key, nativeRows[index]]));
            article.replaceChildren();
            section.style.minHeight = '0';
            for (const group of groupsRef.current) {
              if (group.name) {
                const heading = document.createElement('h2'); heading.textContent = group.name;
                heading.className = 'replica-group'; article.append(heading);
              }
              // Retain the native table widths, header and coloured measurement cells.
              const table = tables[0].cloneNode(true) as HTMLTableElement;
              const copiedRows = Array.from(table.querySelectorAll(':scope > tr, :scope > tbody > tr'));
              copiedRows.slice(1).forEach(row => row.remove());
              const parent = copiedRows[0].parentElement!;
              group.keys.forEach(key => {
                const row = rowMap.get(key)!;
                if (openFindingRef.current) {
                  const cell = row.querySelectorAll('td')[1] || row.querySelector('td');
                  if (cell) {
                    const button = document.createElement('button');
                    button.type = 'button'; button.className = 'replica-finding-link';
                    button.setAttribute('aria-label', `${tr('View finding and photographs')}: ${cell.textContent?.trim()} · ${row.querySelector('td')?.textContent?.trim()}`);
                    button.append(...Array.from(cell.childNodes));
                    cell.append(button);
                    row.classList.add('replica-measurement-link');
                    row.addEventListener('click', () => openFindingRef.current?.(key));
                  }
                }
                parent.append(row);
              });
              article.append(table);
            }
          }
          const nativeWidth = Number.parseFloat(section.style.width) * (section.style.width.endsWith('pt') ? 96 / 72 : 1);
          setFit(Math.min(1, (host.current.clientWidth - 24) / (nativeWidth || 794)));
        }
        host.current.replaceChildren(...Array.from(rendered.childNodes));
      } catch (err) {
        if (!cancelled) setError(await reportError(err, tr('Could not load the original Word layout. Please try again.')));
      } finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [reportId, signature, documentSection]);

  useEffect(() => {
    host.current?.querySelectorAll<HTMLInputElement>('[data-selection-key]').forEach(input => {
      input.checked = selected.includes(input.dataset.selectionKey || '');
    });
  }, [selected]);
  useEffect(() => {
    const findings = Array.from(host.current?.querySelectorAll<HTMLElement>('[data-finding-key]') || []);
    findings.forEach(element => element.removeAttribute('data-current-finding'));
    if (!loading && jumpKey) {
      const finding = findings.find(element => element.dataset.findingKey === jumpKey);
      finding?.setAttribute('data-current-finding', 'true');
      finding?.focus({ preventScroll: true });
      finding?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, jumpKey, signature, documentSection]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const section = element.querySelector<HTMLElement>('section.issued-word');
      if (section) {
        const width = Number.parseFloat(section.style.width) * (section.style.width.endsWith('pt') ? 96 / 72 : 1);
        setFit(Math.max(.2, Math.min(1, (element.clientWidth - 24) / (width || 794))));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const currentImage = gallery?.images[gallery.index];
  useEffect(() => {
    const viewport = imageViewport.current;
    if (!viewport || !gallery) return;
    const wheel = (event: WheelEvent) => {
      const image = viewport.querySelector('img');
      if (!image?.naturalWidth) return;
      event.preventDefault();
      const bounds = image.getBoundingClientRect();
      const frame = viewport.getBoundingClientRect();
      const next = Math.max(.1, Math.min(8, bounds.width / image.naturalWidth * Math.exp(-event.deltaY * .002)));
      zoomAnchor.current = { x: event.clientX - frame.left, y: event.clientY - frame.top,
        fractionX: (event.clientX - bounds.left) / bounds.width, fractionY: (event.clientY - bounds.top) / bounds.height };
      setImageZoom(next);
    };
    // A non-passive listener keeps wheel zoom inside the viewer.
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [gallery]);
  useLayoutEffect(() => {
    const viewport = imageViewport.current;
    const image = viewport?.querySelector('img');
    const anchor = zoomAnchor.current;
    if (viewport && image && anchor) {
      const bounds = image.getBoundingClientRect();
      const frame = viewport.getBoundingClientRect();
      viewport.scrollLeft += bounds.left - frame.left + bounds.width * anchor.fractionX - anchor.x;
      viewport.scrollTop += bounds.top - frame.top + bounds.height * anchor.fractionY - anchor.y;
      zoomAnchor.current = null;
    }
  }, [imageZoom]);
  useEffect(() => {
    const viewport = imageViewport.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setViewportHeight(viewport.clientHeight));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [gallery]);
  useLayoutEffect(() => {
    zoomAnchor.current = null;
    drag.current = null;
    imageViewport.current?.scrollTo(0, 0);
  }, [currentImage?.src]);
  return <Box sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
    <Dialog open={Boolean(gallery)} onClose={closeGallery} maxWidth={false} fullWidth slotProps={{ paper: { sx: { width: maximized ? '100vw' : `${windowWidth}vw`, height: maximized ? '100dvh' : `${windowHeight}dvh`, maxWidth: '100vw', maxHeight: '100dvh', m: maximized ? 0 : 1, resize: maximized ? 'none' : 'both', overflow: 'hidden' } } }} onKeyDown={event => {
      if ((event.target as HTMLElement).closest('input, select, [role="combobox"], [role="listbox"]')) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); moveImage(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveImage(-1); }
    }}>
      <DialogTitle sx={{ fontSize: '1rem' }}>{gallery?.title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}> 
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <Button disabled={!gallery || gallery.index === 0} onClick={() => moveImage(-1)}>{tr('Previous image')}</Button>
          <Typography>{gallery ? `${gallery.index + 1} / ${gallery.images.length}` : ''} · {currentImage?.caption}</Typography>
          <Button disabled={!gallery || gallery.index === gallery.images.length - 1} onClick={() => moveImage(1)}>{tr('Next image')}</Button>
          <Button onClick={() => setImageZoom(null)}>{tr('Fit to window')}</Button>
          <Button onClick={() => setImageZoom(1)}>100%</Button>
          <Button aria-label={tr('Zoom out')} onClick={() => setImageZoom(Math.max(.25, (imageZoom ?? 1) - .25))}>−</Button>
          <Button aria-label={tr('Zoom in')} onClick={() => setImageZoom(Math.min(4, (imageZoom ?? 1) + .25))}>+</Button>
          <Button onClick={() => { setMaximized(false); setWindowWidth(old => Math.min(98, old + 5)); }}>{tr('Wider window')}</Button>
          <Button onClick={() => { setMaximized(false); setWindowHeight(old => Math.min(98, old + 5)); }}>{tr('Taller window')}</Button>
          <Button onClick={() => setMaximized(old => !old)}>{tr(maximized ? 'Restore window' : 'Maximise window')}</Button>
          <Button sx={{ ml: 'auto' }} onClick={closeGallery}>{tr('Close')}</Button>
        </Stack>
        {canAnnotate && <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
          {(['pan', 'pen', 'highlight', 'circle', 'line'] as const).map(mode => <Button key={mode} aria-pressed={tool === mode} startIcon={mode === 'pan' ? <span aria-hidden="true">&#8596;</span> : undefined} variant={tool === mode ? 'contained' : 'outlined'} onClick={() => { clearDrawing(); setTool(mode); }}>{tr(({ pan: 'Move image', pen: 'Freehand pen', highlight: 'Highlighter', circle: 'Circle', line: 'Line' })[mode])}</Button>)}
          <TextField type="color" label={tr('Drawing colour')} value={penColor} onChange={event => setPenColor(event.target.value)} size="small" sx={{ width: 90 }} />
          <TextField select label={tr('Pen thickness')} value={penSize} onChange={event => setPenSize(Number(event.target.value))} size="small" sx={{ minWidth: 110 }}>{[2, 4, 6, 10, 16, 24].map(size => <MenuItem key={size} value={size}>{size} px</MenuItem>)}</TextField>
          <Button disabled={!gallery || !marks[gallery.index]?.length} onClick={() => { clearDrawing(); if (gallery) setMarks(old => ({ ...old, [gallery.index]: (old[gallery.index] || []).slice(0, -1) })); }}>{tr('Undo drawing')}</Button>
          <Button startIcon={<span aria-hidden="true">&#128465;</span>} disabled={!draft && (!gallery || !marks[gallery.index]?.length)} onClick={() => { clearDrawing(); if (gallery) setMarks(old => ({ ...old, [gallery.index]: [] })); }}>{tr('Clear drawings')}</Button>
        </Stack>}
        {canAnnotate && <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{tr('Drawings are temporary and disappear when this window closes.')}</Typography>}
        {imageFailed && <Alert severity="error">{tr('Could not load this photograph.')}</Alert>}
        <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>{tr(tool === 'pan' ? 'Move mode: drag the image without drawing. Scroll the mouse wheel to zoom.' : 'Drawing mode: drag to draw. Choose Move image to pan without drawing.')}</Typography>
        <Box ref={imageViewport} onPointerDown={event => {
          if (tool !== 'pan' || event.button !== 0 || event.pointerType === 'touch') return;
          const viewport = event.currentTarget;
          event.preventDefault(); viewport.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
          setDragging(true);
        }} onPointerMove={event => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
          event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
        }} onPointerUp={event => {
          drag.current = null; setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => { drag.current = null; setDragging(false); }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }} sx={{ cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', overflow: 'auto', height: 'auto', flex: 1, minHeight: 100, bgcolor: '#101820', textAlign: 'center', borderRadius: 1 }}>
          {currentImage && <Box sx={{ display: 'inline-block', position: 'relative', verticalAlign: 'middle', lineHeight: 0, maxWidth: imageZoom === null ? '100%' : 'none' }}>
            <Box component="img" key={currentImage.src} src={currentImage.src} draggable={false} alt={currentImage.caption} onLoad={event => { setImageWidth(event.currentTarget.naturalWidth); setImageHeight(event.currentTarget.naturalHeight); }} onError={() => setImageFailed(true)} sx={{ display: 'block', objectFit: 'contain', maxWidth: imageZoom === null ? '100%' : 'none', maxHeight: imageZoom === null ? viewportHeight : 'none', width: imageZoom === null || !imageWidth ? 'auto' : imageWidth * imageZoom }} />
            {canAnnotate && <svg aria-label={tr('Temporary drawing layer')} viewBox={`0 0 ${imageWidth || 1} ${imageHeight}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', pointerEvents: tool === 'pan' ? 'none' : 'auto', cursor: 'crosshair' }} onPointerDown={event => {
              if (event.button !== 0 || tool === 'pan') return;
              event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
              const rect = event.currentTarget.getBoundingClientRect();
              const mark: Mark = { tool, color: penColor, width: penSize * imageWidth / rect.width, points: [[(event.clientX - rect.left) * imageWidth / rect.width, (event.clientY - rect.top) * imageHeight / rect.height]] };
              draftRef.current = mark; setDraft(mark);
            }} onPointerMove={event => {
              const mark = draftRef.current; if (!mark) return;
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const point: [number, number] = [(event.clientX - rect.left) * imageWidth / rect.width, (event.clientY - rect.top) * imageHeight / rect.height];
              const next = { ...mark, points: mark.tool === 'line' || mark.tool === 'circle' ? [mark.points[0], point] : [...mark.points, point] };
              draftRef.current = next; setDraft(next);
            }} onPointerUp={event => {
              event.stopPropagation(); const mark = draftRef.current;
              if (mark && gallery) setMarks(old => ({ ...old, [gallery.index]: [...(old[gallery.index] || []), mark] }));
              clearDrawing(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }} onPointerCancel={clearDrawing} onLostPointerCapture={clearDrawing}>
              {[...(gallery ? marks[gallery.index] || [] : []), ...(draft ? [draft] : [])].map((mark, index) => {
                const first = mark.points[0], last = mark.points[mark.points.length - 1];
                const props = { stroke: mark.color, strokeWidth: mark.width * (mark.tool === 'highlight' ? 3 : 1), strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none', opacity: mark.tool === 'highlight' ? .35 : 1 };
                return mark.tool === 'circle' ? <ellipse key={index} {...props} cx={(first[0] + last[0]) / 2} cy={(first[1] + last[1]) / 2} rx={Math.abs(last[0] - first[0]) / 2} ry={Math.abs(last[1] - first[1]) / 2} /> : <path key={index} {...props} d={mark.points.length === 1 ? `M ${first[0]} ${first[1]} l .01 0` : mark.points.map((point, i) => `${i ? 'L' : 'M'} ${point[0]} ${point[1]}`).join(' ')} />;
              })}
            </svg>}
          </Box>}
        </Box>
      </DialogContent>
    </Dialog>
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', p: 1.5, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', mr: 'auto', px: 1 }}>{tr('Document reader')}</Typography>
      <Button size="small" onClick={() => setZoom(null)}>{tr('Fit to width')}</Button>
      <Button size="small" aria-label={tr('Zoom out')} sx={{ minWidth: 36 }} onClick={() => setZoom(Math.max(.25, (zoom ?? fit) - .1))}>−</Button>
      <Typography variant="caption">{Math.round((zoom ?? fit) * 100)}%</Typography>
      <Button size="small" aria-label={tr('Zoom in')} sx={{ minWidth: 36 }} onClick={() => setZoom(Math.min(2, (zoom ?? fit) + .1))}>+</Button>
      <Button size="small" onClick={() => setZoom(1)}>100%</Button>
    </Stack>
    {loading && <LinearProgress aria-label={tr('Loading original Word layout')} />}
    {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}
    <Box ref={host} dir="ltr" sx={{ overflowX: 'auto', bgcolor: theme => theme.palette.mode === 'dark' ? '#101a22' : '#edf1f4', minHeight: loading ? 240 : undefined,
      '& .issued-word-wrapper': { background: 'transparent', padding: '12px', display: 'flex', justifyContent: 'center', minWidth: 'fit-content', zoom: zoom ?? fit },
      '& section.issued-word': { flexShrink: 0, boxShadow: '0 4px 24px rgba(0,0,0,.12)', color: '#000', background: '#fff' },
      '& .replica-group': { fontFamily: 'Arial, sans-serif', fontSize: '14pt', color: '#10485b', padding: '18px 0 12px', margin: 0, borderBottom: '2px solid #dce8ed', marginBottom: '16px' },
      '& .replica-finding': { marginBottom: '24pt', scrollMarginTop: '90px' },
      '& .replica-tools': { display: 'flex', gap: '6px', alignItems: 'center', padding: '10px 12px', borderRadius: '6px', background: '#eef4f6', marginBottom: '10px', font: '10pt Arial, sans-serif', color: '#536878' },
      '& .replica-tools input': { accentColor: '#10485b' },
      '& .replica-tower-button': { marginInlineStart: 'auto', border: '1px solid #94b6c3', borderRadius: '8px', padding: '7px 12px', color: '#10485b', background: '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 700, '&:hover': { background: '#dcecf1' }, '&:focus-visible': { outline: '2px solid #10485b', outlineOffset: 2 } },
      '& .replica-finding[data-current-finding]': { outline: '3px solid #27839b', outlineOffset: '8px', borderRadius: '4px' },
      '& .replica-measurement-link': { cursor: 'pointer', '&:hover': { outline: '2px solid #27839b', outlineOffset: '-2px' } },
      '& .replica-finding-link': { display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', color: '#10485b', textAlign: 'inherit', font: 'inherit', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '3px', '&:focus-visible': { outline: '2px solid #27839b', outlineOffset: '2px' } },
    }} />
  </Box>;
}
