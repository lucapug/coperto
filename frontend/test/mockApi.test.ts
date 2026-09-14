import { describe, expect, it } from 'vitest';
import { MockApi } from '../src/services/mock/mockApi';
import { ServiceError } from '../src/services/api';
import type { Table } from '../src/types';

const T0 = Date.parse('2026-07-15T12:00:00Z');

function setup(graceMs = 20 * 60 * 1000) {
  let now = T0;
  const api = new MockApi({ graceMs, now: () => now });
  return {
    api,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function labels(api: MockApi): Promise<Map<string, Table>> {
  const tables = await api.listTables();
  return new Map(tables.map((t) => [t.label, t]));
}

async function addParty(api: MockApi, name: string, size: number) {
  return api.addParty({ name, size, phone: '555-0100' });
}

describe('MockApi — shift lifecycle', () => {
  it('starts with no shift; openShift opens one; double open rejected', async () => {
    const { api } = setup();
    expect(await api.getShift()).toBeNull();

    const shift = await api.openShift();
    expect(shift.status).toBe('open');
    expect(shift.closedAt).toBeNull();

    await expect(api.openShift()).rejects.toBeInstanceOf(ServiceError);
  });

  it('closeShift marks everyone left, frees all tables, and a new shift starts clean', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);
    const t1 = map.get('T1')!;
    const t2 = map.get('T2')!;

    const waiting = await addParty(api, 'Rossi', 4);
    const seated = await addParty(api, 'Bianchi', 4);
    await api.seatParty(seated.id, [t1.id]);
    await api.combineTables([t2.id, map.get('T3')!.id]);

    const closed = await api.closeShift();
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBe(new Date(T0).toISOString());

    const parties = await api.listParties();
    expect(parties.map((p) => p.status)).toEqual(['left', 'left']);

    const tables = await api.listTables();
    expect(tables.every((t) => t.status === 'free' && t.groupId === null)).toBe(true);
    expect(await api.listGroups()).toEqual([]);

    await api.openShift();
    expect(await api.listParties()).toEqual([]);
    expect((await api.listTables()).every((t) => t.status === 'free')).toBe(true);
  });
});

describe('MockApi — waitlist', () => {
  it('addParty appends to the end of the queue and validates required fields', async () => {
    const { api } = setup();
    await api.openShift();

    const a = await addParty(api, 'Rossi', 4);
    const b = await addParty(api, 'Bianchi', 2);
    expect(a.position).toBe(1);
    expect(b.position).toBe(2);

    await expect(api.addParty({ name: '  ', size: 2, phone: '123' })).rejects.toThrow('Name');
    await expect(api.addParty({ name: 'X', size: 2, phone: '' })).rejects.toThrow('Phone');
    await expect(api.addParty({ name: 'X', size: 0, phone: '123' })).rejects.toThrow('size');
  });

  it('addParty requires an open shift', async () => {
    const { api } = setup();
    await expect(addParty(api, 'Rossi', 4)).rejects.toBeInstanceOf(ServiceError);
  });
});

describe('MockApi — seating', () => {
  it('seating on one table reserves it and books the grace window', async () => {
    const { api } = setup();
    await api.openShift();
    const t1 = (await labels(api)).get('T1')!;
    const party = await addParty(api, 'Rossi', 4);

    const { party: seated, group } = await api.seatParty(party.id, [t1.id]);
    expect(group).toBeNull();
    expect(seated.status).toBe('seated');
    expect(seated.tableOrGroupId).toBe(t1.id);
    expect(seated.seatedAt).toBe(new Date(T0).toISOString());
    expect(seated.bookedUntil).toBe(new Date(T0 + 20 * 60 * 1000).toISOString());

    const table = (await api.listTables()).find((t) => t.id === t1.id)!;
    expect(table.status).toBe('reserved');
    expect(table.lockedByPartyId).toBe(party.id);
  });

  it('blocks seating a party larger than the usable seats', async () => {
    const { api } = setup();
    await api.openShift();
    const t1 = (await labels(api)).get('T1')!; // 4 seats
    const party = await addParty(api, 'Rossi', 5);

    await expect(api.seatParty(party.id, [t1.id])).rejects.toThrow("won't fit");
    const after = (await api.listParties()).find((p) => p.id === party.id)!;
    expect(after.status).toBe('waiting');
    const table = (await api.listTables()).find((t) => t.id === t1.id)!;
    expect(table.status).toBe('free');
  });

  it('seating on several tables creates a group with the junction formula', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);
    const party = await addParty(api, 'Verdi', 6); // two 4-seaters give 6 usable

    const { party: seated, group } = await api.seatParty(party.id, [
      map.get('T1')!.id,
      map.get('T2')!.id,
    ]);
    expect(group).not.toBeNull();
    expect(group!.grossSeats).toBe(8);
    expect(group!.junctions).toBe(1);
    expect(group!.usableSeats).toBe(6);
    expect(group!.partyId).toBe(party.id);
    expect(seated.tableOrGroupId).toBe(group!.id);

    for (const label of ['T1', 'T2']) {
      const table = (await api.listTables()).find((t) => t.id === map.get(label)!.id)!;
      expect(table.status).toBe('combined');
      expect(table.groupId).toBe(group!.id);
    }

    // 7 people don't fit on 6 usable seats
    const big = await addParty(api, 'Grossi', 7);
    await expect(api.seatParty(big.id, [map.get('T3')!.id, map.get('T4')!.id])).rejects.toThrow(
      "won't fit",
    );
  });

  it('rejects non-waiting parties, unknown tables, duplicates and non-free tables', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);
    const party = await addParty(api, 'Rossi', 2);

    await expect(api.seatParty(party.id, [])).rejects.toBeInstanceOf(ServiceError);
    await expect(api.seatParty(party.id, ['nope'])).rejects.toBeInstanceOf(ServiceError);
    await expect(
      api.seatParty(party.id, [map.get('T1')!.id, map.get('T1')!.id]),
    ).rejects.toThrow('Duplicate');
    await expect(api.seatParty('nope', [map.get('T1')!.id])).rejects.toBeInstanceOf(ServiceError);

    await api.seatParty(party.id, [map.get('T1')!.id]);
    const other = await addParty(api, 'Bianchi', 2);
    await expect(api.seatParty(other.id, [map.get('T1')!.id])).rejects.toThrow('not free');
    await expect(api.seatParty(party.id, [map.get('T2')!.id])).rejects.toThrow('not waiting');
  });
});

describe('MockApi — groups', () => {
  it('combineTables keeps the host selection order and computes usable seats', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);

    const group = await api.combineTables([map.get('T2')!.id, map.get('T1')!.id]);
    expect(group.tableIds).toEqual([map.get('T2')!.id, map.get('T1')!.id]);
    expect(group.usableSeats).toBe(6);
    expect(group.partyId).toBeNull();
  });

  it('requires an open shift, at least two tables and free tables', async () => {
    const { api } = setup();
    const map = await labels(api);
    await expect(api.combineTables([map.get('T1')!.id, map.get('T2')!.id])).rejects.toThrow(
      'No open shift',
    );

    await api.openShift();
    await expect(api.combineTables([map.get('T1')!.id])).rejects.toThrow('at least two');
    await expect(
      api.combineTables([map.get('T1')!.id, map.get('T1')!.id]),
    ).rejects.toThrow('Duplicate');
  });

  it('a merged group is atomic: partial selection is rejected, whole-group recombine works', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);

    await api.combineTables([map.get('T1')!.id, map.get('T2')!.id]);

    // taking just one member of the group is not allowed
    await expect(api.combineTables([map.get('T1')!.id])).rejects.toThrow('atomic');

    // taking the whole group plus an extra table re-merges in selection order
    const bigger = await api.combineTables([
      map.get('T3')!.id,
      map.get('T1')!.id,
      map.get('T2')!.id,
    ]);
    expect(bigger.tableIds).toEqual([
      map.get('T3')!.id,
      map.get('T1')!.id,
      map.get('T2')!.id,
    ]);
    expect(bigger.grossSeats).toBe(12);
    expect(bigger.usableSeats).toBe(8);
    expect((await api.listGroups()).length).toBe(1);
  });

  it('dissolveGroup frees every table, but refuses while a party holds the group', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);

    const group = await api.combineTables([map.get('T1')!.id, map.get('T2')!.id]);
    await api.dissolveGroup(group.id);
    expect(await api.listGroups()).toEqual([]);
    const tables = await api.listTables();
    expect(tables.filter((t) => ['T1', 'T2'].includes(t.label)).every((t) => t.status === 'free')).toBe(true);

    const held = await api.combineTables([map.get('T1')!.id, map.get('T2')!.id]);
    const party = await addParty(api, 'Rossi', 6);
    // seating on an existing free group re-creates it with the same tables,
    // so use the group the seat operation returns
    const { group: seatedGroup } = await api.seatParty(party.id, held.tableIds);
    await expect(api.dissolveGroup(seatedGroup!.id)).rejects.toThrow('party is seated');
  });
});

describe('MockApi — arrivals, departure, requeue', () => {
  it('markArrived clears the countdown and marks the table occupied', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);
    const party = await addParty(api, 'Rossi', 4);
    await api.seatParty(party.id, [map.get('T1')!.id]);

    const arrived = await api.markArrived(party.id);
    expect(arrived.bookedUntil).toBeNull();
    const table = (await api.listTables()).find((t) => t.id === map.get('T1')!.id)!;
    expect(table.status).toBe('occupied');

    await expect(api.markArrived(party.id)).rejects.toThrow('already arrived');
  });

  it('markLeft on a seated party releases tables; on a waiting party just marks left', async () => {
    const { api } = setup();
    await api.openShift();
    const map = await labels(api);

    const seated = await addParty(api, 'Rossi', 6);
    await api.seatParty(seated.id, [map.get('T1')!.id, map.get('T2')!.id]);
    await api.markLeft(seated.id);
    expect((await api.listParties()).find((p) => p.id === seated.id)!.status).toBe('left');
    expect(await api.listGroups()).toEqual([]);
    const t1 = (await api.listTables()).find((t) => t.id === map.get('T1')!.id)!;
    expect(t1.status).toBe('free');

    const waiting = await addParty(api, 'Bianchi', 2);
    await api.markLeft(waiting.id);
    expect((await api.listParties()).find((p) => p.id === waiting.id)!.status).toBe('left');
  });

  it('requeue moves a no-show to the back of the queue', async () => {
    let now = T0;
    const api = new MockApi({ graceMs: 1_000, now: () => now });
    await api.openShift();
    const map = await labels(api);

    const a = await addParty(api, 'Rossi', 4);
    const b = await addParty(api, 'Bianchi', 2);
    await api.seatParty(a.id, [map.get('T1')!.id]);

    now += 2_000;
    const expired = await api.sweep();
    expect(expired.map((p) => p.id)).toEqual([a.id]);

    const requeued = await api.requeueParty(a.id);
    expect(requeued.status).toBe('waiting');
    expect(requeued.tableOrGroupId).toBeNull();
    const bAfter = (await api.listParties()).find((p) => p.id === b.id)!;
    expect(requeued.position).toBeGreaterThan(bAfter.position);

    await expect(api.requeueParty(b.id)).rejects.toThrow('not a no-show');
  });
});

describe('MockApi — auto-expire sweep (plan §4.3)', () => {
  it('expires overdue seated parties and releases their tables and group', async () => {
    const graceMs = 1_000;
    let now = T0;
    const api = new MockApi({ graceMs, now: () => now });
    await api.openShift();
    const map = await labels(api);

    const party = await addParty(api, 'Rossi', 6);
    await api.seatParty(party.id, [map.get('T1')!.id, map.get('T2')!.id]);

    now += graceMs - 1; // still inside the grace window
    expect(await api.sweep()).toEqual([]);
    expect((await api.listParties()).find((p) => p.id === party.id)!.status).toBe('seated');

    now += 2; // past bookedUntil
    const expired = await api.sweep();
    expect(expired.map((p) => p.id)).toEqual([party.id]);
    const after = (await api.listParties()).find((p) => p.id === party.id)!;
    expect(after.status).toBe('no_show');
    expect(await api.listGroups()).toEqual([]);
    const tables = await api.listTables();
    expect(tables.filter((t) => ['T1', 'T2'].includes(t.label)).every((t) => t.status === 'free')).toBe(true);

    expect(await api.sweep()).toEqual([]); // idempotent
  });

  it('ignores parties that already arrived', async () => {
    const graceMs = 1_000;
    let now = T0;
    const api = new MockApi({ graceMs, now: () => now });
    await api.openShift();
    const map = await labels(api);

    const party = await addParty(api, 'Rossi', 4);
    await api.seatParty(party.id, [map.get('T1')!.id]);
    await api.markArrived(party.id);

    now += graceMs * 10;
    expect(await api.sweep()).toEqual([]);
    expect((await api.listParties()).find((p) => p.id === party.id)!.status).toBe('seated');
    const table = (await api.listTables()).find((t) => t.id === map.get('T1')!.id)!;
    expect(table.status).toBe('occupied');
  });
});
