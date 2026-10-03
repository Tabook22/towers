import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/positionGallery.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { positionPhotos } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const image = (id, position_id, extra = {}) => ({ id, position_id, image_type: 'TH Full', file_path: 'image.jpg', sequence: 1, ...extra });

test('front/back and draft position IDs do not share image associations', () => {
  const staged = [{ id: 1, position_key: -1, image_type: 'RGB Full', filename: 'front.jpg' }, { id: 2, position_key: -2, image_type: 'RGB Full', filename: 'back.jpg' }];
  assert.deepEqual(positionPhotos({ id: -1, images: [] }, staged).map(p => p.filename), ['front.jpg']);
  assert.deepEqual(positionPhotos({ id: -2, images: [] }, staged).map(p => p.filename), ['back.jpg']);
  assert.deepEqual(positionPhotos({ id: 1, images: [image(1, 1), image(2, 2)] }, staged).map(p => p.key), ['saved-1']);
});
test('empty evidence slots and voice notes are not photo thumbnails', () => {
  assert.equal(positionPhotos({ id: 1, images: [image(1, 1, { file_path: null })] }, [{ id: 1, position_key: 1, image_type: 'VOICE', filename: 'note.webm' }]).length, 0);
});
test('all uploaded photos remain visible with explicit report selection respected', () => {
  const photos = positionPhotos({ id: 1, images: [image(2, 1, { sequence: 2, include_in_report: true }), image(1, 1, { include_in_report: false })] }, []);
  assert.deepEqual(photos.map(p => [p.key, p.reportIncluded]), [['saved-1', false], ['saved-2', true]]);
});
test('legacy primary selection and draft IDs are distinct even with the same numeric image ID', () => {
  const photos = positionPhotos({ id: 1, images: [image(2, 1, { sequence: 2 }), image(1, 1)] }, [{ id: 1, position_key: 1, image_type: 'TH Full', filename: 'draft.jpg' }]);
  assert.deepEqual(photos.map(p => [p.key, p.reportIncluded]), [['saved-1', true], ['saved-2', false], ['draft-1', false]]);
});
