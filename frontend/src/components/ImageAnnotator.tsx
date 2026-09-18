import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import NearMeIcon from '@mui/icons-material/NearMeRounded';
import BackspaceIcon from '@mui/icons-material/BackspaceRounded';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEyeRounded';
import CropSquareIcon from '@mui/icons-material/CropSquareRounded';
import GestureIcon from '@mui/icons-material/GestureRounded';
import ArrowRightAltIcon from '@mui/icons-material/ArrowRightAltRounded';
import TextFieldsIcon from '@mui/icons-material/TextFieldsRounded';
import UndoIcon from '@mui/icons-material/UndoRounded';
import ClearAllIcon from '@mui/icons-material/ClearAllRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import RestartAltIcon from '@mui/icons-material/RestartAltRounded';
import SaveIcon from '@mui/icons-material/SaveRounded';
import ZoomInIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutIcon from '@mui/icons-material/ZoomOutRounded';
import TuneIcon from '@mui/icons-material/TuneRounded';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHighRounded';
import { ResizableDialogPaper } from './ResizableDialogPaper';

const ENHANCE_MIN = 50;
const ENHANCE_MAX = 200;
const ENHANCE_DEFAULT = 100;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.5;

type Tool = 'select' | 'pen' | 'circle' | 'rect' | 'arrow' | 'text' | 'erase';
type Point = { x: number; y: number };

type Shape =
  | { id: string; type: 'pen'; color: string; lineWidth: number; points: Point[] }
  // rx/ry (not a single radius) so the 4-corner resize handles can stretch a circle into an
  // ellipse — a perfect circle is just the special case where rx === ry, which is all the
  // "Circle" tool itself ever produces; only a non-uniform resize afterward makes it an ellipse.
  | { id: string; type: 'circle'; color: string; lineWidth: number; cx: number; cy: number; rx: number; ry: number }
  | { id: string; type: 'rect'; color: string; lineWidth: number; x: number; y: number; w: number; h: number }
  // A pointer arrow — e.g. "look right here" aimed at a specific spot. `points` is [tail, head] for
  // a straight arrow, or [tail, bend, head] once it's been bent into a curve (see arrow-handle
  // dragging below) — enforced by convention, not the type, same reasoning as 'pen': a plain array
  // (not a fixed-length tuple) keeps TS's discriminated-union narrowing frictionless, and it lets
  // getBounds/translateShape's generic `.points`-based fallback branches cover arrow entirely for
  // free (a Bezier curve is always contained within its control points' convex hull, so a bounding
  // box from min/max over all of `points` is always a valid, if slightly loose, bound). Selection/
  // rotation/bending use 3 dedicated handles instead of resizeShape's 4 generic corners — see
  // arrowHandlePositions — since "stretch a bounding box" doesn't map onto "reposition an endpoint"
  // the way it does for a circle or rect.
  | { id: string; type: 'arrow'; color: string; lineWidth: number; points: Point[] }
  // A caption/label — e.g. "bad contact joint" next to a circled hotspot. x/y is the top-left of the
  // text (matches ctx.textBaseline = 'top', set where it's drawn). No lineWidth: font size instead
  // (see currentFontSize) — the same Thin/Medium/Thick/Extra-thick picker doubles as the font-size
  // control while the text tool (or a selected text shape) is active.
  | { id: string; type: 'text'; color: string; fontSize: number; x: number; y: number; text: string };

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type ArrowShape = Extract<Shape, { type: 'arrow' }>;
type ArrowHandle = 'tail' | 'bend' | 'head';

// Chosen for contrast against both dark thermal and light RGB photo backgrounds.
const COLORS = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ffffff', '#000000'];
// Multipliers on the image-relative base stroke width — lets the inspector pick a thicker mark for
// a wide shot or a finer one for a tight close-up, independent of the source photo's resolution.
const LINE_WIDTH_OPTIONS = [
  { label: 'Thin', multiplier: 0.5 },
  { label: 'Medium', multiplier: 1 },
  { label: 'Thick', multiplier: 2 },
  { label: 'Extra thick', multiplier: 3.5 },
];
const HANDLE_HIT = 22; // canvas-px hit radius around each resize handle — generous, for real mouse use
const HIT_PAD = 10; // canvas-px padding added around a shape's bounds for selection hit-testing

let shapeCounter = 0;
const newShapeId = () => `s${Date.now()}-${shapeCounter++}`;

function getBounds(s: Shape) {
  if (s.type === 'rect') return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h };
  if (s.type === 'circle') return { minX: s.cx - s.rx, minY: s.cy - s.ry, maxX: s.cx + s.rx, maxY: s.cy + s.ry };
  if (s.type === 'text') {
    // No canvas context handy here to measure precisely — a monospace-ish width estimate is close
    // enough for the selection outline/handles/hit-test, which don't need pixel accuracy.
    const w = Math.max(10, s.text.length * s.fontSize * 0.55);
    const h = s.fontSize * 1.3;
    return { minX: s.x, minY: s.y, maxX: s.x + w, maxY: s.y + h };
  }
  const xs = s.points.map((p) => p.x);
  const ys = s.points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** The position of each corner handle for a shape's (padded) bounding box. */
function handlePositions(b: { minX: number; minY: number; maxX: number; maxY: number }): Record<Corner, Point> {
  return {
    tl: { x: b.minX - HIT_PAD, y: b.minY - HIT_PAD },
    tr: { x: b.maxX + HIT_PAD, y: b.minY - HIT_PAD },
    bl: { x: b.minX - HIT_PAD, y: b.maxY + HIT_PAD },
    br: { x: b.maxX + HIT_PAD, y: b.maxY + HIT_PAD },
  };
}

/** The 3 draggable handles for an arrow: dragging `tail` or `head` repositions that endpoint —
 * which is what "rotate" actually is for a 2-point line, so there's no separate rotate handle —
 * and dragging `bend` curves the shaft through that point (a quadratic Bezier control point) instead
 * of the straight line it starts as. `bend` sits at the geometric midpoint until the arrow has
 * actually been bent (3 points), then it tracks the real control point. */
function arrowHandlePositions(s: ArrowShape): Record<ArrowHandle, Point> {
  const tail = s.points[0];
  const head = s.points[s.points.length - 1];
  const bend = s.points.length >= 3 ? s.points[1] : { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 };
  return { tail, bend, head };
}

function translateShape(s: Shape, dx: number, dy: number): Shape {
  if (s.type === 'rect') return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.type === 'circle') return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  if (s.type === 'text') return { ...s, x: s.x + dx, y: s.y + dy };
  return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/** Resizes `s` by dragging `corner` to `point` — the opposite corner stays anchored in place, so
 * each of the 4 handles independently controls width and/or height depending on which one (and
 * which direction) is dragged, exactly like resizing a shape in any normal drawing program. */
function resizeShape(s: Shape, corner: Corner, point: Point): Shape {
  // Text doesn't get corner-drag resize handles (see redraw()'s selection outline) — this guard is
  // just defense in depth in case resize ever gets triggered for one anyway.
  if (s.type === 'text') return s;
  const b = getBounds(s);
  const anchor: Point =
    corner === 'tl'
      ? { x: b.maxX, y: b.maxY }
      : corner === 'tr'
        ? { x: b.minX, y: b.maxY }
        : corner === 'bl'
          ? { x: b.maxX, y: b.minY }
          : { x: b.minX, y: b.minY };

  const newMinX = Math.min(anchor.x, point.x);
  const newMaxX = Math.max(anchor.x, point.x);
  const newMinY = Math.min(anchor.y, point.y);
  const newMaxY = Math.max(anchor.y, point.y);
  const newW = Math.max(4, newMaxX - newMinX);
  const newH = Math.max(4, newMaxY - newMinY);

  if (s.type === 'rect') {
    return { ...s, x: newMinX, y: newMinY, w: newW, h: newH };
  }
  if (s.type === 'circle') {
    return { ...s, cx: newMinX + newW / 2, cy: newMinY + newH / 2, rx: newW / 2, ry: newH / 2 };
  }
  const oldW = Math.max(b.maxX - b.minX, 1);
  const oldH = Math.max(b.maxY - b.minY, 1);
  const sx = newW / oldW;
  const sy = newH / oldH;
  return {
    ...s,
    points: s.points.map((p) => ({ x: newMinX + (p.x - b.minX) * sx, y: newMinY + (p.y - b.minY) * sy })),
  };
}

/** A dense point trace along `s`'s outline — the eraser works by removing whichever of these
 * points fall within its radius, so circle/rect need to be sampled into a walkable outline the
 * same way a freehand path already is. */
function shapeToOutline(s: Shape): Point[] {
  if (s.type === 'pen') return s.points;
  if (s.type === 'text') return []; // unused — eraseAt filters text out before this is ever called
  if (s.type === 'arrow') {
    // Sampled along the shaft (not just the 2 endpoints) so the eraser can rub out part of an arrow
    // the same way it can a circle/rect/pen line — same reasoning as those, and unlike text, an
    // erased-through arrow becoming plain line segments (its 2 points are all eraseAt has to work
    // with either way) is an acceptable, already-established outcome, not a special case to avoid.
    const [p1, p2] = s.points;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(8, Math.round(dist / 4));
    const pts: Point[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
    }
    return pts;
  }
  if (s.type === 'circle') {
    const n = Math.max(24, Math.round(((s.rx + s.ry) * Math.PI) / 4));
    const pts: Point[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: s.cx + s.rx * Math.cos(a), y: s.cy + s.ry * Math.sin(a) });
    }
    return pts;
  }
  const { x, y, w, h } = s;
  const perimeter = 2 * (w + h) || 1;
  const n = Math.max(16, Math.round(perimeter / 4));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    let t = (i / n) * perimeter;
    let px: number, py: number;
    if (t <= w) {
      px = x + t;
      py = y;
    } else if ((t -= w) <= h) {
      px = x + w;
      py = y + t;
    } else if ((t -= h) <= w) {
      px = x + w - t;
      py = y + h;
    } else {
      t -= w;
      px = x;
      py = y + h - t;
    }
    pts.push({ x: px, y: py });
  }
  return pts;
}

/** Erases within `radius` of `center` — not whole-shape deletion. Each shape's outline is walked
 * and any point inside the eraser radius is dropped; the surviving points are split into separate
 * runs wherever a gap was cut, and each run becomes its own freehand shape. A shape untouched by
 * this pass is returned as-is (so an unerased circle/rect stays a true circle/rect, not a
 * polyline approximation of one) — only shapes the eraser actually crosses get converted. */
function eraseAt(shapes: Shape[], center: Point, radius: number): Shape[] {
  const result: Shape[] = [];
  for (const s of shapes) {
    // Text has no meaningful "partial erase" (there's no line to rub out a piece of) — leave it
    // untouched here; removing a label is a job for Select + the delete button instead.
    if (s.type === 'text') {
      result.push(s);
      continue;
    }
    const outline = shapeToOutline(s);
    let touched = false;
    const runs: Point[][] = [];
    let current: Point[] = [];
    for (const p of outline) {
      if (Math.hypot(p.x - center.x, p.y - center.y) <= radius) {
        touched = true;
        if (current.length > 1) runs.push(current);
        current = [];
      } else {
        current.push(p);
      }
    }
    if (current.length > 1) runs.push(current);
    if (!touched) {
      result.push(s);
      continue;
    }
    for (const run of runs) {
      result.push({ id: newShapeId(), type: 'pen', color: s.color, lineWidth: s.lineWidth, points: run });
    }
    // else: every point fell within the eraser — the shape is fully erased, push nothing.
  }
  return result;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** URL to load as the drawing base — pass the existing annotated version if there is one, so
   * re-opening the tool continues on top of prior marks rather than losing them. */
  imageUrl: string;
  /** When set (i.e. an annotated version already exists and differs from imageUrl), shows a
   * "Start over from original" button that reloads this URL as a fresh, unmarked base. */
  originalUrl?: string;
  onSave: (blob: Blob) => Promise<void> | void;
  saving?: boolean;
}

export function ImageAnnotator({ open, onClose, title, imageUrl, originalUrl, onSave, saving }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [baseUrl, setBaseUrl] = useState(imageUrl);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tool, setTool] = useState<Tool>('circle');
  const [color, setColor] = useState(COLORS[0]);
  const [lineWidthMultiplier, setLineWidthMultiplier] = useState(1);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const drawState = useRef<{ start: Point; shape: Shape } | null>(null);
  const interaction = useRef<
    | { mode: 'move'; id: string; start: Point; orig: Shape }
    | { mode: 'resize'; id: string; corner: Corner; orig: Shape }
    // Dragging one of an arrow's 3 handles — see arrowHandlePositions for what each one does.
    | { mode: 'arrow-handle'; id: string; which: ArrowHandle; orig: ArrowShape }
    // Dragging to scroll the (zoomed-in, now-scrollable) view around — tracked in raw screen/scroll
    // pixels, not canvas coordinates, since it's moving the viewport rather than any Shape.
    | { mode: 'pan'; startClientX: number; startClientY: number; startScrollLeft: number; startScrollTop: number }
    | null
  >(null);
  const [, forceRedraw] = useState(0);
  // Magnification, applied to the canvas as a CSS transform (see the canvas's style below) rather
  // than by changing canvas.width/height — a transform is purely a paint-time visual effect, so all
  // existing pointer-coordinate math (toCanvasPoint et al., which always derives its scale factor
  // fresh from canvas.getBoundingClientRect()) keeps working unmodified: getBoundingClientRect()
  // already reports the post-transform size, so a click lands on the correct underlying image pixel
  // at any zoom level — and drawing precision actually improves when zoomed in, since one screen
  // pixel then covers a smaller slice of the image.
  const [zoom, setZoom] = useState(1);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const handleZoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  const handleZoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));

  // Brightness/contrast/saturation, as the same percentages the CSS/canvas filter functions take
  // (100 = unchanged) — applied in drawBase() via ctx.filter, so they're baked into the exported
  // image exactly like the drawn shapes are, and reset alongside them (open, Start over) below.
  const [showEnhance, setShowEnhance] = useState(false);
  const [brightness, setBrightness] = useState(ENHANCE_DEFAULT);
  const [contrast, setContrast] = useState(ENHANCE_DEFAULT);
  const [saturation, setSaturation] = useState(ENHANCE_DEFAULT);
  const enhanceIsDefault = brightness === ENHANCE_DEFAULT && contrast === ENHANCE_DEFAULT && saturation === ENHANCE_DEFAULT;
  const resetEnhance = () => {
    setBrightness(ENHANCE_DEFAULT);
    setContrast(ENHANCE_DEFAULT);
    setSaturation(ENHANCE_DEFAULT);
  };

  // Reset to the given base image whenever the dialog opens (or the caller hands us a new one).
  useEffect(() => {
    if (open) {
      setBaseUrl(imageUrl);
      setShapes([]);
      setSelectedId(null);
      setZoom(1);
      resetEnhance();
      setShowEnhance(false);
      if (scrollBoxRef.current) {
        scrollBoxRef.current.scrollLeft = 0;
        scrollBoxRef.current.scrollTop = 0;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageUrl]);

  // Keeps whatever's currently centered in view centered after a zoom change, instead of leaving
  // scroll position at whatever it was (which — since the transform scales outward from the middle —
  // would otherwise make zooming in jump to showing an arbitrary corner rather than staying put).
  const prevZoom = useRef(zoom);
  useEffect(() => {
    const box = scrollBoxRef.current;
    if (box && prevZoom.current !== zoom) {
      const ratio = zoom / prevZoom.current;
      const centerX = box.scrollLeft + box.clientWidth / 2;
      const centerY = box.scrollTop + box.clientHeight / 2;
      box.scrollLeft = centerX * ratio - box.clientWidth / 2;
      box.scrollTop = centerY * ratio - box.clientHeight / 2;
    }
    prevZoom.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!open) return;
    setLoadError(false);
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => setImg(el);
    el.onerror = () => setLoadError(true);
    el.src = baseUrl;
    return () => {
      el.onload = null;
      el.onerror = null;
    };
  }, [open, baseUrl]);

  const baseStrokeWidth = img ? Math.max(3, img.naturalWidth / 260) : 4;
  const currentLineWidth = baseStrokeWidth * lineWidthMultiplier;
  // Same multiplier the line-width picker sets — turning a "line width" into a "font size" this way
  // means one size control does double duty instead of needing a second row of buttons just for text.
  const currentFontSize = baseStrokeWidth * lineWidthMultiplier * 6;
  // Meaningfully bigger than the line itself — an eraser exactly as thin as the ink would be
  // unusably fiddly to land on a line with.
  const eraserRadius = baseStrokeWidth * lineWidthMultiplier * 4;
  const eraseCursor = useRef<Point | null>(null);
  const erasing = useRef(false);

  // Size the canvas once per image (assigning canvas.width/height clears its content, so doing
  // this inside redraw() — which also runs on every pointermove while drawing — would wipe and
  // resize on every single mouse-move frame during a freehand stroke).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
  }, [img]);

  // Renders one committed (or in-progress) shape, text included — despite the name this now covers
  // both the stroked shapes and text labels, kept as one function since every call site (drawBase,
  // the in-progress preview) needs to handle whichever kind a Shape happens to be.
  const strokeShape = (ctx: CanvasRenderingContext2D, s: Shape) => {
    if (s.type === 'text') {
      ctx.font = `600 ${s.fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      // A contrasting outline behind the fill keeps a label legible over both the near-black
      // background of a thermal shot and a bright RGB one, regardless of which ink color it uses.
      ctx.lineWidth = Math.max(2, s.fontSize / 7);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = s.color === '#000000' ? '#ffffff' : '#000000';
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.x, s.y);
      return;
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.type === 'pen') {
      ctx.beginPath();
      s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    } else if (s.type === 'circle') {
      ctx.beginPath();
      ctx.ellipse(s.cx, s.cy, Math.max(s.rx, 0.01), Math.max(s.ry, 0.01), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'arrow') {
      const tail = s.points[0];
      const head = s.points[s.points.length - 1];
      const bendPoint = s.points.length >= 3 ? s.points[1] : null;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      if (bendPoint) ctx.quadraticCurveTo(bendPoint.x, bendPoint.y, head.x, head.y);
      else ctx.lineTo(head.x, head.y);
      ctx.stroke();
      // A small filled triangle at the head end, oriented along the shaft's own direction at that
      // point — for a straight arrow that's tail->head; for a bent one, a quadratic Bezier's tangent
      // at its end is the direction from the control point to the end point, so it's bendPoint->head
      // instead, which keeps the head pointing the way the curve is actually arriving there.
      const angleFrom = bendPoint ?? tail;
      const angle = Math.atan2(head.y - angleFrom.y, head.x - angleFrom.x);
      const headLen = Math.max(10, s.lineWidth * 4);
      const headSpread = Math.PI / 7; // ~26° off the shaft on each side — a moderately narrow point
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      ctx.lineTo(head.x - headLen * Math.cos(angle - headSpread), head.y - headLen * Math.sin(angle - headSpread));
      ctx.lineTo(head.x - headLen * Math.cos(angle + headSpread), head.y - headLen * Math.sin(angle + headSpread));
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
    } else {
      ctx.strokeRect(s.x, s.y, s.w, s.h);
    }
  };

  // Image + committed shapes only — no selection outline/handle, no in-progress preview. Used both
  // by redraw() (which layers those on top) and directly by handleSave (which must NOT bake the
  // selection UI into the exported file).
  const drawBase = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The brightness/contrast/saturation adjustment applies only to the photo itself — reset to
    // 'none' before the marks are stroked so a heavy contrast boost, say, doesn't also wash out or
    // exaggerate the ink colors an inspector picked.
    ctx.filter = enhanceIsDefault ? 'none' : `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    ctx.drawImage(img!, 0, 0);
    ctx.filter = 'none';
    for (const s of shapes) strokeShape(ctx, s);
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawBase(ctx, canvas);
    if (drawState.current) strokeShape(ctx, drawState.current.shape);

    const selected = shapes.find((s) => s.id === selectedId);
    if (selected && tool === 'select') {
      const b = getBounds(selected);
      ctx.save();
      ctx.strokeStyle = '#0a84ff';
      ctx.lineWidth = Math.max(1.5, baseStrokeWidth / 2.5);
      ctx.setLineDash([baseStrokeWidth, baseStrokeWidth]);
      ctx.strokeRect(b.minX - HIT_PAD, b.minY - HIT_PAD, b.maxX - b.minX + HIT_PAD * 2, b.maxY - b.minY + HIT_PAD * 2);
      ctx.setLineDash([]);
      if (selected.type === 'arrow') {
        // 3 round handles instead of the 4 square corners below: 'tail'/'head' reposition that
        // endpoint (rotation, for a 2-point line, IS just moving one end around the other — no
        // separate rotate handle needed), 'bend' curves the shaft through wherever it's dragged.
        // Round vs. square is a deliberate visual cue that these behave differently from a resize.
        const r = Math.max(9, baseStrokeWidth * 2.2);
        ctx.fillStyle = '#0a84ff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, baseStrokeWidth / 3);
        for (const hp of Object.values(arrowHandlePositions(selected))) {
          ctx.beginPath();
          ctx.arc(hp.x, hp.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (selected.type !== 'text') {
        // One handle per corner — each independently controls width and/or height, so e.g. dragging
        // the top-right handle straight up only grows the height, straight right only the width.
        // Text skips these: its size comes from the font-size picker, not a corner drag (see
        // resizeShape's text guard) — showing handles that don't do anything would just be confusing.
        const handleSize = Math.max(16, baseStrokeWidth * 3.5);
        ctx.fillStyle = '#0a84ff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, baseStrokeWidth / 3);
        for (const hp of Object.values(handlePositions(b))) {
          ctx.fillRect(hp.x - handleSize / 2, hp.y - handleSize / 2, handleSize, handleSize);
          ctx.strokeRect(hp.x - handleSize / 2, hp.y - handleSize / 2, handleSize, handleSize);
        }
      }
      ctx.restore();
    }

    if (tool === 'erase' && eraseCursor.current) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, baseStrokeWidth / 3);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(eraseCursor.current.x, eraseCursor.current.y, eraserRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  // No deps: also needs to re-run for the in-progress preview shape, which lives in a ref
  // (drawState) bumped via forceRedraw rather than being React state itself.
  useEffect(redraw);

  const toCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  // Guards against a real but harmless edge case: setPointerCapture can throw (NotFoundError) if
  // the pointer session already ended by the time this runs — e.g. a very fast tap, or certain
  // synthetic/automated input. Capture is a nice-to-have (keeps drag events flowing if the cursor
  // leaves the canvas mid-drag) — losing it isn't fatal, so failure shouldn't abort the handler.
  const safeSetPointerCapture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const hitTest = (s: Shape, p: Point) => {
    const b = getBounds(s);
    return p.x >= b.minX - HIT_PAD && p.x <= b.maxX + HIT_PAD && p.y >= b.minY - HIT_PAD && p.y <= b.maxY + HIT_PAD;
  };

  // Starts a pan drag — recorded in raw client/scroll pixels (not canvas coordinates, which don't
  // mean anything for "which part of the viewport is showing"). Used both for an empty-area drag on
  // the Select tool below, and for a middle-mouse-button drag on any tool (see handlePointerDown).
  const startPan = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = scrollBoxRef.current;
    if (!box) return;
    interaction.current = {
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: box.scrollLeft,
      startScrollTop: box.scrollTop,
    };
    safeSetPointerCapture(e);
  };

  const handleSelectPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toCanvasPoint(e);
    const selected = shapes.find((s) => s.id === selectedId);
    if (selected && selected.type === 'arrow') {
      const handles = arrowHandlePositions(selected);
      const grabbed = (Object.entries(handles) as [ArrowHandle, Point][]).find(
        ([, hp]) => Math.hypot(p.x - hp.x, p.y - hp.y) <= HANDLE_HIT,
      );
      if (grabbed) {
        interaction.current = { mode: 'arrow-handle', id: selected.id, which: grabbed[0], orig: selected };
        safeSetPointerCapture(e);
        return;
      }
    } else if (selected && selected.type !== 'text') {
      const handles = handlePositions(getBounds(selected));
      const grabbed = (Object.entries(handles) as [Corner, Point][]).find(
        ([, hp]) => Math.hypot(p.x - hp.x, p.y - hp.y) <= HANDLE_HIT,
      );
      if (grabbed) {
        interaction.current = { mode: 'resize', id: selected.id, corner: grabbed[0], orig: selected };
        safeSetPointerCapture(e);
        return;
      }
    }
    const hit = [...shapes].reverse().find((s) => hitTest(s, p));
    if (hit) {
      setSelectedId(hit.id);
      interaction.current = { mode: 'move', id: hit.id, start: p, orig: hit };
      safeSetPointerCapture(e);
    } else {
      // Nothing there to select — once zoomed in, dragging empty space instead pans the view around,
      // the same way most image editors let you drag on blank canvas to scroll. A drag that never
      // actually moves is indistinguishable from (and behaves the same as) a plain click that just
      // deselects, so there's no need to tell the two apart up front.
      setSelectedId(null);
      startPan(e);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1) {
      // Middle-mouse-button drag pans regardless of which tool is active — lets you reposition the
      // view mid-annotation (e.g. partway through drawing a shape that needs more room) without
      // switching to Select and back.
      e.preventDefault();
      startPan(e);
      return;
    }
    if (tool === 'select') {
      handleSelectPointerDown(e);
      return;
    }
    if (tool === 'erase') {
      const p = toCanvasPoint(e);
      eraseCursor.current = p;
      erasing.current = true;
      setShapes((prev) => eraseAt(prev, p, eraserRadius));
      safeSetPointerCapture(e);
      return;
    }
    if (tool === 'text') {
      const p = toCanvasPoint(e);
      addTextAt(p);
      return;
    }
    const p = toCanvasPoint(e);
    let shape: Shape;
    if (tool === 'pen') shape = { id: newShapeId(), type: 'pen', color, lineWidth: currentLineWidth, points: [p] };
    else if (tool === 'circle')
      shape = { id: newShapeId(), type: 'circle', color, lineWidth: currentLineWidth, cx: p.x, cy: p.y, rx: 0, ry: 0 };
    else if (tool === 'arrow')
      // Tail fixed at the press point, head starts there too and tracks the cursor as the drag
      // continues (see handlePointerMove) — so the arrow points FROM where you started the drag TO
      // wherever you release it, matching how you'd naturally drag "from the label, at the thing".
      shape = { id: newShapeId(), type: 'arrow', color, lineWidth: currentLineWidth, points: [p, p] };
    else shape = { id: newShapeId(), type: 'rect', color, lineWidth: currentLineWidth, x: p.x, y: p.y, w: 0, h: 0 };
    drawState.current = { start: p, shape };
    safeSetPointerCapture(e);
    forceRedraw((n) => n + 1);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // An active pan/move/resize interaction always wins over whatever the currently-selected tool
    // would otherwise do with this pointermove — in particular, a middle-mouse-button pan (see
    // handlePointerDown) can start while any tool is active, not just Select, and needs to keep
    // panning for its whole drag regardless. Checked first, before the tool-specific branches below.
    if (interaction.current) {
      const current = interaction.current;
      if (current.mode === 'pan') {
        const box = scrollBoxRef.current;
        if (box) {
          box.scrollLeft = current.startScrollLeft - (e.clientX - current.startClientX);
          box.scrollTop = current.startScrollTop - (e.clientY - current.startClientY);
        }
        return;
      }
      const p = toCanvasPoint(e);
      let updated: Shape;
      if (current.mode === 'move') {
        updated = translateShape(current.orig, p.x - current.start.x, p.y - current.start.y);
      } else if (current.mode === 'resize') {
        updated = resizeShape(current.orig, current.corner, p);
      } else {
        // arrow-handle: 'tail'/'head' reposition that one endpoint (which — for a 2-point line — is
        // exactly what "rotate" is, so there's no separate rotate handle); 'bend' curves the shaft
        // through `p`, inserting a middle control point the first time (2 points -> 3) or just moving
        // the existing one (already 3 points). Either way the *other* endpoint stays exactly where it
        // was — only the dragged handle's own point changes.
        const orig = current.orig;
        const tail = orig.points[0];
        const head = orig.points[orig.points.length - 1];
        const points =
          current.which === 'tail'
            ? orig.points.length === 3
              ? [p, orig.points[1], head]
              : [p, head]
            : current.which === 'head'
              ? orig.points.length === 3
                ? [tail, orig.points[1], p]
                : [tail, p]
              : [tail, p, head]; // 'bend'
        updated = { ...orig, points };
      }
      setShapes((prev) => prev.map((s) => (s.id === current.id ? updated : s)));
      return;
    }
    if (tool === 'erase') {
      const p = toCanvasPoint(e);
      eraseCursor.current = p;
      if (erasing.current) setShapes((prev) => eraseAt(prev, p, eraserRadius));
      else forceRedraw((n) => n + 1); // keep the radius preview following the cursor on hover
      return;
    }
    if (!drawState.current) return;
    const p = toCanvasPoint(e);
    const { start, shape } = drawState.current;
    // drawState is only ever populated for pen/circle/rect/arrow (text bypasses this whole
    // drag-to-draw flow — see handlePointerDown's text branch, which opens the floating input
    // directly instead), so the rect case is spelled out explicitly rather than as a catch-all
    // `else`, purely so the type checker can see text is excluded here too.
    if (shape.type === 'pen') shape.points.push(p);
    else if (shape.type === 'circle') {
      const r = Math.hypot(p.x - start.x, p.y - start.y);
      shape.rx = r;
      shape.ry = r;
    } else if (shape.type === 'arrow') {
      shape.points[1] = p; // tail (points[0]) stays put — only the head end follows the cursor
    } else if (shape.type === 'rect') {
      shape.x = Math.min(p.x, start.x);
      shape.y = Math.min(p.y, start.y);
      shape.w = Math.abs(p.x - start.x);
      shape.h = Math.abs(p.y - start.y);
    }
    forceRedraw((n) => n + 1);
  };

  const handlePointerUp = () => {
    if (erasing.current) {
      erasing.current = false;
      return;
    }
    if (interaction.current) {
      interaction.current = null;
      return;
    }
    const pending = drawState.current;
    drawState.current = null;
    if (!pending) return;
    const s = pending.shape;
    const bigEnough =
      (s.type === 'pen' && s.points.length > 1) ||
      (s.type === 'circle' && s.rx > 2) ||
      (s.type === 'rect' && s.w > 2 && s.h > 2) ||
      (s.type === 'arrow' && Math.hypot(s.points[1].x - s.points[0].x, s.points[1].y - s.points[0].y) > 4);
    if (bigEnough) setShapes((prev) => [...prev, s]);
    else forceRedraw((n) => n + 1);
  };

  // Belt-and-suspenders alongside setPointerCapture: if the button is released somewhere capture
  // didn't actually take (e.g. a browser/input quirk), this still ends the drag instead of leaving
  // it stuck "on" until the next unrelated click. A no-op when nothing is being dragged.
  useEffect(() => {
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUndo = () => {
    setShapes((prev) => prev.slice(0, -1));
    setSelectedId(null);
  };
  const handleClear = () => {
    setShapes([]);
    setSelectedId(null);
  };
  const handleDeleteSelected = () => {
    setShapes((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  };
  const handleStartOver = () => {
    if (originalUrl) setBaseUrl(originalUrl);
    setShapes([]);
    setSelectedId(null);
    resetEnhance();
  };

  // Auto levels: stretches the darkest/lightest 1% of pixels (by luminance) out to pure black/
  // white, the same "auto contrast" idea most photo editors offer — computed from the ORIGINAL,
  // unfiltered image (never the already-adjusted canvas), so hitting it twice in a row is a no-op
  // rather than compounding. Expressed as brightness/contrast slider values (not applied directly
  // to pixels) so it lands in the exact same adjustable, undoable control the sliders already are.
  // Saturation is left alone — thermal palettes are already a deliberate false-color mapping, and
  // boosting it blindly would distort how the temperature scale reads, not just how vivid it looks.
  const handleAutoEnhance = () => {
    if (!img) return;
    const off = document.createElement('canvas');
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) return;
    octx.drawImage(img, 0, 0);
    const { data } = octx.getImageData(0, 0, off.width, off.height);

    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      hist[lum]++;
    }
    const totalPixels = off.width * off.height;
    const clipCount = totalPixels * 0.01; // ignore the darkest/lightest 1% as outliers

    let lo = 0;
    let acc = 0;
    while (lo < 255 && acc < clipCount) acc += hist[lo++];
    let hi = 255;
    acc = 0;
    while (hi > 0 && acc < clipCount) acc += hist[hi--];

    if (hi <= lo) {
      resetEnhance();
      return;
    }

    // Solve for the brightness(B)/contrast(C) pair whose composition — CSS applies brightness
    // first, then contrast — reproduces the linear stretch f(v) = (v - lo) * k, k = 255/(hi-lo).
    const k = 255 / (hi - lo);
    const midpoint = 127.5;
    const newContrast = 1 + (lo * k) / midpoint;
    const newBrightness = k / newContrast;

    setBrightness(Math.round(clamp(newBrightness * 100, ENHANCE_MIN, ENHANCE_MAX)));
    setContrast(Math.round(clamp(newContrast * 100, ENHANCE_MIN, ENHANCE_MAX)));
    setShowEnhance(true);
  };

  const handleToolChange = (v: Tool | null) => {
    if (!v) return;
    setTool(v);
    if (v !== 'select') setSelectedId(null);
    if (v !== 'erase') eraseCursor.current = null;
  };

  // Text entry uses the browser's own native `prompt()` rather than a floating field of our own —
  // deliberately, after a floating-<TextField>-inside-a-Dialog version kept losing keystrokes for
  // some users (a Dialog's focus trap, autoFocus timing, and a per-keystroke re-render all had ways
  // to interact badly, and the exact combination was never reliably reproducible here). `prompt()`
  // is a native, OS-level modal: it owns keyboard input completely for as long as it's open, so
  // there is no focus-trap or re-render to fight with, no re-render to worry about since it's not
  // React-driven, and no ambiguity about which element has focus. The tradeoff is a plainer look
  // (no positioned mini text box right at the click point) for guaranteed-reliable typing.
  const addTextAt = (p: Point) => {
    const text = window.prompt('Label text:')?.trim();
    if (!text) return; // cancelled, or submitted empty — nothing to add
    const shape: Shape = { id: newShapeId(), type: 'text', color, fontSize: currentFontSize, x: p.x, y: p.y, text };
    setShapes((prev) => [...prev, shape]);
    setSelectedId(shape.id);
  };

  // Double-click, while on the Select tool, re-prompts for an existing label's wording — pre-filled
  // with its current text so retyping the whole thing isn't necessary. Submitting empty clears the
  // label (deletes it); Cancel leaves it untouched.
  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const p: Point = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    const hit = [...shapes].reverse().find((s) => s.type === 'text' && hitTest(s, p));
    if (!hit || hit.type !== 'text') return;
    setSelectedId(hit.id);
    const result = window.prompt('Label text:', hit.text);
    if (result === null) return; // Cancel — leave the label as-is
    const text = result.trim();
    if (text) {
      setShapes((prev) => prev.map((s) => (s.id === hit.id ? { ...s, text } : s)));
    } else {
      setShapes((prev) => prev.filter((s) => s.id !== hit.id));
      setSelectedId(null);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !img) return;
    // Draw directly and synchronously rather than going through requestAnimationFrame + a React
    // state update — rAF callbacks don't reliably fire while a tab/pane is backgrounded or
    // unfocused, which silently dropped every save. drawBase() never includes the selection
    // outline/handle in the first place, so there's nothing to strip before capturing.
    drawBase(ctx, canvas);
    canvas.toBlob(
      (blob) => {
        if (blob) onSave(blob);
      },
      'image/jpeg',
      0.9,
    );
    setSelectedId(null); // deselect after saving; the next redraw() restores the normal (unselected) view
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperComponent={ResizableDialogPaper}>
      <DialogTitle>{title} — mark up</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
            <ToggleButtonGroup size="small" value={tool} exclusive onChange={(_e, v) => handleToolChange(v)}>
              <ToggleButton value="select" aria-label="Select / move / resize">
                <Tooltip title="Select — drag to move, drag any of its 4 corner handles to resize width and height independently">
                  <NearMeIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="circle" aria-label="Circle">
                <Tooltip title="Circle — point at a spot">
                  <PanoramaFishEyeIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="rect" aria-label="Rectangle">
                <Tooltip title="Rectangle — box an area">
                  <CropSquareIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="pen" aria-label="Freehand">
                <Tooltip title="Freehand line">
                  <GestureIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="arrow" aria-label="Arrow">
                <Tooltip title="Arrow — drag from the start toward whatever you want to point at. Select it afterward for 3 round handles: drag the tail or head to move/rotate that end, drag the middle one to bend the shaft into a curve">
                  <ArrowRightAltIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="text" aria-label="Text label">
                <Tooltip title="Text — click to type a label explaining a mark (e.g. 'bad contact joint'); double-click an existing label with the Select tool to edit or clear it">
                  <TextFieldsIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="erase" aria-label="Eraser">
                <Tooltip title="Eraser — rubs out just the part you drag over">
                  <BackspaceIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>

            <Stack direction="row" spacing={0.75}>
              {COLORS.map((c) => (
                <Box
                  key={c}
                  role="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    bgcolor: c,
                    cursor: 'pointer',
                    border: (t) => (color === c ? `2px solid ${t.palette.primary.main}` : '2px solid rgba(0,0,0,0.15)'),
                    boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px rgba(0,0,0,0.1)' : undefined,
                  }}
                />
              ))}
            </Stack>

            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              {LINE_WIDTH_OPTIONS.map((opt, i) => (
                <Tooltip
                  key={opt.label}
                  title={`${opt.label} ${tool === 'erase' ? 'eraser' : tool === 'text' || shapes.find((s) => s.id === selectedId)?.type === 'text' ? 'font size' : 'line'}`}
                >
                  <Box
                    role="button"
                    aria-label={opt.label}
                    onClick={() => {
                      setLineWidthMultiplier(opt.multiplier);
                      if (selectedId) {
                        setShapes((prev) =>
                          prev.map((s) => {
                            if (s.id !== selectedId) return s;
                            if (s.type === 'text') return { ...s, fontSize: baseStrokeWidth * opt.multiplier * 6 };
                            return { ...s, lineWidth: baseStrokeWidth * opt.multiplier };
                          }),
                        );
                      }
                    }}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      bgcolor: lineWidthMultiplier === opt.multiplier ? 'action.selected' : 'transparent',
                      border: '1px solid rgba(0,0,0,0.15)',
                    }}
                  >
                    <Box
                      sx={{
                        width: 4 + i * 3.5,
                        height: 4 + i * 3.5,
                        borderRadius: '50%',
                        bgcolor: 'text.primary',
                      }}
                    />
                  </Box>
                </Tooltip>
              ))}
            </Stack>

            <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
              <Tooltip title="Zoom out">
                <span>
                  <IconButton size="small" onClick={handleZoomOut} disabled={zoom <= ZOOM_MIN}>
                    <ZoomOutIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34, textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </Typography>
              <Tooltip title="Zoom in — magnify to see and mark small details precisely">
                <span>
                  <IconButton size="small" onClick={handleZoomIn} disabled={zoom >= ZOOM_MAX}>
                    <ZoomInIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>

            <Tooltip title="Brightness / contrast / saturation">
              <ToggleButton
                size="small"
                value="enhance"
                selected={showEnhance}
                onChange={() => setShowEnhance((v) => !v)}
                color={enhanceIsDefault ? 'standard' : 'primary'}
              >
                <TuneIcon fontSize="small" />
              </ToggleButton>
            </Tooltip>

            <Box sx={{ flexGrow: 1 }} />

            {selectedId && (
              <Tooltip title="Delete selected shape">
                <IconButton size="small" onClick={handleDeleteSelected} color="error">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Undo last shape">
              <span>
                <IconButton size="small" onClick={handleUndo} disabled={shapes.length === 0}>
                  <UndoIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Clear all marks">
              <span>
                <IconButton size="small" onClick={handleClear} disabled={shapes.length === 0}>
                  <ClearAllIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {originalUrl && baseUrl !== originalUrl && (
              <Tooltip title="Discard marks and start over from the original photo">
                <Button size="small" startIcon={<RestartAltIcon fontSize="small" />} onClick={handleStartOver}>
                  Start over
                </Button>
              </Tooltip>
            )}
          </Stack>

          {showEnhance && (
            <Stack
              direction="row"
              spacing={2.5}
              sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'action.hover' }}
            >
              <EnhanceSlider label="Brightness" value={brightness} onChange={setBrightness} />
              <EnhanceSlider label="Contrast" value={contrast} onChange={setContrast} />
              <EnhanceSlider label="Saturation" value={saturation} onChange={setSaturation} />
              <Tooltip title="Auto-stretch brightness/contrast from this photo's own histogram">
                <Button size="small" startIcon={<AutoFixHighIcon fontSize="small" />} onClick={handleAutoEnhance}>
                  Auto
                </Button>
              </Tooltip>
              <Tooltip title="Back to the unadjusted photo (drawn marks are unaffected)">
                <span>
                  <Button size="small" startIcon={<RestartAltIcon fontSize="small" />} onClick={resetEnhance} disabled={enhanceIsDefault}>
                    Reset
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          )}

          {loadError && <Alert severity="error">Couldn't load the image to annotate.</Alert>}

          <Box
            ref={scrollBoxRef}
            sx={{
              borderRadius: 2,
              // 'auto' (not 'hidden') so a zoomed-in canvas becomes scrollable/pannable instead of
              // just clipped — Chrome's scrollable-overflow calculation already accounts for a
              // transform:scale() child's rendered size, so this alone is enough, no manual width/
              // height math needed.
              overflow: 'auto',
              border: '1px solid rgba(0,0,0,0.12)',
              bgcolor: 'grey.900',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 240,
              // A fixed (not just minimum) height once zoomed — needed for 'auto' overflow to actually
              // scroll rather than the box just growing to fit the enlarged content. Left as min-height
              // at 1x so a small photo keeps its current snug, non-scrolling appearance.
              height: zoom > 1 ? '60vh' : undefined,
            }}
            onPointerDown={(e) => {
              // Fires only when the click lands on this Box's own background, not on the canvas
              // itself — i.e. the dark letterbox padding around a photo whose aspect ratio doesn't
              // exactly fill the available space. Without this, clicking there with the text tool
              // (easy to do on a photo that's mostly dark, like a thermal shot, where the boundary
              // between "photo" and "padding" isn't obvious) would silently do nothing at all, which
              // reads as "the text tool doesn't work" rather than "click a bit more to the left".
              if (tool !== 'text' || e.target !== e.currentTarget) return;
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const scaleX = canvas.width / rect.width;
              const scaleY = canvas.height / rect.height;
              const clampedClientX = Math.min(Math.max(e.clientX, rect.left), rect.right);
              const clampedClientY = Math.min(Math.max(e.clientY, rect.top), rect.bottom);
              const p: Point = { x: (clampedClientX - rect.left) * scaleX, y: (clampedClientY - rect.top) * scaleY };
              addTextAt(p);
            }}
          >
            {img ? (
              <canvas
                ref={canvasRef}
                // `object-fit` has no effect on <canvas> (only replaced elements like <img>/<video>
                // support it), so a fixed width + max-height here would stretch the canvas out of
                // its true aspect ratio — throwing off every click's mapping to canvas coordinates,
                // which is exactly why drawing looked offset from the cursor. `width/height: auto`
                // with only max-* constraints lets the browser scale it uniformly instead, the same
                // way an <img> behaves by default.
                style={{
                  display: 'block',
                  width: 'auto',
                  height: 'auto',
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  // Scales up from the same "fits the dialog" base size computed above — see the
                  // zoom state's comment for why this, rather than resizing the canvas itself, is
                  // both simplest and keeps every pointer-coordinate calculation correct for free.
                  transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                  flexShrink: 0,
                  touchAction: 'none',
                  cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={handleCanvasDoubleClick}
                // No onPointerLeave here on purpose: growing a circle/box outward, or a resize
                // handle near the image edge, routinely pushes the cursor outside the canvas's own
                // bounds mid-drag. setPointerCapture (see safeSetPointerCapture) keeps pointermove
                // and pointerup targeting this canvas regardless of where the cursor physically is
                // — but pointerleave still fires the moment the cursor crosses the edge even while
                // captured, so wiring it to handlePointerUp was ending the drag right as the user
                // dragged outward, which is exactly the direction resizing bigger requires.
              />
            ) : (
              !loadError && <Typography sx={{ color: 'grey.400', p: 4 }}>Loading image…</Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={!img || saving}>
          {saving ? 'Saving…' : 'Save annotation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EnhanceSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 190 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 68, flexShrink: 0 }}>
        {label}
      </Typography>
      <Slider
        size="small"
        min={ENHANCE_MIN}
        max={ENHANCE_MAX}
        value={value}
        onChange={(_e, v) => onChange(v as number)}
        sx={{ width: 100 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ width: 36, flexShrink: 0, textAlign: 'right' }}>
        {value}%
      </Typography>
    </Stack>
  );
}
