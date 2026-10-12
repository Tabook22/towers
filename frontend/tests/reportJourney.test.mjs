import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`;
const digital = url(await readFile(new URL('../src/utils/digitalReport.ts', import.meta.url), 'utf8'));
const journey = (await readFile(new URL('../src/utils/reportJourney.ts', import.meta.url), 'utf8')).replaceAll("from './digitalReport'", `from '${digital}'`);
const { numericReading, priorityFindings, journeyTowers, thermalEvidenceIndex, comparisonEvidence, reportMetricTotals } = await import(url(journey));
const row = (key, tower, severity, delta_t) => ({ key, fields: { tower, severity, delta_t }, evidence: [] });

test('priority follows recorded severity before temperature and leaves missing classifications separate', () => {
  const rows = [row('1', 'T-1', null, 100), row('2', 'T-2', 'Normal', 80), row('3', 'T-3', 'High', 10), row('4', 'T-4', 'Critical', 20), row('5', 'T-5', 'Medium', 50)];
  assert.deepEqual(priorityFindings(rows).map(r => r.key), ['4', '3', '5', '2', '1']);
  assert.deepEqual(rows.map(r => r.key), ['1', '2', '3', '4', '5']);
});

test('missing measurements stay missing and zero remains a valid recorded reading', () => {
  for (const value of [null, undefined, '', '  ', true, 'invalid', Infinity]) assert.equal(numericReading(value), null);
  assert.equal(numericReading(0), 0);
  assert.equal(numericReading('17.4'), 17.4);
});

test('tower navigation includes repeated visits and orders by worst recorded severity', () => {
  const rows = [row('1:1', 'T-10', 'Normal', 1), row('2:1', 'T-2', 'High', 9), row('3:1', 'T-10', 'Medium', 5), row('4:1', 'T-3', null, null)];
  const towers = journeyTowers(rows);
  assert.deepEqual(towers.map(t => [t.tower, t.rank]), [['T-2', 0], ['T-10', 1], ['T-3', 4]]);
  assert.deepEqual(towers[1].findings.map(r => r.key), ['3:1', '1:1']);
  assert.equal(towers.flatMap(t => t.findings).length, rows.length);
});

test('thermal previews use thermal evidence rather than relabelling a visual photograph', () => {
  const finding = row('1', 'T-1', 'High', 5);
  finding.evidence = [{ image_type: 'RGB Full' }, { image_type: 'TH Close' }];
  assert.equal(thermalEvidenceIndex(finding), 1);
  finding.evidence = [{ image_type: 'RGB Full' }];
  assert.equal(thermalEvidenceIndex(finding), -1);
});

test('comparison pairs full and close thermal/visual images without changing their archived indexes', () => {
  const finding = { evidence: ['TH Full', 'TH Close', 'RGB Full', 'RGB Close', 'Additional'].map(image_type => ({ image_type })) };
  assert.deepEqual(comparisonEvidence(finding).map(r => r.index), [0, 2, 1, 3, 4]);
  assert.deepEqual(finding.evidence.map(r => r.image_type), ['TH Full', 'TH Close', 'RGB Full', 'RGB Close', 'Additional']);
});

test('report metric totals count entries, distinct named towers, recorded urgent severity and image references', () => {
  const rows = [row('1:1', 'T-1', 'High', 1), row('2:1', 'T-1', 'Critical', 2), row('3:1', 'T-2', 'Normal', 100), row('4:1', '', null, 200)];
  rows[0].evidence = [{ image_id: 10 }, { image_id: 11 }];
  rows[1].evidence = [{ image_id: 10 }];
  assert.deepEqual(reportMetricTotals(rows), [4, 2, 2, 3]);
  assert.deepEqual(reportMetricTotals([]), [0, 0, 0, 0]);
});
