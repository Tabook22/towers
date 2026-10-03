import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/utils/evidenceDuplicates.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {uniqueEvidenceFiles}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('same bytes with different filenames are skipped within the category, while distinct captures remain',async()=>{
  const a=new File(['same pixels'],'first.jpg'),b=new File(['same pixels'],'renamed.jpg'),c=new File(['other pixels'],'third.jpg');
  const first=await uniqueEvidenceFiles([a,b,c],[]);
  assert.deepEqual(first.files,[a,c]);assert.equal(first.skipped,1);
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',await a.arrayBuffer())).toString('hex');
  const second=await uniqueEvidenceFiles([b,c],[digest]);
  assert.deepEqual(second.files,[c]);assert.equal(second.skipped,1);
  assert.equal((await uniqueEvidenceFiles([b],[])).skipped,0); // another position/category has its own set
});
