"""ORM entities (SQLAlchemy 2.0).

Portability rules, so Postgres can drop in later:
- UUID primary keys via the backend-agnostic ``Uuid`` type
- tz-aware datetimes via UTCDateTime (see db.py)
- insertion order via integer ``seq``/``position`` columns, not backend
  specifics; enum-ish statuses as plain strings validated by Pydantic
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, ForeignKey, Integer, String, Table, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .db import UTCDateTime


class Base(DeclarativeBase):
    pass


# ordered membership: tableIds order defines physical adjacency (plan §3.3)
group_tables = Table(
    "group_tables",
    Base.metadata,
    Column("group_id", Uuid, ForeignKey("table_groups.id"), primary_key=True),
    Column("table_id", Uuid, ForeignKey("tables.id"), primary_key=True),
    Column("position", Integer, nullable=False),
)


class ShiftRow(Base):
    __tablename__ = "shifts"

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, default=uuid.uuid4)
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(8), nullable=False)  # open | closed


class TableGroupRow(Base):
    __tablename__ = "table_groups"

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, default=uuid.uuid4)
    shift_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("shifts.id"), nullable=False)
    gross_seats: Mapped[int] = mapped_column(Integer, nullable=False)
    usable_seats: Mapped[int] = mapped_column(Integer, nullable=False)
    junctions: Mapped[int] = mapped_column(Integer, nullable=False)
    party_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    member_tables: Mapped[list["TableRow"]] = relationship(
        secondary=group_tables,
        back_populates="group",
        order_by=group_tables.c.position,
        lazy="selectin",
    )

    @property
    def table_ids(self) -> list[uuid.UUID]:
        return [table.id for table in self.member_tables]


class TableRow(Base):
    __tablename__ = "tables"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    label: Mapped[str] = mapped_column(String(8), nullable=False, unique=True)
    seats: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="free")
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("table_groups.id"), nullable=True
    )
    # plain UUID, no FK: it may point at a table or a group (discriminated
    # by context, same as the domain model)
    locked_by_party_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    group: Mapped[TableGroupRow | None] = relationship(back_populates="member_tables")


class PartyRow(Base):
    __tablename__ = "parties"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    shift_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("shifts.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    estimated_wait: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="waiting")
    # plain UUID, no FK: it may point at a table or a group
    table_or_group_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    seated_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    booked_until: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
