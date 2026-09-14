"""Contract guard: the served API must match openapi.yaml.

The expected paths/methods/operationIds are copied from openapi.yaml; the
actuals come from the schema FastAPI generates at /openapi.json.
"""

EXPECTED_OPERATIONS = {
    "/shift": {"get": "getShift", "post": "openShift"},
    "/shift/close": {"post": "closeShift"},
    "/tables": {"get": "listTables"},
    "/groups": {"get": "listGroups", "post": "combineTables"},
    "/groups/{groupId}": {"delete": "dissolveGroup"},
    "/parties": {"get": "listParties", "post": "addParty"},
    "/parties/{partyId}/seat": {"post": "seatParty"},
    "/parties/{partyId}/arrived": {"post": "markArrived"},
    "/parties/{partyId}/left": {"post": "markLeft"},
    "/parties/{partyId}/requeue": {"post": "requeueParty"},
    "/sweep": {"post": "sweep"},
}


def test_served_paths_match_openapi_yaml(client):
    schema = client.get("/openapi.json").json()
    actual = {
        path: {method: op["operationId"] for method, op in ops.items()}
        for path, ops in schema["paths"].items()
    }
    assert actual == EXPECTED_OPERATIONS


def test_seeded_demo_data_is_consistent(seeded_client):
    assert seeded_client.get("/shift").json()["status"] == "open"

    parties = seeded_client.get("/parties").json()
    statuses = {p["name"]: p["status"] for p in parties}
    assert statuses == {
        "Rossi": "waiting",
        "Bianchi": "waiting",
        "Verdi": "waiting",
        "Greco": "seated",
        "Esposito": "seated",
        "Conti": "no_show",
    }

    tables = {t["label"]: t for t in seeded_client.get("/tables").json()}
    assert tables["T1"]["status"] == "reserved"  # Greco
    assert tables["T2"]["status"] == "free"  # Conti's table, released by the sweep

    groups = seeded_client.get("/groups").json()
    assert len(groups) == 2
    by_party_name = {
        next(p["name"] for p in parties if p["id"] == g["partyId"]) if g["partyId"] else "free": g
        for g in groups
    }
    assert by_party_name["Esposito"]["usableSeats"] == 8  # T5+T6+T7
    assert by_party_name["free"]["usableSeats"] == 6  # T9+T10
