import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/components/towerMapPins.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({ divIcon: x => x }) });
test('visited badge and adjacent evidence question are independent of team colour', () => {
  const icon = (completed, missingEvidence) => exports.assignmentPinIcon({ towerId: 'T-79', teamId: 2, teamName: 'Crew', completed, missingEvidence }).html;
  assert.ok(icon(true, true).includes('tower-pin-check'));
  assert.ok(icon(true, true).includes('tower-pin-question'));
  assert.ok(icon(true, true).includes('Visit recorded'));
  assert.ok(!icon(true, false).includes('tower-pin-question'));
  assert.ok(!icon(false, true).includes('tower-pin-question'));
  assert.ok(!icon(false, false).includes('tower-pin-check'));
});
