// Read-model helpers shared by the UI components.

import type { Party, Table, TableGroup } from '../types';

export function waitingParties(parties: Party[]): Party[] {
  return parties
    .filter((p) => p.status === 'waiting')
    .sort((a, b) => a.position - b.position);
}

export function seatedParties(parties: Party[]): Party[] {
  return parties.filter((p) => p.status === 'seated');
}

export function noShowParties(parties: Party[]): Party[] {
  return parties
    .filter((p) => p.status === 'no_show')
    .sort((a, b) => (a.bookedUntil ?? '').localeCompare(b.bookedUntil ?? ''));
}

/** plan §3.4: warn when usable seats drop below the smallest party waiting */
export function smallestWaitingSize(parties: Party[]): number | null {
  const waiting = waitingParties(parties);
  return waiting.length ? Math.min(...waiting.map((p) => p.size)) : null;
}

export type GroupState = 'free' | 'reserved' | 'occupied';

export function groupState(group: TableGroup, partyById: Map<string, Party>): GroupState {
  if (!group.partyId) return 'free';
  const party = partyById.get(group.partyId);
  if (!party || party.status !== 'seated') return 'free';
  return party.bookedUntil ? 'reserved' : 'occupied';
}

export function partyByIdMap(parties: Party[]): Map<string, Party> {
  return new Map(parties.map((p) => [p.id, p]));
}

/** minutes until bookedUntil, rounded up; 0 when due; null when absent */
export function minutesLeft(bookedUntil: string | null, nowMs: number): number | null {
  if (!bookedUntil) return null;
  const ms = Date.parse(bookedUntil) - nowMs;
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** "T12" for a table, "G1" (by list order) for a group */
export function seatLabel(
  id: string | null,
  tables: Table[],
  groups: TableGroup[],
): string | null {
  if (!id) return null;
  const table = tables.find((t) => t.id === id);
  if (table) return table.label;
  const index = groups.findIndex((g) => g.id === id);
  return index >= 0 ? `G${index + 1}` : null;
}
