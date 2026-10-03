import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/teamGuidance.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { teamGuidance, teamGuidanceWarning } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const tower = (id, visit_id = id) => ({ id, visit_id, tower_id: `Tower-${id}` });
const visit = (id, extra = {}) => ({ id, tower_id: id, rollup: { installed: 6, screened: 6, images_pending: 0, visit_status: 'Ready for review' }, ...extra });
const map = (...towers) => ({ towers });

test('6/6 screened with 13 pending images recommends evidence, never report completion', () => {
  const v = visit(1, { rollup: { installed: 6, screened: 6, images_pending: 13, visit_status: 'Ready for review' } });
  const guide = teamGuidance(map(tower(1)), [v], false);
  assert.equal(guide.reason, 'evidence');
  assert.equal(guide.missingResults, 0);
  assert.equal(guide.missingEvidence, 13);
  assert.equal(guide.screeningReady, 1);
  assert.ok(teamGuidanceWarning(guide, 'report'));
  assert.equal(teamGuidanceWarning(guide, 'history'), null);
});
test('own draft takes priority without changing confirmed totals', () => {
  const v = visit(1);
  const guide = teamGuidance(map(tower(1)), [v], false, new Set([1]));
  assert.equal(guide.reason, 'draft');
  assert.equal(guide.screened, 6);
  assert.equal(v.has_working_draft, undefined);
  assert.match(teamGuidanceWarning(guide, 'report'), /drafts/);
});
test('historical visits never replace the exact current visit or inflate its counts', () => {
  const guide = teamGuidance(map(tower(1, 10)), [visit(1), visit(10, { tower_id: 1, rollup: { installed: 6, screened: 2, images_pending: 8, visit_status: 'Inspection incomplete' } })], false);
  assert.equal(guide.reason, 'screening');
  assert.equal(guide.next.visit.id, 10);
  assert.equal(guide.visits, 2);
  assert.equal(guide.missingResults, 4);
  assert.equal(guide.screened, 2);
});
test('incomplete and unknown data are not treated as ready', () => {
  assert.equal(teamGuidance(undefined, undefined, false).reason, 'loading');
  assert.equal(teamGuidance(map(), [], true).reason, 'unavailable');
  const missing = teamGuidance(map(tower(1)), [visit(1, { tower_id: 2 })], false);
  assert.equal(missing.reason, 'unknown');
  assert.equal(missing.unknown, 1);
  assert.equal(missing.screeningReady, 0);
});
test('empty team asks for assignments but permits legitimate historical review', () => {
  const guide = teamGuidance(map(), [visit(1)], false);
  assert.equal(guide.reason, 'assign');
  assert.ok(teamGuidanceWarning(guide, 'work'));
  assert.equal(teamGuidanceWarning(guide, 'history'), null);
  assert.equal(teamGuidanceWarning(guide, 'report'), null);
});
test('first visit guidance and no-history reminders remain distinct', () => {
  const guide = teamGuidance(map(tower(1, null)), [], false);
  assert.equal(guide.reason, 'start');
  assert.equal(guide.unstarted, 1);
  assert.ok(teamGuidanceWarning(guide, 'history'));
  assert.equal(teamGuidanceWarning(guide, 'settings'), null);
});
test('finish unfinished visits before starting new towers, then review saved work', () => {
  const guide = teamGuidance(map(tower(1), tower(2, null), tower(3)), [visit(1), visit(3, { has_working_draft: true })], false);
  assert.equal(guide.next.tower.id, 3);
  assert.equal(teamGuidance(map(tower(1)), [visit(1)], false).reason, 'review');
});
test('different team inputs do not retain counts, targets or draft flags', () => {
  teamGuidance(map(tower(1)), [visit(1, { has_working_draft: true })], false);
  const guide = teamGuidance(map(tower(9, null)), [], false);
  assert.equal(guide.next.tower.id, 9);
  assert.equal(guide.drafts, 0);
  assert.equal(guide.visits, 0);
});
