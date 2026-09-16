"""Team archive images: the storage path format, and — most important — that a team_leader/member
account can only ever see their own team's uploads through list_team_archive_images, the same
server-side wall the rest of this app enforces (not just a UI hide)."""
import datetime as dt

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Team, TeamArchiveImage, User
from app.routers.team_archive import list_team_archive_images
from app.services.archive import team_archive_relative_path


def test_team_archive_relative_path_format():
    rel = team_archive_relative_path(7, dt.date(2026, 9, 16), "img-abc123", ".jpg")
    assert rel == "team_archive/team-7/2026/09/16/img-abc123.jpg"


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def _seed(db: Session):
    alpha = Team(name="Alpha")
    bravo = Team(name="Bravo")
    db.add_all([alpha, bravo])
    db.flush()
    db.add_all(
        [
            TeamArchiveImage(
                team_id=alpha.id,
                capture_date=dt.date(2026, 9, 10),
                file_path="team_archive/team-a/2026/09/10/img-1.jpg",
            ),
            TeamArchiveImage(
                team_id=bravo.id,
                capture_date=dt.date(2026, 9, 12),
                file_path="team_archive/team-b/2026/09/12/img-2.jpg",
            ),
        ]
    )
    db.commit()
    return alpha, bravo


def test_team_leader_only_sees_their_own_team():
    engine = _engine()
    with Session(engine) as db:
        alpha, bravo = _seed(db)
        leader = User(username="lead-alpha", role="team_leader", team_id=alpha.id, hashed_password="x")
        db.add(leader)
        db.commit()

        out = list_team_archive_images(db=db, user=leader, team_id=None, year=None, month=None, day=None)
        assert len(out) == 1
        assert out[0].team_id == alpha.id
        assert out[0].team_name == "Alpha"

        # Even asking for the other team explicitly must not leak it — a team_leader's request
        # ignores team_id and is always scoped server-side to their own team.
        other_team_id = bravo.id
        out2 = list_team_archive_images(db=db, user=leader, team_id=other_team_id, year=None, month=None, day=None)
        assert len(out2) == 1
        assert out2[0].team_id == alpha.id


def test_admin_sees_all_and_can_filter_by_date():
    engine = _engine()
    with Session(engine) as db:
        alpha, bravo = _seed(db)
        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        out_all = list_team_archive_images(db=db, user=admin, team_id=None, year=None, month=None, day=None)
        assert len(out_all) == 2

        out_sep = list_team_archive_images(db=db, user=admin, team_id=None, year=2026, month=9, day=10)
        assert len(out_sep) == 1
        assert out_sep[0].team_id == alpha.id

        out_team = list_team_archive_images(db=db, user=admin, team_id=bravo.id, year=None, month=None, day=None)
        assert len(out_team) == 1
        assert out_team[0].team_id == bravo.id
