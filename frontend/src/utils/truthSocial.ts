export type PostKind = "total" | "originals" | "quotes" | "retruths";
export type TruthDay = { date: string; total: number; originals: number; quotes: number; retruths: number; partial: boolean };
export const postKindLabels: Record<PostKind, string> = { total: "All posts", originals: "Originals", quotes: "Quotes", retruths: "ReTruths" };
export const dayTimestamp = (date: string) => Date.parse(`${date}T12:00:00Z`);
export const displayDate = (date: string, long = false) => new Date(dayTimestamp(date)).toLocaleDateString("en-US", { timeZone: "UTC", month: long ? "long" : "short", day: "numeric", ...(long ? { year: "numeric" } : {}) });

export function postingSeries(days: TruthDay[], kind: PostKind) {
  return days.map((day, index) => {
    const window = days.slice(index - 6, index + 1);
    const contiguous = index >= 6 && window.length === 7 && window.every((row, i) => !row.partial && (i === 0 || dayTimestamp(row.date) - dayTimestamp(window[i - 1].date) === 86400000));
    return { ...day, timestamp: dayTimestamp(day.date), posts: day[kind], average: contiguous ? window.reduce((sum, row) => sum + row[kind], 0) / 7 : null };
  });
}

export function monthlyPace(days: TruthDay[], kind: PostKind) {
  const groups = new Map<string, { month: string; total: number; days: number }>();
  for (const day of days) {
    if (day.partial) continue;
    const month = day.date.slice(0, 7);
    const group = groups.get(month) ?? { month, total: 0, days: 0 };
    group.total += day[kind]; group.days += 1; groups.set(month, group);
  }
  return [...groups.values()].map(row => ({ ...row, pace: row.total / row.days }));
}
