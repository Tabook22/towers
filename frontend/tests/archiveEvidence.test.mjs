import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/archiveEvidence.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { collectArchivePages, groupArchiveEvidence } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const row = { team_id: 1, team_name: 'Team 2', tower_pk: 1, tower_code: 'Tower 2', position_id: 1, visit_id: 1, ohl: 'OHL1', phase: 'R', string: 'S1', direction: 'Ashoor', inspection_date: '2026-09-20' };
test('collects all pages of both datasets, including categories beyond first 200', async () => {
  const images = Array.from({length:1204},(_,id)=>({id,image_type:['TH Full','TH Close','RGB Full','RGB Close'][id%4]}));
  const photos = Array.from({length:731},(_,id)=>({id}));
  const calls = [];
  const result = await collectArchivePages(async params => {
    calls.push(params);
    return { images: images.slice(params.skip,params.skip+params.limit), photos: photos.slice(params.skip,params.skip+params.limit), total_images:images.length,total_photos:photos.length, image_ceiling:1204,photo_ceiling:731,has_more:params.skip+params.limit<images.length };
  });
  assert.equal(result.images.length,1204); assert.equal(result.photos.length,731);
  assert.equal(calls[1].image_ceiling,1204); assert.equal(calls[1].photo_ceiling,731);
  assert.equal(result.has_more,false);
});
test('a failed later page never becomes a silently incomplete archive', async () => {
  await assert.rejects(collectArchivePages(async ({skip}) => {
    if(skip) throw Error('offline');
    return {images:[{id:1}],photos:[],has_more:true};
  }), /offline/);
});

test('concurrent removal cannot silently omit images during offset pagination', async () => {
  await assert.rejects(collectArchivePages(async ({skip}) => ({
    images: skip ? [] : [{id:1}], photos:[], has_more:!skip,
    total_images:2, total_photos:0, image_ceiling:2, photo_ceiling:0,
  })), /archive changed/);
});
test('all categories and extras stay together across capture months', () => {
  const images = ['TH Full','TH Close','RGB Full','RGB Close','RGB Close'].map((image_type,id)=>({...row,id,image_type,sequence:id===4?2:1,capture_date:id%2?'2026-08-31':'2026-09-01'}));
  const photos = [{...row,id:8}, {...row,id:9,position_id:null}];
  const tree=groupArchiveEvidence(images,photos);
  assert.equal(tree.length,1);
  assert.equal(tree[0].count,7);
  const tower=tree[0].towers[0];
  assert.equal(tower.positions.length,1); assert.equal(tower.positions[0].images.length,5);
  assert.equal(tower.positions[0].photos.length,1); assert.equal(tower.photos.length,1);
});
test('duplicate team names and repeated insulator inspections never merge', () => {
  const tree=groupArchiveEvidence([{...row,id:1,image_type:'TH Full',sequence:1},{...row,id:2,team_id:2,image_type:'TH Full',sequence:1},{...row,id:3,position_id:3,visit_id:3,image_type:'RGB Full',sequence:1}],[]);
  assert.equal(tree.length,2); assert.equal(tree[0].towers[0].positions.length,2);
});
test('natural tower sorting and insulator search preserve the full evidence set', () => {
  const images=[{...row,id:1,tower_pk:2,tower_code:'Tower 10',image_type:'TH Full',sequence:1},{...row,id:2,image_type:'TH Full',sequence:1},{...row,id:3,image_type:'RGB Full',sequence:1}];
  assert.deepEqual(groupArchiveEvidence(images,[])[0].towers.map(t=>t.name),['Tower 2','Tower 10']);
  assert.equal(groupArchiveEvidence(images,[],'tower 2')[0].towers[0].positions[0].images.length,2);
});
