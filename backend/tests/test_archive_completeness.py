import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, LineInspectionReport, Position, ReportImage, Team, Tower, User, Visit, VisitPhoto
from app.routers.archive import browse_archive


@pytest.fixture
def archive():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name='Alpha')
        tower = Tower(tower_id='T-2')
        db.add_all([team, tower]); db.flush()
        visit = Visit(tower_id=tower.id, team_id=team.id, inspection_date=dt.date(2026, 9, 20))
        db.add(visit); db.flush()
        position = Position(visit_id=visit.id, ohl='OHL1', phase='R', string='S1')
        db.add(position); db.flush()
        user = User(username='reviewer', role='reviewer')
        yield db, team, position, user


def test_archive_pages_include_every_category_extra_and_field_photo(archive):
    db, team, pos, user = archive
    kinds = ['TH Full', 'TH Close', 'RGB Full', 'RGB Close']
    for index in range(824):
        db.add(Image(position_id=pos.id, image_type=kinds[index % 4], sequence=index // 4 + 1, file_path=f'{index}.jpg', capture_date=dt.date(2026, 9, 20)))
    for index in range(407):
        db.add(VisitPhoto(visit_id=pos.visit_id, position_id=pos.id if index % 2 else None, file_path=f'field{index}.jpg'))
    db.commit()
    first = browse_archive(db=db, user=user)
    assert len(first.images) == 200 and len(first.photos) == 200
    assert first.total_images == 824 and first.total_photos == 407 and first.has_more
    images, photos = list(first.images), list(first.photos)
    page = first
    offset = 200
    while page.has_more:
        page = browse_archive(db=db, user=user, skip=offset, image_ceiling=first.image_ceiling, photo_ceiling=first.photo_ceiling)
        images.extend(page.images); photos.extend(page.photos)
        offset += 200
    assert len({i.id for i in images}) == 824
    assert len({p.id for p in photos}) == 407
    assert {kind: sum(i.image_type == kind for i in images) for kind in kinds} == dict.fromkeys(kinds, 206)
    assert sum(i.sequence > 1 for i in images) == 820


def test_new_uploads_do_not_shift_or_extend_a_paginated_snapshot(archive):
    db, _, pos, user = archive
    db.add_all(Image(position_id=pos.id, image_type='TH Full', file_path=f'{i}.jpg', sequence=i+1) for i in range(3))
    db.commit()
    first = browse_archive(db=db, user=user, limit=2)
    db.add(Image(position_id=pos.id, image_type='RGB Close', file_path='new.jpg'))
    db.commit()
    second = browse_archive(db=db, user=user, limit=2, skip=2, image_ceiling=first.image_ceiling, photo_ceiling=first.photo_ceiling)
    assert len(second.images) == 1 and second.total_images == 3 and not second.has_more
    assert browse_archive(db=db, user=user).total_images == 4


def test_missing_capture_dates_use_inspection_date_for_images_and_photos(archive):
    db, _, pos, user = archive
    db.add(Image(position_id=pos.id, image_type='RGB Full', file_path='rgb.jpg'))
    db.add(VisitPhoto(visit_id=pos.visit_id, file_path='field.jpg'))
    db.commit()
    result = browse_archive(db=db, user=user, year=2026, month=9, day=20)
    assert result.total_images == result.total_photos == 1
    assert result.images[0].archive_date == result.photos[0].archive_date == dt.date(2026, 9, 20)
    assert result.images[0].visit_id == pos.visit_id
    assert browse_archive(db=db, user=user, month=10).total_images == 0


def test_report_references_include_each_linked_type_and_extra_without_inventing_links(archive):
    db, team, pos, user = archive
    images = [Image(position_id=pos.id, image_type=kind, sequence=sequence, file_path=f'{index}.jpg') for index, (kind, sequence) in enumerate([('TH Full', 1), ('TH Close', 1), ('RGB Full', 1), ('RGB Close', 1), ('RGB Close', 2), ('TH Full', 2)])]
    db.add_all(images)
    report = LineInspectionReport(team_id=team.id, report_number='REPORT-1', start_date=dt.date(2026,9,1), end_date=dt.date(2026,9,30))
    db.add(report); db.flush()
    db.add_all(ReportImage(report_id=report.id, position_id=pos.id, image_id=image.id, image_type=image.image_type) for image in images[:5])
    db.add(VisitPhoto(visit_id=pos.visit_id, file_path='field.jpg'))
    db.commit()
    result = browse_archive(db=db, user=user, report_id=report.id)
    assert {i.id for i in result.images} == {i.id for i in images[:5]}
    assert result.total_photos == 0
    assert all(i.reports[0].report_number == 'REPORT-1' for i in result.images)
    all_images = browse_archive(db=db, user=user).images
    assert next(i for i in all_images if i.id == images[-1].id).reports == []


def test_team_leaders_cannot_bypass_scope_using_paging_or_report_id(archive):
    db, team, pos, _ = archive
    db.add(Image(position_id=pos.id, image_type='TH Full', file_path='x.jpg'))
    report = LineInspectionReport(team_id=team.id, report_number='PRIVATE', start_date=dt.date(2026,9,1), end_date=dt.date(2026,9,30))
    db.add(report); db.commit()
    leader = User(username='other', role='team_leader', team_id=team.id+1)
    assert browse_archive(db=db, user=leader, team_id=team.id, image_ceiling=99999).total_images == 0
    with pytest.raises(HTTPException) as error:
        browse_archive(db=db, user=leader, report_id=report.id)
    assert error.value.status_code == 403


@pytest.mark.parametrize('filters', [{'skip': -1}, {'limit': 0}, {'limit': 1001}, {'month': 13}, {'day': 32}])
def test_invalid_pagination_and_dates_are_rejected(archive, filters):
    db, _, _, user = archive
    with pytest.raises(HTTPException) as error:
        browse_archive(db=db, user=user, **filters)
    assert error.value.status_code == 422
