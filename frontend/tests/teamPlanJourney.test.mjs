import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/teamPlanJourney.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { planStepBlock } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const day = '2026-10-02';
const plan = { team_id: 2, field_date: day, tower_ids: [5] };
const visit = { team_id: 2, inspection_date: day, tower_id: 5, rollup: { screened: 1, images_pending: 4 } };
test('planning stays reachable while missing data is never treated as a missing plan', () => {
  assert.equal(planStepBlock('planning', 2, day, undefined, undefined, true), null);
  assert.equal(planStepBlock('work', 2, day, undefined, []), 'unavailable');
  assert.equal(planStepBlock('work', 2, day, plan, [], true), 'unavailable');
});
test('an empty saved tower list directs both later steps to planning', () => {
  for (const step of ['work', 'history']) assert.equal(planStepBlock(step, 2, day, { ...plan, tower_ids: [] }, [visit]), 'plan');
});
test('a matching plan opens inspection; review requires actual confirmed screening', () => {
  assert.equal(planStepBlock('work', 2, day, plan, []), null);
  assert.equal(planStepBlock('history', 2, day, plan, []), 'inspection');
  assert.equal(planStepBlock('history', 2, day, plan, [{ ...visit, has_working_draft: true, rollup: { screened: 0 } }]), 'inspection');
  assert.equal(planStepBlock('history', 2, day, plan, [visit]), null);
});
test('other teams, dates and towers cannot satisfy the selected plan', () => {
  for (const patch of [{ team_id: 3 }, { inspection_date: '2026-10-01' }, { tower_id: 6 }]) {
    assert.equal(planStepBlock('history', 2, day, plan, [{ ...visit, ...patch }]), 'inspection');
  }
  assert.equal(planStepBlock('work', 3, day, plan, [visit]), 'unavailable');
  assert.equal(planStepBlock('work', 2, '2026-10-01', plan, [visit]), 'unavailable');
});
test('unavailable visit progress prompts verification, never a false empty-work claim', () => {
  assert.equal(planStepBlock('history', 2, day, plan, undefined), 'unavailable');
  assert.equal(planStepBlock('history', 2, day, plan, [{ ...visit, rollup: null }]), 'unavailable');
});
