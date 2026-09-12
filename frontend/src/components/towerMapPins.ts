import L from 'leaflet';

export const FREE_TOWER_COLOR = '#2e7d32';
export const ASSIGNED_TOWER_COLOR = '#d32f2f';

export type NumberableTower = {
  id: number;
  tower_id: string;
  area?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Last run of digits in the tower ID, e.g. Ashoor-SaadaT12 → 12, "Tower 1" → 1. */
export function extractTowerNumber(towerId: string): number | null {
  const match = towerId.match(/(\d+)\s*$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function orderAlongLine(towers: NumberableTower[]): NumberableTower[] {
  const gps = towers.filter((t) => t.latitude != null && t.longitude != null);
  const noGps = towers.filter((t) => t.latitude == null || t.longitude == null);
  noGps.sort((a, b) => a.tower_id.localeCompare(b.tower_id, undefined, { numeric: true }));
  if (gps.length < 2) {
    return [...gps, ...noGps];
  }
  let a = gps[0];
  let b = gps[1];
  let best = -1;
  for (let i = 0; i < gps.length; i++) {
    for (let j = i + 1; j < gps.length; j++) {
      const d = haversineM(gps[i].latitude as number, gps[i].longitude as number, gps[j].latitude as number, gps[j].longitude as number);
      if (d > best) {
        best = d;
        a = gps[i];
        b = gps[j];
      }
    }
  }
  // Number west → east along the line so "tower 1" is the western end.
  if ((b.longitude as number) < (a.longitude as number)) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  const dx = (b.longitude as number) - (a.longitude as number);
  const dy = (b.latitude as number) - (a.latitude as number);
  const proj = (t: NumberableTower) =>
    ((t.longitude as number) - (a.longitude as number)) * dx + ((t.latitude as number) - (a.latitude as number)) * dy;
  gps.sort((x, y) => proj(x) - proj(y));
  return [...gps, ...noGps];
}

function orderGroup(group: NumberableTower[]): NumberableTower[] {
  const extracted = group.map((t) => ({ t, n: extractTowerNumber(t.tower_id) }));
  const withNum = extracted.filter((x) => x.n != null);
  // If most IDs already carry a field number (Tower 1, T2, …), keep that order so pin 1 is tower 1.
  if (withNum.length >= Math.max(2, Math.ceil(group.length * 0.5))) {
    return [...group].sort((a, b) => {
      const na = extractTowerNumber(a.tower_id);
      const nb = extractTowerNumber(b.tower_id);
      if (na != null && nb != null && na !== nb) return na - nb;
      if (na != null && nb == null) return -1;
      if (na == null && nb != null) return 1;
      return a.tower_id.localeCompare(b.tower_id, undefined, { numeric: true });
    });
  }
  return orderAlongLine(group);
}

/** Number painted in the pin: the trailing number from the Tower ID (Ashoor-Saada-2 → 2).
 *  Towers with no number in the ID get a spare sequential value so they still have a label. */
export function towerNumbersById(towers: NumberableTower[]): Map<number, number> {
  const byArea = new Map<string, NumberableTower[]>();
  for (const t of towers) {
    const key = (t.area || '').trim() || '_none';
    const list = byArea.get(key) || [];
    list.push(t);
    byArea.set(key, list);
  }
  const out = new Map<number, number>();
  for (const group of byArea.values()) {
    const used = new Set<number>();
    for (const t of group) {
      const n = extractTowerNumber(t.tower_id);
      if (n != null) {
        out.set(t.id, n);
        used.add(n);
      }
    }
    let next = 1;
    for (const t of orderGroup(group)) {
      if (out.has(t.id)) continue;
      while (used.has(next)) next += 1;
      out.set(t.id, next);
      used.add(next);
      next += 1;
    }
  }
  return out;
}

/** Green = free, red = assigned. Number in the circle is the Tower ID suffix. */
export function assignmentPinIcon(opts: {
  towerId: string;
  teamName?: string | null;
  mapNumber?: number | null;
}): L.DivIcon {
  const free = !opts.teamName;
  const color = free ? FREE_TOWER_COLOR : ASSIGNED_TOWER_COLOR;
  const n = opts.mapNumber;
  const pin =
    n != null
      ? `<div class="tower-pin-num" style="background:${color}">${n}</div>`
      : `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`;
  const teamLine = free
    ? `<div class="tower-map-label-team free">Free</div>`
    : `<div class="tower-map-label-team">${escapeHtml(opts.teamName as string)}</div>`;
  return L.divIcon({
    className: 'tower-pin',
    html: `<div class="tower-pin-hit tower-pin-hit--labeled">
      ${pin}
      <div class="tower-map-label">
        <div class="tower-map-label-id">${escapeHtml(opts.towerId)}</div>
        ${teamLine}
      </div>
    </div>`,
    iconSize: [96, 56],
    iconAnchor: [48, 14],
  });
}

export function numberedDotIcon(opts: { mapNumber: number; color: string; focused?: boolean }): L.DivIcon {
  const n = opts.mapNumber;
  const pin = `<div class="tower-pin-num" style="background:${opts.color}">${n}</div>`;
  if (opts.focused) {
    return L.divIcon({
      className: 'tower-pin',
      html: `<div class="tower-pin-hit" style="width:40px;height:40px;position:relative">
        <div style="position:absolute;inset:0;border:3px solid #d32f2f;border-radius:6px;box-shadow:0 0 0 2px rgba(255,255,255,0.9)"></div>
        <div style="position:relative;z-index:1">${pin}</div>
      </div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }
  return L.divIcon({
    className: 'tower-pin',
    html: `<div class="tower-pin-hit">${pin}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}
