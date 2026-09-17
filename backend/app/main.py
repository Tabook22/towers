from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.migrations import (
    add_missing_columns,
    backfill_areas_from_towers,
    backfill_visit_team_id_from_towers,
    rebuild_images_table_for_multi_image_support,
)
from app.routers import (
    app_settings,
    archive,
    areas,
    auth,
    channel,
    claims,
    dashboard,
    help_chat,
    images,
    lists,
    positions,
    report_templates,
    reports,
    team_archive,
    teams,
    towers,
    tracking,
    visits,
)

Base.metadata.create_all(bind=engine)
rebuild_images_table_for_multi_image_support(engine)
add_missing_columns(engine, Base)
backfill_areas_from_towers(engine)
backfill_visit_team_id_from_towers(engine)

app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Content-Disposition isn't on the CORS response-header safelist by default — without this, JS
    # `fetch`/axios can't read the server-suggested filename on a cross-origin file download (e.g.
    # the field-execution-plan .docx), even though the browser's own direct-navigation downloads
    # (plain <a href> links) were never affected by this.
    expose_headers=["Content-Disposition"],
)

app.include_router(auth.router)
app.include_router(app_settings.router)
app.include_router(areas.router)
app.include_router(towers.router)
app.include_router(visits.router)
app.include_router(positions.router)
app.include_router(images.router)
app.include_router(archive.router)
app.include_router(dashboard.router)
app.include_router(reports.router)
app.include_router(report_templates.router)
app.include_router(lists.router)
app.include_router(tracking.router)
app.include_router(teams.router)
app.include_router(channel.router)
app.include_router(claims.router)
app.include_router(help_chat.router)
app.include_router(team_archive.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.app_name}
