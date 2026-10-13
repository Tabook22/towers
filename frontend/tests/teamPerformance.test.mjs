import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/teamPerformance.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { teamPerformance, towerDataStatus, towerRemainingWork } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const tower = { visit_id: 1, screening_and_evidence_ready: false, screening_ready: false, four_category_coverage: false, installed_positions: 6, archive_images: 1 };

test('categories partition assigned towers; evidence alone does not mean complete', () => {
  const rows = [{ ...tower, screening_and_evidence_ready: true }, tower, { ...tower, visit_id: null, archive_images: 4 }];
  assert.deepEqual(teamPerformance(rows), { assigned: 3, complete: 1, inProgress: 1, noVisit: 1, remaining: 2, percent: 33.3 });
  assert.equal(towerDataStatus(rows[2]), 'no_visit');
});

test('the screenshot teams retain exact assigned, ready and remaining totals', () => {
  for (const [assigned, ready, noVisit, remaining, percent] of [[88,66,2,22,75],[28,1,1,27,3.6],[141,53,3,88,37.6]]) {
    const rows = Array.from({ length: assigned }, (_, i) => ({ ...tower, screening_and_evidence_ready: i < ready, visit_id: i >= assigned-noVisit ? null : 1 }));
    const stats = teamPerformance(rows);
    assert.equal(stats.remaining, remaining); assert.equal(stats.percent, percent);
    assert.equal(stats.complete + stats.inProgress + stats.noVisit, assigned);
  }
});

test('remaining checklist states the missing work without fabricating a field visit', () => {
  assert.deepEqual(towerRemainingWork({ ...tower, visit_id: null }), ['No visit recorded']);
  assert.deepEqual(towerRemainingWork(tower), ['Screening needs work', 'Four-category gaps']);
  assert.deepEqual(towerRemainingWork({ ...tower, installed_positions: 0, archive_images: 0 }), ['No installed positions recorded', 'No archived evidence']);
  assert.deepEqual(towerRemainingWork({ ...tower, screening_and_evidence_ready: true }), []);
});

test('a team with no assigned towers has zero progress and no remaining work', () => {
  assert.deepEqual(teamPerformance([]), { assigned: 0, complete: 0, noVisit: 0, inProgress: 0, remaining: 0, percent: 0 });
});
