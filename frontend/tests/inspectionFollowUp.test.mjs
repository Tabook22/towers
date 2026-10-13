import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/inspectionFollowUp.ts', import.meta.url), 'utf8');
const { latestInspection, unfinishedScreening, missingPositionEvidence } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64'));
const p = (id, changes = {}) => ({ id, installed: true, in_scope: true, screening_result: 'Not inspected', images: [], ...changes });
test('screening blockers match backend rollup, including null results and excluding out of scope and absent insulators', () => {
  assert.deepEqual(unfinishedScreening([p(1), p(2, { screening_result: null }), p(3, { installed: false }), p(4, { in_scope: false }), p(5, { screening_result: 'Normal' }), p(6, { screening_result: 'Inconclusive' })]).map(p => p.id), [1, 2]);
});
test('latest visit uses inspection date then ID without mutating history', () => {
  const visits = [{ id: 9, inspection_date: null }, { id: 1, inspection_date: '2026-10-14' }, { id: 2, inspection_date: '2026-10-14' }, { id: 10, inspection_date: '2026-10-13' }];
  assert.equal(latestInspection(visits).id, 2);
  assert.equal(visits[0].id, 9);
  assert.equal(latestInspection([]), undefined);
});
test('evidence gaps accept uploaded alternate sequences and documented exemptions, but reject empty exemptions and recapture files', () => {
  const position = p(1, { images: [
    { image_type: 'Full', sequence: 2, file_path: 'photo', evidence_status: 'COMPLETE' },
    { image_type: 'Close', sequence: 1, evidence_status: 'NOT REQUIRED', exemption_reason: 'Not accessible' },
    { image_type: 'Thermal', sequence: 1, file_path: 'photo', evidence_status: 'RECAPTURE REQUIRED' },
    { image_type: 'Other', sequence: 1, evidence_status: 'NOT REQUIRED' },
  ] });
  assert.deepEqual(missingPositionEvidence(position, ['Full', 'Close', 'Thermal', 'Other']), ['Thermal', 'Other']);
  assert.deepEqual(missingPositionEvidence({ ...position, installed: false }, ['Thermal']), []);
});
