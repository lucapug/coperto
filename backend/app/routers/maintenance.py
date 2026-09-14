from fastapi import APIRouter, Depends

from ..auth import require_trusted_device
from ..deps import get_store
from ..models import Party
from ..store import DatabaseStore

router = APIRouter(tags=["Maintenance"], dependencies=[Depends(require_trusted_device)])


@router.post("/sweep", response_model=list[Party], operation_id="sweep")
def sweep(store: DatabaseStore = Depends(get_store)) -> list[Party]:
    """Auto-expire overdue seated parties (plan §4.3).

    The server should also run this autonomously every 30 s; the endpoint
    exists because the frontend calls it on a 5 s interval.
    """
    return store.sweep()
