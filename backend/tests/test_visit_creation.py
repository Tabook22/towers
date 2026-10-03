"""Creation receipts prevent retries from duplicating visits or their 48 image slots."""
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, Position, Team, Tower, User, Visit, VisitCreationRequest, VisitEntryDraft, VisitDraftImage
from app.routers.visits import create_visit, delete_visit_completely
from app.schemas import VisitCreate
from app.services.visit_creation import create_visit_once


@pytest.fixture
def engine(tmp_path):
    engine = create_engine('sqlite:///' + str(tmp_path / 'creation.sqlite3'), connect_args={'timeout': 20})
    @event.listens_for(engine, 'connect')
    def enable_keys(conn, _):
        conn.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([Team(id=1, name='Crew'), Team(id=2, name='Other crew'), Tower(id=1, tower_id='Tower-1'),
                    User(id=1, username='one', hashed_password='unused', role='admin'),
                    User(id=2, username='two', hashed_password='unused', role='admin')])
        db.commit()
    yield engine
    engine.dispose()


def request(**values):
    return VisitCreate(tower_id=1, team_id=1, inspection_date=dt.date(2026, 10, 3), request_token=uuid4(), **values)


def test_public_creation_retry_retains_current_data_and_only_one_set_of_slots(engine):
    with Session(engine) as db:
        user = db.get(User, 1)
        payload = request()
        first = create_visit(payload, db, user)
        db.get(Visit, first.id).inspector_name = 'Later confirmed edit'
        db.commit()
        second = create_visit(payload, db, user)
        assert second.id == first.id and second.inspector_name == 'Later confirmed edit'
        assert db.query(Visit).count() == 1
        assert db.query(Position).count() == 12 and db.query(Image).count() == 48
        assert db.query(VisitCreationRequest).count() == 1


def test_token_cannot_be_reused_for_different_payload_or_endpoint(engine):
    with Session(engine) as db:
        user = db.get(User, 1); payload = request()
        create_visit_once(payload, db, user, numbered=True)
        for changed, numbered in [(payload.model_copy(update={'inspector_name': 'Different'}), True), (payload, False)]:
            with pytest.raises(HTTPException) as error:
                create_visit_once(changed, db, user, numbered=numbered)
            assert error.value.status_code == 409
        assert db.query(Visit).count() == 1 and db.query(Position).count() == 12


def test_same_day_start_resumes_but_explicit_repeat_gets_new_visit(engine):
    with Session(engine) as db:
        first = create_visit_once(request(resume_existing=True), db, db.get(User, 1), numbered=True)
        second = create_visit_once(request(resume_existing=True), db, db.get(User, 2), numbered=True)
        assert second.id == first.id and second.mission_seq == 1
        repeat = create_visit_once(request(), db, db.get(User, 2), numbered=True)
        assert repeat.id != first.id and repeat.mission_seq == 2
        other_team = create_visit_once(request(resume_existing=True).model_copy(update={'team_id': 2}), db, db.get(User, 1), numbered=True)
        assert other_team.id != first.id and other_team.mission_seq == 1


def test_concurrent_mission_numbers_and_same_day_starts(engine):
    def concurrent(payloads):
        barrier = Barrier(len(payloads))
        def worker(item):
            index, payload = item
            with Session(engine) as db:
                user = db.get(User, index % 2 + 1)
                barrier.wait(timeout=10)
                visit = create_visit_once(payload, db, user, numbered=True)
                return visit.id, visit.mission_seq
        with ThreadPoolExecutor(max_workers=len(payloads)) as pool:
            return list(pool.map(worker, enumerate(payloads)))
    numbers = concurrent([request() for _ in range(6)])
    assert sorted(seq for _, seq in numbers) == list(range(1, 7))
    resumed = concurrent([request(resume_existing=True) for _ in range(6)])
    assert len(set(resumed)) == 1
    with Session(engine) as db:
        assert db.query(Visit).count() == 6 and db.query(Image).count() == 6 * 48


def test_concurrent_identical_token_is_consumed_once(engine):
    barrier = Barrier(2); payload = request()
    def worker(_):
        with Session(engine) as db:
            user = db.get(User, 1)
            barrier.wait(timeout=10)
            return create_visit_once(payload, db, user, numbered=True).id
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(worker, range(2)))
    assert ids[0] == ids[1]
    with Session(engine) as db:
        assert db.query(Visit).count() == db.query(VisitCreationRequest).count() == 1


def test_retry_after_deletion_does_not_resurrect_inspection(engine):
    with Session(engine) as db:
        user = db.get(User, 1); payload = request()
        visit = create_visit_once(payload, db, user, numbered=True)
        delete_visit_completely(db, visit); db.commit()
        with pytest.raises(HTTPException) as error:
            create_visit_once(payload, db, user, numbered=True)
        assert error.value.status_code == 410
        assert db.query(Visit).count() == db.query(Position).count() == 0


@pytest.mark.parametrize('enforce_keys', [False, True])
def test_visit_deletion_removes_private_draft_children_without_database_cascades(engine, enforce_keys):
    with engine.connect() as conn:
        conn.exec_driver_sql(f'PRAGMA foreign_keys={int(enforce_keys)}')
        conn.commit()
        with Session(conn) as db:
            visit = create_visit_once(request(), db, db.get(User, 1), numbered=True)
            draft = VisitEntryDraft(visit_id=visit.id, user_id=1, payload={'notes': 'Private'})
            db.add(draft); db.flush()
            db.add(VisitDraftImage(draft_id=draft.id, token='delete-test', position_key=1,
                image_type='RGB Full', filename='draft.jpg', content_type='image/jpeg',
                file_path='draft.jpg', checksum='unused'))
            db.commit()
            delete_visit_completely(db, visit); db.commit()
            assert db.query(VisitEntryDraft).count() == db.query(VisitDraftImage).count() == 0


def test_invalid_creation_rolls_back_receipt_and_partial_records(engine):
    with Session(engine) as db:
        with pytest.raises(HTTPException):
            create_visit_once(request().model_copy(update={'tower_id': 999}), db, db.get(User, 1), numbered=True)
        assert db.query(VisitCreationRequest).count() == db.query(Visit).count() == db.query(Image).count() == 0


def test_retry_checks_current_team_and_assignment_access(engine):
    with Session(engine) as db:
        user = db.get(User, 1); payload = request()
        create_visit_once(payload, db, user, numbered=True)
        user.role = 'team_member'; user.team_id = 2; db.commit()
        with pytest.raises(HTTPException) as error:
            create_visit_once(payload, db, user, numbered=True)
        assert error.value.status_code == 403


def test_resume_requires_a_date():
    with pytest.raises(ValueError, match='inspection date'):
        VisitCreate(tower_id=1, resume_existing=True)
