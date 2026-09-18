"""ROI-aware "smart enhance" for a thermal/RGB position photo (routers/images.py's
POST /{image_id}/smart-enhance). The user draws a box around the insulator string first — this
never tries to find it across a whole busy photo on its own, which would be far less reliable —
then:
  - the insulator's own dominant edge direction and disc pitch are estimated from that box
    (best-effort classical CV, not a guaranteed measurement — see estimate_geometry)
  - the auto-levels stretch is computed from the box's own pixel range, not the whole photo's, so
    an unrelated bright/dark object elsewhere in frame can't skew it
  - noise reduction uses a real edge-preserving bilateral filter (cv2.bilateralFilter), not a
    plain blur, so disc boundaries stay sharp while flat backgrounds smooth out
  - detail enhancement (unsharp mask) is scaled to the estimated disc pitch, not a fixed radius,
    so a close-up shot and a wide one each get a sensible amount of sharpening

None of this is real temperature analysis — these photos are the camera's own rendered
color-palette JPEG, with no per-pixel radiometric data behind them (see knowledge_compose.py's
similar note for the "highlight temperatures" control)."""
from __future__ import annotations

import cv2
import numpy as np

Strength = str  # "gentle" | "balanced" | "strong"

_STRENGTH_SCALE = {"gentle": 0.55, "balanced": 1.0, "strong": 1.6}


def _clip_stretch(gray_roi: np.ndarray, low_pct: float, high_pct: float) -> tuple[float, float]:
    lo = float(np.percentile(gray_roi, low_pct))
    hi = float(np.percentile(gray_roi, high_pct))
    if hi <= lo:
        lo, hi = float(gray_roi.min()), float(gray_roi.max())
    if hi <= lo:
        hi = lo + 1.0
    return lo, hi


def estimate_geometry(roi_bgr: np.ndarray) -> tuple[float, float, str]:
    """Best-effort tilt-from-vertical (degrees, 0-90) and disc pitch (px) for the insulator string
    inside `roi_bgr`. Falls back to a size-based pitch estimate, and confidence="fallback",
    whenever the edge/periodicity signal isn't clean enough to trust — a wrong "confident" number
    would be worse than an honest fallback in a safety-inspection tool."""
    gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    fallback_pitch = float(np.clip(max(h, w) / 8.0, 8.0, 80.0))

    edges = cv2.Canny(gray, 40, 120)
    ys, xs = np.nonzero(edges)
    if len(xs) < 20:
        return 0.0, fallback_pitch, "fallback"

    pts = np.column_stack([xs, ys]).astype(np.float64)
    centered = pts - pts.mean(axis=0)
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    principal = eigvecs[:, int(np.argmax(eigvals))]
    tilt_deg = float(np.degrees(np.arctan2(abs(principal[0]), abs(principal[1]) or 1e-6)))

    # Project every edge point onto the principal axis, then look for a periodic spacing in that
    # 1D profile via autocorrelation — the "spacing of visible discs" the string's edges repeat at.
    axis = principal / (np.linalg.norm(principal) or 1.0)
    proj = centered @ axis
    proj_len = float(proj.max() - proj.min())
    if proj_len < 10:
        return tilt_deg, fallback_pitch, "fallback"

    bins = np.linspace(proj.min(), proj.max(), max(16, int(proj_len)))
    hist, _ = np.histogram(proj, bins=bins)
    hist = hist.astype(np.float64) - hist.mean()
    if np.allclose(hist, 0):
        return tilt_deg, fallback_pitch, "fallback"
    autocorr = np.correlate(hist, hist, mode="full")
    mid = len(autocorr) // 2
    autocorr = autocorr[mid:]
    min_lag = max(2, int(len(bins) * 0.04))
    if len(autocorr) <= min_lag + 1:
        return tilt_deg, fallback_pitch, "fallback"
    search = autocorr[min_lag:]
    peak_lag = int(np.argmax(search)) + min_lag
    if autocorr[0] <= 0 or autocorr[peak_lag] <= autocorr[0] * 0.15:  # no clear periodicity found
        return tilt_deg, fallback_pitch, "fallback"
    bin_width = bins[1] - bins[0]
    pitch_px = float(np.clip(peak_lag * bin_width, 6.0, 120.0))
    return tilt_deg, pitch_px, "estimated"


def smart_enhance(
    image_bgr: np.ndarray, roi: tuple[int, int, int, int], strength: Strength
) -> tuple[np.ndarray, float, float, str]:
    """Returns (enhanced_bgr, direction_deg, pitch_px, confidence). `roi` is (x, y, w, h) in this
    image's own pixel coordinates, clamped to the image bounds — the caller (routers/images.py)
    passes whatever box the user drew, which may run slightly outside the photo."""
    x, y, w, h = roi
    x = max(0, min(x, image_bgr.shape[1] - 1))
    y = max(0, min(y, image_bgr.shape[0] - 1))
    w = max(4, min(w, image_bgr.shape[1] - x))
    h = max(4, min(h, image_bgr.shape[0] - y))
    roi_bgr = image_bgr[y : y + h, x : x + w]

    direction_deg, pitch_px, confidence = estimate_geometry(roi_bgr)
    scale = _STRENGTH_SCALE.get(strength, 1.0)

    # 1) Levels: stretch from the ROI's own histogram (looser/tighter clip by strength) so an
    # unrelated bright/dark object elsewhere in the photo can't skew the whole image's range.
    gray_roi = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    clip = max(0.2, 1.0 / scale)
    lo, hi = _clip_stretch(gray_roi, clip, 100 - clip)
    img_f = image_bgr.astype(np.float32)
    img_f = (img_f - lo) * (255.0 / max(1.0, hi - lo))
    img_f = np.clip(img_f, 0, 255).astype(np.uint8)

    # 2) Edge-preserving noise reduction — a real bilateral filter, so flat backgrounds smooth out
    # while the disc boundaries the pitch estimate found stay crisp (cv2 docs: d4/d86 imgproc filter
    # group). Diameter/sigmas are tied to the estimated pitch, not a fixed guess.
    diameter = int(np.clip(round(pitch_px / 4), 3, 9)) | 1  # odd, never smaller than roughly one disc
    sigma_color = 20 * scale
    sigma_space = max(3.0, pitch_px / 3) * scale
    denoised = cv2.bilateralFilter(img_f, diameter, sigma_color, sigma_space)

    # 3) Detail enhancement (unsharp mask) at a radius tied to the disc pitch — a close-up shot
    # with big discs and a wide shot with tiny ones each get a sensible amount of sharpening.
    blur_radius = max(1, int(round(pitch_px / 2)))
    ksize = blur_radius * 2 + 1
    blurred = cv2.GaussianBlur(denoised, (ksize, ksize), 0)
    sharpen_strength = 0.5 * scale
    sharpened = cv2.addWeighted(denoised, 1 + sharpen_strength, blurred, -sharpen_strength, 0)

    return np.clip(sharpened, 0, 255).astype(np.uint8), direction_deg, pitch_px, confidence
