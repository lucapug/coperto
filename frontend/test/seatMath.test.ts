import { describe, expect, it } from 'vitest';
import { grossSeats, junctionCount, usableSeats } from '../src/lib/seatMath';

describe('usableSeats (plan §3.4)', () => {
  // rows taken verbatim from the spec table
  const rows = [
    { seats: [4, 4], gross: 8, junctions: 1, usable: 6 },
    { seats: [4, 4, 4], gross: 12, junctions: 2, usable: 8 },
    { seats: [4, 4, 4, 4], gross: 16, junctions: 3, usable: 10 },
    { seats: [2, 2], gross: 4, junctions: 1, usable: 2 },
    { seats: [4, 4, 2], gross: 10, junctions: 2, usable: 6 },
  ];

  it.each(rows)(
    '$seats -> gross $gross, $junctions junctions, $usable usable',
    ({ seats, gross, junctions, usable }) => {
      expect(grossSeats([...seats])).toBe(gross);
      expect(junctionCount(seats.length)).toBe(junctions);
      expect(usableSeats([...seats])).toBe(usable);
    },
  );

  it('a single table loses nothing', () => {
    expect(usableSeats([4])).toBe(4);
    expect(usableSeats([2])).toBe(2);
    expect(junctionCount(1)).toBe(0);
  });

  it('rejects an empty selection', () => {
    expect(() => usableSeats([])).toThrow();
  });
});
