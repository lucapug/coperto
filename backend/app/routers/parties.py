from uuid import UUID

from fastapi import APIRouter, Depends

from ..auth import require_trusted_device
from ..deps import get_store
from ..models import AddPartyInput, Party, SeatPartyInput, SeatResult
from ..store import DatabaseStore

router = APIRouter(tags=["Parties"], dependencies=[Depends(require_trusted_device)])


@router.get("/parties", response_model=list[Party], operation_id="listParties")
def list_parties(store: DatabaseStore = Depends(get_store)) -> list[Party]:
    return store.list_parties()


@router.post("/parties", response_model=Party, status_code=201, operation_id="addParty")
def add_party(payload: AddPartyInput, store: DatabaseStore = Depends(get_store)) -> Party:
    return store.add_party(payload)


@router.post(
    "/parties/{partyId}/seat", response_model=SeatResult, operation_id="seatParty"
)
def seat_party(
    partyId: UUID, payload: SeatPartyInput, store: DatabaseStore = Depends(get_store)
) -> SeatResult:
    return store.seat_party(partyId, payload.table_ids)


@router.post(
    "/parties/{partyId}/arrived", response_model=Party, operation_id="markArrived"
)
def mark_arrived(partyId: UUID, store: DatabaseStore = Depends(get_store)) -> Party:
    return store.mark_arrived(partyId)


@router.post("/parties/{partyId}/left", response_model=Party, operation_id="markLeft")
def mark_left(partyId: UUID, store: DatabaseStore = Depends(get_store)) -> Party:
    return store.mark_left(partyId)


@router.post(
    "/parties/{partyId}/requeue", response_model=Party, operation_id="requeueParty"
)
def requeue_party(partyId: UUID, store: DatabaseStore = Depends(get_store)) -> Party:
    return store.requeue_party(partyId)
