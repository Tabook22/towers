import type { VisitReviewCheck } from './visitWorkflow';

/** Reuses real visit checks; guidance never changes validation or marks work done. */
export function nextVisitGuidance(checks: VisitReviewCheck[], positionCount: number) {
  const header = checks.find(c => c.target === 'inspection_date') || checks.find(c => c.target === 'inspector_name');
  if (header) return { step: 1, task: 'Complete the visit details', why: 'Record who inspected the tower and when before completing the visit.', check: header };
  if (!positionCount) return { step: 2, task: 'Set up the tower drawing', why: 'Choose the actual tower arrangement. Entering readings prepares its positions automatically.', check: undefined };
  const check = ['temperatures', 'screening', 'evidence', 'capture_dates'].map(target => checks.find(c => c.target === target)).find(Boolean);
  if (check) return { step: check.target === 'evidence' || check.target === 'capture_dates' ? 3 : 2,
    task: check.target === 'temperatures' ? 'Complete the hotspot readings' : check.target === 'screening' ? 'Record the next inspection result' : check.target === 'evidence' ? 'Add the missing evidence' : 'Check the image dates',
    why: check.target === 'temperatures' ? 'Each hotspot needs its own Tmax and reference temperature. ΔT is calculated automatically.'
      : check.target === 'screening' ? 'Temperatures alone do not mark an insulator inspected. Choose its actual screening result.'
        : check.target === 'evidence' ? 'Keep each image with its own position and evidence category. Pending evidence does not block saving a working visit.'
          : 'Check differing dates against the actual capture. Keep original image metadata accurate.', check };
  return { step: 4, task: 'Review this visit once', why: 'The listed checks are clear. Review the report-specific fields and proposed changes before confirming this visit. This is not report approval.', check: undefined };
}
