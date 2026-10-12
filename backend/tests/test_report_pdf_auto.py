"""Automatic PDFs start only after Word archives and report rows are committed."""
import datetime as dt
from pathlib import Path
from types import SimpleNamespace
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.database import Base
from app.models import Team,Tower,User,Visit,LineInspectionReport
from app.routers import reports
from app.schemas import LineInspectionReportRequest,OetcAreaReportRequest
from app.services import report_pdf_jobs as jobs

@pytest.fixture
def saved_report(tmp_path,monkeypatch):
    monkeypatch.setattr(reports.settings,'reports_dir',tmp_path/'reports')
    engine=create_engine('sqlite:///'+str(tmp_path/'test.db'))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team=Team(name='Test team');tower=Tower(tower_id='TEST-1',voltage='132');user=User(username='test-admin',hashed_password='x',role='admin',is_super_admin=True)
        db.add_all([team,tower,user]);db.flush()
        visit=Visit(team_id=team.id,tower_id=tower.id,inspection_date=dt.date(2026,10,1))
        db.add(visit);db.commit()
        monkeypatch.setattr(reports,'render_oetc_line_report_docx',lambda *args,**kwargs:b'original Word')
        yield db,team,visit,user


def test_word_saved_and_committed_before_automatic_pdf_starts(saved_report,monkeypatch):
    db,team,visit,user=saved_report
    seen=[]
    def start(record):
        with Session(db.get_bind()) as other:
            persisted=other.get(LineInspectionReport,record.id)
            assert persisted is not None
            assert (reports.settings.reports_dir/persisted.file_path).read_bytes()==b'original Word'
            seen.append(persisted.id)
    monkeypatch.setattr(jobs,'start',start)
    response=reports.oetc_line_report(LineInspectionReportRequest(team_id=team.id,start_date=dt.date(2026,10,1),end_date=dt.date(2026,10,1)),db=db,user=user)
    assert response.body==b'original Word' and response.status_code==200
    assert seen==[db.query(LineInspectionReport).one().id]


def test_pdf_scheduling_failure_does_not_fail_word_generation(saved_report,monkeypatch):
    db,team,visit,user=saved_report
    def fail(record):raise RuntimeError('converter unavailable')
    monkeypatch.setattr(jobs,'start',fail)
    response=reports.oetc_line_report(LineInspectionReportRequest(team_id=team.id,start_date=dt.date(2026,10,1),end_date=dt.date(2026,10,1)),db=db,user=user)
    assert response.status_code==200 and response.body==b'original Word'
    record=db.query(LineInspectionReport).one()
    assert (reports.settings.reports_dir/record.file_path).read_bytes()==b'original Word'


def test_combined_customer_pdf_is_queued_before_team_sections(saved_report,monkeypatch):
    db,team,visit,user=saved_report
    seen=[]
    monkeypatch.setattr(jobs,'start',lambda record:seen.append((record.id,record.report_type)))
    block=SimpleNamespace(team=team,visits=[visit],area='Test area',report_number='TEST-SECTION',docx_bytes=b'section Word')
    payload=OetcAreaReportRequest(area='Test area',start_date=dt.date(2026,10,1),end_date=dt.date(2026,10,1))
    combined=reports._persist_blocks(db,[block],user,payload,'area',merged_document=b'combined Word')
    assert seen[0]==(combined.id,'line')
    assert len(seen)==2 and seen[1][1]=='area'
    assert (reports.settings.reports_dir/combined.file_path).read_bytes()==b'combined Word'
