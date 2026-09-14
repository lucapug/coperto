"""Database engine setup.

The URL comes from the COPERTO_DB environment variable and can be any
SQLAlchemy URL — sqlite:///coperto.db today, postgresql+psycopg://… later.
Nothing SQLite-specific may leak beyond this module.
"""

import os
from datetime import datetime, timezone

from sqlalchemy import DateTime, TypeDecorator, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool

DEFAULT_DATABASE_URL = "sqlite:///coperto.db"


def database_url_from_env() -> str:
    return os.environ.get("COPERTO_DB", DEFAULT_DATABASE_URL)


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        # in-memory SQLite needs one shared connection; every SQLite
        # connection must be usable from FastAPI's request threadpool
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kwargs["poolclass"] = StaticPool
        return create_engine(url, **kwargs)
    return create_engine(url)


class UTCDateTime(TypeDecorator):
    """DateTime that always comes back timezone-aware.

    Postgres returns aware datetimes for timestamptz, but SQLite returns
    naive ones — normalize on read so comparisons never mix the two.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
