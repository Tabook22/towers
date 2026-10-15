import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/utils/reportTowerCards.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { reportTowerSummary, validTowerCoordinates } = exports;
const snapshot = { visits: [
  { tower: 'Tower-1', inspection_date: '2026-10-14', latitude: 17.2, longitude: 54.3, area: 'Saved area', positions: [{ severity: 'High', evidence: [{}, {}] }, { severity: 'Normal', evidence: [{}] }] },
  { tower: 'Tower-1', inspection_date: '2026-10-01', positions: [{ severity: 'Critical', evidence: [] }] },
  { tower: 'Other tower', inspection_date: '2026-10-14', positions: [{ severity: 'High', evidence: [{}] }] },
] };
test('summary uses only this tower’s saved visits and evidence', () => {
  const summary = reportTowerSummary('Tower-1', snapshot);
  assert.equal(summary.visits, 2); assert.equal(summary.positions, 3);
  assert.equal(summary.photographs, 3); assert.equal(summary.urgent, 2);
  assert.equal(summary.firstDate, '2026-10-01'); assert.equal(summary.lastDate, '2026-10-14');
});
test('catalog location is preferred and inspection fallback is identified', () => {
  const catalog = reportTowerSummary('Tower-1', snapshot, { latitude: 18, longitude: 55 });
  assert.equal(catalog.latitude, 18); assert.equal(catalog.locationSource, 'catalog');
  const recorded = reportTowerSummary('Tower-1', snapshot);
  assert.equal(recorded.latitude, 17.2); assert.equal(recorded.locationSource, 'inspection');
});
test('missing snapshots and coordinates are not presented as known values', () => {
  const unknown = reportTowerSummary('Tower-1', null);
  assert.equal(unknown.visits, null); assert.equal(unknown.photographs, null);
  assert.equal(unknown.latitude, null); assert.equal(unknown.locationSource, null);
  assert.equal(reportTowerSummary('Absent tower', snapshot).positions, 0);
});
test('invalid, non-finite and placeholder coordinates cannot create a pin', () => {
  for (const coordinates of [[0, 0], [91, 55], [17, 181], [NaN, 55], [17, Infinity], ['17', 55], [null, 55]]) assert.equal(validTowerCoordinates(...coordinates), false);
  assert.equal(validTowerCoordinates(0, 54), true);
});
