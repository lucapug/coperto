"""In-memory store implementing the domain rules from docs/plan.md.

Behavior is ported 1:1 from the frontend mock
(frontend/src/services/mock/mockApi.ts) so both halves of the system agree
on every rule until a real database replaces this module.
"""

import threading
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

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


class InMemoryStore:
    def __init__(
        self,
        now_fn: Callable[[], datetime] | None = None,
        table_seeds: list[tuple[str, int]] | None = None,
        grace: timedelta = DEFAULT_GRACE,
    ) -> None:
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self._grace = grace
        self._lock = threading.RLock()
        self.tables: dict[UUID, Table] = {}
        for label, seats in table_seeds or TABLE_SEEDS:
            table_id = uuid4()
            self.tables[table_id] = Table(
                id=table_id,
                label=label,
                seats=seats,
                status=TableStatus.free,
                group_id=None,
                locked_by_party_id=None,
            )
        self.groups: dict[UUID, TableGroup] = {}
        self.parties: dict[UUID, Party] = {}
        self.shifts: list[Shift] = []

    def now(self) -> datetime:
        return self._now_fn()

    # ---- internal helpers

    def _latest_shift(self) -> Shift | None:
        return self.shifts[-1] if self.shifts else None

    def _require_open_shift(self) -> Shift:
        shift = self._latest_shift()
        if shift is None or shift.status is not ShiftStatus.open:
            raise ServiceError("No open shift", ErrorCode.conflict)
        return shift

    def _party(self, party_id: UUID) -> Party:
        party = self.parties.get(party_id)
        if party is None:
            raise ServiceError(f"Unknown party {party_id}", ErrorCode.not_found)
        return party

    def _table(self, table_id: UUID) -> Table:
        table = self.tables.get(table_id)
        if table is None:
            raise ServiceError(f"Unknown table {table_id}", ErrorCode.not_found)
        return table

    def _free_table(self, table: Table) -> None:
        table.status = TableStatus.free
        table.group_id = None
        table.locked_by_party_id = None

    def _dissolve_group_tables(self, group: TableGroup) -> None:
        for table_id in group.table_ids:
            self._free_table(self._table(table_id))
        self.groups.pop(group.id, None)

    def _release_assignment(self, party: Party) -> None:
        """Free the tables of an assignment and dissolve its group, if any."""
        if party.table_or_group_id is None:
            return
        group = self.groups.get(party.table_or_group_id)
        if group is not None:
            self._dissolve_group_tables(group)
            return
        table = self.tables.get(party.table_or_group_id)
        if table is not None:
            self._free_table(table)

    def _normalize_selection(self, table_ids: list[UUID]) -> list[Table]:
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
        tables = [self._table(table_id) for table_id in table_ids]

        absorbed: dict[UUID, TableGroup] = {}
        for table in tables:
            if table.status is TableStatus.combined and table.group_id:
                group = self.groups.get(table.group_id)
                if group is None:
                    continue
                if group.party_id:
                    raise ServiceError(
                        f"Table {table.label} is part of a group held by a party",
                        ErrorCode.conflict,
                    )
                absorbed[group.id] = group
            elif table.status is not TableStatus.free:
                raise ServiceError(f"Table {table.label} is not free", ErrorCode.conflict)

        for group in absorbed.values():
            missing = [tid for tid in group.table_ids if tid not in seen]
            if missing:
                labels = ", ".join(self.tables[tid].label for tid in missing)
                raise ServiceError(
                    f"A merged group is atomic — also select {labels}",
                    ErrorCode.conflict,
                )
            self._dissolve_group_tables(group)
        return tables

    def _create_group(self, shift_id: UUID, tables: list[Table], party_id: UUID | None) -> TableGroup:
        seat_counts = [t.seats for t in tables]
        group = TableGroup(
            id=uuid4(),
            shift_id=shift_id,
            table_ids=[t.id for t in tables],
            gross_seats=sum(seat_counts),
            usable_seats=usable_seats(seat_counts),
            junctions=len(tables) - 1,
            party_id=party_id,
        )
        self.groups[group.id] = group
        for table in tables:
            table.status = TableStatus.combined
            table.group_id = group.id
            table.locked_by_party_id = party_id
        return group

    def _next_position(self, shift_id: UUID) -> int:
        in_shift = [p.position for p in self.parties.values() if p.shift_id == shift_id]
        return max(in_shift) + 1 if in_shift else 1

    # ---- shift lifecycle

    def get_shift(self) -> Shift | None:
        return self._latest_shift()

    def open_shift(self) -> Shift:
        with self._lock:
            current = self._latest_shift()
            if current is not None and current.status is ShiftStatus.open:
                raise ServiceError("A shift is already open", ErrorCode.conflict)
            shift = Shift(
                id=uuid4(),
                opened_at=self.now(),
                closed_at=None,
                status=ShiftStatus.open,
            )
            self.shifts.append(shift)
            return shift

    def close_shift(self) -> Shift:
        with self._lock:
            shift = self._require_open_shift()
            for party in self.parties.values():
                if party.shift_id != shift.id:
                    continue
                if party.status in (PartyStatus.waiting, PartyStatus.seated):
                    self._release_assignment(party)
                    party.status = PartyStatus.left
            for group in list(self.groups.values()):
                self._dissolve_group_tables(group)
            for table in self.tables.values():
                self._free_table(table)
            shift.closed_at = self.now()
            shift.status = ShiftStatus.closed
            return shift

    # ---- tables and groups

    def list_tables(self) -> list[Table]:
        return list(self.tables.values())

    def list_groups(self) -> list[TableGroup]:
        return list(self.groups.values())

    def combine_tables(self, table_ids: list[UUID]) -> TableGroup:
        with self._lock:
            shift = self._require_open_shift()
            tables = self._normalize_selection(table_ids)
            if len(tables) < 2:
                raise ServiceError("Select at least two tables to combine")
            return self._create_group(shift.id, tables, None)

    def dissolve_group(self, group_id: UUID) -> None:
        with self._lock:
            group = self.groups.get(group_id)
            if group is None:
                raise ServiceError(f"Unknown group {group_id}", ErrorCode.not_found)
            if group.party_id:
                holder = self.parties.get(group.party_id)
                if holder is not None and holder.status is PartyStatus.seated:
                    raise ServiceError(
                        "A party is seated on this group — mark them left first",
                        ErrorCode.conflict,
                    )
            self._dissolve_group_tables(group)

    # ---- parties

    def list_parties(self) -> list[Party]:
        shift = self._latest_shift()
        if shift is None:
            return []
        return [p for p in self.parties.values() if p.shift_id == shift.id]

    def add_party(self, party_input: AddPartyInput) -> Party:
        with self._lock:
            shift = self._require_open_shift()
            name = party_input.name.strip()
            phone = party_input.phone.strip()
            if not name:
                raise ServiceError("Name is required")
            if not phone:
                raise ServiceError("Phone is required")
            party = Party(
                id=uuid4(),
                shift_id=shift.id,
                name=name,
                size=party_input.size,
                phone=phone,
                notes=party_input.notes.strip() if party_input.notes else None,
                estimated_wait=party_input.estimated_wait_minutes,
                status=PartyStatus.waiting,
                table_or_group_id=None,
                seated_at=None,
                booked_until=None,
                created_at=self.now(),
                position=self._next_position(shift.id),
            )
            self.parties[party.id] = party
            return party

    def seat_party(self, party_id: UUID, table_ids: list[UUID]) -> SeatResult:
        with self._lock:
            shift = self._require_open_shift()
            party = self._party(party_id)
            if party.shift_id != shift.id:
                raise ServiceError("Party belongs to another shift", ErrorCode.conflict)
            if party.status is not PartyStatus.waiting:
                raise ServiceError(f"{party.name} is not waiting", ErrorCode.conflict)
            tables = self._normalize_selection(table_ids)
            usable = usable_seats([t.seats for t in tables])
            if party.size > usable:
                raise ServiceError(
                    f"Party of {party.size} won't fit: {usable} usable seats",
                    ErrorCode.conflict,
                )
            group = None
            if len(tables) >= 2:
                group = self._create_group(shift.id, tables, party.id)
            else:
                tables[0].status = TableStatus.reserved
                tables[0].locked_by_party_id = party.id
            now = self.now()
            party.status = PartyStatus.seated
            party.table_or_group_id = group.id if group else tables[0].id
            party.seated_at = now
            party.booked_until = now + self._grace
            return SeatResult(party=party, group=group)

    def mark_arrived(self, party_id: UUID) -> Party:
        with self._lock:
            party = self._party(party_id)
            if party.status is not PartyStatus.seated:
                raise ServiceError(f"{party.name} is not seated", ErrorCode.conflict)
            if party.booked_until is None:
                raise ServiceError(f"{party.name} already arrived", ErrorCode.conflict)
            party.booked_until = None
            table = self.tables.get(party.table_or_group_id or UUID(int=0))
            if table is not None:
                table.status = TableStatus.occupied
            return party

    def mark_left(self, party_id: UUID) -> Party:
        with self._lock:
            party = self._party(party_id)
            if party.status not in (PartyStatus.waiting, PartyStatus.seated):
                raise ServiceError(f"{party.name} already left", ErrorCode.conflict)
            if party.status is PartyStatus.seated:
                self._release_assignment(party)
            party.status = PartyStatus.left
            return party

    def requeue_party(self, party_id: UUID) -> Party:
        with self._lock:
            shift = self._require_open_shift()
            party = self._party(party_id)
            if party.status is not PartyStatus.no_show:
                raise ServiceError(f"{party.name} is not a no-show", ErrorCode.conflict)
            party.status = PartyStatus.waiting
            party.table_or_group_id = None
            party.seated_at = None
            party.booked_until = None
            party.position = self._next_position(shift.id)
            return party

    # ---- auto-expire

    def sweep(self) -> list[Party]:
        with self._lock:
            now = self.now()
            expired: list[Party] = []
            for party in self.parties.values():
                if party.status is not PartyStatus.seated or party.booked_until is None:
                    continue
                if party.booked_until > now:
                    continue
                self._release_assignment(party)
                party.status = PartyStatus.no_show
                expired.append(party)
            return expired
