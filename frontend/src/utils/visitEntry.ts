import type { Position, PositionSlot, VisitDetail } from '../api/types';
import { mergePositionDraft, type PositionDrafts } from './visitWorkflow';
import { evidenceStatusForPosition } from './positionChanges';

export interface VisitEntry {
  drafts: PositionDrafts;
  additions: Position[];
  headerDraft: Record<string, unknown> | null;
  headerBefore: VisitDetail | null;
  layoutIds: number[] | null;
  layoutVersions: Record<number, string>;
  saveTemplate: boolean;
  excludedImages: number[];
}
export const emptyEntry = (): VisitEntry => ({ drafts: {}, additions: [], headerDraft: null, headerBefore: null, layoutIds: null, layoutVersions: {}, saveTemplate: false, excludedImages: [] });
export const entryHasChanges = (entry: VisitEntry) => !!(Object.keys(entry.drafts).length || entry.additions.length || entry.headerDraft || entry.layoutIds || entry.excludedImages.length);
export const positionIdentity = (p: Pick<Position, 'ohl' | 'phase' | 'string' | 'direction' | 'view_side'>) => [p.ohl, p.phase, p.string, p.direction, p.view_side || 'Unspecified'].join('|');
export const hasRecordedWork = (p: Position) => !!(p.inspector_notes || p.voice_note_path || p.images.some(i => i.file_path) || p.screening_result !== 'Not inspected' || p.hotspot || p.tmax_c != null || p.tref_c != null || p.severity || p.confidence || p.pollution_condition || p.thermal_indication || p.visual_indications);
/** Reuse historical Suspension records without changing their identifiers or evidence. */
export function resolveSuspensionSlots(positions: Position[], slots: PositionSlot[]): PositionSlot[] {
  return slots.map(slot => {
    if (slot.mount_type !== 'Suspension' || slot.direction !== 'NA') return slot;
    if (positions.some(p => p.ohl === slot.ohl && p.phase === slot.phase && p.string === slot.string && (p.view_side || 'Unspecified') === (slot.view_side || 'Unspecified') && p.direction && p.mount_type && p.mount_type !== 'Suspension')) {
      throw new Error('An existing position has a different tower type or string count. Check its configuration before using this layout.');
    }
    const existing = positions.filter(p => p.ohl === slot.ohl && p.phase === slot.phase && p.string === slot.string && (p.view_side || 'Unspecified') === (slot.view_side || 'Unspecified')
      && !!p.direction && (!p.mount_type || p.mount_type === 'Suspension'));
    if (existing.length > 1) throw new Error('Multiple historical Suspension positions match this string. Review them individually; no readings or images have been merged.');
    return existing[0] ? { ...slot, direction: existing[0].direction! } : slot;
  });
}
export function entryPositions(visit: VisitDetail, entry: VisitEntry) {
  return [...visit.positions, ...entry.additions].map(p => {
    const next = { ...p, ...entry.drafts[p.id]?.changes,
      in_scope: entry.layoutIds ? entry.layoutIds.includes(p.id) : entry.drafts[p.id] ? true : p.in_scope };
    if (next.installed !== p.installed || next.screening_result !== p.screening_result) {
      next.images = p.images.map(image => ({ ...image, evidence_status: evidenceStatusForPosition(next, image.image_type, image, true) }));
    }
    return next;
  });
}
export function newDraftPosition(visit: VisitDetail, slot: PositionSlot, id: number): Position {
  return { ...visit.positions[0], ...slot, view_side: slot.view_side || 'Unspecified', id, visit_id: visit.id, updated_at: '', in_scope: true, prepared_only: true,
    installed: true, screening_result: 'Not inspected', hotspot: null, tmax_c: null, tref_c: null,
    severity: null, confidence: null, inspector_notes: null, manufacturer: null, year_installed: null,
    insulator_type: null, gs_side: null, pollution_condition: null, thermal_indication: null, visual_indications: null,
    position_code: null, voice_note_path: null, voice_note_content_type: null, voice_note_original_filename: null,
    voice_note_duration_seconds: null, voice_note_transcript: null, images: [],
    tower_proximity: slot.string_count === 'Double' ? (slot.string === 'S1' ? 'Outer' : 'Inner') : null };
}
export function addEntryPosition(visit: VisitDetail, entry: VisitEntry, slot: PositionSlot): VisitEntry {
  const all = entryPositions(visit, entry);
  const match = all.find(p => positionIdentity(p) === positionIdentity(slot));
  if (match && (entry.layoutIds ? entry.layoutIds.includes(match.id) : match.in_scope !== false && !!match.direction)) throw new Error('This position is already in the checklist.');
  const reusable = match || all.find(p => p.ohl === slot.ohl && p.phase === slot.phase && p.string === slot.string && !p.direction && !hasRecordedWork(p));
  const id = reusable?.id ?? Math.min(0, ...entry.additions.map(p => p.id)) - 1;
  return { ...entry,
    additions: reusable ? entry.additions : [...entry.additions, newDraftPosition(visit, slot, id)],
    drafts: reusable ? mergePositionDraft(entry.drafts, visit.positions.find(p => p.id === id) || reusable, { ...slot, tower_proximity: slot.string_count === 'Double' ? (slot.string === 'S1' ? 'Outer' : 'Inner') : null }) : entry.drafts,
    layoutIds: entry.layoutIds ? [...new Set([...entry.layoutIds, id])] : null };
}
export function prepareEntryLayout(visit: VisitDetail, entry: VisitEntry, slots: PositionSlot[], saveTemplate: boolean): VisitEntry {
  slots = resolveSuspensionSlots(entryPositions(visit, entry), slots);
  let next = { ...entry };
  const ids: number[] = [];
  // Previously recorded views stay in scope when adding another view's template.
  const requestedViews = new Set(slots.map(s => s.view_side || 'Unspecified'));
  const preserved = entryPositions(visit, next).filter(p => p.in_scope !== false && p.direction && !requestedViews.has(p.view_side || 'Unspecified'));
  ids.push(...preserved.map(p => p.id));
  for (const slot of slots) {
    let position = entryPositions(visit, next).find(p => positionIdentity(p) === positionIdentity(slot));
    if (!position) {
      next = addEntryPosition(visit, next, slot);
      position = entryPositions(visit, next).find(p => positionIdentity(p) === positionIdentity(slot))!;
    } else if (!hasRecordedWork(position) && (position.prepared_only || !position.direction)) {
      next.drafts = mergePositionDraft(next.drafts, visit.positions.find(p => p.id === position!.id) || position, slot);
    }
    ids.push(position.id);
  }
  for (const p of entryPositions(visit, next)) if (!ids.includes(p.id) && (hasRecordedWork(p) || (p.id > 0 && !!p.direction && !p.prepared_only) || entry.drafts[p.id])) throw new Error('Include all positions that already have observations or draft edits.');
  return { ...next, layoutIds: ids, layoutVersions: Object.fromEntries(visit.positions.map(p => [p.id, entry.layoutVersions[p.id] || entry.drafts[p.id]?.before.updated_at || p.updated_at])), saveTemplate };
}

// Only an explicit comparison action may refresh the revision behind a proposed change.
// A position whose identity changed must be inspected again rather than silently reassociated.
export function compareLatestEntry(entry: VisitEntry, latest: VisitDetail): VisitEntry {
  const drafts: PositionDrafts = {};
  for (const [key, item] of Object.entries(entry.drafts)) {
    if (Number(key) < 0) { drafts[Number(key)] = item; continue; }
    const saved = latest.positions.find(p => p.id === Number(key));
    if (!saved || positionIdentity(saved) !== positionIdentity(item.before)) {
      throw new Error('A drafted position was deleted or its identity changed. Preserve your notes, discard this draft and select the correct position again.');
    }
    drafts[Number(key)] = { before: saved, changes: item.changes };
  }
  return { ...entry, drafts, headerBefore: entry.headerDraft ? latest : entry.headerBefore,
    layoutVersions: entry.layoutIds ? Object.fromEntries(latest.positions.map(p => [p.id, p.updated_at])) : entry.layoutVersions };
}
