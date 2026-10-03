import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';
import * as React from 'react';

const source = await readFile(new URL('../src/utils/towerLines.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const lines = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const towers = [
  { id: 1, line_sector: 'Ashoor-Saada' }, { id: 2, line_sector: null },
  { id: 3, line_sector: '' }, { id: 4, line_sector: '  ' },
  { id: 5, line_sector: ' Saada-Shahaon ' }, { id: 6, line_sector: 'No line sector' },
];
test('null, empty and whitespace line fields form one explicit unassigned group', () => {
  const summary = lines.towerLineSummary(towers);
  assert.equal(summary.find(item => item.id === lines.UNASSIGNED_LINE).value, 3);
  assert.equal(summary.find(item => item.id === 'No line sector').value, 1);
  assert.equal(summary.reduce((total, item) => total + item.value, 0), towers.length);
});
test('each chart group drills down to exactly its counted rows without mutating records', () => {
  const original = JSON.stringify(towers);
  for (const group of lines.towerLineSummary(towers)) {
    assert.equal(lines.towersOnLine(towers, group.id).length, group.value);
  }
  assert.deepEqual(lines.towersOnLine(towers, lines.UNASSIGNED_LINE).map(t => t.id), [2, 3, 4]);
  assert.equal(lines.towersOnLine(towers, ''), towers);
  assert.equal(JSON.stringify(towers), original);
});
test('three project choices remain available even with empty search results, retaining legacy labels', () => {
  assert.deepEqual(lines.towerLineOptions([]), ['Ashoor-Saada', 'Saada-Shahaon', 'Ittin-Thumrait']);
  assert.ok(lines.towerLineOptions(towers).includes('No line sector'));
  assert.ok(!lines.towerLineOptions(towers).includes(lines.UNASSIGNED_LINE));
});
test('a tower ID never becomes an automatic line assignment', () => {
  assert.equal(lines.towerLineKey({ tower_id: 'Ittin-Thumrait-2', line_sector: null }), lines.UNASSIGNED_LINE);
});

// Render the real chart component into an element tree, replacing only UI shells.
const chartSource = await readFile(new URL('../src/components/HorizontalBarChart.tsx', import.meta.url), 'utf8');
const chartCode = ts.transpileModule(chartSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exported = {};
vm.runInNewContext(chartCode, { exports: exported, require: name => {
  if (name === 'react/jsx-runtime') {
    const jsx = (type, props, key) => React.createElement(type, { ...props, key });
    return { jsx, jsxs: jsx };
  }
  if (name === '@mui/material') return { Box: 'box', ButtonBase: 'button', Stack: 'stack', Typography: 'text' };
  if (name === '../i18n') return { tr: value => value, useLanguage: () => {} };
  throw new Error(name);
} });
function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(nodes)];
}
test('interactive rows are native keyboard buttons with stable IDs, pressed state and callbacks', () => {
  const data = [{ id: 'line-a', label: 'A', value: 10, color: '#123' }];
  let chosen;
  const root = exported.HorizontalBarChart({ data, onSelect: row => { chosen = row; }, selectedId: 'line-a', selectionLabel: () => 'View A towers' });
  const button = nodes(root).find(node => node.type === 'button');
  assert.equal(button.props['aria-pressed'], true);
  assert.equal(button.props['aria-label'], 'View A towers');
  button.props.onClick(); assert.equal(chosen, data[0]);
});
test('existing read-only chart consumers stay non-interactive', () => {
  const root = exported.HorizontalBarChart({ data: [{ label: 'Team', value: 0, color: '#123' }] });
  assert.ok(!nodes(root).some(node => node.type === 'button'));
});
