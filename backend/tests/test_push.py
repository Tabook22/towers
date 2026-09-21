"""Web Push subscriptions and delivery (see services/push.py, routers/push.py)."""
import datetime as dt

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import PushSubscription, User
from app.routers import push as push_router
from app.schemas import PushSubscriptionCreate, PushSubscriptionKeys, PushUnsubscribe
from app.services import push as push_service


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _user(user_id: int = 1) -> User:
    return User(id=user_id, username="crew1", role="team_member")


def test_get_vapid_keys_generates_and_persists(tmp_path, monkeypatch):
    monkeypatch.setattr(push_service, "_PRIVATE_KEY_PATH", tmp_path / "vapid_private.pem")
    monkeypatch.setattr(push_service, "_PUBLIC_KEY_PATH", tmp_path / "vapid_public.txt")

    private_pem, public_b64 = push_service.get_vapid_keys()
    assert "BEGIN PRIVATE KEY" in private_pem
    assert len(public_b64) > 40

    # Second call reuses the persisted pair rather than generating a new one.
    private_pem_2, public_b64_2 = push_service.get_vapid_keys()
    assert private_pem_2 == private_pem
    assert public_b64_2 == public_b64


def test_subscribe_then_unsubscribe_round_trip(db):
    payload = PushSubscriptionCreate(
        endpoint="https://fcm.googleapis.com/fcm/send/abc123",
        keys=PushSubscriptionKeys(p256dh="p256dh-key", auth="auth-key"),
        user_agent="pytest",
    )
    push_router.subscribe(payload=payload, db=db, user=_user())
    row = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    assert row is not None
    assert row.user_id == 1

    # Subscribing again with the same endpoint (e.g. a token refresh) updates in place, no duplicate row.
    push_router.subscribe(payload=payload, db=db, user=_user())
    assert db.query(PushSubscription).count() == 1

    push_router.unsubscribe(payload=PushUnsubscribe(endpoint=payload.endpoint), db=db, _user=_user())
    assert db.query(PushSubscription).count() == 0


def test_send_to_subscription_drops_malformed_keys_instead_of_raising(tmp_path, monkeypatch):
    # A real regression: pywebpush raises a plain ValueError (not WebPushException) when a stored
    # p256dh/auth can't be parsed as a key at all — that must be treated as "dead, drop it", not
    # propagate and crash the whole notification batch for every other subscriber.
    monkeypatch.setattr(push_service, "_PRIVATE_KEY_PATH", tmp_path / "vapid_private.pem")
    monkeypatch.setattr(push_service, "_PUBLIC_KEY_PATH", tmp_path / "vapid_public.txt")
    sub = PushSubscription(
        id=1,
        user_id=1,
        endpoint="https://example.com/fake-endpoint-for-testing",
        p256dh="not-a-valid-ec-public-key",
        auth="not-valid-either",
    )
    assert push_service.send_to_subscription(sub, {"title": "x", "body": "y", "url": "/messages"}) is False


def test_notify_new_message_drops_dead_subscriptions_only(db, monkeypatch):
    db.add_all(
        [
            PushSubscription(id=1, user_id=2, endpoint="https://push/alive", p256dh="a", auth="a"),
            PushSubscription(id=2, user_id=3, endpoint="https://push/dead", p256dh="b", auth="b"),
            PushSubscription(id=3, user_id=1, endpoint="https://push/self", p256dh="c", auth="c"),
        ]
    )
    db.commit()

    sent_to = []

    def fake_session_local():
        return db

    def fake_send(sub, payload):
        sent_to.append(sub.endpoint)
        return sub.endpoint != "https://push/dead"

    # notify_new_message opens its own session (see services/push.py) — point it at this test's db.
    monkeypatch.setattr(push_service, "SessionLocal", fake_session_local)
    monkeypatch.setattr(push_service, "send_to_subscription", fake_send)
    # db.close() would end the test's own session — no-op it for this fixture-scoped session.
    monkeypatch.setattr(db, "close", lambda: None)

    push_service.notify_new_message(exclude_user_id=1, title="Someone", body="hi", url="/messages")

    # The excluded user's own subscription was skipped entirely; the other two were attempted.
    assert "https://push/self" not in sent_to
    assert set(sent_to) == {"https://push/alive", "https://push/dead"}
    remaining = {s.endpoint for s in db.query(PushSubscription).all()}
    assert remaining == {"https://push/alive", "https://push/self"}


def test_schedule_push_excludes_author_by_id():
    # A cheap sanity check that _schedule_push's payload always carries the author's id as the
    # exclude filter, so notify_new_message never pushes a message back to whoever just sent it.
    from fastapi import BackgroundTasks

    from app.models import Team
    from app.routers.channel import _schedule_push, TeamChannelMessage

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        team = Team(name="Bravo")
        db.add(team)
        db.commit()
        row = TeamChannelMessage(team_id=team.id, field_date=dt.date(2026, 9, 20), kind="help", body="need a hand")
        db.add(row)
        db.commit()

        tasks = BackgroundTasks()
        _schedule_push(tasks, db, team.id, _user(7), row)
        assert len(tasks.tasks) == 1
        assert tasks.tasks[0].args[0] == 7
