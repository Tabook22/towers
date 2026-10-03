import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/towerAttention.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { towerAttentionItems } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const row = (patch = {}) => ({ tower: { id: 1, tower_id: 'Tower 1', assigned_team_id: 2 }, latest_visit: { id: 3, team_id: 2, mission_status: 'planned', status: 'open' }, rollup: { screened: 0, installed: 12, hotspots: 0, images_pending: 24, visit_status: 'Inspection incomplete' }, ...patch });

test('finished missions stay off the board; assigned unvisited towers remain actionable', () => {
  const items = towerAttentionItems([row({ latest_visit: { mission_status: 'completed' } }), row({ latest_visit: { mission_status: 'planned', status: 'closed' } }), row({ latest_visit: null }), row({ latest_visit: null, tower: { id: 2, assigned_team_id: null } })], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].stage, 'planned');
  assert.equal(items[0].href, '/towers/1');
  assert.equal(items[0].action, 'Start inspection');
});

test('ready screening with pending evidence stays visible and directs staff to evidence', () => {
  const item = towerAttentionItems([row({ rollup: { screened: 12, installed: 12, completion_pct: 100, visit_status: 'Ready for review', images_pending: 13 } })], [])[0];
  assert.equal(item.stage, 'review');
  assert.equal(item.action, 'Add evidence');
  assert.equal(item.href, '/visits/3');
  assert.equal(towerAttentionItems([row({ rollup: { visit_status: 'Ready for review', images_pending: 0 } })], [])[0].action, 'Review visit');
});

test('partial screening overrides planned scheduling, and missing rollups are not treated as complete', () => {
  assert.equal(towerAttentionItems([row({ rollup: { screened: 1 } })], [])[0].stage, 'progress');
  const unknown = towerAttentionItems([row({ rollup: null })], [])[0];
  assert.equal(unknown.action, 'Open visit');
  assert.notEqual(unknown.stage, 'review');
});

test('visit ownership survives tower reassignment without silently attributing old work to the new team', () => {
  const item = towerAttentionItems([row({ tower: { id: 1, tower_id: 'Tower 1', assigned_team_id: 4 } })], [{ id: 2, name: 'Original crew' }, { id: 4, name: 'New crew' }])[0];
  assert.equal(item.teamId, 2);
  assert.equal(item.teamName, 'Original crew');
  assert.equal(item.reassigned, true);
  assert.equal(item.assignedName, 'New crew');
});

test('unassigned work stays explicit and team IDs are retained when names are unavailable', () => {
  assert.equal(towerAttentionItems([row()], [])[0].teamId, 2);
  const item = towerAttentionItems([row({ tower: { id: 1, tower_id: 'T1', assigned_team_id: null }, latest_visit: { id: 3, team_id: null, mission_status: 'planned' } })], [])[0];
  assert.equal(item.teamId, null);
  assert.equal(item.teamName, null);
});

test('hotspots sort first without mutating the dashboard source', () => {
  const low = row();
  const high = row({ tower: { id: 9, tower_id: 'Tower 9' }, rollup: { hotspots: 5 } });
  const source = [low, high];
  assert.equal(towerAttentionItems(source, [])[0].tower.id, 9);
  assert.equal(source[0], low);
});
