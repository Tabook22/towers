import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/teamActivityCharts.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { teamFieldStats, activityTrend, categoryTowers } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const zero = { planned: 0, visited: 0, recorded: 0, finished: 0, reported: 0 };
const tower = (id, flags = {}) => ({ id, name: `T-${id}`, reports: [], visit_ids: [], ...flags });
const day = (date, towers, has_mission = false) => ({ date, towers, has_mission,
  counts: Object.fromEntries(Object.keys(zero).map(k => [k, towers.filter(t => t[k]).length])) });
const team = days => ({ id: 1, name: 'Alpha', days, report_towers: [], counts: zero });

test('visit days count real activity, excluding mission-only days and draft records', () => {
  const stats = teamFieldStats(team([
    day('2026-09-01', [tower(1, { planned: true, recorded: true })], true),
    day('2026-09-02', [tower(2, { visited: true, finished: true })]),
    day('2026-09-03', [tower(3, { visited: true, recorded: true })]),
  ]));
  assert.equal(stats.visitDays, 2);
  assert.equal(stats.recordingDays, 2);
  assert.equal(stats.missionDays, 1);
  assert.equal(stats.completion, 50);
  assert.equal(stats.visitsPerDay, 1);
});

test('repeat visits count in daily workload but only once in the completion pie', () => {
  const stats = teamFieldStats(team([
    day('2026-09-01', [tower(1, { visited: true }), tower(2, { visited: true })]),
    day('2026-09-02', [tower(1, { visited: true, finished: true })]),
  ]));
  assert.equal(stats.visitDays, 2);
  assert.equal(stats.visitTotal, 3);
  assert.equal(stats.visitsPerDay, 1.5);
  assert.equal(stats.visited, 2);
  assert.equal(stats.finishedVisits, 1);
  assert.equal(stats.unfinishedVisits, 1);
  assert.equal(stats.completion, 50);
});

test('no visits has no completion percentage; report-only dates do not become visit days', () => {
  const stats = teamFieldStats(team([day('2026-09-01', [tower(1, { reported: true })])]));
  assert.equal(stats.visitDays, 0);
  assert.equal(stats.visitsPerDay, 0);
  assert.equal(stats.completion, null);
  assert.equal(stats.finishedVisits + stats.unfinishedVisits, 0);
});

test('daily trend includes zero dates and aggregates teams without claiming globally unique towers', () => {
  const teams = [team([day('2026-09-01', [tower(1, { visited: true })])]), team([day('2026-09-01', [tower(1, { visited: true })])])];
  const rows = activityTrend(teams, '2026-09-01', '2026-09-03');
  assert.deepEqual(rows.map(r => r.date), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.deepEqual(rows.map(r => r.counts.visited), [2, 0, 0]);
  assert.deepEqual(activityTrend([], '2024-02-28', '2024-03-01').map(r => r.date), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(activityTrend([], '2026-09-02', '2026-09-01').length, 0);
});

test('chart drill-down merges evidence and uses saved report scope, including undated reports', () => {
  const report = { id: 4, number: 'R-4' };
  const data = team([
    day('2026-09-01', [tower(1, { visited: true, visit_ids: [10], reports: [report] })]),
    day('2026-09-02', [tower(1, { finished: true, visit_ids: [11], reports: [report] })]),
  ]);
  data.report_towers = [tower(9, { reports: [report] })];
  const [row] = categoryTowers(data, 'visited');
  assert.equal(row.finished, true);
  assert.deepEqual(row.visit_ids, [10, 11]);
  assert.deepEqual(row.reports, [report]);
  assert.deepEqual(categoryTowers(data, 'reported').map(t => t.id), [9]);
});
