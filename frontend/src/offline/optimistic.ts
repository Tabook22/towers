import type { QueryClient } from '@tanstack/react-query';
import type { ImageRow, Position, VisitDetail } from '../api/types';
import { LOCAL_FILE_SENTINEL } from './types';

export function patchVisitCache(
  qc: QueryClient,
  visitId: number,
  updater: (visit: VisitDetail) => VisitDetail,
) {
  qc.setQueryData<VisitDetail>(['visit', visitId], (old) => (old ? updater(old) : old));
}

export function applyPositionPatch(visit: VisitDetail, positionId: number, payload: Partial<Position>): VisitDetail {
  return {
    ...visit,
    positions: visit.positions.map((p) => (p.id === positionId ? { ...p, ...payload } : p)),
  };
}

export function applyVisitPatch(visit: VisitDetail, payload: Record<string, unknown>): VisitDetail {
  return { ...visit, ...payload } as VisitDetail;
}

export function applyQueuedImage(
  visit: VisitDetail,
  imageId: number,
  file: File,
): VisitDetail {
  const now = new Date().toISOString();
  return {
    ...visit,
    positions: visit.positions.map((p) => ({
      ...p,
      images: p.images.map((img) =>
        img.id === imageId
          ? {
              ...img,
              file_path: LOCAL_FILE_SENTINEL,
              thumbnail_path: LOCAL_FILE_SENTINEL,
              original_filename: file.name,
              file_size: file.size,
              uploaded_at: now,
              evidence_status: 'COMPLETE',
            }
          : img,
      ),
    })),
  };
}

export function applyQueuedExtraImage(
  visit: VisitDetail,
  positionId: number,
  imageType: string,
  localId: number,
  file: File,
): VisitDetail {
  const now = new Date().toISOString();
  const extra: ImageRow = {
    id: localId,
    position_id: positionId,
    image_type: imageType as ImageRow['image_type'],
    image_code: null,
    sequence: 2,
    capture_date: null,
    capture_time: null,
    latitude: null,
    longitude: null,
    evidence_status: 'COMPLETE',
    file_path: LOCAL_FILE_SENTINEL,
    thumbnail_path: LOCAL_FILE_SENTINEL,
    original_filename: file.name,
    file_size: file.size,
    uploaded_at: now,
    annotated_path: null,
    annotated_thumbnail_path: null,
    annotated_uploaded_at: null,
  };
  return {
    ...visit,
    positions: visit.positions.map((p) =>
      p.id === positionId ? { ...p, images: [...p.images, extra] } : p,
    ),
  };
}
