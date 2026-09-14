import { useState } from 'react';
import type { Party, Table, TableGroup } from '../types';
import { grossSeats, usableSeats as computeUsable } from '../lib/seatMath';
import { groupState, partyByIdMap, smallestWaitingSize } from '../lib/domain';

interface Props {
  tables: Table[];
  groups: TableGroup[];
  parties: Party[];
  selectedParty: Party | null;
  onSeatAtTables: (tableIds: string[]) => void;
  onCombine: (tableIds: string[]) => void;
  onDissolve: (groupId: string) => void;
}

const STATUS_STYLES: Record<Table['status'], string> = {
  free: 'bg-green-100 text-green-900',
  reserved: 'bg-amber-100 text-amber-900',
  occupied: 'bg-red-100 text-red-900',
  combined: 'bg-indigo-100 text-indigo-900',
};

const GROUP_STATE_STYLES = {
  free: 'bg-indigo-100 text-indigo-900',
  reserved: 'bg-amber-100 text-amber-900',
  occupied: 'bg-red-100 text-red-900',
};

export default function TablesPanel(props: Props) {
  const { tables, groups, parties, selectedParty } = props;
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);

  const byId = new Map(tables.map((t) => [t.id, t]));
  const partyById = partyByIdMap(parties);
  const groupedIds = new Set(groups.flatMap((g) => g.tableIds));
  const standalone = tables.filter((t) => !groupedIds.has(t.id));

  /** free tables toggle individually; a group toggles as a whole (atomic) */
  function toggle(target: Table) {
    if (target.groupId) {
      const group = groups.find((g) => g.id === target.groupId);
      if (!group || groupState(group, partyById) !== 'free') return;
      const ids = group.tableIds;
      const allSelected = ids.every((id) => selectedTableIds.includes(id));
      setSelectedTableIds((prev) =>
        allSelected
          ? prev.filter((id) => !ids.includes(id))
          : [...prev.filter((id) => !ids.includes(id)), ...ids],
      );
      return;
    }
    if (target.status !== 'free') return;
    setSelectedTableIds((prev) =>
      prev.includes(target.id) ? prev.filter((id) => id !== target.id) : [...prev, target.id],
    );
  }

  const selectedTables = selectedTableIds
    .map((id) => byId.get(id))
    .filter((t): t is Table => Boolean(t));
  const seatCounts = selectedTables.map((t) => t.seats);
  const usable = seatCounts.length ? computeUsable(seatCounts) : null;
  const smallest = smallestWaitingSize(parties);
  const tooSmallForParty = Boolean(selectedParty && usable != null && selectedParty.size > usable);
  const belowSmallestWaiting = Boolean(
    usable != null && smallest != null && usable < smallest && !tooSmallForParty,
  );
  const selectedLabels = selectedTables.map((t) => t.label).join('+');

  function actSeat() {
    props.onSeatAtTables(selectedTableIds);
    setSelectedTableIds([]);
  }

  function actCombine() {
    props.onCombine(selectedTableIds);
    setSelectedTableIds([]);
  }

  return (
    <section className="card flex flex-col gap-4 p-4" aria-label="Tables">
      <h2 className="text-xl font-black uppercase tracking-wide">Tables</h2>

      <ul className="flex flex-col gap-2">
        {standalone.map((table) => {
          const order = selectedTableIds.indexOf(table.id);
          const selected = order >= 0;
          return (
            <li key={table.id}>
              <button
                type="button"
                disabled={table.status !== 'free'}
                aria-pressed={selected}
                aria-label={`${table.label} ${table.seats} seats, ${table.status}`}
                onClick={() => toggle(table)}
                className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-2 text-left ${
                  table.status === 'free' ? 'border-green-700 bg-green-100' : 'border-stone-300 bg-white'
                } ${selected ? 'ring-4 ring-stone-900' : ''}`}
              >
                <span className="text-lg font-black">{table.label}</span>
                <span className="flex items-center gap-3">
                  <span className="text-base font-bold">{table.seats} seats</span>
                  <span className={`badge ${STATUS_STYLES[table.status]}`}>{table.status}</span>
                  {selected && (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-base font-black text-white">
                      {order + 1}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {groups.map((group, i) => {
        const state = groupState(group, partyById);
        const memberTables = group.tableIds.map((id) => byId.get(id)).filter((t): t is Table => Boolean(t));
        const holder = group.partyId ? partyById.get(group.partyId) : null;
        const allSelected = group.tableIds.every((id) => selectedTableIds.includes(id));
        const firstSelected = selectedTableIds.indexOf(group.tableIds[0]);
        return (
          <div
            key={group.id}
            aria-label={`Group G${i + 1}`}
            className={`rounded-xl border-2 p-3 ${
              state === 'free' ? 'border-indigo-400 bg-indigo-50' : 'border-stone-300 bg-stone-50'
            } ${allSelected ? 'ring-4 ring-stone-900' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-black">
                G{i + 1} · {group.usableSeats} usable seats{' '}
                <span className="text-base font-semibold text-stone-500">
                  ({memberTables.map((t) => t.label).join('+')} · gross {group.grossSeats})
                </span>
              </p>
              <span className="flex items-center gap-3">
                <span className={`badge ${GROUP_STATE_STYLES[state]}`}>{state}</span>
                {holder && state !== 'free' && (
                  <span className="text-base font-bold text-stone-700">{holder.name}</span>
                )}
                {state === 'free' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Split group G${i + 1}`}
                    onClick={() => props.onDissolve(group.id)}
                  >
                    Split
                  </button>
                )}
              </span>
            </div>
            <ul className="ml-4 mt-2 flex flex-col gap-1 border-l-4 border-indigo-300 pl-3">
              {memberTables.map((table) => {
                const order = selectedTableIds.indexOf(table.id);
                return (
                  <li key={table.id}>
                    <button
                      type="button"
                      disabled={state !== 'free'}
                      aria-label={`${table.label} ${table.seats} seats, combined`}
                      onClick={() => toggle(table)}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left ${
                        state === 'free' ? 'hover:bg-indigo-100' : ''
                      }`}
                    >
                      <span className="text-base font-bold">
                        {table.label} · {table.seats} seats · combined
                      </span>
                      {order >= 0 && (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-base font-black text-white">
                          {order + 1}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {firstSelected < 0 && allSelected && <span className="sr-only">group selected</span>}
          </div>
        );
      })}

      <div className="mt-auto flex flex-col gap-3 border-t-2 border-stone-200 pt-4">
        {selectedTables.length > 0 && usable != null && (
          <div
            className={`rounded-xl p-3 text-base font-bold ${
              tooSmallForParty
                ? 'bg-red-100 text-red-900'
                : belowSmallestWaiting
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-stone-100 text-stone-900'
            }`}
            aria-label="Selection preview"
          >
            <p>
              Selected {selectedLabels} · {grossSeats(seatCounts)} gross · {usable} usable
            </p>
            {tooSmallForParty && selectedParty && (
              <p>Party of {selectedParty.size} won’t fit on {usable} usable seats.</p>
            )}
            {belowSmallestWaiting && smallest != null && (
              <p>Only {usable} usable seats — the smallest party waiting is {smallest}.</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {selectedTables.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelectedTableIds([])}
            >
              Clear
            </button>
          )}
          {!selectedParty && selectedTables.length >= 2 && (
            <button type="button" className="btn-primary" onClick={actCombine}>
              Combine selected
            </button>
          )}
          {selectedParty && (
            <button
              type="button"
              className="btn-primary"
              disabled={tooSmallForParty || selectedTables.length === 0}
              onClick={actSeat}
            >
              Seat {selectedParty.name} here
            </button>
          )}
        </div>
        <p className="text-sm font-semibold text-stone-500">
          {selectedParty
            ? `Seating ${selectedParty.name} (${selectedParty.size}p) — tap tables in adjacency order.`
            : 'Tap a party on the left to seat them, or select tables to combine.'}
        </p>
      </div>
    </section>
  );
}
