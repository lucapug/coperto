"""Database configuration and persistence behavior (COPERTO_DB)."""

from fastapi.testclient import TestClient

from app.db import database_url_from_env
from app.main import create_app


def test_default_url_is_local_sqlite_file(monkeypatch):
    monkeypatch.delenv("COPERTO_DB", raising=False)
    assert database_url_from_env() == "sqlite:///coperto.db"


def test_env_var_selects_the_database(monkeypatch):
    monkeypatch.setenv("COPERTO_DB", "postgresql+psycopg://user:pw@host/coperto")
    assert database_url_from_env() == "postgresql+psycopg://user:pw@host/coperto"


def test_data_persists_across_app_restarts_and_seed_does_not_duplicate(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/coperto.db"
    monkeypatch.setenv("COPERTO_DB", url)

    first = TestClient(create_app(seed_demo=True))
    assert first.get("/shift").json()["status"] == "open"
    assert first.post(
        "/parties", json={"name": "Extra", "size": 2, "phone": "555"}
    ).status_code == 201

    # a "server restart": brand-new app instance on the same database file
    second = TestClient(create_app(seed_demo=True))
    names = [p["name"] for p in second.get("/parties").json()]

    assert "Extra" in names  # written data survived
    assert names.count("Rossi") == 1  # demo seed did not duplicate
    assert len(names) == 7  # 6 demo parties + the extra one
    assert second.get("/shift").json()["status"] == "open"
