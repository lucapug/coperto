"""Shared test helpers (importable, unlike conftest fixtures)."""

from fastapi.testclient import TestClient


def table_ids(client: TestClient) -> dict[str, str]:
    tables = client.get("/tables").json()
    return {table["label"]: table["id"] for table in tables}


def add_party(client: TestClient, name: str, size: int, **extra: object) -> dict:
    response = client.post(
        "/parties", json={"name": name, "size": size, "phone": "555-0100", **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()
