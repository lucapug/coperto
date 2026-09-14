// The single services layer: every backend call in the app goes through
// ApiService. Components never talk to HTTP, storage or the domain store
// directly — swap the mock for a real client without touching the UI.

import type { Party, Shift, Table, TableGroup } from '../types';

export class ServiceError extends Error {
  constructor(
    message: string,
    /** validation/conflict/not_found come from the backend's contract;
     *  network/unknown are client-side */
    readonly code: 'validation' | 'conflict' | 'not_found' | 'network' | 'unknown' = 'validation',
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface AddPartyInput {
  name: string;
  size: number;
  phone: string;
  notes?: string;
  estimatedWaitMinutes?: number;
}

export interface SeatResult {
  party: Party;
  group: TableGroup | null;
}

export interface ApiService {
  // Shift lifecycle (plan §3.1, §4.5)
  getShift(): Promise<Shift | null>;
  openShift(): Promise<Shift>;
  closeShift(): Promise<Shift>;

  // Tables and groups (plan §3.2, §3.3)
  listTables(): Promise<Table[]>;
  listGroups(): Promise<TableGroup[]>;
  /** merge free tables into a new group, in host-chosen adjacency order */
  combineTables(tableIds: string[]): Promise<TableGroup>;
  /** only allowed while no party holds the group */
  dissolveGroup(groupId: string): Promise<void>;

  // Waitlist (plan §3.5, §3.6, §4.1, §4.2)
  listParties(): Promise<Party[]>;
  addParty(input: AddPartyInput): Promise<Party>;
  /** one free table, or several in adjacency order (creates a TableGroup) */
  seatParty(partyId: string, tableIds: string[]): Promise<SeatResult>;
  /** guest showed up: clears bookedUntil, single table becomes occupied */
  markArrived(partyId: string): Promise<Party>;
  /** waiting -> left, or seated -> left releasing every table */
  markLeft(partyId: string): Promise<Party>;
  /** no_show -> back to the end of the queue (plan §4.4) */
  requeueParty(partyId: string): Promise<Party>;

  // Auto-expire sweep (plan §4.3): moves overdue seated parties to no_show
  // and releases their tables. Returns the parties just expired.
  sweep(): Promise<Party[]>;
}
