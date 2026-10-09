"""Real SQLite concurrency regression: report/account reads must not block behind writes."""
import sqlite3
import threading
import time

from sqlalchemy import text
from app.database import create_database_engine


def test_account_read_and_queued_write_during_uncommitted_save(tmp_path):
    path = tmp_path / "busy.sqlite3"
    engine = create_database_engine("sqlite:///" + str(path))
    with engine.begin() as c:
        c.execute(text("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)"))
        c.execute(text("INSERT INTO records VALUES (1, 'original')"))
    writer = engine.connect()
    transaction = writer.begin()
    writer.execute(text("UPDATE records SET value='field save' WHERE id=1"))
    with engine.connect() as reader:
        assert reader.scalar(text("PRAGMA journal_mode")) == "wal"
        assert reader.scalar(text("PRAGMA synchronous")) == 2
        assert reader.scalar(text("PRAGMA busy_timeout")) == 30000
        assert reader.scalar(text("SELECT value FROM records WHERE id=1")) == "original"
    started = threading.Event()
    errors = []
    def second_save():
        try:
            with engine.begin() as c:
                started.set()
                c.execute(text("INSERT INTO records VALUES (2, 'report saved')"))
        except Exception as e:
            errors.append(e)
    worker = threading.Thread(target=second_save)
    worker.start()
    assert started.wait(2)
    time.sleep(.1)  # Make the second writer encounter the held SQLite transaction.
    transaction.commit()
    writer.close()
    worker.join(5)
    assert not worker.is_alive()
    assert not errors
    with engine.connect() as c:
        assert c.execute(text("SELECT value FROM records ORDER BY id")).scalars().all() == ["field save", "report saved"]
    # Backup must include committed writes from the WAL and remain a standalone file.
    with sqlite3.connect(path) as source, sqlite3.connect(tmp_path / "copy.sqlite3") as backup:
        source.backup(backup)
        assert backup.execute("SELECT COUNT(*) FROM records").fetchone()[0] == 2
    engine.dispose()


def test_memory_database_remains_supported():
    engine = create_database_engine("sqlite:///:memory:")
    with engine.connect() as c:
        assert c.scalar(text("PRAGMA journal_mode")) == "memory"
        assert c.scalar(text("PRAGMA busy_timeout")) == 30000
    engine.dispose()


def test_busy_report_request_returns_explanation_instead_of_generic_error():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.exc import OperationalError
    from app.database import database_error_response
    api = FastAPI()
    api.add_exception_handler(OperationalError, database_error_response)
    @api.post("/report")
    def report():
        original = sqlite3.OperationalError("database is locked")
        original.sqlite_errorcode = 517  # Extended SQLITE_BUSY_SNAPSHOT.
        raise OperationalError("SELECT private_data FROM users", {"private": "secret"}, original)
    response = TestClient(api).post("/report")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "10"
    assert "database is busy" in response.json()["detail"]
    assert "private_data" not in response.text
    assert "secret" not in response.text
