from helpers import add_party, table_ids
def test_sweep_expires_overdue_party_and_releases_tables(frozen_client, clock):
    frozen_client.post("/shift")
    ids = table_ids(frozen_client)
    party = add_party(frozen_client, "Rossi", 6)
    frozen_client.post(
        f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"], ids["T2"]]}
    )

    # still inside the 20-minute grace window
    clock.advance(minutes=19, seconds=59)
    assert frozen_client.post("/sweep").json() == []
    statuses = {p["id"]: p["status"] for p in frozen_client.get("/parties").json()}
    assert statuses[party["id"]] == "seated"

    # past bookedUntil: no_show, tables and group released
    clock.advance(seconds=2)
    expired = frozen_client.post("/sweep").json()
    assert [p["id"] for p in expired] == [party["id"]]

    party_after = next(
        p for p in frozen_client.get("/parties").json() if p["id"] == party["id"]
    )
    assert party_after["status"] == "no_show"
    assert frozen_client.get("/groups").json() == []
    tables = {t["id"]: t for t in frozen_client.get("/tables").json()}
    assert tables[ids["T1"]]["status"] == "free"
    assert tables[ids["T2"]]["status"] == "free"

    # idempotent
    assert frozen_client.post("/sweep").json() == []


def test_sweep_ignores_arrived_parties(frozen_client, clock):
    frozen_client.post("/shift")
    ids = table_ids(frozen_client)
    party = add_party(frozen_client, "Rossi", 4)
    frozen_client.post(f"/parties/{party['id']}/seat", json={"tableIds": [ids["T1"]]})
    frozen_client.post(f"/parties/{party['id']}/arrived")

    clock.advance(minutes=30)
    assert frozen_client.post("/sweep").json() == []
    party_after = next(
        p for p in frozen_client.get("/parties").json() if p["id"] == party["id"]
    )
    assert party_after["status"] == "seated"
    table = next(t for t in frozen_client.get("/tables").json() if t["id"] == ids["T1"])
    assert table["status"] == "occupied"
