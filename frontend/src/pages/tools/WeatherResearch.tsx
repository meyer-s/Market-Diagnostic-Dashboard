import { useDeferredValue, useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../../hooks/useApi";

type DaysPreset = 365 | 1825 | 9490;
type WindowPreset = 1 | 5 | 10 | 30 | 60 | 80 | 150;
const DEFAULT_YEAR_SELECTION = new Date().getUTCFullYear() - 1;
const YEAR_OPTIONS = Array.from({ length: 26 }, (_, index) => DEFAULT_YEAR_SELECTION - index);

const WINDOW_OPTIONS_BY_DAYS: Record<DaysPreset, WindowPreset[]> = {
  365: [1, 5, 10],
  1825: [10, 30, 60],
  9490: [60, 80, 150],
};

type WeatherHistoryPoint = {
  date: string;
  weather_disruption_index: number;
  weather_stress_score: number;
  pressure_change_hpa: number;
  pressure_shift_score: number;
  precipitation_stress_score: number;
  wind_stress_score: number;
  temperature_stress_score: number;
  sp500_return_pct: number;
  sp500_abs_return_pct: number;
  rolling_corr: number | null;
  rolling_p_value: number | null;
  pressure_hpa: number | null;
  temp_c: number | null;
  temp_anomaly_c: number;
  precip_mm: number;
  wind_kmh: number;
  rolling_significant?: boolean;
  signal_correlations?: Partial<Record<WeatherSignalOption, {
    rolling_corr: number | null;
    rolling_p_value: number | null;
    rolling_significant: boolean;
  }>>;
};

type WeatherSignalOption = "weather_stress_score" | "pressure_hpa" | "precip_mm" | "temp_c" | "wind_kmh";

type CorrelationSummary = {
  pearson_r: number | null;
  p_value: number | null;
  samples: number;
  significant: boolean;
};

type ScoreComponent = {
  key: string;
  label: string;
  description: string;
  weight: number;
  raw_field: keyof WeatherHistoryPoint;
  score_field: keyof WeatherHistoryPoint;
  unit: string;
};

type WeatherPayload = {
  location: string;
  days: number;
  window_days: number;
  calendar_year?: number | null;
  period_start?: string;
  period_end?: string;
  display_granularity: "day" | "week" | "month";
  raw_history_points: number;
  display_history_points: number;
  source: {
    weather: string;
    market: string;
  };
  latest: WeatherHistoryPoint | null;
  history: WeatherHistoryPoint[];
  score_components: ScoreComponent[];
  correlations: {
    same_day_direction: CorrelationSummary;
    same_day_sensitivity: CorrelationSummary;
    lag_1d: CorrelationSummary;
    lag_2d: CorrelationSummary;
  };
  signal_correlations: Record<WeatherSignalOption, {
    same_day_direction: CorrelationSummary;
    lag_1d: CorrelationSummary;
    lag_2d: CorrelationSummary;
  }>;
};

const weatherSignalOptions: Array<{
  key: WeatherSignalOption;
  label: string;
  chartLabel: string;
  color: string;
  strokeDasharray?: string;
}> = [
  {
    key: "weather_stress_score",
    label: "Weather stress",
    chartLabel: "Weather stress score",
    color: "#38bdf8",
    strokeDasharray: "4 4",
  },
  {
    key: "pressure_hpa",
    label: "Barometric pressure",
    chartLabel: "Barometric pressure",
    color: "#f59e0b",
  },
  {
    key: "precip_mm",
    label: "Total precipitation",
    chartLabel: "Total precipitation",
    color: "#60a5fa",
  },
  {
    key: "temp_c",
    label: "Temperature",
    chartLabel: "Average temperature",
    color: "#fb7185",
  },
  {
    key: "wind_kmh",
    label: "Wind speed",
    chartLabel: "Peak wind speed",
    color: "#a78bfa",
  },
];

const getRelationshipTone = (label: string, corr: number | null | undefined, significant: boolean | undefined) => {
  if (corr === null || corr === undefined) {
    return {
      title: "Not enough signal yet",
      body: `This window does not show a stable relationship between ${label.toLowerCase()} and market direction.`,
    };
  }
  if (!significant || Math.abs(corr) < 0.15) {
    return {
      title: "Mostly noise right now",
      body: `${label} and market direction are brushing past each other, but not in a durable way.`,
    };
  }
  if (corr > 0) {
    return {
      title: `${label} has lined up with greener sessions`,
      body: `In the recent window, higher ${label.toLowerCase()} readings have been showing up alongside more positive S&P days.`,
    };
  }
  return {
    title: `Lower ${label.toLowerCase()} has lined up with greener sessions`,
    body: `In the recent window, lower ${label.toLowerCase()} readings have been showing up alongside more positive S&P days.`,
  };
};

const getSignalContext = (label: string, normalizedValue: number | null | undefined) => {
  if (normalizedValue === null || normalizedValue === undefined) {
    return `${label} is unavailable in the current view.`;
  }
  if (normalizedValue >= 75) {
    return `${label} is running near the top of its recent range.`;
  }
  if (normalizedValue <= 25) {
    return `${label} is sitting near the low end of its recent range.`;
  }
  return `${label} is sitting near the middle of its recent range.`;
};

const getHistoricalContext = (label: string, corr: CorrelationSummary) => {
  if (corr.pearson_r === null || corr.p_value === null) {
    return "There is not enough overlap yet to say much about the broader pattern.";
  }
  if (!corr.significant || Math.abs(corr.pearson_r) < 0.15) {
    return "Across the selected history, the broader pattern still looks weak and inconsistent.";
  }
  if (corr.pearson_r > 0) {
    return `Across the selected history, higher ${label.toLowerCase()} readings have tended to coincide with more positive same-session returns.`;
  }
  return `Across the selected history, lower ${label.toLowerCase()} readings have tended to coincide with more positive same-session returns.`;
};

const buildCorrelationZones = (
  points: Array<{ date: string; corr: number | null; rollingSignificant: boolean }>
) => {
  const zones: Array<{ start: string; end: string; fill: string; stroke: string }> = [];
  let current: { start: string; end: string; fill: string; stroke: string } | null = null;

  for (const point of points) {
    if (!point.rollingSignificant || point.corr === null || Math.abs(point.corr) < 0.15) {
      if (current) {
        zones.push(current);
        current = null;
      }
      continue;
    }

    const fill = point.corr < 0 ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.22)";
    const stroke = point.corr < 0 ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
    if (!current || current.fill !== fill) {
      if (current) zones.push(current);
      current = { start: point.date, end: point.date, fill, stroke };
      continue;
    }
    current.end = point.date;
  }

  if (current) zones.push(current);
  return zones;
};

const normalizeSeries = (values: Array<number | null | undefined>) => {
  const numeric = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (!numeric.length) return values.map(() => null);

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  if (min === max) return values.map((value) => (value === null || value === undefined ? null : 50));

  return values.map((value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return ((value - min) / (max - min)) * 100;
  });
};

const normalizeCenteredSeries = (values: Array<number | null | undefined>) => {
  const numeric = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (!numeric.length) return values.map(() => null);

  const maxAbs = Math.max(...numeric.map((value) => Math.abs(value)));
  if (maxAbs === 0) return values.map((value) => (value === null || value === undefined ? null : 0));

  return values.map((value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return (value / maxAbs) * 100;
  });
};

const formatComponentRaw = (value: number | null | undefined, unit: string) => {
  if (value === null || value === undefined) return "n/a";
  if (unit === "score") return value.toFixed(2);
  if (unit === "hPa") return `${value.toFixed(1)} hPa`;
  if (unit === "mm") return `${value.toFixed(1)} mm`;
  if (unit === "km/h") return `${value.toFixed(1)} km/h`;
  return `${value.toFixed(1)} C`;
};

const getBucketLabel = (granularity: WeatherPayload["display_granularity"] | undefined) => {
  if (granularity === "day") return "Daily buckets";
  if (granularity === "week") return "Weekly buckets";
  return "Monthly buckets";
};

const selectorRailClass = "rounded-2xl border border-stealth-800 bg-stealth-950/55 p-1 shadow-[inset_0_1px_0_rgba(148,163,184,0.04)]";

const getSelectorButtonClass = (active: boolean) =>
  `rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "border-stealth-700 bg-stealth-900/80 text-stealth-50"
      : "border-transparent bg-transparent text-stealth-500 hover:border-stealth-800 hover:bg-stealth-900/45 hover:text-stealth-200"
  }`;

export default function WeatherResearch() {
  const [days, setDays] = useState<DaysPreset>(9490);
  const [window, setWindow] = useState<WindowPreset>(60);
  const [selectedYear, setSelectedYear] = useState<number>(DEFAULT_YEAR_SELECTION);
  const [selectedSignal, setSelectedSignal] = useState<WeatherSignalOption>("weather_stress_score");
  const windowOptions = WINDOW_OPTIONS_BY_DAYS[days];

  const handleDaysChange = (nextDays: DaysPreset) => {
    setDays(nextDays);
    setWindow((currentWindow) => (
      WINDOW_OPTIONS_BY_DAYS[nextDays].includes(currentWindow)
        ? currentWindow
        : WINDOW_OPTIONS_BY_DAYS[nextDays][0]
    ));
  };

  const endpoint = `/research/weather-market?days=${days}&window=${window}&granularity=${days === 365 ? "day" : "auto"}${days === 365 ? `&calendar_year=${selectedYear}` : ""}`;
  const { data, loading, error } = useApi<WeatherPayload>(endpoint);

  const chartData = useMemo(
    () => {
      const history = data?.history ?? [];
      const returnScaled = normalizeCenteredSeries(history.map((point) => point.sp500_return_pct));
      const signalScaled = normalizeSeries(history.map((point) => point[selectedSignal] as number | null | undefined));

      return history.map((point, index) => ({
        date: point.date,
        corr: point.signal_correlations?.[selectedSignal]?.rolling_corr ?? null,
        rollingSignificant: Boolean(point.signal_correlations?.[selectedSignal]?.rolling_significant),
        returnScaled: returnScaled[index],
        returnRaw: point.sp500_return_pct,
        signalScaled: signalScaled[index],
        signalRaw: point[selectedSignal] as number | null | undefined,
      }));
    },
    [data, selectedSignal]
  );
  const deferredChartData = useDeferredValue(chartData);
  const selectedSignalMeta = weatherSignalOptions.find((option) => option.key === selectedSignal) ?? weatherSignalOptions[0];
  const latestSignalNormalized = deferredChartData.length ? deferredChartData[deferredChartData.length - 1]?.signalScaled : null;
  const latestSelectedCorrelation = data?.latest?.signal_correlations?.[selectedSignal];
  const relationshipTone = getRelationshipTone(selectedSignalMeta.label, latestSelectedCorrelation?.rolling_corr ?? null, latestSelectedCorrelation?.rolling_significant);
  const correlationZones = useMemo(() => buildCorrelationZones(deferredChartData), [deferredChartData]);
  const bucketLabel = getBucketLabel(data?.display_granularity);
  const historicalCorrelation = data?.signal_correlations?.[selectedSignal]?.same_day_direction ?? {
    pearson_r: null,
    p_value: null,
    samples: 0,
    significant: false,
  };

  return (
    <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stealth-100">Weather Research Explorer</h1>
          <p className="mt-1 text-sm text-stealth-400">
            Long-horizon NYC weather and S&P sensitivity view. Includes dot-com and GFC windows when source coverage is available.
          </p>
          {data && (
            <p className="mt-2 text-xs text-stealth-500">
              Weather: {data.source.weather} | Market: {data.source.market} | View: {bucketLabel}{days === 365 ? ` | Year: ${selectedYear}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className={selectorRailClass}>
            {[365, 1825, 9490].map((p) => (
              <button
                key={p}
                onClick={() => handleDaysChange(p as DaysPreset)}
                className={getSelectorButtonClass(days === p)}
              >
                {p === 365 ? "1y" : p === 1825 ? "5y" : "26y"}
              </button>
            ))}
          </div>
          <div className={selectorRailClass}>
            {windowOptions.map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={getSelectorButtonClass(window === w)}
              >
                {w}d window
              </button>
            ))}
          </div>
          {days === 365 && (
            <div className={selectorRailClass}>
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                className="rounded-xl border border-stealth-700 bg-stealth-900/80 px-3 py-1.5 text-sm font-medium text-stealth-50 outline-none transition hover:border-stealth-600"
              >
                {YEAR_OPTIONS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={`${selectorRailClass} flex-wrap`}>
            {weatherSignalOptions.map((option) => (
              <button
                key={option.key}
                onClick={() => setSelectedSignal(option.key)}
                className={getSelectorButtonClass(selectedSignal === option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-400">
          Loading weather history...
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-900/20 p-6 text-sm text-red-300">{error}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-4 text-sm text-stealth-200">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Current read</div>
              <div className="mt-2 text-base font-medium text-stealth-100">{relationshipTone.title}</div>
              <div className="mt-2 leading-relaxed text-stealth-400">{relationshipTone.body}</div>
            </div>
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-4 text-sm text-stealth-200">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Weather context</div>
              <div className="mt-2 text-base font-medium text-stealth-100">{selectedSignalMeta.label}</div>
              <div className="mt-2 leading-relaxed text-stealth-400">{getSignalContext(selectedSignalMeta.label, latestSignalNormalized)}</div>
            </div>
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-4 text-sm text-stealth-200">
              <div className="text-[11px] uppercase tracking-wide text-stealth-500">Bigger picture</div>
              <div className="mt-2 text-base font-medium text-stealth-100">Selected window</div>
              <div className="mt-2 leading-relaxed text-stealth-400">{getHistoricalContext(selectedSignalMeta.label, historicalCorrelation)}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-stealth-700 bg-stealth-900/50 p-4">
            <div className="mb-2 text-xs text-stealth-400">
              Drag the lower brush handles to zoom. Green shading marks windows where lower {selectedSignalMeta.label.toLowerCase()} readings have been lining up with greener sessions; red shading marks windows where higher {selectedSignalMeta.label.toLowerCase()} readings have been lining up with greener sessions.
            </div>
            <div className="h-[520px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={deferredChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.22)" />
                  {correlationZones.map((zone) => (
                    <ReferenceArea key={`${zone.start}-${zone.end}-${zone.fill}`} x1={zone.start} x2={zone.end} yAxisId="corr" fill={zone.fill} stroke={zone.stroke} strokeOpacity={0.9} ifOverflow="extendDomain" />
                  ))}
                  <XAxis
                    dataKey="date"
                    minTickGap={30}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                    tickFormatter={(value: string) => value.slice(0, 7)}
                  />
                  <YAxis yAxisId="corr" domain={[-1, 1]} stroke="#f43f5e" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="signal" orientation="right" domain={[-100, 100]} stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)}`} />
                  <Tooltip
                    labelFormatter={(label: string) => `Date: ${label}`}
                    formatter={(value: string | number | readonly (string | number)[] | null | undefined, _name: string, item: { dataKey?: unknown; payload?: { returnRaw?: number; signalRaw?: number | null } }) => {
                      const numericValue = typeof value === "number" ? value : Array.isArray(value) ? Number(value[0]) : Number(value);
                      const normalizedValue = Number.isFinite(numericValue) ? numericValue.toFixed(1) : "n/a";
                      if (item.dataKey === "returnScaled") {
                        return [`${item.payload?.returnRaw?.toFixed(2) ?? "n/a"}% bucket avg | ${normalizedValue} directional index`, "S&P directional path"];
                      }
                      if (item.dataKey === "signalScaled") {
                        return [`${formatComponentRaw(item.payload?.signalRaw, selectedSignalMeta.key === "weather_stress_score" ? "score" : selectedSignalMeta.key === "pressure_hpa" ? "hPa" : selectedSignalMeta.key === "precip_mm" ? "mm" : selectedSignalMeta.key === "temp_c" ? "C" : "km/h")} | ${normalizedValue} relative level`, selectedSignalMeta.chartLabel];
                      }
                      return [Number.isFinite(numericValue) ? numericValue.toFixed(2) : "n/a", `${selectedSignalMeta.chartLabel} rolling relationship`];
                    }}
                    contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    yAxisId="corr"
                    type="monotone"
                    dataKey="corr"
                    name={`${window}d rolling ${selectedSignalMeta.chartLabel.toLowerCase()} relationship`}
                    stroke="#f43f5e"
                    dot={false}
                    strokeWidth={1.2}
                    strokeOpacity={0.45}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="signal"
                    type="monotone"
                    dataKey="returnScaled"
                    name="S&P directional path"
                    stroke="#22c55e"
                    dot={false}
                    strokeWidth={1.6}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="signal"
                    type="monotone"
                    dataKey="signalScaled"
                    name={`${selectedSignalMeta.chartLabel} (normalized)`}
                    stroke={selectedSignalMeta.color}
                    dot={false}
                    strokeWidth={1.4}
                    strokeDasharray={selectedSignalMeta.strokeDasharray}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Brush
                    dataKey="date"
                    height={26}
                    stroke="#64748b"
                    travellerWidth={8}
                    tickFormatter={(value: string) => value.slice(0, 7)}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-stealth-700 bg-stealth-800/60 p-4 text-xs leading-relaxed text-stealth-300">
            The chart now leans into direction, not just move size. The green market line is the signed S&P return, the weather line is contextual, and the quiet red line still shows rolling correlation between the composite weather score and directional returns.
          </div>
          <p className="mt-3 text-[11px] text-stealth-500">
            The red line and the background shading now track the selected weather signal directly, while the green line reflects signed S&P direction.
          </p>
        </>
      )}
    </div>
  );
}
