import datetime as dt
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.database import Base
from app.models import User,Team,LineInspectionReport
from app.routers import reports
from app.services import report_pdf_jobs

@pytest.fixture
def library(tmp_path,monkeypatch):
    monkeypatch.setattr(reports.settings,'reports_dir',tmp_path)
    engine=create_engine('sqlite:///:memory:');Base.metadata.create_all(engine)
    with Session(engine) as db:
        team=Team(name='Team');other=Team(name='Other');db.add_all([team,other]);db.flush()
        for number,role,team_id,kind in [('ADMIN','admin',team.id,'line'),('CREW','team_leader',team.id,'team'),('OTHER','team_leader',other.id,'team')]:
            db.add(LineInspectionReport(team_id=team_id,report_number=number,start_date=dt.date(2026,10,1),end_date=dt.date(2026,10,2),report_type=kind,inspection_snapshot={'team_name':'Team','report_creator':{'role':role,'name':role}}))
        db.commit()
        yield db,team

def test_all_allowed_creators_listed_with_paired_document_metadata(library,monkeypatch):
    db,team=library;seen=[]
    def status(record):seen.append(record.id);return {'word_bytes':100,'pdf_bytes':50,'status':'complete','pdf_available':True,'error':None}
    monkeypatch.setattr(report_pdf_jobs,'status',status)
    rows=reports.report_document_library(db=db,user=User(role='admin',username='admin',hashed_password='x'))
    assert {r['report_number'] for r in rows}=={'ADMIN','CREW','OTHER'}
    assert len(seen)==3 and all(r['documents']['pdf_bytes']==50 for r in rows)
    assert all('file_path' not in r for r in rows)

def test_customer_documents_are_only_explicitly_shared(library,monkeypatch):
    db,team=library;seen=[]
    monkeypatch.setattr(report_pdf_jobs,'status',lambda record:seen.append(record.id) or {'pdf_bytes':None,'word_bytes':None,'status':'unavailable'})
    customer=User(role='client',username='client',hashed_password='x',allowed_report_ids=[2])
    assert [r['id'] for r in reports.report_document_library(db=db,user=customer)]==[2]
    assert seen==[2]
    customer.allowed_report_ids=[]
    assert reports.report_document_library(db=db,user=customer)==[]
    assert seen==[2]

def test_team_scope_and_team_member_denial_are_preserved(library,monkeypatch):
    db,team=library
    monkeypatch.setattr(report_pdf_jobs,'status',lambda record:{'status':'idle','word_bytes':None,'pdf_bytes':None})
    leader=User(role='team_leader',username='leader',hashed_password='x',team_id=team.id)
    assert [r['report_number'] for r in reports.report_document_library(db=db,user=leader)]==['CREW']
    with pytest.raises(HTTPException) as error:reports.report_document_library(db=db,user=User(role='team_member',username='member',hashed_password='x'))
    assert error.value.status_code==403
