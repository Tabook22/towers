import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/utils/reportPdf.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { generatedWordReport } = exports;
const report = { id: 3, report_number: 'OETC/2026/001', has_file: true };
test('completed Word job resolves its archived report rather than newest history', () => {
  assert.equal(generatedWordReport([{id: 9, report_number:'NEW', has_file:true}, report], 'OETC-2026-001.docx'), report);
  assert.equal(generatedWordReport([report], 'OETC/2026/001.DOCX'), report);
});
test('missing archives, unrelated filenames and non-Word jobs do not expose conversion', () => {
  assert.equal(generatedWordReport([{...report, has_file:false}], 'OETC-2026-001.docx'), undefined);
  for (const name of [undefined, '', 'OTHER.docx', 'OETC-2026-001.pdf']) assert.equal(generatedWordReport([report], name), undefined);
});
test('ambiguous sanitized report numbers never choose the wrong archive', () => {
  assert.equal(generatedWordReport([report, {...report, id:4, report_number:'OETC-2026-001'}], 'OETC-2026-001.docx'), undefined);
});
