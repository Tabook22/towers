import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Use the project's existing compiler; no additional test runner dependency is needed.
const source = await readFile(new URL('../src/utils/reportLibrary.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { selectReports, emptyReportFilters, reportTimestamp, reportError } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const rows = [
  { id: 2, report_number: 'R-10', team_id: 2, team_name: 'Team 10', tower_id: 10, tower_name: 'T-10', start_date: '2026-09-10', end_date: '2026-09-20', created_at: '2026-09-22T23:30:00', report_type: 'tower' },
  { id: 1, report_number: 'R-2', team_id: 1, team_name: 'Team 2', scope_towers: [{ id: 2, name: 'T-2' }, { id: 3, name: 'T-3' }], start_date: '2026-09-01', end_date: '2026-09-30', created_at: '2026-09-23T00:00:00', report_type: 'team' },
];
const select = (filters = {}, key = 'created_at', direction = 'desc') => selectReports(rows, { ...emptyReportFilters, ...filters }, key, direction).map(r => r.id);

test('natural team, tower and report sorting; newest first', () => {
  for (const key of ['team_name', 'tower_name', 'report_number']) assert.deepEqual(select({}, key, 'asc'), [1, 2]);
  assert.deepEqual(select(), [1, 2]);
});
test('tower filtering includes towers inside a team report', () => assert.deepEqual(select({ tower: '3' }), [1]));
test('search and combined filters are case insensitive and scope aware', () => {
  assert.deepEqual(select({ search: ' t-3 ', team: '1', type: 'team' }), [1]);
  assert.deepEqual(select({ search: 't-3', team: '2' }), []);
});
test('date filters include overlapping periods and boundary dates', () => {
  assert.deepEqual(select({ from: '2026-09-20', to: '2026-09-20' }), [1, 2]);
  assert.deepEqual(select({ from: '2026-09-21' }), [1]);
});
test('timestamps without an offset are interpreted as UTC', () => {
  assert.equal(reportTimestamp('2026-09-23T00:00:00').toISOString(), '2026-09-23T00:00:00.000Z');
  assert.equal(reportTimestamp('2026-09-23T04:00:00+04:00').toISOString(), '2026-09-23T00:00:00.000Z');
});
test('download errors preserve the server explanation inside a blob', async () => {
  assert.equal(await reportError({ response: { data: new Blob(['{"detail":"Report no longer exists"}']) } }, 'Fallback'), 'Report no longer exists');
  assert.equal(await reportError({ response: { data: new Blob(['not json']) } }, 'Fallback'), 'Fallback');
});
