import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function moduleFrom(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { positionPatch, positionChangeRows, positionError } = await moduleFrom(await readFile(new URL('../src/utils/positionChanges.ts', import.meta.url), 'utf8'));
const saved = { id:1, ohl:'OHL1', phase:'R', string:'S1', direction:'Ashoor', string_count:'Single', installed:true, screening_result:'Not inspected', hotspot:null, tower_proximity:null, inspector_notes:'Original note', tmax_c:0 };

test('draft edits never mutate the saved inspection; review contains only real changes', () => {
  const original = structuredClone(saved);
  const patch = positionPatch(saved, { phase:'Y', inspector_notes:'Corrected note', tmax_c:0 });
  assert.deepEqual(saved, original);
  assert.deepEqual(patch, { phase:'Y', inspector_notes:'Corrected note' });
  assert.deepEqual(positionChangeRows(saved, patch), [
    { key:'phase', label:'Phase', before:'R', after:'Y' },
    { key:'inspector_notes', label:'Inspector notes', before:'Original note', after:'Corrected note' },
  ]);
});
test('unchanged and discarded drafts have nothing to save', () => {
  assert.deepEqual(positionPatch(saved, {}), {});
  assert.deepEqual(positionPatch(saved, { phase:'R', hotspot:'' }), {});
});
test('review includes screening changes that the server derives from hotspot and installed', () => {
  assert.deepEqual(positionPatch(saved, { hotspot:'Yes' }), { screening_result:'Hotspot detected', hotspot:'Yes' });
  assert.deepEqual(positionPatch(saved, { installed:false }), { installed:false, screening_result:'Not installed' });
});
test('string configuration review includes its dependent proximity correction', () => {
  assert.deepEqual(positionPatch(saved, { string_count:'Double', string:'S2' }), { string:'S2', string_count:'Double', tower_proximity:'Inner' });
});
test('clearing a report field and zero temperatures are accurately represented', () => {
  const patch = positionPatch(saved, { inspector_notes:null, tmax_c:35 });
  assert.equal(positionChangeRows(saved, patch).find(row => row.key === 'tmax_c').before, '0');
  assert.equal(positionChangeRows(saved, patch).find(row => row.key === 'inspector_notes').after, 'Not set');
});
test('failure feedback preserves server conflicts and offline/sync explanations', () => {
  assert.equal(positionError({ response:{data:{detail:'Position already exists'}} }, 'fallback'), 'Position already exists');
  assert.equal(positionError({ userMessage:'Waiting for sync' }, 'fallback'), 'Waiting for sync');
  assert.equal(positionError(new Error('Network Error'), 'Save not confirmed'), 'Save not confirmed');
});

test('confirmed saves never enter the offline queue or report success on a failed request', async () => {
  const calls = [];
  let blocked = false, fail = false;
  globalThis.__positionTest = {
    useMutation: options => options, useQueryClient: () => ({invalidateQueries:async()=>{}}),
    requireConfirmedPositionWrite: async () => { if (blocked) throw Error('Pending sync'); },
    apiClient: {patch:async (path, payload)=> { calls.push({path,payload}); if(fail) throw Error('Network failed'); return {data:{...saved,...payload}}; }},
    sendOrQueue: () => assert.fail('A confirmed save must not silently queue'),
    isQueued: () => false, patchVisitCache: () => {},
  };
  const source = await readFile(new URL('../src/api/hooks.ts', import.meta.url), 'utf8');
  const hook = source.slice(source.indexOf('export function useUpdatePosition('), source.indexOf('// Adds an additional direction'));
  const { useUpdatePosition } = await moduleFrom('const {useMutation,useQueryClient,requireConfirmedPositionWrite,apiClient,sendOrQueue,isQueued,patchVisitCache}=globalThis.__positionTest;\n'+hook);
  const mutation = useUpdatePosition(1, true);
  assert.equal(calls.length, 0);
  blocked = true;
  await assert.rejects(mutation.mutationFn({id:1,payload:{phase:'Y'}}), /Pending sync/);
  assert.equal(calls.length, 0);
  blocked = false; fail = true;
  await assert.rejects(mutation.mutationFn({id:1,payload:{phase:'Y'}}), /Network failed/);
  fail = false;
  const result = await mutation.mutationFn({id:1,payload:{phase:'Y'}});
  assert.equal(result.phase, 'Y');
  delete globalThis.__positionTest;
});
