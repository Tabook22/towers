import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/reportTower.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { reportTowerLayouts, reportTowerSlot } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const row = (key, fields = {}) => ({ key, fields: { tower: 'T-1', inspection_date: '2026-10-09', ohl: 'OHL1', mount_type: 'Tension', string_count: 'Double', view_side: 'Front', phase: 'R', string: 'S1', direction: 'East', tmax_c: 0, ...fields }, evidence: [{ image_id: 20, image_type: 'TH Full' }] });
test('same named towers, visits, circuits and viewing sides retain independent findings', () => {
 const rows = [row('1:1'), row('2:1'), row('1:2', { ohl: 'OHL2' }), row('1:3', { view_side: 'Back' })];
 const original = JSON.stringify(rows);
 const layouts = reportTowerLayouts(rows);
 assert.equal(layouts.length, 4);
 assert.deepEqual(layouts.flatMap(l => l.rows.map(r => r.key)).sort(), rows.map(r => r.key).sort());
 assert.equal(JSON.stringify(rows), original);
});
test('front/back physical sides swap without borrowing readings or images', () => {
 const layouts = reportTowerLayouts([row('1:1'), row('1:2', { direction: 'West', tmax_c: 20 })]);
 const layout = layouts[0];
 assert.equal(layout.drawable, true);
 assert.equal(reportTowerSlot(layout, 0, 'R', 'S1').fields.tmax_c, 0);
 assert.equal(reportTowerSlot(layout, 1, 'R', 'S1').key, '1:2');
 assert.equal(reportTowerSlot(layout, 0, 'Y', 'S1'), undefined);
 assert.equal(reportTowerSlot({ ...layout, viewSide: 'Back' }, 0, 'R', 'S1').key, '1:2');
});
test('suspension matches circuits rather than directions, retaining both strings', () => {
 const rows = [row('1:1', { mount_type: 'Suspension', direction: 'NA' }), row('1:2', { mount_type: 'Suspension', direction: 'NA', ohl: 'OHL2', string: 'S2' })];
 const layout = reportTowerLayouts(rows)[0];
 assert.equal(layout.drawable, true);
 assert.equal(reportTowerSlot(layout, 1, 'R', 'S2').key, '1:2');
 assert.equal(reportTowerSlot(layout, 0, 'R', 'S2'), undefined);
});
test('ambiguous duplicate slots, gantries and incomplete configurations use cards instead of invented mapping', () => {
 for (const rows of [[row('1:1'), row('1:2')], [row('1:1', { mount_type: 'Gantry' })], [row('1:1', { string_count: null })], [row('1:1', { direction: null })], [row('1:1', { phase: null })], [row('1:1', { mount_type: 'Suspension', ohl: null })]]) {
  const layout = reportTowerLayouts(rows)[0];
  assert.equal(layout.drawable, false);
  assert.equal(layout.rows.length, rows.length);
 }
});
test('single and double arrangements are never collapsed together', () => {
 const layouts = reportTowerLayouts([row('1:1', { string_count: 'Single' }), row('1:2', { string: 'S2' })]);
 assert.equal(layouts.length, 2);
 assert.equal(layouts[0].count, 'Single');
 assert.equal(layouts[1].count, 'Double');
});
