import type { ImageRow, Position } from '../api/types';
import type { DraftImage } from '../api/visitEntry';

export const evidenceImageTypes = ['TH Full', 'TH Close', 'RGB Full', 'RGB Close'];
export interface PositionPhoto {
  key: string;
  type: string;
  filename: string | null;
  image?: ImageRow;
  draft?: DraftImage;
  reportIncluded: boolean;
}

/** Position IDs, including negative draft IDs, keep front/back and strings separate. */
export function positionPhotos(position: Position, staged: DraftImage[]): PositionPhoto[] {
  const saved = position.images.filter(i => i.position_id === position.id && !!i.file_path && evidenceImageTypes.includes(i.image_type))
    .sort((a, b) => evidenceImageTypes.indexOf(a.image_type) - evidenceImageTypes.indexOf(b.image_type) || a.sequence - b.sequence || a.id - b.id);
  return [
    ...saved.map(image => ({ key: `saved-${image.id}`, type: image.image_type, filename: image.original_filename, image,
      reportIncluded: image.include_in_report ?? saved.find(i => i.image_type === image.image_type)?.id === image.id })),
    ...staged.filter(i => i.position_key === position.id && evidenceImageTypes.includes(i.image_type))
      .map(draft => ({ key: `draft-${draft.id}`, type: draft.image_type, filename: draft.filename, draft, reportIncluded: false })),
  ];
}
