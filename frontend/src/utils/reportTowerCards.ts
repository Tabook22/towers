import type { InspectionSnapshot } from '../api/types';

export type TowerMapMetadata = { id: number; latitude: number | null; longitude: number | null; area: string | null; line_sector: string | null; location_name: string | null; voltage: string | null; tower_type: string | null };
export function validTowerCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);
}

export function reportTowerSummary(name: string, snapshot: InspectionSnapshot | null | undefined, metadata?: TowerMapMetadata) {
  const visits = snapshot?.visits.filter(visit => visit.tower === name) ?? [];
  const positions = visits.flatMap(visit => visit.positions);
  const dates = [...new Set(visits.map(visit => visit.inspection_date).filter((date): date is string => !!date))].sort();
  const recorded = [...visits].sort((a, b) => (b.inspection_date ?? '').localeCompare(a.inspection_date ?? ''))
    .find(visit => validTowerCoordinates(visit.latitude, visit.longitude));
  const catalogLocation = metadata && validTowerCoordinates(metadata.latitude, metadata.longitude);
  return {
    visits: snapshot ? visits.length : null,
    positions: snapshot ? positions.length : null,
    photographs: snapshot ? positions.reduce((total, position) => total + position.evidence.length, 0) : null,
    urgent: snapshot ? positions.filter(position => /high|critical/i.test(String(position.severity ?? ''))).length : null,
    firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
    area: metadata?.area || String(visits.find(visit => visit.area)?.area || ''),
    line: metadata?.line_sector || String(visits.find(visit => visit.line_sector)?.line_sector || ''),
    latitude: catalogLocation ? metadata.latitude : recorded ? Number(recorded.latitude) : null,
    longitude: catalogLocation ? metadata.longitude : recorded ? Number(recorded.longitude) : null,
    locationSource: catalogLocation ? 'catalog' : recorded ? 'inspection' : null,
  };
}
