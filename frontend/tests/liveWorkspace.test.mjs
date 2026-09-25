import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function moduleURL(name, replacements = {}) {
  let source = await readFile(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(`'${from}'`, `'${to}'`);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const boardURL = await moduleURL('liveBoard');
const { validMark, safeFilename } = await import(boardURL);
const recorderURL = await moduleURL('liveRecorder', { './liveBoard': boardURL });
const { LiveWorkspace } = await import(await moduleURL('liveWorkspace', { './liveBoard': boardURL, './liveRecorder': recorderURL }));
class Channel extends EventTarget {
  readyState = 'open'; bufferedAmount = 0; sent = [];
  send(text) { this.sent.push(JSON.parse(text)); queueMicrotask(() => this.peer.dispatchEvent(new MessageEvent('message', { data: text }))); }
  inject(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ workspace: 1, ...data }) })); }
}
const settle = () => new Promise(r => setTimeout(r, 20));
async function pair(t) {
  const a = new LiveWorkspace(), b = new LiveWorkspace(), ac = new Channel(), bc = new Channel(); ac.peer = bc; bc.peer = ac;
  a.connect(ac); b.connect(bc); await settle();
  t.after(() => { a.disconnect(); b.disconnect(); });
  return { a, b, ac, bc };
}
const mark = id => ({ id, color: '#163e4c', width: 4, order: 1, points: [[.1, .2], [.3, .4]] });
test('drawing validation rejects oversized or non-finite peer input and unsafe file paths', () => {
  assert.equal(validMark(mark('one')), true);
  assert.equal(validMark({ ...mark('one'), points: [[NaN, .1]] }), false);
  assert.equal(validMark({ ...mark('one'), points: Array(513).fill([.1, .1]) }), false);
  assert.equal(validMark({ ...mark('one'), text: 'x'.repeat(161) }), false);
  assert.equal(safeFilename('../report\\draft.pdf'), '.._report_draft.pdf');
});
test('both participants draw and undo only their own strokes; duplicate packets are harmless', async t => {
  const { a, b, ac } = await pair(t);
  a.addMark(mark('a')); b.addMark(mark('b')); await settle();
  assert.deepEqual(a.getSnapshot().marks.map(m => m.id).sort(), ['a', 'b']);
  assert.deepEqual(b.getSnapshot().marks.map(m => m.id).sort(), ['a', 'b']);
  assert.deepEqual(a.getSnapshot().marks, b.getSnapshot().marks);
  ac.inject({ type: 'remove-mark', id: 'a' }); assert.equal(a.getSnapshot().marks.length, 2);
  a.undo(); await settle(); assert.deepEqual(b.getSnapshot().marks.map(m => m.id), ['b']);
  ac.inject({ type: 'mark', mark: mark('b') }); assert.equal(a.getSnapshot().marks.length, 1);
});
test('document transfer requires acceptance and delivers exact bytes, including multiple chunks', async t => {
  const { a, b, ac } = await pair(t);
  const bytes = Uint8Array.from({ length: 50001 }, (_, i) => i % 251);
  a.offerFile(new File([bytes], 'inspection.pdf'));
  await settle(); const id = b.getSnapshot().files[0].id;
  assert.equal(ac.sent.filter(p => p.type === 'file-chunk').length, 0);
  b.acceptFile(id); await settle(); await settle();
  assert.equal(a.getSnapshot().files[0].status, 'ready');
  const f = b.getSnapshot().files[0]; assert.equal(f.status, 'ready');
  assert.deepEqual(new Uint8Array(await f.blob.arrayBuffer()), bytes);
});
test('declining sends no file bytes and interrupted or out-of-order chunks never become downloadable', async t => {
  const { a, b, ac, bc } = await pair(t);
  a.offerFile(new File(['hello'], 'first.txt')); await settle(); b.cancelFile(b.getSnapshot().files[0].id); await settle();
  assert.equal(ac.sent.some(p => p.type === 'file-chunk'), false);
  bc.inject({ type: 'file-offer', id: 'malformed', name: 'report.pdf', size: 20 }); b.acceptFile('malformed');
  bc.inject({ type: 'file-chunk', id: 'malformed', sequence: 9, data: 'aGVsbG8=' });
  assert.equal(b.getSnapshot().files.at(-1).status, 'failed'); assert.equal(b.getSnapshot().files.at(-1).blob, undefined);
});
test('oversized offers are ignored; incomplete files are failed on disconnect', async t => {
  const { a, b, bc } = await pair(t);
  bc.inject({ type: 'file-offer', id: 'huge', name: 'large.pdf', size: 21 * 1024 * 1024 });
  assert.equal(b.getSnapshot().files.length, 0);
  a.offerFile(new File(['hello'], 'small.txt')); await settle(); b.disconnect();
  assert.equal(b.getSnapshot().files[0].status, 'failed');
});
test('recording cannot start before consent; approval and revocation propagate to both people', async t => {
  const { a, b, ac } = await pair(t);
  assert.throws(() => a.startRecording(), /permission/);
  ac.inject({ type: 'record-allow', id: 'unsolicited' }); assert.equal(a.getSnapshot().phase, 'idle');
  a.requestRecording(); await settle(); assert.equal(b.getSnapshot().phase, 'requested');
  b.answerRecording(true); await settle(); assert.equal(a.getSnapshot().phase, 'approved');
  assert.equal(b.getSnapshot().phase, 'peer-approved');
  b.stopRecording(); await settle(); assert.equal(a.getSnapshot().phase, 'idle'); assert.equal(b.getSnapshot().phase, 'idle');
});
test('simultaneous recording requests cancel safely and consent does not survive a new session', async t => {
  const { a, b } = await pair(t);
  a.requestRecording(); b.requestRecording(); await settle();
  assert.equal(a.getSnapshot().phase, 'idle'); assert.equal(b.getSnapshot().phase, 'idle');
  a.requestRecording(); await settle(); b.answerRecording(true); await settle(); a.disconnect();
  assert.equal(a.getSnapshot().phase, 'idle'); assert.throws(() => a.startRecording(), /permission/);
});
