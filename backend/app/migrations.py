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
