import type { DigitalFinding } from './digitalReport';

export interface ReportTowerLayout {
  key: string;
  visitId: string;
  tower: string;
  date: string;
  mount: string;
  viewSide: string;
  circuit: string;
  count: string;
  sides: string[];
  rows: DigitalFinding[];
  drawable: boolean;
}
const text = (row: DigitalFinding, field: string) => String(row.fields[field] ?? '');
/** Keep visit, circuit, configuration and viewing side separate. Never query live visits. */
export function reportTowerLayouts(rows: DigitalFinding[]): ReportTowerLayout[] {
  const groups = new Map<string, DigitalFinding[]>();
  for (const row of rows) {
    const visitId = row.key.split(':')[0];
    const mount = text(row, 'mount_type');
    const key = JSON.stringify([visitId, mount, text(row, 'view_side'), mount === 'Suspension' ? '' : text(row, 'ohl'), text(row, 'string_count')]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups].map(([key, items]) => {
    const first = items[0];
    const mount = text(first, 'mount_type');
    const count = text(first, 'string_count');
    const sides = mount === 'Suspension' ? ['OHL1', 'OHL2'] : [...new Set(items.map(row => text(row, 'direction')).filter(side => side && side !== 'NA'))].sort();
    const slots = items.map(row => JSON.stringify([mount === 'Suspension' ? text(row, 'ohl') : text(row, 'direction'), text(row, 'phase'), text(row, 'string')]));
    const drawable = ['Suspension', 'Tension'].includes(mount) && ['Single', 'Double'].includes(count)
      && sides.length > 0 && sides.length <= 2 && new Set(slots).size === slots.length
      && items.every(row => ['R', 'Y', 'B'].includes(text(row, 'phase')) && (count === 'Single' ? ['S1'] : ['S1', 'S2']).includes(text(row, 'string'))
        && (mount === 'Suspension' ? ['OHL1', 'OHL2'].includes(text(row, 'ohl')) : sides.includes(text(row, 'direction'))));
    return { key, visitId: first.key.split(':')[0], tower: text(first, 'tower'), date: text(first, 'inspection_date'), mount,
      viewSide: text(first, 'view_side'), circuit: mount === 'Suspension' ? 'OHL1 / OHL2' : text(first, 'ohl'), count, sides, rows: items, drawable };
  });
}
export function reportTowerSlot(layout: ReportTowerLayout, side: number, phase: string, string: string): DigitalFinding | undefined {
  const physicalSide = layout.viewSide === 'Back' ? 1 - side : side;
  const direction = layout.sides[physicalSide];
  if (!direction) return undefined;
  return layout.rows.find(row => String(row.fields[layout.mount === 'Suspension' ? 'ohl' : 'direction'] ?? '') === direction
    && row.fields.phase === phase && row.fields.string === string);
}
