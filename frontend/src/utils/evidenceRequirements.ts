import type { Position } from '../api/types';
import type { StagedEvidence } from './inspectionProgress';

export function evidenceRequirements(positions: Position[], types: string[], staged: StagedEvidence[] = []) {
  return positions.filter(p => p.in_scope !== false && p.installed).flatMap(position => types.map(type => {
    const image = position.images.find(i => i.image_type === type && i.sequence === 1);
    const waived = image?.evidence_status === 'NOT REQUIRED' && !!image.exemption_reason;
    const captured = position.images.some(i => i.image_type === type && i.file_path && i.evidence_status !== 'RECAPTURE REQUIRED')
      || staged.some(i => i.position_key === position.id && i.image_type === type);
    return { position, type, image, waived, missing: !waived && !captured };
  }));
}
