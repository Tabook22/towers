import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/utils/reportDocuments.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};vm.runInNewContext(code,{exports,require:()=>({})});
const {documentMatches}=exports;
test('document filters reflect saved files rather than report counts',()=>{
 const word={documents:{word_bytes:100,pdf_bytes:null,status:'idle'}};
 const ready={documents:{word_bytes:100,pdf_bytes:40,status:'complete'}};
 const preparing={documents:{word_bytes:100,pdf_bytes:null,status:'running'}};
 const missing={documents:{word_bytes:null,pdf_bytes:null,status:'unavailable'}};
 assert.ok(documentMatches(ready,'pdf'));assert.ok(!documentMatches(word,'pdf'));
 assert.ok(documentMatches(word,'word'));assert.ok(!documentMatches(missing,'word'));
 assert.ok(documentMatches(preparing,'preparing'));assert.ok(!documentMatches(ready,'preparing'));
 for(const row of [word,ready,preparing,missing])assert.ok(documentMatches(row,'all'));
});
