import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const load = async file => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(await readFile(new URL(`../src/utils/${file}.ts`, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const { parseInspectionReading } = await load('inspectionReading');
const { reconcileDraft } = await load('reconcileDraft');
test('temperature entry preserves zero, negative and decimal values without accepting partial input', () => {
  for (const [raw,value] of [['',null],['  ',null],['0',0],['-2.5',-2.5],['.5',.5],['35.',35],['+14.2',14.2],['٣٤٫٥',34.5],['۱۲.۵',12.5]]) assert.deepEqual(parseInspectionReading(raw),{valid:true,value});
  for (const raw of ['-','.','abc','NaN','Infinity','1,2','1e','1e999']) assert.equal(parseInspectionReading(raw).valid,false);
});
test('independent draft edits merge but conflicting observations and layout arrays never choose a silent winner', () => {
  const base={drafts:{1:{changes:{tmax_c:20,inspector_notes:''}}},additions:[]};
  const local=structuredClone(base);local.drafts[1].changes.inspector_notes='Local note';
  const remote=structuredClone(base);remote.drafts[1].changes.tmax_c=22;
  assert.deepEqual(reconcileDraft(local,remote,base),{drafts:{1:{changes:{tmax_c:22,inspector_notes:'Local note'}}},additions:[]});
  remote.drafts[1].changes.inspector_notes='Other note';
  assert.throws(()=>reconcileDraft(local,remote,base),/Conflicting draft proposals/);
  assert.throws(()=>reconcileDraft({additions:[{id:-1,phase:'R'}]},{additions:[{id:-1,phase:'Y'}]},{additions:[]}),/additions/);
  assert.equal(local.drafts[1].changes.tmax_c,20);
  assert.deepEqual(reconcileDraft({headerDraft:{inspector_name:'Local'}},{headerDraft:{weather_wind:'Calm'}},{}),{headerDraft:{inspector_name:'Local',weather_wind:'Calm'}});
});
