// Domain model — mirrors docs/plan.md §3.

export type ShiftStatus = 'open' | 'closed';

export interface Shift {
  id: string;
  openedAt: string; // ISO datetime
  closedAt: string | null; // null while open
  status: ShiftStatus;
}

export type TableStatus = 'free' | 'occupied' | 'reserved' | 'combined';

export interface Table {
  id: string;
  label: string; // e.g. "T12"
  seats: number;
  status: TableStatus;
  /** set when merged into a TableGroup */
  groupId: string | null;
  /** party currently holding this table */
  lockedByPartyId: string | null;
}

export interface TableGroup {
  id: string;
  shiftId: string;
  /** ordered: physical adjacency order, defined by the host's selection order */
  tableIds: string[];
  grossSeats: number;
  usableSeats: number; // grossSeats - 2 per junction
  junctions: number; // tableIds.length - 1
  /** party seated on this group, null while the group is free */
  partyId: string | null;
}

export type PartyStatus = 'waiting' | 'seated' | 'no_show' | 'left';

export interface Party {
  id: string;
  shiftId: string;
  name: string;
  size: number;
  phone: string;
  notes: string | null; // allergies, high chair, wheelchair, ...
  /** minutes, entered manually by the host */
  estimatedWait: number | null;
  status: PartyStatus;
  /** table id or group id, assigned when seated */
  tableOrGroupId: string | null;
  seatedAt: string | null;
  /** seatedAt + grace period; cleared when the guest shows up */
  bookedUntil: string | null;
  createdAt: string;
  /** order in the queue */
  position: number;
}
