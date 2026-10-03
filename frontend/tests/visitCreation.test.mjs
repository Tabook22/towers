import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/api/visitCreation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
let moduleId = 0;
const fresh = () => import('data:text/javascript;base64,' + Buffer.from(compiled + `\n// ${++moduleId}`).toString('base64'));
const storage = () => {
  const items = new Map([['iip_user', JSON.stringify({ id: 1 })]]);
  return { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key), items };
};

test('lost response and refresh reuse the stored token; confirmed repeat gets a new token', async () => {
  const device = storage(); const attempts = []; const payload = { tower_id: 12, inspection_date: '2026-10-03' };
  const first = await fresh();
  await assert.rejects(first.createVisitWithToken('/api/visits', payload, async body => { attempts.push(body); throw Error('Response lost'); }, device));
  const refreshed = await fresh();
  await refreshed.createVisitWithToken('/api/visits', { inspection_date: payload.inspection_date, tower_id: 12 }, async body => { attempts.push(body); return { id: 5 }; }, device);
  assert.equal(attempts[0].request_token, attempts[1].request_token);
  assert.equal(device.items.size, 1);
  await refreshed.createVisitWithToken('/api/visits', payload, async body => { attempts.push(body); return { id: 6 }; }, device);
  assert.notEqual(attempts[2].request_token, attempts[0].request_token);
});

test('pending attempts are scoped by account, endpoint and inspection details', async () => {
  const { createVisitWithToken } = await fresh(); const device = storage(); const tokens = [];
  const fail = async body => { tokens.push(body.request_token); throw Error('Lost response'); };
  await assert.rejects(createVisitWithToken('/api/visits', { tower_id: 1 }, fail, device));
  await assert.rejects(createVisitWithToken('/api/visits', { tower_id: 2 }, fail, device));
  await assert.rejects(createVisitWithToken('/api/teams/1/missions', { tower_id: 1 }, fail, device));
  device.setItem('iip_user', JSON.stringify({ id: 2 }));
  await assert.rejects(createVisitWithToken('/api/visits', { tower_id: 1 }, fail, device));
  assert.equal(new Set(tokens).size, 4);
});

test('blocked browser storage retains the token for in-memory retries', async () => {
  const { createVisitWithToken } = await fresh(); const tokens = [];
  const unavailable = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); }, removeItem() { throw Error('Blocked'); } };
  for (let i = 0; i < 2; i++) await assert.rejects(createVisitWithToken('/api/visits', { tower_id: 1 }, async body => {
    tokens.push(body.request_token); throw Error('Response lost');
  }, unavailable));
  assert.equal(tokens[0], tokens[1]);
});

test('retry after a fresh GPS fix sends the original body with the original token', async () => {
  const device = storage(); const bodies = [];
  const first = await fresh();
  await assert.rejects(first.createVisitWithToken('/api/visits', { tower_id: 1, latitude: 17, longitude: 54 }, async body => {
    bodies.push(body); throw Error('Lost response');
  }, device));
  const reloaded = await fresh();
  await reloaded.createVisitWithToken('/api/visits', { tower_id: 1, latitude: 17.0001, longitude: 54.0001 }, async body => {
    bodies.push(body); return { id: 1 };
  }, device);
  assert.deepEqual(bodies[0], bodies[1]);
});

test('confirmed deletion is shown as an error and requires a fresh user action', async () => {
  const { createVisitWithToken } = await fresh(); const device = storage(); const tokens = [];
  await assert.rejects(createVisitWithToken('/api/visits', { tower_id: 1 }, async body => {
    tokens.push(body.request_token); throw { response: { status: 410 } };
  }, device));
  assert.equal(tokens.length, 1);
  await createVisitWithToken('/api/visits', { tower_id: 1 }, async body => {
    tokens.push(body.request_token); return { id: 2 };
  }, device);
  assert.notEqual(tokens[0], tokens[1]);
});
