export type RealEstateHorizon = 1 | 5 | 15 | 30;

export const REAL_ESTATE_HORIZONS: Array<{ years: RealEstateHorizon; label: string }> = [
  { years: 1, label: "1Y" },
  { years: 5, label: "5Y" },
  { years: 15, label: "15Y" },
  { years: 30, label: "30Y" },
];

function parseIsoDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

export type RealEstateSeriesWindow = {
  start: number;
  end: number;
};

export function realEstateTimestamp(date: string) {
  return parseIsoDate(date).getTime();
}

export function buildSeriesWindow(
  series: Array<Array<{ date: string }>>,
  years: RealEstateHorizon,
): RealEstateSeriesWindow | null {
  const latestDates = series
    .filter((points) => points.length > 0)
    .map((points) => realEstateTimestamp(points[points.length - 1].date));
  if (!latestDates.length) return null;

  const end = Math.max(...latestDates);
  const cutoff = new Date(end);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return { start: cutoff.getTime(), end };
}

export function filterToSeriesWindow<T extends { date: string }>(
  points: T[],
  window: RealEstateSeriesWindow | null,
) {
  if (!window) return [];
  return points.filter((point) => {
    const timestamp = realEstateTimestamp(point.date);
    return timestamp >= window.start && timestamp <= window.end;
  });
}

export function rebaseSeriesToWindow(
  points: Array<{ date: string; value: number }>,
  window: RealEstateSeriesWindow | null,
) {
  const filtered = filterToSeriesWindow(points, window);
  const base = filtered[0]?.value;
  if (!filtered.length || base == null || base === 0) return [];
  return filtered.map((point) => ({ date: point.date, value: (point.value / base) * 100 }));
}

export function buildCycleTimeTicks(
  window: RealEstateSeriesWindow | null,
  years: RealEstateHorizon,
) {
  if (!window) return [] as number[];

  const start = new Date(window.start);
  const ticks: number[] = [];

  if (years === 1) {
    const firstQuarterMonth = Math.floor(start.getUTCMonth() / 3) * 3;
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), firstQuarterMonth, 1));
    if (cursor.getTime() <= window.start) cursor.setUTCMonth(cursor.getUTCMonth() + 3);
    while (cursor.getTime() < window.end) {
      ticks.push(cursor.getTime());
      cursor.setUTCMonth(cursor.getUTCMonth() + 3);
    }
  } else {
    const step = years === 5 ? 1 : years === 15 ? 3 : 5;
    let year = Math.ceil(start.getUTCFullYear() / step) * step;
    let cursor = new Date(Date.UTC(year, 0, 1));
    if (cursor.getTime() <= window.start) {
      year += step;
      cursor = new Date(Date.UTC(year, 0, 1));
    }
    while (cursor.getTime() < window.end) {
      ticks.push(cursor.getTime());
      year += step;
      cursor = new Date(Date.UTC(year, 0, 1));
    }
  }

  return ticks.length ? ticks : [window.start, window.end];
}

export function formatCycleTimeAxisLabel(timestamp: number, years: RealEstateHorizon) {
  return formatCycleAxisLabel(new Date(timestamp).toISOString().slice(0, 10), years);
}

export function filterByYears<T extends { date: string }>(points: T[], years: number) {
  if (!points.length) return [];
  const end = parseIsoDate(points[points.length - 1].date);
  const cutoff = new Date(end);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return points.filter((point) => parseIsoDate(point.date) >= cutoff);
}

export function rebaseSeries(points: Array<{ date: string; value: number }>, years: number) {
  const filtered = filterByYears(points, years);
  const base = filtered[0]?.value;
  if (!filtered.length || base == null || base === 0) return [];
  return filtered.map((point) => ({ date: point.date, value: (point.value / base) * 100 }));
}

export function decimateKeepLast<T>(points: T[], maxPoints: number) {
  if (points.length <= maxPoints) return points;
  const step = Math.max(1, Math.floor(points.length / maxPoints));
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

export function buildCycleTicks(points: Array<{ date: string }>, years: RealEstateHorizon) {
  if (!points.length) return [] as string[];
  const tickMonths = new Set<string>();
  const tickDates = points
    .map((point) => point.date)
    .filter((date) => {
      const parsed = parseIsoDate(date);
      const month = parsed.getUTCMonth();
      const day = parsed.getUTCDate();
      const year = parsed.getUTCFullYear();
      const isAnchor = years === 1
        ? month % 3 === 0 && day <= 7
        : years === 5
          ? month === 0 && day <= 7
          : years === 15
            ? month === 0 && day <= 7 && year % 3 === 0
            : month === 0 && day <= 7 && year % 5 === 0;
      if (!isAnchor) return false;
      const monthKey = `${year}-${month}`;
      if (tickMonths.has(monthKey)) return false;
      tickMonths.add(monthKey);
      return true;
    });

  if (!tickDates.length) {
    return [...new Set([points[0].date, points[points.length - 1].date])];
  }

  const minimumEdgeGapDays = years === 1 ? 45 : years === 5 ? 240 : years === 15 ? 540 : 1500;
  const minimumEdgeGapMs = minimumEdgeGapDays * 24 * 60 * 60 * 1000;
  const ticks = [...tickDates];
  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  if (parseIsoDate(ticks[0]).getTime() - parseIsoDate(firstDate).getTime() >= minimumEdgeGapMs) {
    ticks.unshift(firstDate);
  }
  if (parseIsoDate(lastDate).getTime() - parseIsoDate(ticks[ticks.length - 1]).getTime() >= minimumEdgeGapMs) {
    ticks.push(lastDate);
  }
  return [...new Set(ticks)];
}

export function formatCycleAxisLabel(date: string, years: RealEstateHorizon) {
  const parsed = parseIsoDate(date);
  if (years === 1) {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(parsed);
  }
  return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function formatCycleTooltipLabel(date: string | number) {
  const parsed = typeof date === "number" ? new Date(date) : parseIsoDate(date);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}
