import { useState } from 'react';
import { api } from './services';
import type { ApiService } from './services/api';
import { useRestaurant } from './hooks/useRestaurant';
import WaitlistPanel from './components/WaitlistPanel';
import TablesPanel from './components/TablesPanel';

export default function App({ service = api }: { service?: ApiService }) {
  const r = useRestaurant(service);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const selectedParty =
    r.parties.find((p) => p.id === selectedPartyId && p.status === 'waiting') ?? null;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="flex items-center justify-between gap-4 border-b-2 border-stone-300 bg-white px-6 py-4">
        <h1 className="text-2xl font-black tracking-tight">Coperto</h1>
        {r.shift && (
          <span
            className={`badge ${
              r.shift.status === 'open'
                ? 'bg-green-100 text-green-900'
                : 'bg-stone-200 text-stone-700'
            }`}
          >
            {r.shift.status === 'open' ? 'Shift open' : 'Shift closed'}
          </span>
        )}
        {r.shift?.status === 'open' ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (window.confirm('Close the shift? Waiting and seated parties will be marked left.')) {
                void r.closeShift();
              }
            }}
          >
            Close shift
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => void r.openShift()}>
            Open shift
          </button>
        )}
      </header>

      {r.error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 border-b-2 border-red-300 bg-red-100 px-6 py-3 text-lg font-semibold text-red-900"
        >
          <span>{r.error}</span>
          <button type="button" onClick={r.dismissError} className="rounded-lg px-3 py-1 font-bold">
            Dismiss
          </button>
        </div>
      )}

      <main className="mx-auto max-w-7xl p-4">
        {!r.shift || r.shift.status === 'closed' ? (
          <div className="card mx-auto mt-24 max-w-md p-8 text-center">
            <p className="mb-6 text-xl font-semibold">
              {r.shift ? 'Shift closed.' : 'No shift yet.'}
            </p>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => void r.openShift()}
            >
              Open shift
            </button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <WaitlistPanel
              parties={r.parties}
              tables={r.tables}
              groups={r.groups}
              selectedPartyId={selectedParty?.id ?? null}
              onSelectParty={setSelectedPartyId}
              onAddParty={r.addParty}
              onMarkArrived={r.markArrived}
              onMarkLeft={r.markLeft}
              onRequeue={r.requeueParty}
              nowMs={r.nowMs}
            />
            <TablesPanel
              tables={r.tables}
              groups={r.groups}
              parties={r.parties}
              selectedParty={selectedParty}
              onSeatAtTables={(tableIds) => {
                if (!selectedParty) return;
                void r.seatParty(selectedParty.id, tableIds);
                setSelectedPartyId(null);
              }}
              onCombine={(tableIds) => void r.combineTables(tableIds)}
              onDissolve={(groupId) => void r.dissolveGroup(groupId)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
