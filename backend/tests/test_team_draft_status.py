from tests.test_visit_entry import db, files, make_visit, save, upload
from app.models import Team, User, VisitEntryDraft, VisitDraftImage
from app.routers.teams import list_missions
from app.routers.visit_entry import discard_entry, DraftRevision


def team_visit(db):
    visit, user = make_visit(db)
    team = Team(name='Draft team')
    db.add(team); db.flush()
    visit.team_id = team.id
    db.commit()
    return visit, user, team


def test_drafts_stay_private_and_never_change_confirmed_counts(db):
    visit, user, team = team_visit(db)
    other = User(username='other', hashed_password='unused', role='admin')
    db.add(other); db.commit()
    before = list_missions(team.id, db, user)[0].rollup
    state = save(db, visit, user, {'headerDraft': {'inspector_name': 'Unsaved inspector'}})
    mine = list_missions(team.id, db, user)[0]
    assert mine.has_working_draft and mine.inspector_name is None and mine.rollup == before
    assert not list_missions(team.id, db, other)[0].has_working_draft
    discard_entry(visit.id, DraftRevision(revision=state['revision']), db, user)
    assert not list_missions(team.id, db, user)[0].has_working_draft


def test_empty_payload_fields_do_not_count_but_unconsumed_evidence_does(db, files):
    visit, user, team = team_visit(db)
    state = save(db, visit, user, {'drafts': {}, 'additions': [], 'headerDraft': None, 'layoutIds': None, 'excludedImages': []})
    assert not list_missions(team.id, db, user)[0].has_working_draft
    pos = visit.positions[0]
    upload(db, visit, user, pos.id, state['revision'], expected=pos.updated_at)
    assert list_missions(team.id, db, user)[0].has_working_draft
    image = db.query(VisitDraftImage).one()
    image.consumed = True; db.commit()
    assert not list_missions(team.id, db, user)[0].has_working_draft
