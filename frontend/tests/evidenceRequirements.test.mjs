import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/utils/evidenceRequirements.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const p = { id: 1, installed: true, in_scope: true, images: [{ id: 1, sequence: 1, image_type: 'TH Full', evidence_status: 'NOT REQUIRED', file_path: null }] };
test('only explicit exemptions remove empty required categories, and staged evidence is separate', () => {
  assert.equal(exports.evidenceRequirements([p], ['TH Full'])[0].missing, true);
  const exempt = { ...p, images: [{ ...p.images[0], exemption_reason: 'Optional' }] };
  assert.equal(exports.evidenceRequirements([exempt], ['TH Full'])[0].missing, false);
  assert.equal(exports.evidenceRequirements([exempt], ['TH Full'])[0].waived, true);
  assert.equal(exports.evidenceRequirements([p], ['TH Full'], [{ position_key: 1, image_type: 'TH Full' }])[0].missing, false);
  assert.equal(exports.evidenceRequirements([{ ...p, in_scope: false }], ['TH Full']).length, 0);
  assert.equal(exports.evidenceRequirements([{ ...p, installed: false }], ['TH Full']).length, 0);
});
