from uuid import UUID

from fastapi import APIRouter, Depends, Response

from ..auth import require_trusted_device
from ..deps import get_store
from ..models import CombineTablesInput, Table, TableGroup
from ..store import InMemoryStore

router = APIRouter(tags=["Tables", "Groups"], dependencies=[Depends(require_trusted_device)])


@router.get("/tables", response_model=list[Table], operation_id="listTables")
def list_tables(store: InMemoryStore = Depends(get_store)) -> list[Table]:
    return store.list_tables()


@router.get("/groups", response_model=list[TableGroup], operation_id="listGroups")
def list_groups(store: InMemoryStore = Depends(get_store)) -> list[TableGroup]:
    return store.list_groups()


@router.post(
    "/groups", response_model=TableGroup, status_code=201, operation_id="combineTables"
)
def combine_tables(
    payload: CombineTablesInput, store: InMemoryStore = Depends(get_store)
) -> TableGroup:
    return store.combine_tables(payload.table_ids)


@router.delete(
    "/groups/{groupId}", status_code=204, operation_id="dissolveGroup"
)
def dissolve_group(groupId: UUID, store: InMemoryStore = Depends(get_store)) -> None:
    store.dissolve_group(groupId)
