import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/api/reportGeneration.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, setTimeout, require: name => name === 'axios' ? { isAxiosError: error => error.isAxiosError } : {} });
const { followReportJob, estimateRemaining } = exports;
const job = { id: 'existing-job', status: 'queued', percent: 0, stage: 'Waiting to start' };

test('remaining-time estimates require measurable work and never invent a countdown', () => {
  assert.equal(estimateRemaining(0, 100, 20), null);
  assert.equal(estimateRemaining(1, 100, 20), null);
  assert.equal(estimateRemaining(20, 100, 2), null);
  assert.equal(estimateRemaining(20, 100, 10), 40);
  assert.equal(estimateRemaining(50, 100, 10), 10);
  assert.equal(estimateRemaining(100, 100, 10), null);
  assert.equal(estimateRemaining(1000, 0, 10), null);
});

test('report polling displays server progress and stops only at a terminal status', async () => {
  const updates = [], ids = [];
  const replies = [{ ...job, status: 'running', percent: 42, stage: 'Preparing findings and photos' }, { ...job, status: 'complete', percent: 100, stage: 'Report ready' }];
  const result = await followReportJob(job, async id => { ids.push(id); return replies.shift(); }, value => updates.push(value), () => {}, async () => {});
  assert.equal(result.status, 'complete');
  assert.deepEqual(ids, ['existing-job', 'existing-job']);
  assert.deepEqual(updates.map(value => value.percent), [0, 42, 100]);
});

test('network and maintenance interruptions resume the same job without inventing progress', async () => {
  const updates = [], connections = [];
  let attempts = 0;
  const result = await followReportJob({ ...job, status: 'running', percent: 37 }, async id => {
    assert.equal(id, 'existing-job');
    if (++attempts === 1) throw new Error('Connection lost');
    if (attempts === 2) throw { isAxiosError: true, response: { status: 503 } };
    return { ...job, status: 'complete', percent: 100 };
  }, value => updates.push(value), value => connections.push(value), async () => {});
  assert.equal(result.percent, 100);
  assert.deepEqual(updates.map(value => value.percent), [37, 100]);
  assert.deepEqual(connections, [true, true, false]);
});

test('permission loss ends polling rather than retrying a forbidden report indefinitely', async () => {
  const denied = { isAxiosError: true, response: { status: 403 } };
  await assert.rejects(followReportJob(job, async () => { throw denied; }, () => {}, () => {}, async () => {}), error => error === denied);
});

test('failed generation keeps the server percentage and explanation', async () => {
  const failed = { ...job, status: 'failed', percent: 61, error: 'Could not save report' };
  const result = await followReportJob(job, async () => failed, () => {}, () => {}, async () => {});
  assert.equal(result.percent, 61);
  assert.equal(result.error, 'Could not save report');
});
