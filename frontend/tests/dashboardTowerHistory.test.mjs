import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/dashboardTowerHistory.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { filterTowerHistory, visitDateLabel } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const rows = [
  { tower: { tower_id: 'T2', area: 'North' }, visits: [{ id: 1, team_name: 'Old crew', inspector_name: 'Ali', has_field_activity: true }, { id: 2, team_name: 'New crew', has_field_activity: false }] },
  { tower: { tower_id: 'T10', area: 'North' }, visits: [{ id: 3, team_name: 'New crew', has_field_activity: false }] },
  { tower: { tower_id: 'T20', area: 'South' }, visits: [] },
];
test('visited filter excludes planned-only and empty towers while preserving history', () => {
  assert.deepEqual(filterTowerHistory(rows, 'visited', ''), [rows[0]]);
  assert.deepEqual(filterTowerHistory(rows, 'unvisited', ''), rows.slice(1));
  assert.deepEqual(filterTowerHistory(rows, 'all', ''), rows);
});
test('search finds historical crews, inspectors and areas, including case and whitespace', () => {
  assert.deepEqual(filterTowerHistory(rows, 'all', ' OLD CREW '), [rows[0]]);
  assert.deepEqual(filterTowerHistory(rows, 'all', 'ali'), [rows[0]]);
  assert.deepEqual(filterTowerHistory(rows, 'all', 'south'), [rows[2]]);
  assert.deepEqual(filterTowerHistory(rows, 'visited', 'T10'), []);
});
test('missing dates stay explicit and calendar dates do not shift across timezones', () => {
  assert.equal(visitDateLabel(null), 'Date not recorded');
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try { assert.equal(visitDateLabel('2026-09-28'), '28 Sept 2026'); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
