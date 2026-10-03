import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const changes = ts.transpileModule(await readFile(new URL('../src/utils/positionChanges.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const source = (await readFile(new URL('../src/utils/inspectionProgress.ts', import.meta.url), 'utf8')).replace("'./positionChanges'", JSON.stringify('data:text/javascript;base64,'+Buffer.from(changes).toString('base64')));
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { evidenceProgress, nextIncompletePosition } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const types = ['TH Full', 'RGB Full'];
const base = { id: 1, in_scope: true, installed: true, screening_result: 'Normal', images: types.map(image_type => ({ image_type, sequence: 1, evidence_status: 'COMPLETE', file_path: 'original.jpg' })) };

test('staged images complete only the exact position/category; recapture and exclusions remain visible', () => {
  const p = { ...base, images: [{ image_type: 'TH Full', sequence: 1, evidence_status: 'RECAPTURE REQUIRED', file_path: 'old.jpg' }] };
  const before = structuredClone(p);
  const draft = [{ position_key: 2, image_type: 'TH Full' }, { position_key: 1, image_type: 'RGB Full' }];
  assert.deepEqual(evidenceProgress(p, types, draft), { missing: ['TH Full'], complete: 1, total: 2 });
  draft.push({ position_key: 1, image_type: 'TH Full' });
  assert.equal(evidenceProgress(p, types, draft).complete, 2);
  assert.deepEqual(evidenceProgress(p, types, [] ).missing, types);
  assert.deepEqual(p, before);
});

test('next incomplete wraps, skips complete/excluded/current positions and includes missing hotspot readings', () => {
  const positions = [base, { ...base, id: 2, in_scope: false, images: [] }, { ...base, id: -3, hotspot: 'Yes', tmax_c: 0, tref_c: null }, { ...base, id: 4, screening_result: 'Not inspected' }];
  assert.equal(nextIncompletePosition(positions, 1, types, []).id, -3);
  assert.equal(nextIncompletePosition(positions, 4, types, []).id, -3);
  assert.equal(nextIncompletePosition(positions, -3, types, []).id, 4);
  assert.equal(nextIncompletePosition([base], 1, types, []), undefined);
  assert.equal(nextIncompletePosition([{ ...base, hotspot: 'Yes', tmax_c: 0, tref_c: 0 }], undefined, types, []), undefined);
});

test('normal draft readings need full evidence only; recapture flags and retained photos stay individual', () => {
  const all = ['TH Full','TH Close','RGB Full','RGB Close'];
  const normal = {...base,images:[]};
  assert.deepEqual(evidenceProgress(normal,all,[]).missing,['TH Full','RGB Full']);
  assert.deepEqual(evidenceProgress({...normal,installed:false},all,[]).missing,[]);
  const recapture = {...normal,images:[{image_type:'TH Close',sequence:1,evidence_status:'RECAPTURE REQUIRED',file_path:'old.jpg'}]};
  assert.deepEqual(evidenceProgress(recapture,all,[]).missing,['TH Full','TH Close','RGB Full']);
  assert.deepEqual(evidenceProgress({...normal,screening_result:'Hotspot detected'},all,[]).missing,all);
});
