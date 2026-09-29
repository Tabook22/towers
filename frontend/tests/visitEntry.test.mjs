import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64');
const changes = compile(await readFile(new URL('../src/utils/positionChanges.ts', import.meta.url), 'utf8'));
const workflow = compile((await readFile(new URL('../src/utils/visitWorkflow.ts', import.meta.url), 'utf8')).replace("'./positionChanges'", JSON.stringify(changes)));
const { emptyEntry, entryPositions, addEntryPosition, prepareEntryLayout, entryHasChanges, compareLatestEntry } = await import(compile((await readFile(new URL('../src/utils/visitEntry.ts', import.meta.url), 'utf8')).replace("'./visitWorkflow'", JSON.stringify(workflow))));
const { layoutSlots, mergePositionDraft } = await import(workflow);
const slots = layoutSlots('Suspension', ['OHL1', 'OHL2'], ['R', 'Y', 'B'], 'Double', ['Ashoor']);
const visit = { id: 62, positions: slots.map((s, index) => ({ ...s, id: index + 1, visit_id: 62, updated_at: '2026-09-29T10:00:00', direction: null, mount_type: null, string_count: null, installed: true, screening_result: 'Not inspected', images: [], in_scope: true })) };

test('layout is a draft: baseline identities and saved visit stay untouched', () => {
  const original = JSON.stringify(visit);
  const state = prepareEntryLayout(visit, emptyEntry(), slots.filter(s => s.string === 'S1'), false);
  assert.equal(JSON.stringify(visit), original);
  assert.equal(state.layoutIds.length, 6);
  assert.equal(state.additions.length, 0);
  assert.equal(entryPositions(visit, state).filter(p => p.in_scope).length, 6);
  assert.ok(entryHasChanges(state));
});
test('new directions have stable independent draft IDs before server confirmation', () => {
  let state = prepareEntryLayout(visit, emptyEntry(), slots, false);
  state = addEntryPosition(visit, state, { ...slots[0], direction: 'Saada' });
  assert.equal(state.additions[0].id, -1);
  state = addEntryPosition(visit, state, { ...slots[1], direction: 'Saada' });
  assert.equal(state.additions[1].id, -2);
  assert.equal(state.layoutIds.length, 14);
  assert.throws(() => addEntryPosition(visit, state, { ...slots[0], direction: 'Saada' }), /already/);
});
test('existing observations cannot be hidden by a draft layout', () => {
  const recorded = { ...visit, positions: visit.positions.map(p => p.id === 2 ? { ...p, inspector_notes: 'Preserve this finding' } : p) };
  assert.throws(() => prepareEntryLayout(recorded, emptyEntry(), slots.filter(s => s.string === 'S1'), false), /Include all/);
});
test('position edits and header recovery survive serializing a whole visit draft', () => {
  let state = prepareEntryLayout(visit, emptyEntry(), slots, true);
  const position = visit.positions[1];
  state.drafts = mergePositionDraft(state.drafts, position, { inspector_notes: 'Inner only' });
  state.headerDraft = { inspector_name: 'Sample inspector' };
  state.headerBefore = { id: 62, updated_at: 'old' };
  const recovered = JSON.parse(JSON.stringify(state));
  assert.equal(recovered.headerDraft.inspector_name, 'Sample inspector');
  const positions = entryPositions(visit, recovered);
  assert.equal(positions[1].inspector_notes, 'Inner only');
  assert.equal(positions[0].inspector_notes, undefined);
  assert.equal(recovered.drafts[2].before.updated_at, position.updated_at);
});
test('repeat layout changes retain the original saved revision', () => {
  const state = prepareEntryLayout(visit, emptyEntry(), slots, false);
  const reloaded = { ...visit, positions: visit.positions.map(p => ({ ...p, updated_at: 'newer' })) };
  const changed = prepareEntryLayout(reloaded, state, slots, true);
  assert.equal(changed.layoutVersions[1], visit.positions[0].updated_at);
});


test('explicit latest comparison preserves proposals and refreshes only their saved baseline', () => {
  const state = emptyEntry();
  state.drafts = mergePositionDraft({}, visit.positions[0], { inspector_notes: 'My proposed finding' });
  state.headerDraft = { inspector_name: 'Inspector A' };
  const latest = { ...visit, updated_at: 'new-header', positions: visit.positions.map(p => ({ ...p, updated_at: 'new-position', inspector_notes: 'Colleague finding' })) };
  const compared = compareLatestEntry(state, latest);
  assert.equal(compared.drafts[1].before.inspector_notes, 'Colleague finding');
  assert.equal(compared.drafts[1].changes.inspector_notes, 'My proposed finding');
  assert.equal(compared.headerBefore.updated_at, 'new-header');
  assert.equal(state.drafts[1].before.updated_at, visit.positions[0].updated_at);
  assert.throws(() => compareLatestEntry(state, { ...latest, positions: latest.positions.map(p => ({ ...p, direction: 'Different' })) }), /identity changed/);
});

test('removing the final staged file still requires confirmation of the exclusion', () => {
  assert.ok(entryHasChanges({ ...emptyEntry(), excludedImages: [24] }));
});
