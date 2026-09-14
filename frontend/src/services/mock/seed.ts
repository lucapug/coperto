export interface TableSeed {
  label: string;
  seats: number;
}

// 30 tables, 106 seats — a floor in the 100–120 seat range (plan §1).
export const DEFAULT_TABLE_SEEDS: TableSeed[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ label: `T${i + 1}`, seats: 4 })),
  ...Array.from({ length: 6 }, (_, i) => ({ label: `T${i + 21}`, seats: 3 })),
  ...Array.from({ length: 4 }, (_, i) => ({ label: `T${i + 27}`, seats: 2 })),
];
