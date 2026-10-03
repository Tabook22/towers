import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/teamArchiveUpload.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { teamArchiveImageType, teamArchiveFileKey } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('folder selection accepts supported photos with missing MIME and skips nonimages or empty files', () => {
  assert.equal(teamArchiveImageType({name:'IR.TIFF',type:'',size:12}), 'image/tiff');
  assert.equal(teamArchiveImageType({name:'IR.jpg',type:'image/jpeg',size:12}), 'image/jpeg');
  assert.equal(teamArchiveImageType({name:'notes.txt',type:'text/plain',size:12}), null);
  assert.equal(teamArchiveImageType({name:'bad.jpg',type:'text/plain',size:12}), null);
  assert.equal(teamArchiveImageType({name:'empty.jpg',type:'image/jpeg',size:0}), null);
});
test('same filename from separate subfolders stays separate, repeated selections deduplicate', () => {
  const file = {name:'photo.jpg',size:123,lastModified:10,webkitRelativePath:'day1/photo.jpg'};
  assert.notEqual(teamArchiveFileKey(file), teamArchiveFileKey({...file,webkitRelativePath:'day2/photo.jpg'}));
  assert.equal(teamArchiveFileKey(file), teamArchiveFileKey({...file}));
});
