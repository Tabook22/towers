/** Best-guess Direction for a Suspension position, from the tower's own line/area name.
 *
 * A Suspension position "runs straight through" (see HelpPage) so there's no direction to record
 * for it — but the app's image-code scheme (backend services/id_gen.py) still needs some real
 * Direction value to build a position/image code at all, Suspension included. Most areas are a
 * two-line compound like "Ashoor-Saada" (both halves are valid Direction choices), so this can't
 * always be a certain answer — it deterministically picks the line name that appears first in the
 * area string, which is a reasonable default and keeps evidence tracking working, without ever
 * overwriting a Direction the user already set (see call sites).
 */
export function deriveDirectionFromArea(area: string | null | undefined, directionChoices: string[]): string | null {
  return deriveDirectionsFromArea(area, directionChoices)[0] ?? null;
}

/** Every Direction segment found in the tower's line/area name, in the order they appear (e.g.
 * "Ashoor-Saada" -> ["Ashoor", "Saada"]) — a Tension position (see AddPositionBar) needs to offer
 * ALL of them, not just a single best guess, since the line genuinely runs toward each one from
 * that tower. Empty if the area doesn't match any known Direction, so callers can fall back to the
 * full choice list rather than showing nothing. */
export function deriveDirectionsFromArea(area: string | null | undefined, directionChoices: string[]): string[] {
  if (!area) return [];
  const segments = area.split(/[-–—]/).map((s) => s.trim());
  return segments.filter((seg) => directionChoices.includes(seg));
}
