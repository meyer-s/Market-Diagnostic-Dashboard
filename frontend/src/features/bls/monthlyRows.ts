export function monthlyIndex(period: string): number | null {
  const match = /^(\d{4})-(\d{2})/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return year * 12 + month - 1;
}

function periodFromMonthlyIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function densifyMonthlyRows<T extends { period: string }>(
  rows: T[],
  emptyRow: (period: string) => T,
): T[] {
  const valuesByMonth = new Map<number, T>();
  rows.forEach((row) => {
    const index = monthlyIndex(row.period);
    if (index !== null) valuesByMonth.set(index, row);
  });
  const monthIndexes = [...valuesByMonth.keys()].sort((left, right) => left - right);
  if (monthIndexes.length === 0) {
    return [...rows].sort((left, right) => left.period.localeCompare(right.period));
  }
  const dense: T[] = [];
  for (let index = monthIndexes[0]; index <= monthIndexes[monthIndexes.length - 1]; index += 1) {
    dense.push(valuesByMonth.get(index) ?? emptyRow(periodFromMonthlyIndex(index)));
  }
  return dense;
}
