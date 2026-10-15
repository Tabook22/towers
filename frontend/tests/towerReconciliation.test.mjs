import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/utils/towerReconciliation.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { matchesTowerCoverage, reconciliationCsv } = exports;
const tower = { id: 1, tower_id: 'T-1', visit_id: null, archive_images: 0, screening_ready: false, four_category_coverage: false, screening_and_evidence_ready: false };

test('no visit and no evidence remain distinct filters', () => {
  assert.ok(matchesTowerCoverage(tower, 'without_visit'));
  assert.ok(matchesTowerCoverage(tower, 'without_evidence'));
  const photoOnly = { ...tower, visit_id: 3, archive_images: 90 };
  assert.ok(!matchesTowerCoverage(photoOnly, 'without_visit'));
  assert.ok(!matchesTowerCoverage(photoOnly, 'without_evidence'));
  assert.ok(matchesTowerCoverage(photoOnly, 'screening'));
  assert.ok(matchesTowerCoverage(photoOnly, 'categories'));
  assert.ok(!matchesTowerCoverage(photoOnly, 'ready'));
});

test('CSV preserves zeros and quotes, and protects formula-like user names', () => {
  const csv = reconciliationCsv([{ name: '=SUM(1,2)', towers: [{ ...tower, tower_id: 'T,"1"' }], outside_assignment: [{ tower_id: '+Other', archive_images: 6 }] }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"T,""1"""'));
  assert.ok(csv.includes('"0"'));
  assert.ok(csv.includes('"\'+Other"'));
  assert.ok(csv.includes('Historical evidence outside current assignment'));
});
