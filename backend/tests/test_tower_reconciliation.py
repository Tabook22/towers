import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, IMAGE_TYPE_CHOICES, Position, Team, Tower, User, Visit, VisitPhoto
from app.routers.teams import tower_reconciliation
from app.services.tower_reconciliation import reconcile_towers


@pytest.fixture
def data():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        a, b = Team(name='Alpha', status='completed'), Team(name='Bravo')
        db.add_all([a, b]); db.flush()
        towers = [Tower(tower_id=f'T-{i}', assigned_team_id=a.id if i < 3 else b.id) for i in range(1, 4)]
        db.add_all(towers); db.flush()
        admin = User(username='admin', hashed_password='x', role='admin', is_super_admin=True)
        db.add(admin); db.commit()
        yield db, a, b, towers, admin


def visit(db, team, tower, day=10, screened=True):
    v = Visit(team_id=team.id, tower_id=tower.id, inspection_date=dt.date(2026, 9, day))
    db.add(v); db.flush()
    p = Position(visit_id=v.id, ohl='OHL1', phase='R', string='S1',
                 screening_result='Normal' if screened else 'Not inspected')
    db.add(p); db.flush()
    return v, p


def image(db, p, category='TH Full', **kwargs):
    row = Image(position_id=p.id, image_type=category, file_path='evidence.jpg', evidence_status='COMPLETE', **kwargs)
    db.add(row); db.flush()
    return row


def result(data):
    db, a, b, _, _ = data
    db.flush()
    return reconcile_towers(db, [a.id, b.id], include_inventory=True)


def test_shared_archive_tower_is_not_an_assigned_completion(data):
    db, a, b, towers, _ = data
    _, p = visit(db, a, towers[0]); image(db, p)
    _, p = visit(db, a, towers[2]); image(db, p)
    _, p = visit(db, b, towers[2]); image(db, p)
    r = result(data)
    assert r['archive_team_entries'] == 3 and r['unique_archive_towers'] == 2
    alpha = r['teams'][0]
    assert alpha['counts']['assigned'] == 2
    assert alpha['counts']['archive_towers'] == 2
    assert alpha['counts']['assigned_with_evidence'] == 1
    assert alpha['counts']['without_evidence'] == 1
    assert alpha['counts']['screening_and_evidence_ready'] == 0
    assert alpha['outside_assignment'][0]['assigned_team_name'] == 'Bravo'
    assert alpha['status_needs_review'] is True


def test_field_photo_counts_archive_but_not_category_coverage(data):
    db, a, _, towers, _ = data
    v, _ = visit(db, a, towers[0])
    db.add(VisitPhoto(visit_id=v.id, file_path='field.jpg'))
    row = result(data)['teams'][0]['towers'][0]
    assert row['archive_images'] == 1 and row['screening_ready']
    assert row['covered_categories'] == 0 and row['missing_categories'] == 4


def test_latest_visit_does_not_borrow_coverage_from_old_visit(data):
    db, a, _, towers, _ = data
    _, old = visit(db, a, towers[0])
    for kind in IMAGE_TYPE_CHOICES: image(db, old, kind)
    _, new = visit(db, a, towers[0], day=11, screened=False)
    image(db, new, 'TH Full')
    row = result(data)['teams'][0]['towers'][0]
    assert row['archive_images'] == 5
    assert row['covered_categories'] == 1 and not row['screening_ready']
    assert not row['screening_and_evidence_ready']


def test_extra_images_cannot_replace_a_missing_category_and_recapture_is_a_gap(data):
    db, a, _, towers, _ = data
    _, p = visit(db, a, towers[0])
    for kind in IMAGE_TYPE_CHOICES: image(db, p, kind)
    extra = image(db, p, 'TH Full', sequence=2)
    rgb = db.query(Image).filter(Image.position_id == p.id, Image.image_type == 'RGB Close').one()
    rgb.evidence_status = 'RECAPTURE REQUIRED'
    row = result(data)['teams'][0]['towers'][0]
    assert row['archive_images'] == 5 and row['covered_categories'] == 3
    assert row['missing_categories'] == 1 and not row['four_category_coverage']
    rgb.evidence_status = 'COMPLETE'
    assert result(data)['teams'][0]['towers'][0]['screening_and_evidence_ready']
    extra.file_path = None
    assert result(data)['teams'][0]['towers'][0]['screening_and_evidence_ready']


def test_defaults_missing_rows_and_empty_visits_do_not_certify_evidence(data):
    db, a, _, towers, _ = data
    _, p = visit(db, a, towers[0])
    db.add_all([Image(position_id=p.id, image_type=kind, evidence_status='NOT REQUIRED') for kind in IMAGE_TYPE_CHOICES])
    db.add(Visit(team_id=a.id, tower_id=towers[1].id, inspection_date=dt.date(2026, 9, 11)))
    rows = result(data)['teams'][0]['towers']
    assert rows[0]['missing_categories'] == 4 and not rows[0]['four_category_coverage']
    assert not rows[1]['screening_ready'] and not rows[1]['screening_and_evidence_ready']
    assert rows[1]['visit_id'] is not None


def test_excluded_and_noninstalled_positions_do_not_inflate_expected_categories(data):
    db, a, _, towers, _ = data
    v, p = visit(db, a, towers[0])
    for kind in IMAGE_TYPE_CHOICES: image(db, p, kind)
    db.add(Position(visit_id=v.id, ohl='OHL1', phase='Y', string='S1', in_scope=False))
    db.add(Position(visit_id=v.id, ohl='OHL1', phase='B', string='S1', installed=False))
    row = result(data)['teams'][0]['towers'][0]
    assert row['installed_positions'] == 1 and row['expected_categories'] == 4
    assert row['screening_and_evidence_ready']
    p.prepared_only = True
    assert result(data)['teams'][0]['towers'][0]['screening_ready']
    p.screening_result = 'Not inspected'
    assert not result(data)['teams'][0]['towers'][0]['screening_ready']


def test_inactive_and_unassigned_inventory_are_separate(data):
    db, a, _, towers, _ = data
    towers[1].is_active = False
    db.add(Tower(tower_id='Unassigned'))
    r = result(data)
    assert r['totals']['assigned'] == 2
    assert r['inactive_inventory'] == 1 and r['unassigned_active'] == 1


def test_leader_scope_hides_other_team_and_inventory(data):
    db, a, _, towers, _ = data
    _, p = visit(db, a, towers[2]); image(db, p)
    leader = User(username='leader', hashed_password='x', role='team_leader', team_id=a.id)
    db.add(leader); db.commit()
    r = tower_reconciliation(db=db, user=leader)
    assert [team['id'] for team in r['teams']] == [a.id]
    assert r['inactive_inventory'] is None
    assert r['teams'][0]['outside_assignment'][0]['assigned_team_name'] is None
    leader.team_id = None; db.commit()
    assert tower_reconciliation(db=db, user=leader)['teams'] == []


@pytest.mark.parametrize('role', ['client', 'team_member'])
def test_nonprivileged_roles_are_denied(data, role):
    db, a, _, _, _ = data
    actor = User(username='actor', hashed_password='x', role=role, team_id=a.id)
    with pytest.raises(HTTPException) as error:
        tower_reconciliation(db=db, user=actor)
    assert error.value.status_code == 403


def test_restricted_admin_requires_teams_or_archive_menu(data):
    db, _, _, _, admin = data
    admin.is_super_admin = False
    admin.menu_permissions_csv = ''
    with pytest.raises(HTTPException): tower_reconciliation(db=db, user=admin)
    admin.menu_permissions_csv = 'archive:view'
    assert len(tower_reconciliation(db=db, user=admin)['teams']) == 2


def test_query_count_does_not_grow_per_tower_and_service_is_read_only(data):
    db, a, _, _, _ = data
    for i in range(25):
        t = Tower(tower_id=f'Extra-{i}', assigned_team_id=a.id)
        db.add(t); db.flush(); visit(db, a, t)
    db.commit()
    tid = a.id
    statements = []
    def track(conn, cursor, statement, parameters, context, executemany): statements.append(statement)
    event.listen(db.bind, 'before_cursor_execute', track)
    reconcile_towers(db, [tid], include_inventory=True)
    event.remove(db.bind, 'before_cursor_execute', track)
    assert len(statements) <= 8
    assert all(statement.lstrip().upper().startswith('SELECT') for statement in statements)
    assert not db.dirty and not db.new and not db.deleted
