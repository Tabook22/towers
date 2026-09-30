import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as React from 'react';

const root = new URL('../src/', import.meta.url);
const arabic = JSON.parse(fs.readFileSync(new URL('i18n/ar.json', root), 'utf8'));
function load(file, imports = {}, globals = {}) {
  const source = fs.readFileSync(new URL(file, root), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, ...globals });
  return exports;
}
const storage = new Map();
const document = { documentElement: {} };
const storageListeners = {};
const i18n = load('i18n/index.ts', { react: React, './ar.json': arabic }, {
  document, navigator: { language: 'en-US' },
  localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  window: { addEventListener: (event, handler) => { storageListeners[event] = handler; } },
});
const inspection = load('i18n/inspection.ts', { './index': i18n });

test('language choice persists and sets both HTML language and reading direction', () => {
  i18n.setLanguage('ar');
  assert.equal(storage.get('iip_language'), 'ar');
  assert.equal(document.documentElement.lang, 'ar');
  assert.equal(document.documentElement.dir, 'rtl');
  storageListeners.storage({ key: 'iip_language', newValue: 'en' });
  assert.equal(i18n.getLanguage(), 'en');
  assert.equal(document.documentElement.dir, 'ltr');
});
test('technical glossary preserves codes, interpolation, zero and original notes', () => {
  assert.equal(i18n.translate('Phase', 'ar'), 'الطور');
  assert.equal(i18n.translate('OHL1', 'ar'), 'OHL1');
  assert.equal(i18n.translate('shed pending', 'ar'), 'shed pending');
  assert.equal(i18n.translate('Select {0}', 'ar', ['Normal &apos; OHL1-R-S1-Ashoor']), 'تحديد Normal &apos; OHL1-R-S1-Ashoor');
  assert.equal(i18n.translate('No record: {0}', 'en', [0]), 'No record: 0');
  assert.equal(i18n.translate("Inspector&apos;s note", 'en'), "Inspector's note");
  assert.equal(i18n.translate(null, 'ar'), '');
  assert.equal(i18n.translate('Unknown server message', 'ar'), 'Unknown server message');
  i18n.setLanguage('ar');
  assert.equal(inspection.inspectionValue('inspector_notes', 'Normal'), 'Normal');
  assert.equal(inspection.inspectionValue('manufacturer', 'High'), 'High');
  assert.equal(inspection.inspectionValue('direction', 'Ashoor'), 'Ashoor');
  assert.equal(inspection.inspectionValue('tmax_c', 0), '0');
  assert.equal(inspection.inspectionValue('screening_result', 'Normal'), arabic.Normal);
  assert.equal(inspection.inspectionValue('installed', false), arabic.No);
  assert.equal(inspection.inspectionValue('visual_indications', 'cracks,shed pending'), `${arabic.cracks}، shed pending`);
  i18n.setLanguage('en');
});
test('all catalog translations retain interpolation arguments and valid Arabic text', () => {
  const placeholders = text => [...new Set(text.match(/\{\d+\}/g) || [])].sort();
  const errors = [];
  for (const [key, value] of Object.entries(arabic)) {
    if (JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))) errors.push(key);
    assert.ok(value && !value.includes('\ufffd'), `Invalid translation: ${key}`);
  }
  assert.deepEqual(errors, []);
});
test('all authored static interface translation keys have Arabic entries', () => {
  const missing = new Set();
  function literals(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (/[a-zA-Z]/.test(node.text) && !(node.text.trim() in arabic)) missing.add(node.text.trim());
    } else if (ts.isConditionalExpression(node)) { literals(node.whenTrue); literals(node.whenFalse); }
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(tree) === 'tr' && node.arguments[0]) literals(node.arguments[0]);
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
  walk(fileURLToPath(new URL('../src/', import.meta.url)));
  assert.deepEqual([...missing].sort(), []);
});
