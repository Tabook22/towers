import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64');
const changesUrl = compile(await readFile(new URL('../src/utils/positionChanges.ts', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../src/utils/visitWorkflow.ts', import.meta.url), 'utf8')).replace("'./positionChanges'", JSON.stringify(changesUrl));
const { layoutSlots, applySharedAssets, mergePositionDraft, restorePositionDrafts, visitReviewIssues } = await import(compile(source));
const position = { id: 1, visit_id: 62, updated_at: '2026-09-29T10:00:00', ohl: 'OHL1', phase: 'R', string: 'S1',
  installed: true, in_scope: true, screening_result: 'Not inspected', direction: 'Ashoor', images: [],
  manufacturer: null, year_installed: null, insulator_type: null, tmax_c: 28.1, tref_c: 26.5 };

test('layouts enumerate exact six/twelve positions and retain distinct tension directions', () => {
  const six = layoutSlots('Suspension', ['OHL1', 'OHL2'], ['R', 'Y', 'B'], 'Single', ['Ashoor']);
  assert.equal(six.length, 6); assert.ok(six.every(s => s.string === 'S1'));
  const twelve = layoutSlots('Suspension', ['OHL1', 'OHL2'], ['R', 'Y', 'B'], 'Double', ['Ashoor']);
  assert.equal(twelve.length, 12);
  const tension = layoutSlots('Tension', ['OHL1', 'OHL2'], ['R', 'Y', 'B'], 'Double', ['Ashoor', 'Saada']);
  assert.equal(tension.length, 24);
  assert.equal(new Set(tension.map(s => [s.ohl, s.phase, s.string, s.direction].join('|'))).size, 24);
});

test('shared details affect selected assets only and preserve observations and exceptions', () => {
  const positions = [position, { ...position, id: 2, manufacturer: 'Replacement maker' }, { ...position, id: 3 }];
  const before = structuredClone(positions);
  const drafts = applySharedAssets({}, positions, [1, 2], { manufacturer: 'Shared maker', year_installed: 2020, tmax_c: 999, hotspot: 'No' }, true);
  assert.equal(drafts[1].changes.manufacturer, 'Shared maker');
  assert.equal(drafts[2].changes.manufacturer, undefined);
  assert.equal(drafts[2].changes.year_installed, 2020);
  assert.equal(drafts[3], undefined);
  assert.equal(drafts[1].changes.tmax_c, undefined); assert.equal(drafts[1].changes.hotspot, undefined);
  assert.deepEqual(positions, before);
});

test('individual exceptions already in a draft are not overwritten by fill-empty', () => {
  const draft = mergePositionDraft({}, position, { manufacturer: 'Inspected exception' });
  const result = applySharedAssets(draft, [position], [1], { manufacturer: 'Preset' }, true);
  assert.equal(result[1].changes.manufacturer, 'Inspected exception');
});

test('refetches cannot silently rebase a draft onto another inspector’s revision', () => {
  const draft = mergePositionDraft({}, position, { inspector_notes: 'My draft' });
  const result = mergePositionDraft(draft, { ...position, updated_at: 'later', inspector_notes: 'Other inspector' }, { tmax_c: 30 });
  assert.equal(result[1].before.updated_at, position.updated_at);
  assert.equal(result[1].changes.inspector_notes, 'My draft');
  assert.equal(result[1].changes.tmax_c, 30);
});

test('recovery is scoped to this visit and rejects broken storage', () => {
  const drafts = mergePositionDraft({}, position, { inspector_notes: 'Recover me' });
  assert.deepEqual(restorePositionDrafts(JSON.stringify(drafts), 62), drafts);
  assert.deepEqual(restorePositionDrafts(JSON.stringify(drafts), 63), {});
  assert.deepEqual(restorePositionDrafts('{broken', 62), {});
});

test('visit checks ignore excluded slots and flag image date mismatches without modifying metadata', () => {
  const visit = { inspection_date: '2026-09-29', inspector_name: 'Inspector', positions: [
    { ...position, screening_result: 'Normal', images: [{ sequence: 1, evidence_status: 'COMPLETE', file_path: 'original.jpg', capture_date: '2026-09-21' }] },
    { ...position, id: 2, in_scope: false, images: [{ sequence: 1, evidence_status: 'PENDING CAPTURE' }] },
  ] };
  const issues = visitReviewIssues(visit);
  assert.equal(issues.length, 1); assert.match(issues[0], /capture date different/);
  assert.equal(visit.positions[0].images[0].capture_date, '2026-09-21');
});
