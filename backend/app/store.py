"""SQLAlchemy-backed store implementing the domain rules from docs/plan.md.

Same public interface the routers use; each method is one transaction.
Domain rules (junction seat loss, atomic groups, grace period, auto-expire,
non-destructive close) are unchanged from the in-memory predecessor.
"""

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from .errors import ServiceError
from .models import (
    AddPartyInput,
    ErrorCode,
    Party,
    PartyStatus,
    SeatResult,
    Shift,
    ShiftStatus,
    Table,
    TableGroup,
    TableStatus,
)
from .orm import PartyRow, ShiftRow, TableGroupRow, TableRow, group_tables

# plan §4.2 — bookedUntil = now + 20 minutes (configurable constant)
DEFAULT_GRACE = timedelta(minutes=20)

# 30 tables, 106 seats — the same floor as the frontend mock seed
TABLE_SEEDS: list[tuple[str, int]] = [
    *((f"T{i + 1}", 4) for i in range(20)),
    *((f"T{i + 21}", 3) for i in range(6)),
    *((f"T{i + 27}", 2) for i in range(4)),
]


def usable_seats(seat_counts: list[int]) -> int:
    """plan §3.4 — every junction between two tables costs 2 seats."""
    if not seat_counts:
        raise ServiceError("Select at least one table")
    return sum(seat_counts) - 2 * (len(seat_counts) - 1)


def seed_tables(session_factory: sessionmaker[Session]) -> None:
    """Insert the static floor once (tables are seeded per restaurant)."""
    with session_factory() as session, session.begin():
        existing = session.scalar(select(func.count()).select_from(TableRow))
        if existing:
            return
        for position, (label, seats) in enumerate(TABLE_SEEDS):
            session.add(
                TableRow(
                    label=label,
                    seats=seats,
                    status=TableStatus.free.value,
                    group_id=None,
                    locked_by_party_id=None,
                    position=position,
                )
            )


class DatabaseStore:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        now_fn: Callable[[], datetime] | None = None,
        grace: timedelta = DEFAULT_GRACE,
    ) -> None:
        self.session_factory = session_factory
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self._grace = grace

    def now(self) -> datetime:
        return self._now_fn()

    # ---- row helpers (all take an active session)

    def _latest_shift(self, session: Session) -> ShiftRow | None:
        return session.scalar(select(ShiftRow).order_by(ShiftRow.seq.desc()).limit(1))

    def _require_open_shift(self, session: Session) -> ShiftRow:
        shift = self._latest_shift(session)
        if shift is None or shift.status != ShiftStatus.open.value:
            raise ServiceError("No open shift", ErrorCode.conflict)
        return shift

    def _party_row(self, session: Session, party_id: UUID) -> PartyRow:
        party = session.get(PartyRow, party_id)
        if party is None:
            raise ServiceError(f"Unknown party {party_id}", ErrorCode.not_found)
        return party

    def _table_row(self, session: Session, table_id: UUID) -> TableRow:
        table = session.get(TableRow, table_id)
        if table is None:
            raise ServiceError(f"Unknown table {table_id}", ErrorCode.not_found)
        return table

    def _group_row(self, session: Session, group_id: UUID) -> TableGroupRow | None:
        # groups are keyed by their public uuid, not by the seq primary key
        return session.scalar(
            select(TableGroupRow).where(TableGroupRow.id == group_id)
        )

    def _free_table_row(self, table: TableRow) -> None:
        table.status = TableStatus.free.value
        table.group_id = None
        table.locked_by_party_id = None

    def _dissolve_group(self, session: Session, group: TableGroupRow) -> None:
        members = list(group.member_tables)
        # clearing the relationship makes the ORM delete the association
        # rows; a manual DELETE would collide with it (StaleDataError)
        group.member_tables = []
        for table in members:
            self._free_table_row(table)
        session.delete(group)

    def _release_assignment(self, session: Session, party: PartyRow) -> None:
        if party.table_or_group_id is None:
            return
        group = self._group_row(session, party.table_or_group_id)
        if group is not None:
            self._dissolve_group(session, group)
            return
        table = session.get(TableRow, party.table_or_group_id)
        if table is not None:
            self._free_table_row(table)

    def _normalize_selection(self, session: Session, table_ids: list[UUID]) -> list[TableRow]:
        """Validate a merge/seat selection (plan §3.3).

        Tables must be free, or members of a free group taken whole
        (atomicity). Absorbed groups are dissolved and re-created in the
        host's selection order.
        """
        if not table_ids:
            raise ServiceError("Select at least one table")
        seen: set[UUID] = set()
        for table_id in table_ids:
            if table_id in seen:
                raise ServiceError("Duplicate table in selection")
            seen.add(table_id)
        tables = [self._table_row(session, table_id) for table_id in table_ids]

        absorbed: dict[UUID, TableGroupRow] = {}
        for table in tables:
            if table.status == TableStatus.combined.value and table.group_id is not None:
                group = self._group_row(session, table.group_id)
                if group is None:
                    continue
                if group.party_id is not None:
                    raise ServiceError(
                        f"Table {table.label} is part of a group held by a party",
                        ErrorCode.conflict,
                    )
                absorbed[group.id] = group
            elif table.status != TableStatus.free.value:
                raise ServiceError(
                    f"Table {table.label} is not free", ErrorCode.conflict
                )

        for group in absorbed.values():
            missing = [tid for tid in group.table_ids if tid not in seen]
            if missing:
                labels = ", ".join(self._table_row(session, tid).label for tid in missing)
                raise ServiceError(
                    f"A merged group is atomic — also select {labels}",
                    ErrorCode.conflict,
                )
            self._dissolve_group(session, group)
        return tables

    def _create_group(
        self,
        session: Session,
        shift_id: UUID,
        tables: list[TableRow],
        party_id: UUID | None,
    ) -> TableGroupRow:
        seat_counts = [table.seats for table in tables]
        group = TableGroupRow(
            id=uuid4(),
            shift_id=shift_id,
            gross_seats=sum(seat_counts),
            usable_seats=usable_seats(seat_counts),
            junctions=len(tables) - 1,
            party_id=party_id,
        )
        session.add(group)
        for position, table in enumerate(tables):
            session.execute(
                group_tables.insert().values(
                    group_id=group.id, table_id=table.id, position=position
                )
            )
            table.status = TableStatus.combined.value
            table.group_id = group.id
            table.locked_by_party_id = party_id
        # the association rows above were inserted via core SQL — refresh
        # so the member_tables relationship (and table_ids) reflects them
        session.flush()
        session.refresh(group)
        return group

    def _next_position(self, session: Session, shift_id: UUID) -> int:
        current = session.scalar(
            select(func.max(PartyRow.position)).where(PartyRow.shift_id == shift_id)
        )
        return (current or 0) + 1

    # ---- shift lifecycle

    def get_shift(self) -> Shift | None:
        with self.session_factory() as session:
            row = self._latest_shift(session)
            return Shift.model_validate(row) if row is not None else None

    def open_shift(self) -> Shift:
        with self.session_factory() as session, session.begin():
            current = self._latest_shift(session)
            if current is not None and current.status == ShiftStatus.open.value:
                raise ServiceError("A shift is already open", ErrorCode.conflict)
            row = ShiftRow(
                id=uuid4(),
                opened_at=self.now(),
                closed_at=None,
                status=ShiftStatus.open.value,
            )
            session.add(row)
            return Shift.model_validate(row)

    def close_shift(self) -> Shift:
        with self.session_factory() as session, session.begin():
            shift = self._require_open_shift(session)
            parties = list(
                session.scalars(select(PartyRow).where(PartyRow.shift_id == shift.id))
            )
            for party in parties:
                if party.status in (PartyStatus.waiting.value, PartyStatus.seated.value):
                    self._release_assignment(session, party)
                    party.status = PartyStatus.left.value
            for group in list(session.scalars(select(TableGroupRow))):
                self._dissolve_group(session, group)
            for table in session.scalars(select(TableRow)):
                self._free_table_row(table)
            shift.closed_at = self.now()
            shift.status = ShiftStatus.closed.value
            return Shift.model_validate(shift)

    # ---- tables and groups

    def list_tables(self) -> list[Table]:
        with self.session_factory() as session:
            rows = session.scalars(select(TableRow).order_by(TableRow.position))
            return [Table.model_validate(row) for row in rows]

    def list_groups(self) -> list[TableGroup]:
        with self.session_factory() as session:
            rows = session.scalars(select(TableGroupRow).order_by(TableGroupRow.seq))
            return [TableGroup.model_validate(row) for row in rows]

    def combine_tables(self, table_ids: list[UUID]) -> TableGroup:
        with self.session_factory() as session, session.begin():
            shift = self._require_open_shift(session)
            tables = self._normalize_selection(session, table_ids)
            if len(tables) < 2:
                raise ServiceError("Select at least two tables to combine")
            group = self._create_group(session, shift.id, tables, None)
            return TableGroup.model_validate(group)

    def dissolve_group(self, group_id: UUID) -> None:
        with self.session_factory() as session, session.begin():
            group = self._group_row(session, group_id)
            if group is None:
                raise ServiceError(f"Unknown group {group_id}", ErrorCode.not_found)
            if group.party_id is not None:
                holder = session.get(PartyRow, group.party_id)
                if holder is not None and holder.status == PartyStatus.seated.value:
                    raise ServiceError(
                        "A party is seated on this group — mark them left first",
                        ErrorCode.conflict,
                    )
            self._dissolve_group(session, group)

    # ---- parties

    def list_parties(self) -> list[Party]:
        with self.session_factory() as session:
            shift = self._latest_shift(session)
            if shift is None:
                return []
            rows = session.scalars(
                select(PartyRow).where(PartyRow.shift_id == shift.id)
            )
            return [Party.model_validate(row) for row in rows]

    def add_party(self, party_input: AddPartyInput) -> Party:
        with self.session_factory() as session, session.begin():
            shift = self._require_open_shift(session)
            name = party_input.name.strip()
            phone = party_input.phone.strip()
            if not name:
                raise ServiceError("Name is required")
            if not phone:
                raise ServiceError("Phone is required")
            row = PartyRow(
                id=uuid4(),
                shift_id=shift.id,
                name=name,
                size=party_input.size,
                phone=phone,
                notes=party_input.notes.strip() if party_input.notes else None,
                estimated_wait=party_input.estimated_wait_minutes,
                status=PartyStatus.waiting.value,
                table_or_group_id=None,
                seated_at=None,
                booked_until=None,
                created_at=self.now(),
                position=self._next_position(session, shift.id),
            )
            session.add(row)
            return Party.model_validate(row)

    def seat_party(self, party_id: UUID, table_ids: list[UUID]) -> SeatResult:
        with self.session_factory() as session, session.begin():
            shift = self._require_open_shift(session)
            party = self._party_row(session, party_id)
            if party.shift_id != shift.id:
                raise ServiceError(
                    "Party belongs to another shift", ErrorCode.conflict
                )
            if party.status != PartyStatus.waiting.value:
                raise ServiceError(f"{party.name} is not waiting", ErrorCode.conflict)
            tables = self._normalize_selection(session, table_ids)
            usable = usable_seats([table.seats for table in tables])
            if party.size > usable:
                raise ServiceError(
                    f"Party of {party.size} won't fit: {usable} usable seats",
                    ErrorCode.conflict,
                )
            group: TableGroupRow | None = None
            if len(tables) >= 2:
                group = self._create_group(session, shift.id, tables, party.id)
            else:
                tables[0].status = TableStatus.reserved.value
                tables[0].locked_by_party_id = party.id
            now = self.now()
            party.status = PartyStatus.seated.value
            party.table_or_group_id = group.id if group is not None else tables[0].id
            party.seated_at = now
            party.booked_until = now + self._grace
            return SeatResult(
                party=Party.model_validate(party),
                group=TableGroup.model_validate(group) if group is not None else None,
            )

    def mark_arrived(self, party_id: UUID) -> Party:
        with self.session_factory() as session, session.begin():
            party = self._party_row(session, party_id)
            if party.status != PartyStatus.seated.value:
                raise ServiceError(f"{party.name} is not seated", ErrorCode.conflict)
            if party.booked_until is None:
                raise ServiceError(
                    f"{party.name} already arrived", ErrorCode.conflict
                )
            party.booked_until = None
            if party.table_or_group_id is not None:
                table = session.get(TableRow, party.table_or_group_id)
                if table is not None:
                    table.status = TableStatus.occupied.value
            return Party.model_validate(party)

    def mark_left(self, party_id: UUID) -> Party:
        with self.session_factory() as session, session.begin():
            party = self._party_row(session, party_id)
            if party.status not in (PartyStatus.waiting.value, PartyStatus.seated.value):
                raise ServiceError(f"{party.name} already left", ErrorCode.conflict)
            if party.status == PartyStatus.seated.value:
                self._release_assignment(session, party)
            party.status = PartyStatus.left.value
            return Party.model_validate(party)

    def requeue_party(self, party_id: UUID) -> Party:
        with self.session_factory() as session, session.begin():
            shift = self._require_open_shift(session)
            party = self._party_row(session, party_id)
            if party.status != PartyStatus.no_show.value:
                raise ServiceError(
                    f"{party.name} is not a no-show", ErrorCode.conflict
                )
            party.status = PartyStatus.waiting.value
            party.table_or_group_id = None
            party.seated_at = None
            party.booked_until = None
            party.position = self._next_position(session, shift.id)
            return Party.model_validate(party)

    # ---- auto-expire

    def sweep(self) -> list[Party]:
        with self.session_factory() as session, session.begin():
            now = self.now()
            overdue = list(
                session.scalars(
                    select(PartyRow).where(
                        PartyRow.status == PartyStatus.seated.value,
                        PartyRow.booked_until.is_not(None),
                        PartyRow.booked_until <= now,
                    )
                )
            )
            expired: list[Party] = []
            for party in overdue:
                self._release_assignment(session, party)
                party.status = PartyStatus.no_show.value
                expired.append(Party.model_validate(party))
            return expired
