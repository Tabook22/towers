import type { ArchiveResponse, ArchiveVisitPhoto, ImageRow } from '../api/types';

export const evidenceTypes = ['TH Full', 'TH Close', 'RGB Full', 'RGB Close'] as const;
export const evidenceLabels: Record<string, string> = { 'TH Full': 'Thermal full', 'TH Close': 'Thermal close', 'RGB Full': 'RGB full', 'RGB Close': 'RGB close' };
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Collect bounded API pages before displaying complete insulator groups. A failed page rejects
 * the entire query instead of presenting an incomplete collection as a complete archive. */
export async function collectArchivePages(fetchPage: (page: { skip: number; limit: number; image_ceiling?: number; photo_ceiling?: number }) => Promise<ArchiveResponse>): Promise<ArchiveResponse> {
  const first = await fetchPage({ skip: 0, limit: 500 });
  const images = new Map(first.images.map((image) => [image.id, image]));
  const photos = new Map(first.photos.map((photo) => [photo.id, photo]));
  let page = first;
  for (let skip = 500; page.has_more; skip += 500) {
    page = await fetchPage({ skip, limit: 500, image_ceiling: first.image_ceiling, photo_ceiling: first.photo_ceiling });
    page.images.forEach((image) => images.set(image.id, image));
    page.photos.forEach((photo) => photos.set(photo.id, photo));
  }
  if (images.size !== first.total_images || photos.size !== first.total_photos) {
    throw new Error('The archive changed while loading. Refresh to load the complete collection.');
  }
  return { ...first, images: [...images.values()], photos: [...photos.values()], has_more: false };
}

export interface EvidencePosition {
  id: number;
  label: string;
  visitId: number | undefined;
  date: string | null;
  images: ImageRow[];
  photos: ArchiveVisitPhoto[];
}
export interface EvidenceTower {
  id: number;
  name: string;
  area: string;
  positions: EvidencePosition[];
  photos: ArchiveVisitPhoto[];
  count: number;
}
export interface EvidenceTeam { id: number | null; name: string; towers: EvidenceTower[]; count: number }

export function groupArchiveEvidence(images: ImageRow[], photos: ArchiveVisitPhoto[], search = '', newestFirst = false): EvidenceTeam[] {
  const teams = new Map<number | null, EvidenceTeam>();
  const query = search.trim().toLocaleLowerCase();
  const matches = (row: ImageRow | ArchiveVisitPhoto) => !query || [row.team_name, row.tower_code, row.area, row.position_code, `${row.ohl} ${row.phase} ${row.string} ${row.direction || ''}`].some((v) => v?.toLocaleLowerCase().includes(query));
  const towerFor = (row: ImageRow | ArchiveVisitPhoto) => {
    const id = row.team_id ?? null;
    let team = teams.get(id);
    if (!team) { team = { id, name: row.team_name || 'Unassigned team', towers: [], count: 0 }; teams.set(id, team); }
    let tower = team.towers.find((t) => t.id === row.tower_pk);
    if (!tower) { tower = { id: row.tower_pk ?? 0, name: row.tower_code || 'Unknown tower', area: row.area || '', positions: [], photos: [], count: 0 }; team.towers.push(tower); }
    team.count++; tower.count++;
    return tower;
  };
  const positionFor = (tower: EvidenceTower, row: ImageRow | ArchiveVisitPhoto) => {
    let position = tower.positions.find((p) => p.id === row.position_id);
    if (!position) {
      position = { id: row.position_id!, label: `${row.ohl || ''} ${row.phase || ''} ${row.string || ''}${row.direction ? ` — ${row.direction}` : ''}`.trim() || row.position_code || `Insulator ${row.position_id}`, visitId: row.visit_id, date: row.inspection_date || row.archive_date || null, images: [], photos: [] };
      tower.positions.push(position);
    }
    return position;
  };
  for (const image of images.filter(matches)) positionFor(towerFor(image), image).images.push(image);
  for (const photo of photos.filter(matches)) {
    const tower = towerFor(photo);
    if (photo.position_id != null) positionFor(tower, photo).photos.push(photo);
    else tower.photos.push(photo);
  }
  const sorted = [...teams.values()].sort((a, b) => naturalCompare(a.name, b.name));
  for (const team of sorted) {
    team.towers.sort((a, b) => naturalCompare(a.name, b.name));
    for (const tower of team.towers) {
      tower.positions.sort((a, b) => (newestFirst ? (b.date || '').localeCompare(a.date || '') : 0) || naturalCompare(a.label, b.label) || (b.date || '').localeCompare(a.date || '') || a.id - b.id);
      for (const position of tower.positions) position.images.sort((a, b) => evidenceTypes.indexOf(a.image_type) - evidenceTypes.indexOf(b.image_type) || a.sequence - b.sequence || a.id - b.id);
    }
  }
  return sorted;
}
