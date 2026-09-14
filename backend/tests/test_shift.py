from helpers import add_party, table_ids
def test_get_shift_returns_404_before_any_shift(client):
    response = client.get("/shift")
    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "No shift has been opened yet"}


def test_open_shift_roundtrip(client):
    response = client.post("/shift")
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "open"
    assert body["closedAt"] is None
    assert body["openedAt"]

    assert client.get("/shift").json()["id"] == body["id"]


def test_open_shift_twice_conflicts(client):
    assert client.post("/shift").status_code == 201
    response = client.post("/shift")
    assert response.status_code == 409
    assert response.json()["code"] == "conflict"
    assert "already open" in response.json()["message"]


def test_close_without_open_shift_conflicts(client):
    assert client.post("/shift/close").status_code == 409


def test_close_shift_marks_everyone_left_and_frees_tables(client):
    client.post("/shift")
    ids = table_ids(client)
    add_party(client, "Rossi", 4)  # stays waiting
    seated = add_party(client, "Bianchi", 4)
    client.post(f"/parties/{seated['id']}/seat", json={"tableIds": [ids["T1"]]})
    client.post("/groups", json={"tableIds": [ids["T2"], ids["T3"]]})

    response = client.post("/shift/close")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "closed"
    assert body["closedAt"]

    statuses = {p["name"]: p["status"] for p in client.get("/parties").json()}
    assert statuses == {"Rossi": "left", "Bianchi": "left"}

    tables = client.get("/tables").json()
    assert all(t["status"] == "free" and t["groupId"] is None for t in tables)
    assert client.get("/groups").json() == []


def test_new_shift_starts_clean(client):
    client.post("/shift")
    add_party(client, "Rossi", 4)
    client.post("/shift/close")
    client.post("/shift")

    assert client.get("/parties").json() == []
    assert all(t["status"] == "free" for t in client.get("/tables").json())
