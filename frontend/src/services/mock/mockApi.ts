// In-memory mock of the backend: same contract as the future REST API,
// no network, no persistence. Runs the whole app standalone.

import type { Party, Shift, Table, TableGroup } from '../../types';
import { grossSeats, junctionCount, usableSeats } from '../../lib/seatMath';
import { ServiceError, type AddPartyInput, type ApiService, type SeatResult } from '../api';
import { DEFAULT_TABLE_SEEDS, type TableSeed } from './seed';

/** plan §4.2: bookedUntil = now + 20 minutes (configurable constant) */
export const DEFAULT_GRACE_MS = 20 * 60 * 1000;

export interface MockApiOptions {
  graceMs?: number;
  now?: () => number;
  tables?: TableSeed[];
}

function uuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export class MockApi implements ApiService {
  private readonly graceMs: number;
  private readonly now: () => number;

  private tables: Table[] = [];
  private groups: TableGroup[] = [];
  private parties: Party[] = [];
  private shifts: Shift[] = [];

  constructor(options: MockApiOptions = {}) {
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.now = options.now ?? Date.now;
    const seeds = options.tables ?? DEFAULT_TABLE_SEEDS;
    this.tables = seeds.map((s) => ({
      id: uuid(),
      label: s.label,
      seats: s.seats,
      status: 'free',
      groupId: null,
      lockedByPartyId: null,
    }));
  }

  // ---- helpers

  private latestShift(): Shift | null {
    return this.shifts.at(-1) ?? null;
  }

  private requireOpenShift(): Shift {
    const shift = this.latestShift();
    if (!shift || shift.status !== 'open') {
      throw new ServiceError('No open shift', 'conflict');
    }
    return shift;
  }

  private party(partyId: string): Party {
    const party = this.parties.find((p) => p.id === partyId);
    if (!party) throw new ServiceError(`Unknown party ${partyId}`);
    return party;
  }

  private table(id: string): Table {
    const table = this.tables.find((t) => t.id === id);
    if (!table) throw new ServiceError(`Unknown table ${id}`);
    return table;
  }

  private freeTable(table: Table): void {
    table.status = 'free';
    table.groupId = null;
    table.lockedByPartyId = null;
  }

  private dissolveGroupTables(group: TableGroup): void {
    for (const id of group.tableIds) this.freeTable(this.table(id));
    this.groups = this.groups.filter((g) => g.id !== group.id);
  }

  /** free the tables of an assignment and dissolve its group, if any */
  private releaseAssignment(party: Party): void {
    if (!party.tableOrGroupId) return;
    const group = this.groups.find((g) => g.id === party.tableOrGroupId);
    if (group) {
      this.dissolveGroupTables(group);
      return;
    }
    const table = this.tables.find((t) => t.id === party.tableOrGroupId);
    if (table) this.freeTable(table);
  }

  /**
   * Normalize a selection for merging/seating:
   * - every table must exist, no duplicates
   * - tables must be free, or members of a free group
   * - a group can only be taken whole (atomic, plan §3.3); absorbing one
   *   dissolves it so it is re-created in the host's selection order
   */
  private normalizeSelection(tableIds: string[]): Table[] {
    if (tableIds.length === 0) throw new ServiceError('Select at least one table');
    const seen = new Set<string>();
    for (const id of tableIds) {
      if (seen.has(id)) throw new ServiceError('Duplicate table in selection');
      seen.add(id);
    }
    const tables = tableIds.map((id) => this.table(id));
    const absorbed = new Map<string, TableGroup>();
    for (const table of tables) {
      if (table.status === 'combined' && table.groupId) {
        const group = this.groups.find((g) => g.id === table.groupId);
        if (!group) continue;
        if (group.partyId) {
          throw new ServiceError(
            `Table ${table.label} is part of a group held by a party`,
            'conflict',
          );
        }
        absorbed.set(group.id, group);
      } else if (table.status !== 'free') {
        throw new ServiceError(`Table ${table.label} is not free`, 'conflict');
      }
    }
    for (const group of absorbed.values()) {
      const missing = group.tableIds.filter((id) => !seen.has(id));
      if (missing.length > 0) {
        const labels = missing.map((id) => this.table(id).label).join(', ');
        throw new ServiceError(
          `A merged group is atomic — also select ${labels}`,
          'conflict',
        );
      }
      this.dissolveGroupTables(group);
    }
    return tables;
  }

  private createGroup(shiftId: string, tables: Table[], partyId: string | null): TableGroup {
    const seatCounts = tables.map((t) => t.seats);
    const group: TableGroup = {
      id: uuid(),
      shiftId,
      tableIds: tables.map((t) => t.id),
      grossSeats: grossSeats(seatCounts),
      usableSeats: usableSeats(seatCounts),
      junctions: junctionCount(tables.length),
      partyId,
    };
    this.groups.push(group);
    for (const table of tables) {
      table.status = 'combined';
      table.groupId = group.id;
      table.lockedByPartyId = partyId;
    }
    return { ...group, tableIds: [...group.tableIds] };
  }

  private nextPosition(shiftId: string): number {
    const inShift = this.parties.filter((p) => p.shiftId === shiftId);
    return inShift.length ? Math.max(...inShift.map((p) => p.position)) + 1 : 1;
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }

  // ---- shift lifecycle

  async getShift(): Promise<Shift | null> {
    return this.latestShift() ? { ...this.latestShift()! } : null;
  }

  async openShift(): Promise<Shift> {
    const current = this.latestShift();
    if (current?.status === 'open') {
      throw new ServiceError('A shift is already open', 'conflict');
    }
    const shift: Shift = { id: uuid(), openedAt: this.isoNow(), closedAt: null, status: 'open' };
    this.shifts.push(shift);
    return { ...shift };
  }

  async closeShift(): Promise<Shift> {
    const shift = this.requireOpenShift();
    for (const party of this.parties.filter((p) => p.shiftId === shift.id)) {
      if (party.status === 'waiting' || party.status === 'seated') {
        this.releaseAssignment(party);
        party.status = 'left';
      }
    }
    for (const group of [...this.groups]) this.dissolveGroupTables(group);
    for (const table of this.tables) this.freeTable(table);
    shift.closedAt = this.isoNow();
    shift.status = 'closed';
    return { ...shift };
  }

  // ---- tables and groups

  async listTables(): Promise<Table[]> {
    return this.tables.map((t) => ({ ...t }));
  }

  async listGroups(): Promise<TableGroup[]> {
    return this.groups.map((g) => ({ ...g, tableIds: [...g.tableIds] }));
  }

  async combineTables(tableIds: string[]): Promise<TableGroup> {
    const shift = this.requireOpenShift();
    const tables = this.normalizeSelection(tableIds);
    if (tables.length < 2) throw new ServiceError('Select at least two tables to combine');
    return this.createGroup(shift.id, tables, null);
  }

  async dissolveGroup(groupId: string): Promise<void> {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) throw new ServiceError(`Unknown group ${groupId}`);
    if (group.partyId) {
      const holder = this.parties.find((p) => p.id === group.partyId);
      if (holder?.status === 'seated') {
        throw new ServiceError(
          'A party is seated on this group — mark them left first',
          'conflict',
        );
      }
    }
    this.dissolveGroupTables(group);
  }

  // ---- waitlist

  async listParties(): Promise<Party[]> {
    const shift = this.latestShift();
    if (!shift) return [];
    return this.parties
      .filter((p) => p.shiftId === shift.id)
      .map((p) => ({ ...p }));
  }

  async addParty(input: AddPartyInput): Promise<Party> {
    const shift = this.requireOpenShift();
    const name = input.name?.trim();
    const phone = input.phone?.trim();
    if (!name) throw new ServiceError('Name is required');
    if (!phone) throw new ServiceError('Phone is required');
    if (!Number.isInteger(input.size) || input.size < 1) {
      throw new ServiceError('Party size must be a positive integer');
    }
    const wait = input.estimatedWaitMinutes;
    if (wait != null && (!Number.isInteger(wait) || wait < 0)) {
      throw new ServiceError('Estimated wait must be a number of minutes');
    }
    const party: Party = {
      id: uuid(),
      shiftId: shift.id,
      name,
      size: input.size,
      phone,
      notes: input.notes?.trim() || null,
      estimatedWait: wait ?? null,
      status: 'waiting',
      tableOrGroupId: null,
      seatedAt: null,
      bookedUntil: null,
      createdAt: this.isoNow(),
      position: this.nextPosition(shift.id),
    };
    this.parties.push(party);
    return { ...party };
  }

  async seatParty(partyId: string, tableIds: string[]): Promise<SeatResult> {
    const shift = this.requireOpenShift();
    const party = this.party(partyId);
    if (party.shiftId !== shift.id) {
      throw new ServiceError('Party belongs to another shift', 'conflict');
    }
    if (party.status !== 'waiting') {
      throw new ServiceError(`${party.name} is not waiting`, 'conflict');
    }
    const tables = this.normalizeSelection(tableIds);
    const usable = usableSeats(tables.map((t) => t.seats));
    if (party.size > usable) {
      throw new ServiceError(
        `Party of ${party.size} won't fit: ${usable} usable seat${usable === 1 ? '' : 's'}`,
        'conflict',
      );
    }
    let group: TableGroup | null = null;
    if (tables.length >= 2) {
      group = this.createGroup(shift.id, tables, party.id);
    } else {
      const table = tables[0];
      table.status = 'reserved';
      table.lockedByPartyId = party.id;
    }
    party.status = 'seated';
    party.tableOrGroupId = group ? group.id : tables[0].id;
    party.seatedAt = new Date(this.now()).toISOString();
    party.bookedUntil = new Date(this.now() + this.graceMs).toISOString();
    return { party: { ...party }, group };
  }

  async markArrived(partyId: string): Promise<Party> {
    const party = this.party(partyId);
    if (party.status !== 'seated') {
      throw new ServiceError(`${party.name} is not seated`, 'conflict');
    }
    if (!party.bookedUntil) {
      throw new ServiceError(`${party.name} already arrived`, 'conflict');
    }
    party.bookedUntil = null;
    const table = this.tables.find((t) => t.id === party.tableOrGroupId);
    if (table) table.status = 'occupied';
    return { ...party };
  }

  async markLeft(partyId: string): Promise<Party> {
    const party = this.party(partyId);
    if (party.status !== 'waiting' && party.status !== 'seated') {
      throw new ServiceError(`${party.name} already left`, 'conflict');
    }
    if (party.status === 'seated') this.releaseAssignment(party);
    party.status = 'left';
    return { ...party };
  }

  async requeueParty(partyId: string): Promise<Party> {
    const shift = this.requireOpenShift();
    const party = this.party(partyId);
    if (party.status !== 'no_show') {
      throw new ServiceError(`${party.name} is not a no-show`, 'conflict');
    }
    party.status = 'waiting';
    party.tableOrGroupId = null;
    party.seatedAt = null;
    party.bookedUntil = null;
    party.position = this.nextPosition(shift.id);
    return { ...party };
  }

  async sweep(): Promise<Party[]> {
    const now = this.now();
    const expired: Party[] = [];
    for (const party of this.parties) {
      if (party.status !== 'seated' || !party.bookedUntil) continue;
      if (Date.parse(party.bookedUntil) > now) continue;
      this.releaseAssignment(party);
      party.status = 'no_show';
      expired.push({ ...party });
    }
    return expired;
  }
}
