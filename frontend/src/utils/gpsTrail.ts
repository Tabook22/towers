/** Drop impossible jumps (bad Wi‑Fi/IP fixes) so trails don't draw 100+ km lines across the map. */
const MAX_SEGMENT_METERS = 2_500;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lon2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function splitTrailSegments(
  points: { latitude: number; longitude: number }[],
): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const p of points) {
    const pt: [number, number] = [p.latitude, p.longitude];
    if (current.length === 0) {
      current.push(pt);
      continue;
    }
    const prev = current[current.length - 1];
    if (haversineMeters(prev[0], prev[1], pt[0], pt[1]) > MAX_SEGMENT_METERS) {
      if (current.length >= 2) segments.push(current);
      current = [pt];
    } else {
      current.push(pt);
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}
