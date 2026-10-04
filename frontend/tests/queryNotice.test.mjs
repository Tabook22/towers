import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/utils/queryNotice.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}});
const {queryNotice}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const initial={error:undefined,hasData:false,online:true,paused:false,isError:false};
test('a network/server error is never presented as revoked permissions',()=>{
  for(const error of [new Error('offline'),{response:{status:500}}])assert.equal(queryNotice({...initial,isError:true,error}).kind,'error');
});
test('cached teams remain visible after a network failure',()=>{
  assert.equal(queryNotice({...initial,isError:true,hasData:true}).hideData,false);
  assert.equal(queryNotice({...initial,online:false,hasData:true}).hideData,false);
});
test('permission failures hide even previously cached team details',()=>{
  assert.equal(queryNotice({...initial,error:{response:{status:403}},hasData:true,isError:true}).hideData,true);
});
test('paused first fetch explains offline availability and successful empty data is valid',()=>{
  assert.equal(queryNotice({...initial,paused:true}).kind,'offline');
  assert.equal(queryNotice({...initial,hasData:true}),null);
});
