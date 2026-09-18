/** Pixel-level thermal-photo enhancement — everything here operates on a raw ImageData buffer,
 * separate from ImageAnnotator's cheap brightness/contrast/saturation (those stay as a live
 * ctx.filter overlay; see ImageAnnotator.tsx). These are heavier per-pixel algorithms (blur-based
 * local contrast/noise reduction/sharpening, per-hue saturation, hue-range dimming), so the caller
 * only reruns them when a control is released/committed, not on every drag tick — see
 * ImageAnnotator's recomputeHeavy.
 *
 * Deliberately NOT real "AI" and NOT real temperature analysis: this app's photos are the camera's
 * own rendered color-palette JPEG, with no per-pixel radiometric data behind them, so "highlight
 * temperatures" is implemented honestly as "highlight hue range" — it isolates by the photo's own
 * colors, which is a reasonable stand-in for "hot vs. cool" on a typical ironbow/rainbow palette,
 * but is not a real °C measurement. */

export interface HueBandSaturation {
  red: number;
  yellow: number;
  green: number;
  cyan: number;
  blue: number;
  purple: number;
}

export interface HeavyEnhanceParams {
  localContrast: number; // 0-100, 0 = off
  noiseReduction: number; // 0-100, 0 = off
  sharpening: number; // 0-100, 0 = off
  hueSat: HueBandSaturation; // each 0-200, 100 = unchanged
  highlightRange: boolean;
  hueRange: [number, number]; // degrees, 0-360, inclusive band to KEEP at full brightness
}

export const DEFAULT_HUE_SAT: HueBandSaturation = { red: 100, yellow: 100, green: 100, cyan: 100, blue: 100, purple: 100 };

export function isHeavyDefault(p: HeavyEnhanceParams): boolean {
  return (
    p.localContrast === 0 &&
    p.noiseReduction === 0 &&
    p.sharpening === 0 &&
    !p.highlightRange &&
    Object.values(p.hueSat).every((v) => v === 100)
  );
}

// --- Box blur, per channel, via a sliding-window running sum so cost is O(pixels) regardless of
// radius (a naive per-pixel window sum would be O(pixels * radius), unusably slow at the radius
// "local contrast" needs on a multi-megapixel photo). Two passes (horizontal then vertical)
// approximate a Gaussian blur closely enough for this purpose.
function boxBlur1D(src: Float32Array, width: number, height: number, radius: number, horizontal: boolean): Float32Array {
  if (radius < 1) return src.slice();
  const out = new Float32Array(src.length);
  const outerLen = horizontal ? height : width;
  const innerLen = horizontal ? width : height;
  const windowSize = radius * 2 + 1;
  for (let o = 0; o < outerLen; o++) {
    const base = (i: number) => (horizontal ? o * width + i : i * width + o);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const clamped = Math.min(innerLen - 1, Math.max(0, i));
      sum += src[base(clamped)];
    }
    for (let i = 0; i < innerLen; i++) {
      out[base(i)] = sum / windowSize;
      const addIdx = Math.min(innerLen - 1, i + radius + 1);
      const subIdx = Math.max(0, i - radius);
      sum += src[base(addIdx)] - src[base(subIdx)];
    }
  }
  return out;
}

function boxBlurChannel(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const h = boxBlur1D(src, width, height, radius, true);
  return boxBlur1D(h, width, height, radius, false);
}

function extractChannel(data: Uint8ClampedArray, channel: number): Float32Array {
  const n = data.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data[i * 4 + channel];
  return out;
}

// --- HSL helpers, RGB in 0-255, H in degrees 0-360, S/L in 0-1.
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// The 6 standard hue-band anchors (matches the reference "Individual colors" panel), each 60°
// apart around the wheel — a pixel between two anchors gets a linearly-blended multiplier from
// both, so there's no visible hard edge where one band's adjustment stops and the next starts.
const HUE_ANCHORS: Array<{ hue: number; key: keyof HueBandSaturation }> = [
  { hue: 0, key: 'red' },
  { hue: 60, key: 'yellow' },
  { hue: 120, key: 'green' },
  { hue: 180, key: 'cyan' },
  { hue: 240, key: 'blue' },
  { hue: 300, key: 'purple' },
];

function hueSatMultiplier(hue: number, bands: HueBandSaturation): number {
  for (let i = 0; i < HUE_ANCHORS.length; i++) {
    const a = HUE_ANCHORS[i];
    const b = HUE_ANCHORS[(i + 1) % HUE_ANCHORS.length];
    const span = ((b.hue - a.hue + 360) % 360) || 360;
    const offset = ((hue - a.hue + 360) % 360);
    if (offset <= span) {
      const t = offset / span;
      const va = bands[a.key] / 100;
      const vb = bands[b.key] / 100;
      return va + (vb - va) * t;
    }
  }
  return 1;
}

function isHueInRange(hue: number, [lo, hi]: [number, number]): boolean {
  if (lo <= hi) return hue >= lo && hue <= hi;
  return hue >= lo || hue <= hi; // wraps through 0/360 (e.g. isolating reds spanning 350°-10°)
}

/** Mutates `imageData` in place, applying whichever of the heavy effects are non-default. Caller
 * decides when to run this (see ImageAnnotator's recomputeHeavy) — it's too expensive to call on
 * every animation frame for a multi-megapixel photo. */
export function applyHeavyEnhancements(imageData: ImageData, p: HeavyEnhanceParams): void {
  const { data, width, height } = imageData;
  const hueSatActive = Object.values(p.hueSat).some((v) => v !== 100);

  if (hueSatActive || p.highlightRange) {
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const newS = hueSatActive ? Math.min(1, Math.max(0, s * hueSatMultiplier(h, p.hueSat))) : s;
      const newL = p.highlightRange && !isHueInRange(h, p.hueRange) ? l * 0.16 : l;
      const [r, g, b] = hslToRgb(h, newS, newL);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }

  if (p.noiseReduction > 0) {
    const radius = 1 + Math.round((p.noiseReduction / 100) * 2); // 1-3px — gentle, not a heavy blur
    const strength = p.noiseReduction / 100;
    for (let c = 0; c < 3; c++) {
      const channel = extractChannel(data, c);
      const blurred = boxBlurChannel(channel, width, height, radius);
      for (let i = 0, n = channel.length; i < n; i++) {
        data[i * 4 + c] = channel[i] * (1 - strength) + blurred[i] * strength;
      }
    }
  }

  if (p.localContrast > 0) {
    const radius = Math.round(8 + (p.localContrast / 100) * 24); // 8-32px — a "clarity" radius
    const strength = (p.localContrast / 100) * 0.6;
    for (let c = 0; c < 3; c++) {
      const channel = extractChannel(data, c);
      const localAvg = boxBlurChannel(channel, width, height, radius);
      for (let i = 0, n = channel.length; i < n; i++) {
        data[i * 4 + c] = channel[i] + strength * (channel[i] - localAvg[i]);
      }
    }
  }

  if (p.sharpening > 0) {
    const strength = (p.sharpening / 100) * 0.8;
    for (let c = 0; c < 3; c++) {
      const channel = extractChannel(data, c);
      const blurred = boxBlurChannel(channel, width, height, 1);
      for (let i = 0, n = channel.length; i < n; i++) {
        data[i * 4 + c] = channel[i] + strength * (channel[i] - blurred[i]);
      }
    }
  }
}
