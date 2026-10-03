import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = file => readFile(new URL(`../src/utils/${file}.ts`, import.meta.url), 'utf8');
const compile = text => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64');
const changes = compile(await source('positionChanges'));
const workflow = compile((await source('visitWorkflow')).replace("'./positionChanges'", JSON.stringify(changes)));
const entryModule = compile((await source('visitEntry')).replace("'./visitWorkflow'", JSON.stringify(workflow)).replace("'./positionChanges'", JSON.stringify(changes)));
const { entryPositions, emptyEntry } = await import(entryModule);
const { mergePositionDraft } = await import(workflow);
const { visitVisualLayout, matchesVisualSlot, visualSides, visualSlots, prepareVisualEntry, editVisualReading, visualScreeningPatch, numericReading } = await import(compile((await source('visualTower')).replace("'./visitEntry'", JSON.stringify(entryModule)).replace("'./visitWorkflow'", JSON.stringify(workflow))));
const slots = visualSlots('OHL1', 'Tension', 'Double', 'Ashoor', 'Saada');

test('front and back use independent identities, readings and draft images while legacy remains unassigned', () => {
  const both = ['Front', 'Back'].flatMap(view_side => visualSlots('OHL1', 'Suspension', 'Double', '', '').map(s => ({ ...s, view_side })));
  let entry = prepareVisualEntry(visit, emptyEntry(), both);
  const front = both.find(s => s.view_side === 'Front');
  const back = both.find(s => s.view_side === 'Back');
  entry = editVisualReading(visit, entry, both, front, { tmax_c: 31, tref_c: 20 });
  entry = editVisualReading(visit, entry, both, back, { tmax_c: 43, tref_c: 20 });
  const all = entryPositions(visit, entry).filter(p => p.in_scope);
  assert.equal(all.length, 24);
  const f = all.find(p => matchesVisualSlot(p, front));
  const b = all.find(p => matchesVisualSlot(p, back));
  assert.notEqual(f.id, b.id);
  assert.equal(f.tmax_c - f.tref_c, 11);
  assert.equal(b.tmax_c - b.tref_c, 23);
  assert.ok(!matchesVisualSlot({ ...f, view_side: undefined }, front));
  assert.equal(all.filter(p => p.tmax_c != null).length, 2);
  const repeat = prepareVisualEntry(visit, entry, both);
  assert.equal(repeat.additions.length, entry.additions.length);
});

test('preparing both views keeps historical unlabelled readings and evidence separate', () => {
  const historical = { ...visit, positions: visit.positions.map((p,i) => i ? p : ({ ...p, direction: 'NA', mount_type: 'Suspension', string_count: 'Single', tmax_c: 55, tref_c: 22, images: [{ id: 501, file_path: 'original.jpg' }] })) };
  const both = ['Front', 'Back'].flatMap(view_side => visualSlots('OHL1', 'Suspension', 'Single', '', '').map(s => ({ ...s, view_side })));
  const entry = prepareVisualEntry(historical, emptyEntry(), both);
  const positions = entryPositions(historical, entry).filter(p => p.in_scope);
  const old = positions.find(p => p.id === historical.positions[0].id);
  assert.equal(old.view_side, undefined);
  assert.equal(old.tmax_c, 55);
  assert.equal(old.images[0].id, 501);
  assert.equal(positions.length, 13);
  assert.ok(positions.filter(p => p.view_side).every(p => p.tmax_c == null && !p.images.length));
});

test('recorded Single configuration overrides stale Double preferences without changing readings or evidence', () => {
  const positions = visualSlots('OHL1', 'Tension', 'Single', 'Saada', 'Ashoor').map((p, i) => ({ ...p, id: i + 1, in_scope: true, tmax_c: 35 + i, images: [{ id: 100 + i }] }));
  const before = structuredClone(positions);
  const layout = visitVisualLayout(positions, { ohl: 'OHL1', count: 'Double', mount: 'Suspension', directionA: 'Ashoor', directionB: 'Ittin', back: true });
  assert.equal(layout.count, 'Single');
  assert.equal(layout.mount, 'Tension');
  assert.equal(layout.directionA, 'Ashoor');
  assert.equal(layout.directionB, 'Saada');
  assert.equal(layout.back, true);
  const drawn = visualSlots(layout.ohl, layout.mount, layout.count, layout.directionA, layout.directionB);
  assert.equal(drawn.length, 6);
  assert.ok(drawn.every(slot => positions.some(p => matchesVisualSlot(p, slot))));
  assert.deepEqual(positions, before);
});

test('switching circuit loads that circuit configuration and ignores inactive positions', () => {
  const positions = [
    ...visualSlots('OHL1', 'Tension', 'Single', 'Saada', 'Ashoor'),
    ...visualSlots('OHL2', 'Tension', 'Double', 'Ittin', 'Thumrait'),
  ];
  const layout = visitVisualLayout([{ ...positions[0], in_scope: false, direction: 'Shahaon' }, ...positions], { ohl: 'OHL2', count: 'Single' });
  assert.equal(layout.ohl, 'OHL2');
  assert.equal(layout.count, 'Double');
  assert.deepEqual([layout.directionA, layout.directionB], ['Ittin', 'Thumrait']);
});

test('new visit keeps optional layout preferences while existing layout never invents a second direction', () => {
  const preference = { ohl: 'OHL2', mount: 'Tension', count: 'Single', directionA: 'Ittin', directionB: 'Thumrait', back: false };
  assert.deepEqual(visitVisualLayout([], preference), preference);
  const layout = visitVisualLayout([{ ohl: 'OHL1', direction: 'Saada', mount_type: 'Tension', string_count: 'Single' }], preference);
  assert.equal(layout.directionA, 'Saada');
  assert.equal(layout.directionB, '');
});
const visit = { id: 1, positions: ['OHL1', 'OHL2'].flatMap(ohl => ['R', 'Y', 'B'].flatMap(phase => ['S1', 'S2'].map(string => ({
  ohl, phase, string, direction: null, mount_type: null, string_count: null, updated_at: 'v1', in_scope: true,
  installed: true, screening_result: 'Not inspected', hotspot: null, tmax_c: null, tref_c: null, images: [],
})))).map((p, index) => ({ ...p, id: index + 1, visit_id: 1 })) };

test('one selected circuit has two distinct directions and 6 or 12 unique positions', () => {
  assert.equal(slots.length, 12);
  assert.deepEqual([...new Set(slots.map(s => s.ohl))], ['OHL1']);
  assert.equal(new Set(slots.map(s => [s.ohl, s.phase, s.string, s.direction].join('|'))).size, 12);
  assert.equal(visualSlots('OHL2', 'Suspension', 'Single', 'Ittin', 'Thumrait').length, 6);
  assert.throws(() => visualSlots('OHL1', 'Tension', 'Double', 'Ashoor', 'Ashoor'), /different/);
});

test('front and back reorder physical sides without changing position identities', () => {
  const readings = { A: { direction: 'Ashoor', tmax_c: 40 }, B: { direction: 'Saada', tmax_c: 28 } };
  assert.deepEqual(visualSides(false).map(side => readings[side].tmax_c), [40, 28]);
  assert.deepEqual(visualSides(true).map(side => readings[side].tmax_c), [28, 40]);
  assert.equal(readings.A.direction, 'Ashoor');
});

test('preparing a second OHL preserves individual readings, image associations and draft revisions', () => {
  let entry = prepareVisualEntry(visit, emptyEntry(), slots);
  const first = entryPositions(visit, entry).find(p => p.direction === 'Ashoor');
  entry.drafts = mergePositionDraft(entry.drafts, first, { tmax_c: 40, tref_c: 30, ...visualScreeningPatch('Hotspot detected') });
  const saved = { ...visit, positions: visit.positions.map(p => p.id === first.id ? { ...p, images: [{ id: 99, file_path: 'original.jpg' }] } : p) };
  entry = prepareVisualEntry(saved, entry, visualSlots('OHL2', 'Tension', 'Double', 'Ittin', 'Thumrait'));
  const all = entryPositions(saved, entry).filter(p => p.in_scope);
  assert.equal(all.length, 24);
  assert.equal(all.find(p => p.id === first.id).tmax_c, 40);
  assert.equal(all.find(p => p.id === first.id).images[0].id, 99);
  assert.equal(entry.drafts[first.id].before.updated_at, 'v1');
  assert.ok(all.filter(p => p.id !== first.id).every(p => p.tmax_c == null));
  assert.equal(visit.positions[0].direction, null);
});

test('reopening a prepared diagram does not duplicate positions or retag existing evidence', () => {
  const entry = prepareVisualEntry(visit, emptyEntry(), slots);
  const repeated = prepareVisualEntry(visit, entry, slots);
  assert.equal(repeated.additions.length, entry.additions.length);
  assert.deepEqual(repeated.layoutIds, entry.layoutIds);
  assert.throws(() => prepareVisualEntry(visit, entry, visualSlots('OHL1', 'Suspension', 'Double', 'Ashoor', 'Saada')), /different tower type/);
});

test('result choice synchronizes hotspot fields and measurements alone never mark a position inspected', () => {
  assert.deepEqual(visualScreeningPatch('Hotspot detected'), { installed: true, screening_result: 'Hotspot detected', hotspot: 'Yes' });
  assert.equal(visualScreeningPatch('Normal').hotspot, 'No');
  assert.equal(visualScreeningPatch('Not installed').installed, false);
  const entry = prepareVisualEntry(visit, emptyEntry(), slots);
  const p = entryPositions(visit, entry)[0];
  entry.drafts = mergePositionDraft(entry.drafts, p, { tmax_c: 40, tref_c: 30 });
  assert.equal(entryPositions(visit, entry)[0].screening_result, 'Not inspected');
});

test('reading conversion preserves zero and negative values and rejects nonfinite numbers', () => {
  assert.equal(numericReading('0'), 0);
  assert.equal(numericReading('-2.5'), -2.5);
  assert.equal(numericReading(''), null);
  assert.throws(() => numericReading('Infinity'), /valid numeric/);
  assert.throws(() => numericReading('invalid'), /valid numeric/);
});

test('first reading creates the layout and subsequent S1/S2 edits stay independent without preparation', () => {
  let entry = editVisualReading(visit, emptyEntry(), slots, slots[0], { tmax_c: 41.5 });
  entry = editVisualReading(visit, entry, slots, slots[0], { tref_c: 30 });
  entry = editVisualReading(visit, entry, slots, slots[1], { tmax_c: 36, tref_c: 31 });
  const all = entryPositions(visit, entry).filter(p => p.in_scope);
  assert.equal(all.length, 12);
  const s1 = all.find(p => p.phase === 'R' && p.string === 'S1' && p.direction === 'Ashoor');
  const s2 = all.find(p => p.phase === 'R' && p.string === 'S2' && p.direction === 'Ashoor');
  assert.equal(s1.tmax_c - s1.tref_c, 11.5);
  assert.equal(s2.tmax_c - s2.tref_c, 5);
  assert.equal(s1.screening_result, 'Not inspected');
  assert.equal(entry.drafts[s1.id].before.updated_at, 'v1');
});

test('a selected side can accept readings before the second direction is chosen', () => {
  const side = slots.filter(p => p.direction === 'Ashoor');
  let entry = editVisualReading(visit, emptyEntry(), side, side[0], { tmax_c: 0, tref_c: -2.5 });
  entry = editVisualReading(visit, entry, slots, slots[6], { tmax_c: 20 });
  const all = entryPositions(visit, entry).filter(p => p.in_scope);
  assert.equal(all.length, 12);
  assert.equal(all.find(p => p.direction === 'Ashoor' && p.phase === 'R' && p.string === 'S1').tref_c, -2.5);
  assert.throws(() => editVisualReading(visit, entry, [], { ...side[0], direction: '' }, { tmax_c: 5 }), /direction/);
  assert.equal(visit.positions[0].tmax_c, null);
});

test('legacy R S1 readings remain visible and editable when configuration is missing', () => {
  const legacy = { ...visit.positions[0], direction: 'Ashoor', tmax_c: 1, tref_c: 1,
    images: [{ id: 99, file_path: 'original.jpg' }], inspector_notes: 'Existing note' };
  const saved = { ...visit, positions: [legacy] };
  assert.equal(matchesVisualSlot(legacy, slots[0]), true);
  let entry = editVisualReading(saved, emptyEntry(), slots, slots[1], { tmax_c: 3, tref_c: 3 });
  entry = editVisualReading(saved, entry, slots, slots[0], { tmax_c: 42, tref_c: 31 });
  const result = entryPositions(saved, entry).find(p => p.id === legacy.id);
  assert.equal(matchesVisualSlot(result, slots[0]), true);
  assert.equal(result.tmax_c - result.tref_c, 11);
  assert.equal(result.mount_type, 'Tension');
  assert.equal(result.string_count, 'Double');
  assert.equal(result.tower_proximity, 'Outer');
  assert.equal(result.images[0].id, 99);
  assert.equal(result.inspector_notes, 'Existing note');
  assert.equal(entry.drafts[legacy.id].before.updated_at, 'v1');
  assert.equal(entry.additions.length, 11);
  assert.equal(legacy.mount_type, null);
  assert.equal(legacy.tmax_c, 1);
});

test('missing configuration is compatible but conflicting known configuration is not', () => {
  const base = { ...visit.positions[0], ...slots[0] };
  assert.equal(matchesVisualSlot({ ...base, string_count: null }, slots[0]), true);
  assert.equal(matchesVisualSlot({ ...base, mount_type: null }, slots[0]), true);
  for (const mismatch of [{ mount_type: 'Suspension' }, { string_count: 'Single' }]) {
    const position = { ...base, ...mismatch };
    assert.equal(matchesVisualSlot(position, slots[0]), false);
    assert.throws(() => editVisualReading({ ...visit, positions: [position] }, emptyEntry(), slots, slots[0], { tmax_c: 42 }), /different tower type/);
  }
});

test('Suspension covers both OHL sides once, with no directional duplication', () => {
  const single = visualSlots('OHL1', 'Suspension', 'Single', '', '');
  const double = visualSlots('OHL2', 'Suspension', 'Double', 'Ashoor', 'Saada');
  assert.equal(single.length, 6);
  assert.equal(double.length, 12);
  assert.deepEqual([...new Set(single.map(p => p.ohl))], ['OHL1','OHL2']);
  assert.ok(double.every(p => p.direction === 'NA'));
  let entry = editVisualReading(visit, emptyEntry(), double, double[0], { tmax_c: 40, tref_c: 30 });
  entry = editVisualReading(visit, entry, double, double[6], { tmax_c: 35, tref_c: 31 });
  const all = entryPositions(visit, entry).filter(p => p.in_scope);
  assert.equal(all.length, 12);
  assert.equal(all.find(p => p.ohl === 'OHL1' && p.phase === 'R' && p.string === 'S1').tmax_c, 40);
  assert.equal(all.find(p => p.ohl === 'OHL2' && p.phase === 'R' && p.string === 'S1').tmax_c, 35);
  assert.equal(visualSlots('OHL1','Gantry','Double','Ashoor','Saada').length, 0);
});

test('legacy Suspension reuses its identity and image links; ambiguous history is never merged', () => {
  const old = { ...visit.positions[0], direction: 'Ashoor', mount_type: 'Suspension', string_count: 'Double', tmax_c: 28, images: [{ id: 99, file_path: 'keep.jpg' }] };
  const saved = { ...visit, positions: [old] };
  const layout = visualSlots('OHL1', 'Suspension', 'Double', '', '');
  const entry = editVisualReading(saved, emptyEntry(), layout, layout[0], { tref_c: 24 });
  const current = entryPositions(saved, entry).find(p => p.id === old.id);
  assert.equal(current.direction, 'Ashoor');
  assert.equal(current.images[0].id, 99);
  assert.equal(current.tmax_c, 28);
  assert.equal(current.tref_c, 24);
  assert.equal(entry.additions.length, 11);
  assert.throws(() => prepareVisualEntry({ ...saved, positions: [old, { ...old, id: 90, direction: 'Saada' }] }, emptyEntry(), layout), /Multiple historical/);
});
