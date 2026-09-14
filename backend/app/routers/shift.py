from fastapi import APIRouter, Depends

from ..auth import require_trusted_device
from ..deps import get_store
from ..errors import ErrorCode, ServiceError
from ..models import Shift
from ..store import InMemoryStore

# NOTE: path params use camelCase identifiers (groupId, partyId) so the
# generated OpenAPI paths match openapi.yaml templates exactly.
router = APIRouter(tags=["Shift"], dependencies=[Depends(require_trusted_device)])


@router.get("/shift", response_model=Shift, operation_id="getShift")
def get_shift(store: InMemoryStore = Depends(get_store)) -> Shift:
    shift = store.get_shift()
    if shift is None:
        raise ServiceError("No shift has been opened yet", ErrorCode.not_found)
    return shift


@router.post("/shift", response_model=Shift, status_code=201, operation_id="openShift")
def open_shift(store: InMemoryStore = Depends(get_store)) -> Shift:
    return store.open_shift()


@router.post("/shift/close", response_model=Shift, operation_id="closeShift")
def close_shift(store: InMemoryStore = Depends(get_store)) -> Shift:
    return store.close_shift()
