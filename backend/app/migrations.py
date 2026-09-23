"""Lightweight additive-only migration, run once at startup after `Base.metadata.create_all()`.

There's no Alembic in this project (see README's "deviations" note) — `create_all()` creates
brand-new tables but never alters existing ones, so a new nullable column added to a model (like
Tower.tower_type) would otherwise silently vanish from real requests against an already-existing
SQLite file. This scans for exactly that case and adds the missing column via `ALTER TABLE ...
ADD COLUMN`, which SQLite supports for nullable/defaulted columns. It never drops or modifies an
existing column — if the schema ever needs a real migration (renames, constraints, data backfills),
move to Alembic instead of extending this.
"""
from __future__ import annotations

import logging

from sqlalchemy import Engine, inspect, text
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.schema import CreateColumn, CreateTable

logger = logging.getLogger(__name__)


def rebuild_images_table_for_multi_image_support(engine: Engine) -> None:
    """One-off structural migration for the `images` table.

    Positions used to allow exactly one image per type (TH Full/TH Close/RGB Full/RGB Close),
    enforced by a UNIQUE(position_id, image_type) constraint. Supporting extra gallery images of
    the same type meant dropping that constraint and adding a `sequence` column — SQLite can't
    ALTER a UNIQUE constraint away, so this rebuilds the table the standard SQLite way: rename the
    old table aside, create the new one from the current model (via SQLAlchemy's own DDL compiler,
    so it always matches whatever `Image.__table__` currently says), copy over every column the old
    table actually had, then drop the old one.

    Safe to call on every startup — it's a no-op once `sequence` already exists on the table.
    """
    from app.models import Image  # local import: models.py doesn't need to know about migrations.py

    inspector = inspect(engine)
    if "images" not in inspector.get_table_names():
        return  # brand-new DB — create_all() already builds the current (correct) schema
    existing_columns = {c["name"] for c in inspector.get_columns("images")}
    if "sequence" in existing_columns:
        return  # already migrated

    logger.info("Auto-migration: rebuilding images table to allow more than one image per type")
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE "images" RENAME TO "images_old"'))
        conn.execute(CreateTable(Image.__table__))
        shared_cols = [f'"{c.name}"' for c in Image.__table__.columns if c.name in existing_columns]
        cols_sql = ", ".join(shared_cols)
        conn.execute(text(f'INSERT INTO "images" ({cols_sql}) SELECT {cols_sql} FROM "images_old"'))
        conn.execute(text('DROP TABLE "images_old"'))


def rebuild_positions_table_for_multi_direction_support(engine: Engine) -> None:
    """One-off structural migration for the `positions` table.

    A position used to be capped at exactly one row per (visit, ohl, phase, string) — enforced by a
    UNIQUE(visit_id, ohl, phase, string) constraint — because Direction was purely a label on that
    one row. A Tension-type tower can now carry the same OHL/phase/string out toward more than one
    line Direction, each needing its own row, so the constraint gains `direction` as a column.
    SQLite can't ALTER a UNIQUE constraint away, so this rebuilds the table the same way
    rebuild_images_table_for_multi_image_support does above: rename the old table aside, create the
    new one from the current model, copy every column the old table had, then drop the old one.

    Safe to call on every startup — it's a no-op once the constraint already includes `direction`.
    """
    from app.models import Position  # local import: models.py doesn't need to know about migrations.py

    inspector = inspect(engine)
    if "positions" not in inspector.get_table_names():
        return  # brand-new DB — create_all() already builds the current (correct) schema
    already_migrated = any(
        "direction" in (uc.get("column_names") or []) for uc in inspector.get_unique_constraints("positions")
    )
    if already_migrated:
        return
    existing_columns = {c["name"] for c in inspector.get_columns("positions")}

    logger.info("Auto-migration: rebuilding positions table to allow more than one direction per slot")
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE "positions" RENAME TO "positions_old"'))
        conn.execute(CreateTable(Position.__table__))
        shared_cols = [f'"{c.name}"' for c in Position.__table__.columns if c.name in existing_columns]
        cols_sql = ", ".join(shared_cols)
        conn.execute(text(f'INSERT INTO "positions" ({cols_sql}) SELECT {cols_sql} FROM "positions_old"'))
        conn.execute(text('DROP TABLE "positions_old"'))


def backfill_areas_from_towers(engine: Engine) -> None:
    """One-time seed for the new `areas` catalog table (see models.Area): every distinct
    Tower.area value that already exists in real data gets its own Area row, so nothing an admin
    was already relying on (a filter dropdown, a report) silently loses an entry just because the
    catalog table used to not exist. Safe to call on every startup — only inserts names that aren't
    already there."""
    from app.models import Area, Tower  # local import: models.py doesn't need to know about migrations.py

    inspector = inspect(engine)
    if "towers" not in inspector.get_table_names() or "areas" not in inspector.get_table_names():
        return  # brand-new DB — nothing to backfill from, or the table isn't created yet
    with engine.begin() as conn:
        existing = {row[0] for row in conn.execute(text('SELECT name FROM "areas"'))}
        tower_areas = {row[0] for row in conn.execute(text('SELECT DISTINCT area FROM "towers" WHERE area IS NOT NULL'))}
        missing = sorted(tower_areas - existing)
        for name in missing:
            conn.execute(text('INSERT INTO "areas" (name, created_at, updated_at) VALUES (:n, :t, :t)'), {"n": name, "t": dt_now_iso()})
        if missing:
            logger.info("Auto-migration: seeded %d area(s) from existing tower data: %s", len(missing), missing)


def backfill_visit_team_id_from_towers(engine: Engine) -> None:
    """One-time repair for visits created with no team_id at all.

    `POST /api/visits` (the tower detail page's "Start new visit") used to only auto-fill team_id
    for a team_member login, not a team_leader — so a leader-started visit on their own team's
    tower could end up with team_id NULL. check_visit_team_access() then locked that same leader
    out of the visit they'd just created (a visit with no team is nobody's team). Fixed going
    forward in routers/visits.py's create_visit(); this repairs any such visit already sitting in
    the database, from the tower's current assignment. Safe to call on every startup — only touches
    rows where team_id is still NULL and the tower has since been assigned to exactly one team.
    """
    inspector = inspect(engine)
    if "visits" not in inspector.get_table_names() or "towers" not in inspector.get_table_names():
        return  # brand-new DB
    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                UPDATE visits
                SET team_id = (SELECT assigned_team_id FROM towers WHERE towers.id = visits.tower_id)
                WHERE team_id IS NULL
                  AND tower_id IN (SELECT id FROM towers WHERE assigned_team_id IS NOT NULL)
                """
            )
        )
        if result.rowcount:
            logger.info("Auto-migration: backfilled team_id on %d visit(s) from their tower's assignment", result.rowcount)


def backfill_report_type(engine: Engine) -> None:
    """One-time fill-in for LineInspectionReport.report_type on rows generated before that column
    existed — 'tower' when the row was scoped to one tower, otherwise 'team' (an older
    area/consolidated section can't be told apart from a plain team report in hindsight, since that
    distinction wasn't tracked yet; it just shows up under the wrong filter facet in the client
    portal, never affecting what the report actually contains). Safe to call on every startup —
    only touches rows where report_type is still NULL."""
    inspector = inspect(engine)
    if "line_inspection_reports" not in inspector.get_table_names():
        return  # brand-new DB
    existing_columns = {c["name"] for c in inspector.get_columns("line_inspection_reports")}
    if "report_type" not in existing_columns:
        return  # add_missing_columns hasn't added it yet this run — next startup will backfill
    with engine.begin() as conn:
        result = conn.execute(
            text(
                """
                UPDATE line_inspection_reports
                SET report_type = CASE WHEN tower_id IS NOT NULL THEN 'tower' ELSE 'team' END
                WHERE report_type IS NULL
                """
            )
        )
        if result.rowcount:
            logger.info("Auto-migration: backfilled report_type on %d report row(s)", result.rowcount)


def backfill_menu_permissions(engine: Engine) -> None:
    """One-time fill-in for User.menu_permissions_csv on accounts created before that column
    existed — set to deps.default_menu_permissions_for_role(role), which reproduces exactly what
    that role's sidebar looked like under the old hardcoded nav logic in frontend Layout.tsx, so no
    existing account's menu silently changes until an admin deliberately edits it. Safe to call on
    every startup — only touches rows where menu_permissions_csv is still NULL."""
    from app.deps import default_menu_permissions_for_role  # local import: avoids a migrations<->deps import cycle at module load

    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return  # brand-new DB
    existing_columns = {c["name"] for c in inspector.get_columns("users")}
    if "menu_permissions_csv" not in existing_columns:
        return  # add_missing_columns hasn't added it yet this run — next startup will backfill
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, role FROM users WHERE menu_permissions_csv IS NULL")).fetchall()
        for user_id, role in rows:
            perms = default_menu_permissions_for_role(role)
            csv_value = ",".join(f"{k}:{v}" for k, v in perms.items()) or None
            conn.execute(
                text("UPDATE users SET menu_permissions_csv = :csv WHERE id = :id"),
                {"csv": csv_value, "id": user_id},
            )
        if rows:
            logger.info("Auto-migration: backfilled menu_permissions_csv on %d user(s)", len(rows))


def dt_now_iso() -> str:
    import datetime as dt

    return dt.datetime.utcnow().isoformat(sep=" ")


def add_missing_columns(engine: Engine, base: type[DeclarativeBase]) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # brand-new table — create_all() already created it with every column
            existing_columns = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                if not column.nullable and column.server_default is None:
                    logger.warning(
                        "Skipping auto-migration of %s.%s: NOT NULL with no default — add it via a"
                        " real migration.",
                        table.name,
                        column.name,
                    )
                    continue
                # `CreateColumn` (the same compiler SQLAlchemy uses for CREATE TABLE) rather than
                # just `column.type.compile(...)` — the latter emits only the bare type (e.g.
                # "VARCHAR(10)"), silently dropping any `server_default`. SQLite's `ALTER TABLE ...
                # ADD COLUMN` without an explicit DEFAULT clause sets every *existing* row's new
                # column to NULL regardless of what server_default says — only fresh INSERTs that
                # omit the column would ever see it applied. A NOT NULL column with a server_default
                # (this method's own condition for proceeding at all, two lines up) means the model
                # promises existing rows get a real backfilled value, not NULL, so the DEFAULT clause
                # has to actually be in this statement for that promise to hold.
                col_def = str(CreateColumn(column).compile(dialect=engine.dialect))
                try:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN {col_def}'))
                    logger.info("Auto-migration: added column %s.%s", table.name, column.name)
                except Exception:
                    logger.exception("Auto-migration failed for %s.%s", table.name, column.name)
