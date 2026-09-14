import { useCallback, useEffect, useState } from 'react';
import type { ApiService, AddPartyInput } from '../services/api';
import type { Party, Shift, Table, TableGroup } from '../types';

/** auto-expire sweep cadence: plan §6 asks for at least every 30 s */
const SWEEP_INTERVAL_MS = 5_000;
/** re-render cadence for the bookedUntil countdowns */
const TICK_INTERVAL_MS = 1_000;

interface RestaurantState {
  shift: Shift | null;
  tables: Table[];
  groups: TableGroup[];
  parties: Party[];
}

const EMPTY: RestaurantState = { shift: null, tables: [], groups: [], parties: [] };

export function useRestaurant(service: ApiService) {
  const [state, setState] = useState<RestaurantState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const [shift, tables, groups, parties] = await Promise.all([
        service.getShift(),
        service.listTables(),
        service.listGroups(),
        service.listParties(),
      ]);
      setState({ shift, tables, groups, parties });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    }
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      void service.sweep().then(refresh);
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [service, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        setError(null);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unexpected error');
      }
    },
    [refresh],
  );

  const actions = {
    openShift: () => run(() => service.openShift()),
    closeShift: () => run(() => service.closeShift()),
    addParty: (input: AddPartyInput) => run(() => service.addParty(input)),
    seatParty: (partyId: string, tableIds: string[]) =>
      run(() => service.seatParty(partyId, tableIds)),
    combineTables: (tableIds: string[]) => run(() => service.combineTables(tableIds)),
    dissolveGroup: (groupId: string) => run(() => service.dissolveGroup(groupId)),
    markArrived: (partyId: string) => run(() => service.markArrived(partyId)),
    markLeft: (partyId: string) => run(() => service.markLeft(partyId)),
    requeueParty: (partyId: string) => run(() => service.requeueParty(partyId)),
  };

  return { ...state, error, nowMs, dismissError: () => setError(null), ...actions };
}
