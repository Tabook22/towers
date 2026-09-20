"""The Image Archive page groups images by team, then year/month, then line (Tower.area), then
tower, then insulator (position) — see routers/archive.browse_archive and ArchiveImageOut. This
verifies the extra grouping fields actually get populated from the joined Team/Tower/Position."""
import datetime as dt

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Image, Position, Team, Tower, User, Visit, VisitPhoto
from app.routers.archive import browse_archive


def _engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine


def test_archive_rows_carry_team_line_tower_and_insulator_context():
    engine = _engine()
    with Session(engine) as db:
        team = Team(name="Nabil-Team")
        tower = Tower(tower_id="Ashoor-Saada-1", area="Ashoor-Saada")
        db.add_all([team, tower])
        db.flush()

        visit = Visit(tower_id=tower.id, team_id=team.id, inspection_date=dt.date(2026, 9, 1))
        db.add(visit)
        db.flush()

        pos = Position(
            visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor",
            position_code="AshoorSaada1-OHL1-R-S1-Ashoor",
        )
        db.add(pos)
        db.flush()

        img = Image(
            position_id=pos.id, image_type="TH Full", capture_date=dt.date(2026, 9, 1),
            file_path="some/path.jpg",
        )
        db.add(img)
        db.commit()

        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        rows = browse_archive(db=db, user=admin).images
        assert len(rows) == 1
        row = rows[0]
        assert row.team_id == team.id
        assert row.team_name == "Nabil-Team"
        assert row.tower_code == "Ashoor-Saada-1"
        assert row.area == "Ashoor-Saada"
        assert row.position_code == "AshoorSaada1-OHL1-R-S1-Ashoor"
        assert row.ohl == "OHL1" and row.phase == "R" and row.string == "S1"


def test_team_id_filter_scopes_the_archive():
    engine = _engine()
    with Session(engine) as db:
        team_a = Team(name="Alpha")
        team_b = Team(name="Bravo")
        tower_a = Tower(tower_id="T-1")
        tower_b = Tower(tower_id="T-2")
        db.add_all([team_a, team_b, tower_a, tower_b])
        db.flush()

        visit_a = Visit(tower_id=tower_a.id, team_id=team_a.id, inspection_date=dt.date(2026, 9, 1))
        visit_b = Visit(tower_id=tower_b.id, team_id=team_b.id, inspection_date=dt.date(2026, 9, 1))
        db.add_all([visit_a, visit_b])
        db.flush()

        pos_a = Position(visit_id=visit_a.id, ohl="OHL1", phase="R", string="S1")
        pos_b = Position(visit_id=visit_b.id, ohl="OHL1", phase="R", string="S1")
        db.add_all([pos_a, pos_b])
        db.flush()

        db.add_all(
            [
                Image(position_id=pos_a.id, image_type="TH Full", capture_date=dt.date(2026, 9, 1), file_path="a.jpg"),
                Image(position_id=pos_b.id, image_type="TH Full", capture_date=dt.date(2026, 9, 1), file_path="b.jpg"),
            ]
        )
        db.commit()

        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        rows = browse_archive(db=db, user=admin, team_id=team_a.id).images
        assert len(rows) == 1
        assert rows[0].team_name == "Alpha"


def test_archive_includes_visit_photos_tagged_and_untagged():
    engine = _engine()
    with Session(engine) as db:
        team = Team(name="Nabil-Team")
        tower = Tower(tower_id="Ashoor-Saada-1", area="Ashoor-Saada")
        db.add_all([team, tower])
        db.flush()

        visit = Visit(tower_id=tower.id, team_id=team.id, inspection_date=dt.date(2026, 9, 1))
        db.add(visit)
        db.flush()

        pos = Position(
            visit_id=visit.id, ohl="OHL1", phase="R", string="S1", direction="Ashoor",
            position_code="AshoorSaada1-OHL1-R-S1-Ashoor",
        )
        db.add(pos)
        db.flush()

        db.add_all(
            [
                VisitPhoto(visit_id=visit.id, position_id=pos.id, file_path="tagged.jpg"),
                VisitPhoto(visit_id=visit.id, position_id=None, file_path="ungrouped.jpg"),
            ]
        )
        db.commit()

        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        result = browse_archive(db=db, user=admin)
        assert len(result.images) == 0
        assert len(result.photos) == 2
        tagged = next(p for p in result.photos if p.position_id == pos.id)
        untagged = next(p for p in result.photos if p.position_id is None)
        assert tagged.position_code == "AshoorSaada1-OHL1-R-S1-Ashoor"
        assert tagged.tower_code == "Ashoor-Saada-1"
        assert tagged.team_name == "Nabil-Team"
        assert untagged.tower_code == "Ashoor-Saada-1"


def test_archive_image_type_filter_excludes_visit_photos():
    engine = _engine()
    with Session(engine) as db:
        tower = Tower(tower_id="T-1")
        db.add(tower)
        db.flush()
        visit = Visit(tower_id=tower.id, inspection_date=dt.date(2026, 9, 1))
        db.add(visit)
        db.flush()
        db.add(VisitPhoto(visit_id=visit.id, file_path="a.jpg"))
        db.commit()

        admin = User(username="admin", role="admin", hashed_password="x")
        db.add(admin)
        db.commit()

        result = browse_archive(db=db, user=admin, image_type="TH Full")
        assert result.photos == []
