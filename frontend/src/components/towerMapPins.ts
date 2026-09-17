import L from 'leaflet';

export const FREE_TOWER_COLOR = '#2e7d32';
export const ASSIGNED_TOWER_COLOR = '#d32f2f';

// One color per team, cycling through a fixed palette keyed by team id — so the same team always
// gets the same pin color on every map and every reload, without the caller needing the full team
// roster on hand (just the id already on the tower/visit record).
const TEAM_COLOR_PALETTE = [
  '#1976d2', // blue
  '#e65100', // orange
  '#6a1b9a', // purple
  '#00838f', // teal
  '#ad1457', // pink
  '#4e342e', // brown
  '#283593', // indigo
  '#c62828', // red
  '#f9a825', // amber
  '#558b2f', // olive
];

export function colorForTeam(teamId: number | null | undefined): string {
  if (teamId == null) return ASSIGNED_TOWER_COLOR;
  const idx = ((teamId % TEAM_COLOR_PALETTE.length) + TEAM_COLOR_PALETTE.length) % TEAM_COLOR_PALETTE.length;
  return TEAM_COLOR_PALETTE[idx];
}

/** Distinct (team id, team name) pairs actually present, sorted by name — for a map's color legend. */
export function teamsPresent<T extends { assigned_team_id: number | null; assigned_team_name?: string | null }>(
  towers: T[],
): { id: number; name: string }[] {
  const out = new Map<number, string>();
  for (const t of towers) {
    if (t.assigned_team_id != null) out.set(t.assigned_team_id, t.assigned_team_name || `Team ${t.assigned_team_id}`);
  }
  return Array.from(out, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

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

const CHECK_BADGE = `<div class="tower-pin-check" title="Inspection completed"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>`;

/** Wraps a pin's dot/number markup so a completed check badge can sit at its top-right corner. */
function withCheckBadge(pinHtml: string, completed?: boolean): string {
  if (!completed) return pinHtml;
  return `<div class="tower-pin-num-wrap">${pinHtml}${CHECK_BADGE}</div>`;
}

/** Green = free, one color per team = assigned (see colorForTeam). A check badge marks a tower
 * whose latest visit is fully completed. Number in the circle is the Tower ID suffix. */
export function assignmentPinIcon(opts: {
  towerId: string;
  teamId?: number | null;
  teamName?: string | null;
  mapNumber?: number | null;
  completed?: boolean;
}): L.DivIcon {
  const free = !opts.teamName;
  const color = free ? FREE_TOWER_COLOR : colorForTeam(opts.teamId);
  const n = extractTowerNumber(opts.towerId) ?? opts.mapNumber;
  const pin =
    n != null
      ? `<div class="tower-pin-num" style="background:${color}">${n}</div>`
      : `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>`;
  const teamLine = free
    ? `<div class="tower-map-label-team free">Free</div>`
    : `<div class="tower-map-label-team" style="color:${color}">${escapeHtml(opts.teamName as string)}</div>`;
  return L.divIcon({
    className: 'tower-pin',
    html: `<div class="tower-pin-hit tower-pin-hit--labeled">
      ${withCheckBadge(pin, opts.completed)}
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
