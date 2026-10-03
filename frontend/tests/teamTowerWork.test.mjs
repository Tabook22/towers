import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/teamTowerWork.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { towerWorkState, localInspectionDate, dailyVisitProgress, hasDeviceVisitDraft } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const tower = { id: 66, visit_id: 20, status: 'completed' };
const visit = (id, status) => ({ id, tower_id: 66, mission_status: 'planned', rollup: { visit_status: status } });

test('work opens the exact visit selected by the server, not an earlier ready visit', () => {
  const result = towerWorkState(tower, [visit(10, 'Ready for review'), visit(20, 'Inspection incomplete')]);
  assert.equal(result.visit.id, 20);
  assert.equal(result.status, 'in_progress');
});
test('inspection readiness is independent of scheduling and map status labels', () => {
  assert.equal(towerWorkState({ ...tower, status: 'in_progress' }, [visit(20, 'Ready for review')]).status, 'ready');
  assert.equal(towerWorkState(tower, [{ ...visit(20, 'Inspection incomplete'), mission_status: 'completed' }]).status, 'in_progress');
});
test('missing or mismatched visit data never claims that an inspection is ready', () => {
  assert.equal(towerWorkState(tower, []).status, 'unknown');
  assert.equal(towerWorkState(tower, [{ ...visit(20, 'Ready for review'), tower_id: 19 }]).status, 'unknown');
  assert.equal(towerWorkState(tower, [{ id: 20, tower_id: 66 }]).status, 'unknown');
});
test('unvisited assigned towers offer the first inspection', () => {
  assert.equal(towerWorkState({ ...tower, visit_id: null }, []).status, 'pending');
});
test('new inspection defaults to the Oman calendar date at midnight, independent of device timezone', () => {
  assert.equal(localInspectionDate(new Date('2026-10-02T19:59:59Z')), '2026-10-02');
  assert.equal(localInspectionDate(new Date('2026-10-02T20:00:00Z')), '2026-10-03');
  assert.equal(localInspectionDate(new Date('2026-12-31T20:00:00Z')), '2027-01-01');
});

test('daily progress counts repeat visits individually and excludes other inspection dates', () => {
  const visits = [
    { ...visit(1, 'Ready for review'), inspection_date: '2026-09-30', rollup: { visit_status: 'Ready for review', images_pending: 2 } },
    { ...visit(2, 'Inspection incomplete'), mission_status: 'completed', inspection_date: '2026-09-30', rollup: { visit_status: 'Inspection incomplete', images_pending: 48 } },
    { ...visit(3, 'Ready for review'), inspection_date: '2026-09-29' },
    { ...visit(4, 'Ready for review'), inspection_date: null },
  ];
  assert.deepEqual(dailyVisitProgress(visits, '2026-09-30'), { total: 2, ready: 1, incomplete: 1, unknown: 0, imagesPending: 50 });
  assert.equal(dailyVisitProgress(visits, '').total, 0);
});

test('missing daily rollups remain unknown instead of becoming completed or incomplete', () => {
  assert.deepEqual(dailyVisitProgress([{ id: 5, inspection_date: '2026-10-01' }], '2026-10-01'),
    { total: 1, ready: 0, incomplete: 0, unknown: 1, imagesPending: 0 });
});


test('a private draft offers Continue even if the last confirmed inspection was ready', () => {
  const saved = { ...visit(20, 'Ready for review'), has_working_draft: true };
  assert.equal(towerWorkState(tower, [saved]).status, 'in_progress');
  assert.equal(saved.rollup.visit_status, 'Ready for review');
});


test('device draft badge distinguishes empty, changed, and uncertain copies without claiming confirmation', () => {
  assert.equal(hasDeviceVisitDraft(null), false);
  assert.equal(hasDeviceVisitDraft('{broken'), false);
  assert.equal(hasDeviceVisitDraft(JSON.stringify({ entry: { drafts: {}, additions: [], headerDraft: null, layoutIds: null, excludedImages: [] } })), false);
  assert.equal(hasDeviceVisitDraft(JSON.stringify({ entry: { drafts: { 1: { changes: { tmax_c: 0 } } } } })), true);
  assert.equal(hasDeviceVisitDraft(JSON.stringify({ entry: {}, commitToken: 'unconfirmed' })), true);
});
