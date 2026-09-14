import { useState } from 'react';
import type { Party, Table, TableGroup } from '../types';
import type { AddPartyInput } from '../services/api';
import { minutesLeft, noShowParties, seatedParties, waitingParties } from '../lib/domain';
import AddPartyForm from './AddPartyForm';

interface Props {
  parties: Party[];
  tables: Table[];
  groups: TableGroup[];
  selectedPartyId: string | null;
  onSelectParty: (id: string | null) => void;
  onAddParty: (input: AddPartyInput) => Promise<void>;
  onMarkArrived: (partyId: string) => Promise<void>;
  onMarkLeft: (partyId: string) => Promise<void>;
  onRequeue: (partyId: string) => Promise<void>;
  nowMs: number;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function partyMeta(party: Party): string {
  return [`${party.size}p`, party.estimatedWait != null ? `~${party.estimatedWait}m` : null]
    .filter(Boolean)
    .join(' · ');
}

export default function WaitlistPanel(props: Props) {
  const { parties, tables, groups, selectedPartyId } = props;
  const [adding, setAdding] = useState(false);
  const waiting = waitingParties(parties);
  const seated = seatedParties(parties);
  const noShows = noShowParties(parties);

  return (
    <section className="card flex flex-col gap-4 p-4" aria-label="Waitlist">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black uppercase tracking-wide">Waitlist</h2>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
        >
          {adding ? 'Cancel' : '+ Add party'}
        </button>
      </div>

      {adding && (
        <AddPartyForm
          onSubmit={async (input) => {
            await props.onAddParty(input);
            setAdding(false);
          }}
        />
      )}

      <ol className="flex flex-col gap-2" aria-label="Queue">
        {waiting.map((party) => {
          const selected = party.id === selectedPartyId;
          return (
            <li
              key={party.id}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 px-4 py-2 ${
                selected
                  ? 'border-stone-900 bg-stone-100 ring-4 ring-stone-900'
                  : 'border-stone-300 bg-white'
              }`}
            >
              <span className="text-lg font-bold">
                #{party.position} {party.name} · {partyMeta(party)}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  aria-pressed={selected}
                  aria-label={`Seat ${party.name}`}
                  onClick={() => props.onSelectParty(selected ? null : party.id)}
                >
                  Seat
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Gone ${party.name}`}
                  onClick={() => void props.onMarkLeft(party.id)}
                >
                  Gone
                </button>
              </span>
            </li>
          );
        })}
        {waiting.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-stone-300 px-4 py-6 text-center text-base font-semibold text-stone-500">
            Nobody waiting.
          </li>
        )}
      </ol>

      {selectedPartyId && (
        <p className="rounded-xl bg-stone-900 px-4 py-2 text-base font-bold text-white">
          Party selected — tap tables on the right, then “Seat here”.
        </p>
      )}

      {seated.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-black uppercase tracking-wide text-stone-500">Seated</h3>
          <ul className="flex flex-col gap-2">
            {seated.map((party) => {
              const table = tables.find((t) => t.id === party.tableOrGroupId);
              const groupIndex = groups.findIndex((g) => g.id === party.tableOrGroupId);
              const label = table?.label ?? (groupIndex >= 0 ? `G${groupIndex + 1}` : '?');
              const left = minutesLeft(party.bookedUntil, props.nowMs);
              return (
                <li
                  key={party.id}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-2"
                >
                  <span className="text-lg font-bold">
                    {party.name} · {party.size}p · {label}
                  </span>
                  <span className="flex items-center gap-2">
                    {party.bookedUntil ? (
                      <span className="text-base font-black text-amber-800">{left} min left</span>
                    ) : (
                      <span className="badge bg-red-100 text-red-900">dining</span>
                    )}
                    {party.bookedUntil && (
                      <button
                        type="button"
                        className="btn-primary"
                        aria-label={`Arrived ${party.name}`}
                        onClick={() => void props.onMarkArrived(party.id)}
                      >
                        Arrived
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Left ${party.name}`}
                      onClick={() => void props.onMarkLeft(party.id)}
                    >
                      Left
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {noShows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-red-300 bg-red-50 p-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-red-700">No-show</h3>
          <ul className="flex flex-col gap-2">
            {noShows.map((party) => (
              <li key={party.id} className="flex items-center justify-between gap-3">
                <span className="text-base font-bold text-red-900">
                  {party.name} · {party.size}p · expired{' '}
                  {party.bookedUntil ? formatTime(party.bookedUntil) : ''}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Requeue ${party.name}`}
                  onClick={() => void props.onRequeue(party.id)}
                >
                  Requeue
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
