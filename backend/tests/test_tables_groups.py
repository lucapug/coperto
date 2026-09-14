from helpers import add_party, table_ids


def test_lists_seeded_tables(client):
    tables = client.get("/tables").json()
    assert len(tables) == 30
    assert sum(t["seats"] for t in tables) == 106
    by_label = {t["label"]: t for t in tables}
    assert by_label["T1"]["seats"] == 4
    assert by_label["T27"]["seats"] == 2
    assert all(t["status"] == "free" for t in tables)


def test_combine_tables_creates_group_with_junction_math(client):
    client.post("/shift")
    ids = table_ids(client)

    response = client.post("/groups", json={"tableIds": [ids["T2"], ids["T1"]]})
    assert response.status_code == 201
    group = response.json()
    assert group["tableIds"] == [ids["T2"], ids["T1"]]  # host selection order
    assert group["grossSeats"] == 8
    assert group["junctions"] == 1
    assert group["usableSeats"] == 6
    assert group["partyId"] is None

    tables = {t["id"]: t for t in client.get("/tables").json()}
    for label in ("T1", "T2"):
        table = tables[ids[label]]
        assert table["status"] == "combined"
        assert table["groupId"] == group["id"]


def test_combine_requires_two_tables(client):
    client.post("/shift")
    ids = table_ids(client)
    response = client.post("/groups", json={"tableIds": [ids["T1"]]})
    assert response.status_code == 422
    assert response.json()["code"] == "validation"


def test_combine_rejects_duplicate_ids(client):
    client.post("/shift")
    ids = table_ids(client)
    response = client.post("/groups", json={"tableIds": [ids["T1"], ids["T1"]]})
    assert response.status_code == 422
    assert response.json()["code"] == "validation"


def test_combine_requires_open_shift(client):
    ids = table_ids(client)
    response = client.post("/groups", json={"tableIds": [ids["T1"], ids["T2"]]})
    assert response.status_code == 409
    assert "No open shift" in response.json()["message"]


def test_combine_rejects_non_free_tables(client):
    client.post("/shift")
    ids = table_ids(client)
    party = add_party(client, "Rossi", 4)
    client.post(f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"]]})

    response = client.post("/groups", json={"tableIds": [ids["T1"], ids["T2"]]})
    assert response.status_code == 409
    assert "not free" in response.json()["message"]


def test_group_is_atomic(client):
    client.post("/shift")
    ids = table_ids(client)
    client.post("/groups", json={"tableIds": [ids["T1"], ids["T2"], ids["T3"]]})

    # a single table is a 422 (the schema requires at least two to combine);
    # a partial selection of the group is a 409 with the missing tables named
    response = client.post("/groups", json={"tableIds": [ids["T1"]]})
    assert response.status_code == 422
    response = client.post("/groups", json={"tableIds": [ids["T1"], ids["T2"]]})
    assert response.status_code == 409
    assert "atomic" in response.json()["message"]
    assert "T3" in response.json()["message"]

    # whole group + an extra table re-merges in selection order
    response = client.post(
        "/groups",
        json={"tableIds": [ids["T4"], ids["T1"], ids["T2"], ids["T3"]]},
    )
    assert response.status_code == 201
    group = response.json()
    assert group["tableIds"] == [ids["T4"], ids["T1"], ids["T2"], ids["T3"]]
    assert group["grossSeats"] == 16
    assert group["usableSeats"] == 10
    assert len(client.get("/groups").json()) == 1


def test_dissolve_group_frees_tables(client):
    client.post("/shift")
    ids = table_ids(client)
    group = client.post("/groups", json={"tableIds": [ids["T1"], ids["T2"]]}).json()

    assert client.delete(f"/groups/{group['id']}").status_code == 204
    assert client.get("/groups").json() == []
    tables = {t["id"]: t for t in client.get("/tables").json()}
    assert tables[ids["T1"]]["status"] == "free"
    assert tables[ids["T2"]]["status"] == "free"


def test_dissolve_unknown_group_404(client):
    assert client.delete("/groups/00000000-0000-0000-0000-000000000000").status_code == 404


def test_dissolve_held_group_conflicts(client):
    client.post("/shift")
    ids = table_ids(client)
    group = client.post("/groups", json={"tableIds": [ids["T1"], ids["T2"]]}).json()
    party = add_party(client, "Rossi", 6)
    # seating on an existing free group re-creates it with the same tables,
    # so the group id changes — use the id the seat operation returns
    seated = client.post(
        f"/parties/{party['id']}/seat", json={"tableIds": group["tableIds"]}
    ).json()

    response = client.delete(f"/groups/{seated['group']['id']}")
    assert response.status_code == 409
    assert "seated on this group" in response.json()["message"]
