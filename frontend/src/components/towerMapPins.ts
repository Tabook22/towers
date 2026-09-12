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

/** Last run of digits in the tower ID, e.g. Ashoor-Saada-100 → 100, "Tower 1" → 1. */
export function extractTowerNumber(towerId: string): number | null {
  const cleaned = towerId.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const match = cleaned.match(/(\d+)\s*$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Pin label = trailing number from the Tower ID. Never a 1,2,3 sequence that can disagree with the ID. */
export function towerNumbersById(towers: NumberableTower[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of towers) {
    const n = extractTowerNumber(t.tower_id);
    if (n != null) out.set(t.id, n);
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
  const n = extractTowerNumber(opts.towerId) ?? opts.mapNumber;
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

export function numberedDotIcon(opts: {
  mapNumber?: number;
  towerId?: string;
  color: string;
  focused?: boolean;
  showIdLabel?: boolean;
}): L.DivIcon {
  const n = (opts.towerId ? extractTowerNumber(opts.towerId) : null) ?? opts.mapNumber;
  const pin =
    n != null
      ? `<div class="tower-pin-num" style="background:${opts.color}">${n}</div>`
      : `<div style="width:16px;height:16px;border-radius:50%;background:${opts.color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`;
  const idLabel =
    opts.showIdLabel && opts.towerId
      ? `<div class="tower-map-label"><div class="tower-map-label-id">${escapeHtml(opts.towerId)}</div></div>`
      : '';
  if (opts.focused) {
    return L.divIcon({
      className: 'tower-pin',
      html: `<div class="tower-pin-hit${idLabel ? ' tower-pin-hit--labeled' : ''}" style="${idLabel ? '' : 'width:40px;height:40px;position:relative'}">
        <div style="position:absolute;inset:0;border:3px solid #d32f2f;border-radius:6px;box-shadow:0 0 0 2px rgba(255,255,255,0.9)"></div>
        <div style="position:relative;z-index:1">${pin}${idLabel}</div>
      </div>`,
      iconSize: idLabel ? [96, 56] : [40, 40],
      iconAnchor: idLabel ? [48, 14] : [20, 20],
    });
  }
  if (idLabel) {
    return L.divIcon({
      className: 'tower-pin',
      html: `<div class="tower-pin-hit tower-pin-hit--labeled">${pin}${idLabel}</div>`,
      iconSize: [96, 56],
      iconAnchor: [48, 14],
    });
  }
  return L.divIcon({
    className: 'tower-pin',
    html: `<div class="tower-pin-hit">${pin}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}
