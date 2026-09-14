"""Pydantic models mirroring openapi.yaml and frontend/src/types.ts.

Python fields are snake_case; JSON is camelCase via the alias generator,
so the frontend consumes responses unchanged.
"""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class ShiftStatus(str, Enum):
    open = "open"
    closed = "closed"


class TableStatus(str, Enum):
    free = "free"
    occupied = "occupied"
    reserved = "reserved"
    combined = "combined"


class PartyStatus(str, Enum):
    waiting = "waiting"
    seated = "seated"
    no_show = "no_show"
    left = "left"


class ErrorCode(str, Enum):
    validation = "validation"
    conflict = "conflict"
    not_found = "not_found"


class Shift(CamelModel):
    id: UUID
    opened_at: datetime
    closed_at: datetime | None
    status: ShiftStatus


class Table(CamelModel):
    id: UUID
    label: str
    seats: int = Field(ge=2, le=4)
    status: TableStatus
    group_id: UUID | None
    locked_by_party_id: UUID | None


class TableGroup(CamelModel):
    id: UUID
    shift_id: UUID
    table_ids: list[UUID]
    gross_seats: int
    usable_seats: int
    junctions: int
    party_id: UUID | None


class Party(CamelModel):
    id: UUID
    shift_id: UUID
    name: str
    size: int = Field(ge=1)
    phone: str
    notes: str | None
    estimated_wait: int | None  # minutes, entered manually by the host
    status: PartyStatus
    table_or_group_id: UUID | None
    seated_at: datetime | None
    booked_until: datetime | None
    created_at: datetime
    position: int = Field(ge=1)


class AddPartyInput(CamelModel):
    name: str = Field(min_length=1)
    size: int = Field(ge=1)
    phone: str = Field(min_length=1)
    notes: str | None = None
    estimated_wait_minutes: int | None = Field(default=None, ge=0)


class CombineTablesInput(CamelModel):
    table_ids: list[UUID] = Field(min_length=2)


class SeatPartyInput(CamelModel):
    table_ids: list[UUID] = Field(min_length=1)


class SeatResult(CamelModel):
    party: Party
    group: TableGroup | None


class ServiceErrorBody(CamelModel):
    code: ErrorCode
    message: str
