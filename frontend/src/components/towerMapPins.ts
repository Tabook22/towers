import L from 'leaflet';

export const FREE_TOWER_COLOR = '#2e7d32';
export const ASSIGNED_TOWER_COLOR = '#d32f2f';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Green = free, red = assigned. Team name sits under the pin so a leader can see who holds it. */
export function assignmentPinIcon(opts: { towerId: string; teamName?: string | null }): L.DivIcon {
  const free = !opts.teamName;
  const color = free ? FREE_TOWER_COLOR : ASSIGNED_TOWER_COLOR;
  const teamLine = free
    ? `<div class="tower-map-label-team free">Free</div>`
    : `<div class="tower-map-label-team">${escapeHtml(opts.teamName as string)}</div>`;
  return L.divIcon({
    className: 'tower-pin',
    html: `<div class="tower-pin-hit tower-pin-hit--labeled">
      <div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>
      <div class="tower-map-label">
        <div class="tower-map-label-id">${escapeHtml(opts.towerId)}</div>
        ${teamLine}
      </div>
    </div>`,
    iconSize: [96, 52],
    iconAnchor: [48, 10],
  });
}
