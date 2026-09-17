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
  if (!area) return null;
  const segments = area.split(/[-–—]/).map((s) => s.trim());
  return segments.find((seg) => directionChoices.includes(seg)) ?? null;
}
