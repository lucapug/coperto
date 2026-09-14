from uuid import UUID

from helpers import add_party, table_ids


def test_add_party_appends_to_queue(client):
    client.post("/shift")

    first = add_party(client, "Rossi", 4, estimatedWaitMinutes=25)
    second = add_party(client, "Bianchi", 2)

    assert first["position"] == 1
    assert first["status"] == "waiting"
    assert first["estimatedWait"] == 25
    assert second["position"] == 2
    assert second["estimatedWait"] is None


def test_add_party_requires_open_shift(client):
    response = client.post("/parties", json={"name": "Rossi", "size": 4, "phone": "555"})
    assert response.status_code == 409


def test_add_party_validation_errors(client):
    client.post("/shift")

    for payload in (
        {"name": "  ", "size": 2, "phone": "555"},  # blank name (store-level)
        {"name": "Rossi", "size": 2, "phone": "  "},  # blank phone (store-level)
        {"name": "Rossi", "size": 0, "phone": "555"},  # size < 1 (schema-level)
        {"size": 2, "phone": "555"},  # missing name (schema-level)
        {"name": "Rossi", "size": 2, "phone": "555", "estimatedWaitMinutes": -1},
    ):
        response = client.post("/parties", json=payload)
        assert response.status_code == 422, payload
        body = response.json()
        assert body["code"] == "validation"
        assert body["message"]


def test_seat_party_on_single_table(frozen_client):
    frozen_client.post("/shift")
    ids = table_ids(frozen_client)
    party = add_party(frozen_client, "Rossi", 4)

    response = frozen_client.post(
        f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"]]}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["group"] is None
    assert body["party"]["status"] == "seated"
    assert body["party"]["tableOrGroupId"] == ids["T1"]
    # 20-minute grace window, deterministic under the frozen clock
    assert body["party"]["seatedAt"] == "2026-07-15T12:00:00Z"
    assert body["party"]["bookedUntil"] == "2026-07-15T12:20:00Z"

    table = next(t for t in frozen_client.get("/tables").json() if t["id"] == ids["T1"])
    assert table["status"] == "reserved"
    assert table["lockedByPartyId"] == party["id"]


def test_seat_party_larger_than_usable_seats_blocked(client):
    client.post("/shift")
    ids = table_ids(client)
    party = add_party(client, "Rossi", 5)

    response = client.post(f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"]]})
    assert response.status_code == 409
    assert "won't fit" in response.json()["message"]

    # nothing changed
    party_after = next(
        p for p in client.get("/parties").json() if p["id"] == party["id"]
    )
    assert party_after["status"] == "waiting"
    table = next(t for t in client.get("/tables").json() if t["id"] == ids["T1"])
    assert table["status"] == "free"


def test_seat_party_on_merged_tables_creates_group(client):
    client.post("/shift")
    ids = table_ids(client)
    party = add_party(client, "Verdi", 6)

    response = client.post(
        f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"], ids["T2"]]}
    )
    assert response.status_code == 200
    body = response.json()
    group = body["group"]
    assert group is not None
    assert group["usableSeats"] == 6
    assert group["partyId"] == party["id"]
    assert body["party"]["tableOrGroupId"] == group["id"]

    # 7 people still don't fit on 6 usable seats
    big = add_party(client, "Grossi", 7)
    response = client.post(
        f"/parties/{big['id']}/seat", json={"tableIds": [ids["T3"], ids["T4"]]}
    )
    assert response.status_code == 409
    assert "won't fit" in response.json()["message"]


def test_seat_party_error_cases(client):
    client.post("/shift")
    ids = table_ids(client)
    party = add_party(client, "Rossi", 2)

    unknown = "00000000-0000-0000-0000-000000000000"
    assert (
        client.post(f"/parties/{party['id']}/seat", json={"tableIds": [unknown]}).status_code
        == 404
    )
    assert (
        client.post(
            f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"], ids["T1"]]}
        ).status_code
        == 422
    )
    assert client.post(f"/parties/{unknown}/seat", json={"tableIds": [ids["T1"]]}).status_code == 404

    client.post(f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"]]})
    # seating again: not waiting anymore
    response = client.post(f"/parties/{party['id']}/seat", json={"tableIds": [ids["T2"]]})
    assert response.status_code == 409
    assert "not waiting" in response.json()["message"]


def test_mark_arrived_clears_countdown_and_occupies_table(client):
    client.post("/shift")
    ids = table_ids(client)
    party = add_party(client, "Rossi", 4)
    client.post(f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"]]})

    response = client.post(f"/parties/{party['id']}/arrived")
    assert response.status_code == 200
    assert response.json()["bookedUntil"] is None
    table = next(t for t in client.get("/tables").json() if t["id"] == ids["T1"])
    assert table["status"] == "occupied"

    # arrived twice
    assert client.post(f"/parties/{party['id']}/arrived").status_code == 409


def test_mark_left_releases_tables(client):
    client.post("/shift")
    ids = table_ids(client)
    seated = add_party(client, "Rossi", 6)
    waiting = add_party(client, "Bianchi", 2)
    client.post(
        f"/parties/{seated['id']}/seat", json={"tableIds": [ids["T1"], ids["T2"]]}
    )

    assert client.post(f"/parties/{seated['id']}/left").status_code == 200
    assert client.post(f"/parties/{waiting['id']}/left").status_code == 200
    assert client.get("/groups").json() == []
    assert all(t["status"] == "free" for t in client.get("/tables").json())

    # left twice
    assert client.post(f"/parties/{seated['id']}/left").status_code == 409


def test_requeue_requires_no_show(client):
    client.post("/shift")
    ids = table_ids(client)
    party = add_party(client, "Rossi", 4)
    other = add_party(client, "Bianchi", 2)

    response = client.post(f"/parties/{party['id']}/requeue")
    assert response.status_code == 409
    assert "not a no-show" in response.json()["message"]

    # turn Rossi into a no-show via the store clock, then requeue
    client.post(f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"]]})
    app_store = client.app.state.store
    app_store.parties[UUID(party["id"])].booked_until = app_store.now()
    client.post("/sweep")

    response = client.post(f"/parties/{party['id']}/requeue")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "waiting"
    assert body["tableOrGroupId"] is None
    other_after = next(p for p in client.get("/parties").json() if p["id"] == other["id"])
    assert body["position"] > other_after["position"]
