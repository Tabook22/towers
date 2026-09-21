"""Seed script: creates demo users, 3 demo towers (ARSD 92/93/94, Dufar) with one
inspection visit each, and pre-populates a couple of positions so the dashboard
and reports have something to show. Run with:

    python -m app.seed
"""
from __future__ import annotations

import datetime as dt

from app.database import Base, SessionLocal, engine
from app.migrations import (
    add_missing_columns,
    rebuild_images_table_for_multi_image_support,
    rebuild_positions_table_for_multi_direction_support,
)
from app.models import (
    DIRECTION_CHOICES,
    IMAGE_TYPE_CHOICES,
    OHL_CHOICES,
    PHASE_CHOICES,
    STRING_CHOICES,
    Image,
    Position,
    Tower,
    User,
    Visit,
)
from app.security import hash_password
from app.services.codes import refresh_position_codes

Base.metadata.create_all(bind=engine)
rebuild_images_table_for_multi_image_support(engine)
rebuild_positions_table_for_multi_direction_support(engine)
add_missing_columns(engine, Base)


def run():
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "admin").first():
            db.add(
                User(
                    username="admin",
                    email="admin@example.com",
                    full_name="System Administrator",
                    hashed_password=hash_password("Admin123!"),
                    role="admin",
                )
            )
            db.add(
                User(
                    username="inspector1",
                    full_name="Field Inspector",
                    hashed_password=hash_password("Inspect123!"),
                    role="inspector",
                )
            )
            db.commit()
            print("Seeded users: admin/Admin123!  inspector1/Inspect123!")

        # Coordinates are small offsets around Salalah, Oman (17.01972°N 54.08972°E) — the real city
        # at the center of the Dhofar/"Dufar" governorate, not the Abu Dhabi-area point this used to
        # use by mistake.
        demo_towers = [
            {"tower_id": "ARSD 92", "voltage": "132 kV", "area": "Dufar", "latitude": 17.0197, "longitude": 54.0897},
            {"tower_id": "ARSD 93", "voltage": "132 kV", "area": "Dufar", "latitude": 17.0259, "longitude": 54.0946},
            {"tower_id": "ARSD 94", "voltage": "132 kV", "area": "Dufar", "latitude": 17.0323, "longitude": 54.1012},
        ]

        admin = db.query(User).filter(User.username == "admin").first()

        for spec in demo_towers:
            tower = db.query(Tower).filter(Tower.tower_id == spec["tower_id"]).first()
            if tower:
                continue
            tower = Tower(**spec)
            db.add(tower)
            db.flush()

            visit = Visit(
                tower_id=tower.id,
                inspection_date=dt.date.today(),
                inspector_name="Field Inspector",
                latitude=spec["latitude"],
                longitude=spec["longitude"],
                weather_wind="Clear, 12 km/h NE",
                electrical_load="Normal",
                camera_drone="DJI Matrice 300 + H20T",
                thermal_mode="Radiometric",
                emissivity=0.95,
                reflected_temp=28.0,
                permit_job_no=f"JOB-{tower.tower_id.replace(' ', '')}-{dt.date.today().year}",
                status="draft",
                created_by=admin.id if admin else None,
            )
            db.add(visit)
            db.flush()

            i = 0
            for ohl in OHL_CHOICES:
                for phase in PHASE_CHOICES:
                    for string in STRING_CHOICES:
                        direction = DIRECTION_CHOICES[i % len(DIRECTION_CHOICES)]
                        i += 1
                        screening = "Not inspected"
                        pos = Position(
                            visit_id=visit.id,
                            ohl=ohl,
                            phase=phase,
                            string=string,
                            direction=direction,
                            installed=True,
                            screening_result=screening,
                        )
                        db.add(pos)
                        db.flush()
                        for img_type in IMAGE_TYPE_CHOICES:
                            db.add(Image(position_id=pos.id, image_type=img_type, evidence_status="NOT REQUIRED"))
                        db.flush()
                        pos.visit = visit
                        refresh_position_codes(pos)

            # Make the first tower's first position a flagged example
            if spec["tower_id"] == "ARSD 92":
                first = visit.positions[0]
                first.screening_result = "Hotspot detected"
                first.hotspot = "Yes"
                first.tmax_c = 68.4
                first.tref_c = 32.1
                first.severity = "High"
                first.confidence = "High"
                first.inspector_notes = "Elevated cap temperature on windward disc, consistent with a bad contact joint."
                refresh_position_codes(first)

            db.commit()
            print(f"Seeded tower {tower.tower_id} with 1 visit and 12 positions")

    finally:
        db.close()


if __name__ == "__main__":
    run()
