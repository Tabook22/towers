"""SQLAlchemy engine/session setup."""
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

def create_database_engine(database_url):
    sqlite = make_url(database_url).get_backend_name() == "sqlite"
    args = {"check_same_thread": False, "timeout": 30} if sqlite else {}
    instance = create_engine(database_url, connect_args=args)
    if sqlite:
        @event.listens_for(instance, "connect")
        def configure_connection(connection, _):
            cursor = connection.cursor()
            try:
                cursor.execute("PRAGMA busy_timeout=30000")
                cursor.execute("PRAGMA synchronous=FULL")
            finally:
                cursor.close()

        if make_url(database_url).database not in (None, "", ":memory:"):
            @event.listens_for(instance, "first_connect")
            def enable_concurrent_reads(connection, _):
                # WAL is persistent and allows account/report reads during field saves.
                # The snapshot service uses SQLite backup(), including committed WAL data.
                cursor = connection.cursor()
                try:
                    cursor.execute("PRAGMA journal_mode=WAL")
                    if cursor.fetchone()[0].lower() != "wal":
                        raise RuntimeError("Could not enable concurrent database reads")
                finally:
                    cursor.close()
    return instance


engine = create_database_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def database_error_response(request, exc):
    from fastapi.responses import JSONResponse
    code = getattr(exc.orig, "sqlite_errorcode", 0) or 0
    if (code & 255) in (5, 6):  # SQLITE_BUSY/SQLITE_LOCKED, including extended codes.
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "10"},
            content={"detail": "The database is busy saving another change. Please wait a few seconds and try again."},
        )
    return JSONResponse(status_code=500, content={"detail": "A database error prevented this operation. Please try again."})
