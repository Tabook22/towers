/** Explicit project lines. Never infer or persist a line from a tower ID. */
export const PROJECT_LINES = ['Ashoor-Saada', 'Saada-Shahaon', 'Ittin-Thumrait'] as const;
export const UNASSIGNED_LINE = '__no_line__';

type TowerLine = { line_sector?: string | null };
export function towerLineKey(tower: TowerLine): string {
  return tower.line_sector?.trim() || UNASSIGNED_LINE;
}
export function towersOnLine<T extends TowerLine>(towers: T[], line: string): T[] {
  return line ? towers.filter(tower => towerLineKey(tower) === line) : towers;
}
export function towerLineSummary(towers: TowerLine[]) {
  const counts = new Map<string, number>();
  for (const tower of towers) {
    const key = towerLineKey(tower);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts, ([id, value]) => ({ id, label: id === UNASSIGNED_LINE ? 'Line not assigned' : id, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
export function towerLineOptions(towers: TowerLine[]) {
  return [...new Set([...PROJECT_LINES, ...towers.map(towerLineKey).filter(key => key !== UNASSIGNED_LINE)])];
}
