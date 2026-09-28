import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/dashboardTowerHistory.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { filterTowerHistory, sortTowerHistory, towerHistoryOptions, visitDateLabel, UNRECORDED } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
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

const history = [
  { tower: { id: 1, tower_id: 'T10', area: 'Saada', assigned_team_id: 2 }, visits: [
    { id: 1, team_id: 1, team_name: 'Alpha', inspection_date: '2026-09-20', has_field_activity: true },
    { id: 2, team_id: 2, team_name: 'Bravo', inspection_date: '2026-10-01', has_field_activity: false },
  ] },
  { tower: { id: 2, tower_id: 'T2', area: 'Ashoor-Saada' }, visits: [
    { id: 3, team_id: 1, team_name: 'Alpha', inspection_date: null, has_field_activity: true },
    { id: 4, team_id: 1, team_name: 'Alpha', inspection_date: '2026-09-28', has_field_activity: true },
  ] },
  { tower: { id: 3, tower_id: 'T1', area: null }, visits: [] },
];
test('line and team filters combine and team activity is not borrowed from another crew', () => {
  const result = filterTowerHistory(history, 'visited', '', 'Saada', '1');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].visits.map(v => v.id), [1]);
  assert.deepEqual(filterTowerHistory(history, 'visited', '', 'Saada', '2'), []);
  assert.deepEqual(filterTowerHistory(history, 'all', '', 'Saada', '2')[0].visits.map(v => v.id), [2]);
  assert.deepEqual(filterTowerHistory(history, 'all', '', UNRECORDED), [history[2]]);
  assert.equal(history[0].visits.length, 2);
});
test('team sorting groups actual visit rows and keeps dates newest first with unknown dates last', () => {
  const before = structuredClone(history);
  assert.deepEqual(sortTowerHistory(history, 'team').map(row => row.visit?.id ?? null), [4, 3, 1, 2, null]);
  assert.deepEqual(sortTowerHistory(history, 'line').map(row => row.visit?.id ?? null), [4, 3, 2, 1, null]);
  assert.deepEqual(sortTowerHistory(history, 'tower').map(row => row.tower.tower_id), ['T1', 'T2', 'T2', 'T10', 'T10']);
  assert.deepEqual(history, before);
});
test('team identities stay distinct even with duplicate names and missing values are selectable', () => {
  const duplicates = [{tower: {id: 1, area: null}, visits: [
    {team_id: 1, team_name: 'Crew'}, {team_id: 2, team_name: 'Crew'}, {team_id: null, team_name: null},
  ]}];
  assert.deepEqual(towerHistoryOptions(duplicates), {
    lines: [{value: UNRECORDED, label: 'Line not recorded'}],
    teams: [{value: '1', label: 'Crew (#1)'}, {value: '2', label: 'Crew (#2)'}, {value: UNRECORDED, label: 'Team not recorded'}],
  });
  assert.equal(filterTowerHistory(duplicates, 'all', '', '', '1')[0].visits.length, 1);
  assert.equal(filterTowerHistory(duplicates, 'all', '', '', UNRECORDED)[0].visits.length, 1);
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
