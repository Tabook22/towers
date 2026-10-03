import type { Position, PositionSlot, VisitDetail } from '../api/types';
import { entryPositions, positionIdentity, prepareEntryLayout, resolveSuspensionSlots, type VisitEntry } from './visitEntry';
import { mergePositionDraft } from './visitWorkflow';

export type VisualLayout = { ohl: string; mount: string; count: string; directionA: string; directionB: string; back: boolean; view_side?: string };

/** Browser preferences choose presentation; recorded visit configuration is authoritative. */
export function visitVisualLayout(positions: Position[], preference?: Partial<VisualLayout> | null): VisualLayout {
  const active = positions.filter(p => p.in_scope !== false && p.direction);
  const selected = active.filter(p => p.ohl === preference?.ohl);
  const circuitPositions = selected.length ? selected : active;
  const viewed = circuitPositions.filter(p => (p.view_side || 'Unspecified') === preference?.view_side);
  const first = (viewed.length ? viewed : circuitPositions)[0];
  if (!first) return { ohl: preference?.ohl || 'OHL1', mount: preference?.mount || 'Tension', count: preference?.count || 'Double',
    directionA: preference?.directionA || '', directionB: preference?.directionB || '', back: preference?.back === true };
  const mount = first.mount_type || preference?.mount || 'Tension';
  const circuit = active.filter(p => p.ohl === first.ohl && (!p.mount_type || p.mount_type === mount));
  const directions = [...new Set(circuit.map(p => p.direction!).filter(d => d !== 'NA'))];
  const ordered = preference?.directionA && directions.includes(preference.directionA)
    ? [preference.directionA, ...directions.filter(d => d !== preference.directionA)] : directions;
  return { ohl: first.ohl, mount, count: first.string_count || circuit.find(p => p.string_count)?.string_count || preference?.count || 'Double',
    directionA: ordered[0] || '', directionB: ordered[1] || '', back: preference?.back === true, ...(preference?.view_side || first.view_side ? { view_side: preference?.view_side || first.view_side } : {}) };
}

/** Physical sides have stable keys; changing the viewing side only changes display order. */
export function visualSides(backView: boolean) {
  return backView ? ['B', 'A'] as const : ['A', 'B'] as const;
}

export function visualSlots(ohl: string, mount: string, count: string, directionA: string, directionB: string): PositionSlot[] {
  if (mount === 'Gantry') return [];
  if (mount === 'Suspension') return ['OHL1', 'OHL2'].flatMap(side => ['R', 'Y', 'B'].flatMap(phase =>
    (count === 'Double' ? ['S1', 'S2'] : ['S1']).map(string => ({ ohl: side, phase, string, direction: 'NA', mount_type: mount, string_count: count }))));
  if (!directionA || !directionB || directionA === directionB) throw new Error('Choose two different directions for this OHL.');
  return [directionA, directionB].flatMap(direction => ['R', 'Y', 'B'].flatMap(phase =>
    (count === 'Double' ? ['S1', 'S2'] : ['S1']).map(string => ({ ohl, phase, string, direction, mount_type: mount, string_count: count }))));
}

/** Older positions may predate configuration fields; their identity and readings still apply. */
export function matchesVisualSlot(position: Position, slot: PositionSlot): boolean {
  return position.in_scope !== false && positionIdentity(position) === positionIdentity(slot)
    && (!position.mount_type || position.mount_type === slot.mount_type)
    && (!position.string_count || position.string_count === slot.string_count);
}

/** Add this diagram to the visit without removing another circuit, direction or evidence. */
export function prepareVisualEntry(visit: VisitDetail, entry: VisitEntry, slots: PositionSlot[]): VisitEntry {
  slots = resolveSuspensionSlots(entryPositions(visit, entry), slots);
  if (!slots.length || new Set(slots.map(positionIdentity)).size !== slots.length) throw new Error('The visual form contains duplicate or missing positions.');
  const all = entryPositions(visit, entry);
  let next = entry;
  const layout = new Map<string, PositionSlot>();
  for (const position of all) {
    if (position.in_scope !== false && position.direction && position.mount_type && position.string_count) {
      layout.set(positionIdentity(position), { ohl: position.ohl, phase: position.phase, string: position.string,
        direction: position.direction, view_side: position.view_side, mount_type: position.mount_type, string_count: position.string_count });
    }
  }
  for (const slot of slots) {
    const existing = all.find(position => positionIdentity(position) === positionIdentity(slot));
    if (existing && ((existing.mount_type && existing.mount_type !== slot.mount_type) || (existing.string_count && existing.string_count !== slot.string_count))) {
      throw new Error('An existing position has a different tower type or string count. Check its configuration before using this layout.');
    }
    if (existing && (!existing.mount_type || !existing.string_count)) {
      // Fill only absent configuration, even when the legacy position already has evidence.
      const missing: Partial<Position> = {};
      if (!existing.mount_type) missing.mount_type = slot.mount_type;
      if (!existing.string_count) missing.string_count = slot.string_count;
      next = { ...next, drafts: mergePositionDraft(next.drafts, visit.positions.find(p => p.id === existing.id) || existing, missing) };
    }
    layout.set(positionIdentity(slot), slot);
  }
  return prepareEntryLayout(visit, next, [...layout.values()], entry.saveTemplate);
}

/** The first reading creates its diagram's draft positions in the same update. */
export function editVisualReading(visit: VisitDetail, entry: VisitEntry, slots: PositionSlot[], slot: PositionSlot, changes: Partial<Position>): VisitEntry {
  slot = resolveSuspensionSlots(entryPositions(visit, entry), [slot])[0];
  slots = resolveSuspensionSlots(entryPositions(visit, entry), slots);
  if (!slot.direction || !slots.some(item => positionIdentity(item) === positionIdentity(slot))) throw new Error('Select a direction above this side to enter its readings.');
  const next = prepareVisualEntry(visit, entry, slots);
  const position = entryPositions(visit, next).find(item => positionIdentity(item) === positionIdentity(slot))!;
  return { ...next, drafts: mergePositionDraft(next.drafts, visit.positions.find(item => item.id === position.id) || position, changes) };
}

/** Explicit inspector choice, never inferred from temperature values. */
export function visualScreeningPatch(result: string): Partial<Position> {
  return { screening_result: result, installed: result !== 'Not installed',
    hotspot: ({ Normal: 'No', 'Hotspot detected': 'Yes', Inconclusive: 'Unconfirmed' } as Record<string, string>)[result] || null };
}

export function numericReading(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error('Enter a valid numeric reading.');
  return value;
}
