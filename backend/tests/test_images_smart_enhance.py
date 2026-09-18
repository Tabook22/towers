""""Auto enhance selected insulator" (routers/images.py's POST /{image_id}/smart-enhance) — a
ROI-aware bilateral-filter + auto-levels + unsharp-mask pass, computed from a box the caller drew
around the insulator string rather than the whole photo, so an unrelated bright/dark object
elsewhere in frame can't skew it. Also covers services/smart_enhance.py's geometry estimate
directly, since that's the part most likely to misbehave on real, noisy photos."""
import asyncio
import io

import cv2
import numpy as np
import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.database import Base
from app.models import Image, Position, Tower, User, Visit
from app.routers import images
from app.services.smart_enhance import estimate_geometry, smart_enhance


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _setup(db: Session):
    tower = Tower(tower_id="T50", voltage="132 kV", area="Dufar")
    db.add(tower)
    db.flush()
    visit = Visit(tower_id=tower.id)
    db.add(visit)
    db.flush()
    pos = Position(visit_id=visit.id, ohl="OHL1", phase="R", string="S1")
    db.add(pos)
    db.flush()
    img = Image(position_id=pos.id, image_type="TH Full", file_path="whatever.jpg")
    db.add(img)
    db.commit()
    return img


def _synthetic_jpeg(width=200, height=300) -> bytes:
    frame = np.full((height, width, 3), 40, dtype=np.uint8)
    for i in range(6):
        cv2.circle(frame, (width // 2, 20 + i * 40), 14, (210, 210, 210), -1)
    ok, encoded = cv2.imencode(".jpg", frame)
    assert ok
    return encoded.tobytes()


def _upload_file(content: bytes, content_type="image/jpeg") -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename="photo.jpg", headers=Headers({"content-type": content_type}))


def test_smart_enhance_requires_visit_team_access(db: Session):
    img = _setup(db)
    leader = User(username="leader1", role="team_leader", team_id=999, hashed_password="x")  # a different team
    db.add(leader)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            images.smart_enhance_image(
                img.id,
                file=_upload_file(_synthetic_jpeg()),
                roi_x=50,
                roi_y=0,
                roi_w=100,
                roi_h=300,
                strength="balanced",
                db=db,
                user=leader,
            )
        )
    assert exc.value.status_code == 403


def test_smart_enhance_rejects_unknown_strength(db: Session):
    img = _setup(db)
    admin = User(username="admin", role="admin", is_super_admin=True, hashed_password="x")
    db.add(admin)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            images.smart_enhance_image(
                img.id,
                file=_upload_file(_synthetic_jpeg()),
                roi_x=50,
                roi_y=0,
                roi_w=100,
                roi_h=300,
                strength="extreme",
                db=db,
                user=admin,
            )
        )
    assert exc.value.status_code == 400


def test_smart_enhance_returns_a_valid_jpeg_and_geometry_estimate(db: Session):
    img = _setup(db)
    admin = User(username="admin", role="admin", is_super_admin=True, hashed_password="x")
    db.add(admin)
    db.commit()
    out = asyncio.run(
        images.smart_enhance_image(
            img.id,
            file=_upload_file(_synthetic_jpeg()),
            roi_x=50,
            roi_y=0,
            roi_w=100,
            roi_h=300,
            strength="balanced",
            db=db,
            user=admin,
        )
    )
    assert out.confidence in ("estimated", "fallback")
    assert 0 <= out.direction_deg <= 90
    assert out.pitch_px > 0

    import base64

    decoded = base64.b64decode(out.image_base64)
    assert decoded.startswith(b"\xff\xd8")  # JPEG magic bytes
    frame = cv2.imdecode(np.frombuffer(decoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert frame is not None and frame.shape == (300, 200, 3)


def test_smart_enhance_rejects_oversized_upload(db: Session, monkeypatch):
    img = _setup(db)
    admin = User(username="admin", role="admin", is_super_admin=True, hashed_password="x")
    db.add(admin)
    db.commit()
    monkeypatch.setattr(images.settings, "max_upload_size_mb", 0)  # anything at all now exceeds it
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            images.smart_enhance_image(
                img.id,
                file=_upload_file(_synthetic_jpeg()),
                roi_x=0,
                roi_y=0,
                roi_w=10,
                roi_h=10,
                strength="balanced",
                db=db,
                user=admin,
            )
        )
    assert exc.value.status_code == 413


def test_geometry_estimate_falls_back_cleanly_on_a_blank_roi():
    blank = np.full((80, 80, 3), 100, dtype=np.uint8)
    direction_deg, pitch_px, confidence = estimate_geometry(blank)
    assert confidence == "fallback"
    assert pitch_px > 0
    assert direction_deg == 0.0


def test_smart_enhance_clamps_a_roi_that_runs_outside_the_image():
    frame = np.full((100, 100, 3), 60, dtype=np.uint8)
    result, direction_deg, pitch_px, confidence = smart_enhance(frame, (90, 90, 500, 500), "gentle")
    assert result.shape == frame.shape
    assert confidence in ("estimated", "fallback")
