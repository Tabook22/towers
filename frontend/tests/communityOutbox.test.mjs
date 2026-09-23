import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('queued community messages preserve attachments and refresh the common conversation', async () => {
  let items = [{ id:'chat-1',kind:'community-message',path:{},json:{body:'Field update ✅',attachment_type:'voice',duration_seconds:4,latitude:17.1,longitude:54.2},file:{blob:new Blob(['recorded voice'],{type:'audio/webm'}),name:'voice.webm',type:'audio/webm'} }];
  const original=items[0];
  const calls=[];
  globalThis.__chatOutboxTest={
    apiClient:{post:async (...args)=>calls.push(args)},
    deleteOutbox:async id=>{items=items.filter(i=>i.id!==id);},
    listOutbox:async()=>items,
    markAttempt:async()=>assert.fail('Unexpected send error'),
    errorMessage:()=>'', isRetryableError:()=>false,
  };
  const source=(await readFile(new URL('../src/offline/flush.ts',import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,'');
  const header='const {apiClient,deleteOutbox,listOutbox,markAttempt,errorMessage,isRetryableError}=globalThis.__chatOutboxTest;\n';
  const {outputText}=ts.transpileModule(header+source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  const {flushOutbox,queryKeysTouched}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  assert.deepEqual(await flushOutbox(),{sent:1,remaining:0,failed:0});
  assert.equal(calls[0][0],'/api/community/channel');
  const form=calls[0][1];
  assert.equal(form.get('body'),'Field update ✅');
  assert.equal(form.get('duration_seconds'),'4');
  assert.equal(form.get('latitude'),'17.1');
  assert.equal(form.get('file').name,'voice.webm');
  assert.equal(await form.get('file').text(),'recorded voice');
  assert.ok(queryKeysTouched([original]).some(key=>key[0]==='community-chat'));
  delete globalThis.__chatOutboxTest;
});
