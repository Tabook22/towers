import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/visitGuidance.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { nextVisitGuidance } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const check = (target, positionIds = []) => ({ target, positionIds, message: target });

test('missing visit identity precedes evidence and screening without discarding checks', () => {
  const checks = [check('evidence', [3]), check('screening', [3]), check('inspector_name'), check('inspection_date')];
  const before = structuredClone(checks);
  assert.equal(nextVisitGuidance(checks, 6).check.target, 'inspection_date');
  assert.equal(nextVisitGuidance(checks.filter(c => c.target !== 'inspection_date'), 6).check.target, 'inspector_name');
  assert.deepEqual(checks, before);
});
test('an empty checklist is setup, never falsely ready for review', () => {
  const next = nextVisitGuidance([], 0);
  assert.equal(next.step, 2);
  assert.equal(next.task, 'Set up the tower drawing');
});
test('hotspot readings keep the exact affected position identity', () => {
  const next = nextVisitGuidance([check('screening', [8]), check('temperatures', [41, 42]), check('evidence', [8, 41])], 12);
  assert.equal(next.check.target, 'temperatures');
  assert.deepEqual(next.check.positionIds, [41, 42]);
});
test('the next recommendation advances only when its actual check disappears', () => {
  const screening = check('screening', [5]), evidence = check('evidence', [9]);
  assert.equal(nextVisitGuidance([screening, evidence], 6).check, screening);
  assert.equal(nextVisitGuidance([evidence], 6).check, evidence);
  assert.equal(nextVisitGuidance([evidence], 6).step, 3);
});
test('capture date discrepancies remain actionable after evidence is complete', () => {
  const next = nextVisitGuidance([check('capture_dates', [17])], 6);
  assert.equal(next.check.target, 'capture_dates');
  assert.equal(next.step, 3);
});
test('clear checks recommend review without claiming report approval', () => {
  const next = nextVisitGuidance([], 6);
  assert.equal(next.step, 4);
  assert.match(next.why, /report-specific fields/);
  assert.match(next.why, /not report approval/);
});
