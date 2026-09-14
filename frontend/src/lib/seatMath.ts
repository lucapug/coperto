// Seat accounting for merged tables — docs/plan.md §3.4.
// Two tables pushed side by side lose the two facing seats: one from each
// table. Every junction costs 2 seats.

export function junctionCount(tableCount: number): number {
  return tableCount - 1;
}

export function grossSeats(seatCounts: number[]): number {
  return seatCounts.reduce((sum, n) => sum + n, 0);
}

export function usableSeats(seatCounts: number[]): number {
  if (seatCounts.length === 0) {
    throw new Error('Cannot compute usable seats for an empty selection');
  }
  return grossSeats(seatCounts) - 2 * junctionCount(seatCounts.length);
}
