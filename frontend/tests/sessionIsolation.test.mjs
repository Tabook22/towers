import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let version = 0;
async function load(path, mocks = {}) {
  globalThis.__sessionMocks = mocks;
  const source = (await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')).replace(/^import .*;\r?$/gm, '').replaceAll('import.meta.env.VITE_API_BASE_URL', 'undefined');
  const header = `const {${Object.keys(mocks).join(',')}} = globalThis.__sessionMocks;\n`;
  const compiled = ts.transpileModule(header + source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(compiled + `\n// ${++version}`).toString('base64'));
}
function signIn(id, token = `token-${id}`) {
  const values = new Map([['iip_user', JSON.stringify({ id, username: `crew${id}` })], ['iip_token', token]]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
}

test('ownership survives token rotation and rejects absent or corrupt identity', async () => {
  const { currentAccountKey, requireSameSession } = await load('auth/session.ts');
  signIn(1); assert.equal(currentAccountKey(), 'user:1');
  signIn(1, 'rotated'); assert.equal(currentAccountKey(), 'user:1');
  assert.throws(() => requireSameSession('token-1'), /Sign-in changed/);
  localStorage.removeItem('iip_token'); assert.equal(currentAccountKey(), null);
  globalThis.localStorage = { getItem: () => '{broken' };
  assert.equal(currentAccountKey(), null);
});

test('overlapping flushes send once and every request carries the original session', async () => {
  signIn(1);
  const session = await load('auth/session.ts');
  let items = [{ id: 'one', ownerKey: 'user:1', kind: 'ping', json: {}, path: {} }];
  let calls = 0; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { flushOutbox } = await load('offline/flush.ts', {
    ...session, sharedApiClient: { post: async (_url, _body, config) => { calls++; assert.equal(config.iipSessionToken, 'token-1'); await pending; } },
    listOutbox: async () => items, deleteOutbox: async () => { items = []; }, markAttempt: async () => {},
    errorMessage: String, isRetryableError: () => false,
  });
  const first = flushOutbox(); const second = flushOutbox();
  assert.equal(first, second); release();
  assert.deepEqual(await first, { sent: 1, remaining: 0, failed: 0 }); assert.equal(calls, 1);
});

test('switching accounts during upload stops the batch and retains unsent work', async () => {
  signIn(1);
  const session = await load('auth/session.ts');
  let calls = 0;
  const items = [1, 2].map(id => ({ id: String(id), ownerKey: 'user:1', kind: 'ping', json: {}, path: {} }));
  const { flushOutbox } = await load('offline/flush.ts', {
    ...session, sharedApiClient: { post: async () => { calls++; signIn(2); } }, listOutbox: async () => items,
    deleteOutbox: async () => assert.fail('Must preserve original work'), markAttempt: async () => assert.fail('Must not alter another account'),
    errorMessage: String, isRetryableError: () => false,
  });
  await assert.rejects(flushOutbox(), /Sign-in changed/); assert.equal(calls, 1); assert.equal(items.length, 2);
});

test('failed replacement keeps the previous queued photo intact', async () => {
  signIn(1);
  const session = await load('auth/session.ts');
  const previous = { id: 'photo', ownerKey: 'user:1', kind: 'image-upload', path: { imageId: 4 }, file: { blob: new Blob(['original']) } };
  const { enqueue } = await load('offline/enqueue.ts', {
    ...session, listOutbox: async () => [previous], getOutbox: async () => previous, newOutboxId: () => 'new',
    putOutbox: async item => { assert.equal(item.id, 'photo'); throw Error('Storage full'); },
    isBrowserOnline: () => false, isRetryableError: () => false,
  });
  await assert.rejects(enqueue({ kind: 'image-upload', path: { imageId: 4 }, file: { blob: new Blob(['replacement']) } }), /Storage full/);
  assert.equal(await previous.file.blob.text(), 'original');
});

test('a delayed network failure never queues old work under the new login', async () => {
  signIn(1);
  const session = await load('auth/session.ts');
  const { sendOrQueue } = await load('offline/enqueue.ts', {
    ...session, listOutbox: async () => [], putOutbox: async () => assert.fail('Must not queue for the new account'),
    isBrowserOnline: () => true, isRetryableError: () => true,
  });
  await assert.rejects(sendOrQueue(async () => { signIn(2); throw Error('Network lost'); }, { kind: 'ping', path: {} }), /Sign-in changed/);
});

test('storage hides other accounts and ownerless records while preserving recovery data', async () => {
  signIn(1);
  const session = await load('auth/session.ts');
  const records = new Map([
    ['a', { id: 'a', ownerKey: 'user:1', createdAt: 1 }],
    ['b', { id: 'b', ownerKey: 'user:2', createdAt: 2 }],
    ['legacy', { id: 'legacy', createdAt: 0 }],
  ]);
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { objectStore: () => ({
          getAll: () => requestFor([...records.values()]), get: id => {
            const request = requestFor(records.get(id)); setTimeout(() => tx.oncomplete?.(), 0); return request;
          },
          delete: id => { records.delete(id); queueMicrotask(() => tx.oncomplete?.()); },
          put: item => { records.set(item.id, item); queueMicrotask(() => tx.oncomplete?.()); },
        }) };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  function requestFor(result) {
    const request = { result }; queueMicrotask(() => request.onsuccess()); return request;
  }
  const db = await load('offline/db.ts', session);
  assert.deepEqual((await db.listOutbox()).map(item => item.id), ['a']);
  assert.equal(await db.getOutbox('b'), undefined);
  await db.deleteOutbox('b'); assert.ok(records.has('b'));
  await assert.rejects(db.putOutbox({ id: 'x', ownerKey: 'user:2' }), /Sign-in changed/);
  const uploading = await db.getOutbox('a');
  await db.putOutbox({ ...uploading, json: { note: 'New edit during upload' } });
  await db.deleteOutbox('a', uploading);
  assert.equal((await db.getOutbox('a')).json.note, 'New edit during upload');
  await db.deleteOutbox('a', await db.getOutbox('a'));
  assert.equal(await db.getOutbox('a'), undefined);
  assert.equal(await db.unownedOutboxCount(), 1);
  signIn(2); assert.deepEqual((await db.listOutbox()).map(item => item.id), ['b']);
  localStorage.removeItem('iip_token'); assert.deepEqual(await db.listOutbox(), []);
  assert.equal(records.size, 2);
});

test('expired requests cannot clear a newer login and queued requests reject session changes', async () => {
  signIn(1);
  const session = await load('auth/session.ts');
  let onRequest; let onError;
  const client = { interceptors: {
    request: { use: fn => { onRequest = fn; } },
    response: { use: (_success, fn) => { onError = fn; } },
  } };
  globalThis.window = { location: { origin: 'https://inspection.example', pathname: '/towers', href: '/towers' } };
  await load('api/client.ts', { ...session, axios: { create: () => client } });
  const oldConfig = onRequest({ headers: {} });
  assert.equal(oldConfig.headers.Authorization, 'Bearer token-1');
  signIn(2);
  await assert.rejects(onError({ response: { status: 401 }, config: oldConfig }));
  assert.equal(localStorage.getItem('iip_token'), 'token-2'); assert.equal(window.location.href, '/towers');
  assert.throws(() => onRequest({ headers: {}, iipSessionToken: 'token-1' }), /Sign-in changed/);
  const currentConfig = onRequest({ headers: {} });
  await assert.rejects(onError({ response: { status: 401 }, config: currentConfig }));
  assert.equal(localStorage.getItem('iip_token'), null); assert.equal(window.location.href, '/login');
});
