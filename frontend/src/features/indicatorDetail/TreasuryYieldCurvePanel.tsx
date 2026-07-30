import React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import EvidenceStateNotice from "../../components/ui/EvidenceStateNotice";
import { CHART_ANIMATION, CHART_MARGIN } from "../../utils/chartUtils";
import type { YieldCurveDateEntry, YieldCurveResponse } from "./types";

// Maturity labels in order for the x-axis
const MATURITY_ORDER = ["1M","2M","3M","4M","6M","1Y","2Y","3Y","5Y","7Y","10Y","20Y","30Y"];
const DAILY_CURVE_STYLES = [
  { color: "#67e8f9", opacity: 1.0, width: 3 },
  { color: "#22d3ee", opacity: 0.88, width: 2.6 },
  { color: "#06b6d4", opacity: 0.74, width: 2.2 },
  { color: "#0891b2", opacity: 0.60, width: 1.8 },
  { color: "#0e7490", opacity: 0.48, width: 1.4 },
];
const MONTHLY_CURVE_STYLES = [
  { color: "#fbbf24", opacity: 0.95, width: 2.1 },
  { color: "#fbbf24", opacity: 0.78, width: 1.8 },
  { color: "#fbbf24", opacity: 0.62, width: 1.5 },
  { color: "#fbbf24", opacity: 0.46, width: 1.3 },
  { color: "#fbbf24", opacity: 0.32, width: 1.1 },
];
const YIELD_CURVE_MA_COLOR = "var(--chart-tooltip-label)";

interface YieldCurveTooltipItem {
  dataKey?: string | number;
  name?: string;
  value?: number | string | null;
  color?: string;
}

interface YieldCurveTooltipProps {
  active?: boolean;
  payload?: readonly YieldCurveTooltipItem[];
  label?: string | number;
}

interface TreasuryYieldCurvePanelProps {
  data: YieldCurveResponse | null | undefined;
  loading: boolean;
  error: string | null;
}

function getYieldCurveTooltipSection(dataKey?: string | number) {
  if (typeof dataKey !== "string") {
    return "other";
  }

  if (dataKey.startsWith("daily_")) {
    return "daily";
  }

  if (dataKey.startsWith("monthly_")) {
    return "monthly";
  }

  if (dataKey === "moving_average_200d") {
    return "average";
  }

  return "other";
}

function getYieldCurveTooltipOrder(dataKey?: string | number) {
  const section = getYieldCurveTooltipSection(dataKey);

  if (section === "daily") {
    return 0;
  }

  if (section === "monthly") {
    return 1;
  }

  if (section === "average") {
    return 2;
  }

  return 3;
}

function getYieldCurveTooltipLabel(name?: string) {
  if (!name) {
    return "Series";
  }

  if (name.startsWith("Daily ")) {
    return `Daily · ${name.replace("Daily ", "")}`;
  }

  if (name.startsWith("Monthly ")) {
    return `Monthly · ${name.replace("Monthly ", "")}`;
  }

  if (name === "200D Avg") {
    return "200-day average";
  }

  return name;
}

function renderYieldCurveTooltip({ active, payload, label }: YieldCurveTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const visibleItems = payload
    .filter((item) => typeof item.value === "number")
    .sort((left, right) => getYieldCurveTooltipOrder(left.dataKey) - getYieldCurveTooltipOrder(right.dataKey));

  if (visibleItems.length === 0) {
    return null;
  }

  let currentSection = "";

  return (
    <div className="min-w-[220px] rounded-md border border-stealth-700 bg-stealth-900/95 px-3 py-2 shadow-lg">
      <div className="mb-2 text-sm font-semibold text-stealth-100">{label} maturity</div>
      <div className="space-y-1.5">
        {visibleItems.map((item, index) => {
          const section = getYieldCurveTooltipSection(item.dataKey);
          const sectionTitle =
            section === "daily"
              ? "Daily curves"
              : section === "monthly"
                ? "Monthly snapshots"
                : section === "average"
                  ? "Reference"
                  : "Other";
          const showSectionHeader = section !== currentSection;
          currentSection = section;

          return (
            <React.Fragment key={`${String(item.dataKey)}-${index}`}>
              {showSectionHeader && (
                <div className="pt-1 text-xs font-semibold uppercase tracking-[0.14em] text-stealth-500">
                  {sectionTitle}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-stealth-200">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: item.color ?? "#9ca3af" }}
                  />
                  <span>{getYieldCurveTooltipLabel(item.name)}</span>
                </div>
                <span className="font-semibold text-stealth-100">{Number(item.value).toFixed(2)}%</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function TreasuryYieldCurvePanel({
  data,
  loading,
  error,
}: TreasuryYieldCurvePanelProps) {
  if (loading) {
    return (
      <EvidenceStateNotice
        panelId="bond-yield-curve"
        title="Treasury yield-curve evidence"
        state="loading"
        message="Loading the current Treasury curve and comparison history."
        className="mb-4 md:mb-6"
      />
    );
  }
  if (error) {
    return (
      <EvidenceStateNotice
        panelId="bond-yield-curve"
        title="Treasury yield-curve evidence"
        state="error"
        message={`Treasury yield-curve evidence is unavailable: ${error}`}
        className="mb-4 md:mb-6"
      />
    );
  }
  if (!data || !data.curves || data.curves.length === 0)
    return (
      <EvidenceStateNotice
        panelId="bond-yield-curve"
        title="Treasury yield-curve evidence"
        state="empty"
        message="The yield-curve request completed without observations."
        className="mb-4 md:mb-6"
      />
    );

  const recentDailyCurves = data.curves.slice(0, 5);
  const latestMonthKey = recentDailyCurves[0]?.date.slice(0, 7);
  const monthlySnapshots: YieldCurveDateEntry[] = [];
  const seenMonths = new Set<string>(latestMonthKey ? [latestMonthKey] : []);

  for (const entry of data.curves) {
    const monthKey = entry.date.slice(0, 7);
    if (seenMonths.has(monthKey)) {
      continue;
    }
    monthlySnapshots.push(entry);
    seenMonths.add(monthKey);
    if (monthlySnapshots.length === 5) {
      break;
    }
  }

  const movingAverageWindow = data.curves.slice(0, 200);
  const movingAverageCurve = MATURITY_ORDER.map((maturity) => {
    let total = 0;
    let count = 0;

    for (const entry of movingAverageWindow) {
      const point = entry.curve.find((curvePoint) => curvePoint.maturity === maturity);
      if (point && Number.isFinite(point.yield)) {
        total += point.yield;
        count += 1;
      }
    }

    return {
      maturity,
      yield: count > 0 ? total / count : null,
    };
  });

  const chartData = MATURITY_ORDER.map((maturity) => {
    const row: Record<string, string | number | null> = { maturity };

    recentDailyCurves.forEach((entry, index) => {
      const point = entry.curve.find((curvePoint) => curvePoint.maturity === maturity);
      row[`daily_${index}`] = point ? point.yield : null;
    });

    monthlySnapshots.forEach((entry, index) => {
      const point = entry.curve.find((curvePoint) => curvePoint.maturity === maturity);
      row[`monthly_${index}`] = point ? point.yield : null;
    });

    row.moving_average_200d = movingAverageCurve.find((point) => point.maturity === maturity)?.yield ?? null;

    return row;
  });

  const latestEntry = recentDailyCurves[0];
  const latestCurve = latestEntry.curve;
  const shortEnd = latestCurve.find((p) => p.maturity === "2Y")?.yield ?? null;
  const longEnd = latestCurve.find((p) => p.maturity === "10Y")?.yield ?? null;
  const spread10y2y = shortEnd !== null && longEnd !== null ? (longEnd - shortEnd).toFixed(2) : "—";
  const inverted = shortEnd !== null && longEnd !== null && longEnd < shortEnd;

  const monthLabel = `${data.month.slice(0, 4)}-${data.month.slice(4)}`;
  const sourceRangeLabel = data.curves.length > 0
    ? `${data.curves[data.curves.length - 1].date} to ${data.curves[0].date}`
    : monthLabel;

  return (
    <div
      className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-4 md:mb-6"
      data-evidence-panel="bond-yield-curve"
      data-evidence-state="complete"
      aria-label="Treasury yield-curve evidence: complete"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-lg md:text-xl font-semibold text-stealth-100">
            Live Treasury Yield Curve
          </h3>
          <p className="text-xs text-stealth-400 mt-0.5">
            Source: U.S. Treasury · {sourceRangeLabel} · Updated daily
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300">
            Complete evidence
          </p>
        </div>
        <div className="flex gap-4">
          <div className="bg-stealth-900/60 border border-stealth-700 rounded px-3 py-2 text-center">
            <div className="text-xs text-stealth-400">10Y-2Y Spread</div>
            <div className={`text-base font-bold ${inverted ? "text-red-400" : "text-green-400"}`}>
              {spread10y2y} %
            </div>
            <div className={`text-xs ${inverted ? "text-red-400" : "text-stealth-500"}`}>
              {inverted ? "Inverted" : "Normal"}
            </div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded px-3 py-2 text-center">
            <div className="text-xs text-stealth-400">Latest Date</div>
            <div className="text-sm font-semibold text-cyan-300">{latestEntry.date}</div>
          </div>
          <div className="bg-stealth-900/60 border border-stealth-700 rounded px-3 py-2 text-center">
            <div className="text-xs text-stealth-400">Lookback</div>
            <div className="text-sm font-semibold text-stealth-200">5D · 5M · 200D MA</div>
          </div>
        </div>
      </div>

      <div className="text-xs text-stealth-400 mb-3 flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-cyan-300">Daily curves</span>
        <span className="text-amber-300">Monthly snapshots</span>
        <span className="text-stealth-300">200-day moving average</span>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            accessibilityLayer
            aria-label="Daily and monthly Treasury yield curves with 200-day moving average"
            data={chartData}
            margin={CHART_MARGIN}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="maturity"
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#4b5563" }}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#4b5563" }}
              tickFormatter={(v) => `${v}%`}
              label={{ value: "Yield (%)", angle: -90, position: "insideLeft", fill: "#9ca3af", fontSize: 12 }}
            />
            <Tooltip
              content={renderYieldCurveTooltip}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
            {recentDailyCurves.map((entry, index) => {
              const style = DAILY_CURVE_STYLES[index] ?? DAILY_CURVE_STYLES[DAILY_CURVE_STYLES.length - 1];
              return (
                <Line
                  key={`daily_${entry.date}`}
                  type="monotone"
                  dataKey={`daily_${index}`}
                  name={`Daily ${entry.date}`}
                  stroke={style.color}
                  strokeOpacity={style.opacity}
                  strokeWidth={style.width}
                  dot={
                    index === 0
                      ? { r: 3, fill: style.color, fillOpacity: style.opacity }
                      : false
                  }
                  connectNulls
                  {...CHART_ANIMATION}
                />
              );
            })}
            {monthlySnapshots.map((entry, index) => {
              const style = MONTHLY_CURVE_STYLES[index] ?? MONTHLY_CURVE_STYLES[MONTHLY_CURVE_STYLES.length - 1];
              const monthName = new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, {
                month: "short",
                year: "2-digit",
              });
              return (
                <Line
                  key={`monthly_${entry.date}`}
                  type="monotone"
                  dataKey={`monthly_${index}`}
                  name={`Monthly ${monthName}`}
                  stroke={style.color}
                  strokeOpacity={style.opacity}
                  strokeWidth={style.width}
                  dot={false}
                  connectNulls
                  {...CHART_ANIMATION}
                />
              );
            })}
            <Line
              type="monotone"
              dataKey="moving_average_200d"
              name="200D Avg"
              stroke={YIELD_CURVE_MA_COLOR}
              strokeWidth={2.5}
              strokeDasharray="2 6"
              dot={false}
              connectNulls
              {...CHART_ANIMATION}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Latest values table */}
      <div className="mt-4">
        <h4 className="text-sm font-semibold text-stealth-200 mb-2">Latest Rates ({latestEntry.date})</h4>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {latestCurve.map((pt) => (
            <div key={pt.maturity} className="bg-stealth-900/60 border border-stealth-700 rounded p-2 text-center">
              <div className="text-xs text-stealth-400">{pt.maturity}</div>
              <div className="text-sm font-bold text-cyan-300">{pt.yield.toFixed(2)}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
