"""Application configuration."""
from pathlib import Path

from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_name: str = "Insulator Inspector Pro"
    database_url: str = f"sqlite:///{BASE_DIR / 'storage' / 'insulator_inspector.db'}"
    storage_dir: Path = BASE_DIR / "storage"
    images_dir: Path = BASE_DIR / "storage" / "images"
    thumbnails_dir: Path = BASE_DIR / "storage" / "thumbnails"
    reports_dir: Path = BASE_DIR / "storage" / "reports"
    # A single reference/context photo per tower (what the structure looks like) — distinct from the
    # per-position inspection evidence images under images_dir/thumbnails_dir.
    tower_photos_dir: Path = BASE_DIR / "storage" / "tower_photos"
    tower_photo_thumbnails_dir: Path = BASE_DIR / "storage" / "tower_photo_thumbnails"
    # User-uploaded .docx report templates (see models.ReportTemplate / services/docx_reports.py).
    report_templates_dir: Path = BASE_DIR / "storage" / "report_templates"

    secret_key: str = "dev-secret-key-change-me-in-production-please"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12  # 12 hours, field crews work long days

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]

    max_upload_size_mb: int = 40

    class Config:
        env_file = ".env"


settings = Settings()

for d in (
    settings.storage_dir,
    settings.images_dir,
    settings.thumbnails_dir,
    settings.reports_dir,
    settings.tower_photos_dir,
    settings.tower_photo_thumbnails_dir,
    settings.report_templates_dir,
):
    d.mkdir(parents=True, exist_ok=True)
