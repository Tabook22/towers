from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import LineInspectionReportRequest, OetcAreaReportRequest, OetcConsolidatedReportRequest
from app.services import report_jobs as jobs

router = APIRouter(prefix='/api/reports/generation-jobs', tags=['reports'])


class StartReport(BaseModel):
    kind: Literal['team', 'area', 'consolidated']
    request_token: UUID
    payload: dict


@router.post('', status_code=202)
def start(body: StartReport, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    model = {'team': LineInspectionReportRequest, 'area': OetcAreaReportRequest,
             'consolidated': OetcConsolidatedReportRequest}[body.kind]
    try:
        payload = model.model_validate(body.payload)
    except ValidationError:
        raise HTTPException(422, 'Invalid report fields')
    jobs.authorize(db, user, body.kind, payload)
    job, created = jobs.create(user.id, str(body.request_token), body.kind, payload.model_dump(mode='json'))
    if created:
        jobs.dispatch(job['id'])
    return jobs.public(job)


@router.get('/{ident}')
def status(ident: UUID, user: User = Depends(get_current_user)):
    return jobs.public(jobs.get(str(ident), user.id))


@router.get('/{ident}/file')
def download(ident: UUID, user: User = Depends(get_current_user)):
    job = jobs.get(str(ident), user.id)
    if job['status'] != 'complete':
        raise HTTPException(409, 'Report is not ready yet')
    return FileResponse(jobs.directory(str(ident)) / 'report.docx', filename=job['filename'],
                        media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        headers={'Cache-Control': 'private, no-store'})
