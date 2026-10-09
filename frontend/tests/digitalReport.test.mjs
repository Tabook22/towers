import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/digitalReport.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { digitalFindings, filterFindings, groupFindings } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const snapshot = { visits: [
  { id: 1, tower: 'T-10', inspection_date: '2026-09-01', positions: [{ id: 2, phase: 'R', delta_t: 20, inspector_notes: 'Cracked composite', evidence: [] }] },
  { id: 3, tower: 'T-2', inspection_date: '2026-09-02', positions: [{ id: 2, phase: 'Y', delta_t: 5, inspector_notes: 'Normal', evidence: [] }] },
] };
const rows = digitalFindings(snapshot);
test('keys include visit scope and frozen data is not mutated', () => {
  assert.deepEqual(rows.map(row => row.key), ['1:2', '3:2']);
  assert.equal(snapshot.visits[0].positions[0].phase, 'R');
});
test('keyword terms and filters combine, matching across saved fields', () => {
  assert.deepEqual(filterFindings(rows, 'T-10 cracked', { phase: 'R' }, 'tower', false).map(row => row.key), ['1:2']);
  assert.equal(filterFindings(rows, 'cracked', { phase: 'Y' }, 'tower', false).length, 0);
});
test('sorting handles tower numbers and numeric measurements', () => {
  assert.deepEqual(filterFindings(rows, '', {}, 'tower', false).map(row => row.key), ['3:2', '1:2']);
  assert.deepEqual(filterFindings(rows, '', {}, 'delta_t', true).map(row => row.key), ['1:2', '3:2']);
});
test('grouping shows each finding exactly once', () => {
  assert.equal(groupFindings(rows, 'phase').length, 2);
  assert.equal(groupFindings(rows, '')[0][1].length, 2);
});

test('severity sorts most urgent first and keeps unclassified readings last', () => {
  const severityRows = ['Normal', 'Low', 'High / Critical', 'Medium', ''].map((severity, index) => ({ key: String(index), fields: { severity }, evidence: [] }));
  assert.deepEqual(filterFindings(severityRows, '', {}, 'severity', false).map(row => row.fields.severity), ['High / Critical', 'Medium', 'Low', 'Normal', '']);
  assert.equal(filterFindings(severityRows, '', { severity: 'High / Critical' }, 'severity', false).length, 1);
});

test('severity grouping follows urgency regardless of row sort order', () => {
  const severityRows = ['Normal', 'Low', 'High / Critical', 'Medium', 'Normal'].map((severity, index) => ({ key: String(index), fields: { severity }, evidence: [] }));
  const groups = groupFindings(severityRows, 'severity');
  assert.deepEqual(groups.map(([name]) => name), ['High / Critical', 'Medium', 'Low', 'Normal']);
  assert.equal(groups[3][1].length, 2);
  assert.equal(groups.flatMap(([, rows]) => rows).length, severityRows.length);
});
