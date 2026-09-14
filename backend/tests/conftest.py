from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

# in-memory SQLite: one shared connection per engine, fresh per app
TEST_DB = "sqlite://"


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(db_url=TEST_DB, seed_demo=False))


class Clock:
    """Deterministic clock for grace-period / sweep tests."""

    def __init__(self) -> None:
        self.now = datetime(2026, 7, 15, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture()
def clock() -> Clock:
    return Clock()


@pytest.fixture()
def frozen_client(clock: Clock) -> TestClient:
    app = create_app(db_url=TEST_DB, now_fn=clock, seed_demo=False)
    return TestClient(app)


@pytest.fixture()
def seeded_client() -> TestClient:
    return TestClient(create_app(db_url=TEST_DB, seed_demo=True))
