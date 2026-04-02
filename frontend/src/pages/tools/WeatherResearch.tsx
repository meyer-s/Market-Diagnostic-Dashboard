import { useDeferredValue, useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../../hooks/useApi";

type DaysPreset = 365 | 1825 | 9490;

type WeatherHistoryPoint = {
  date: string;
  weather_disruption_index: number;
  weather_stress_score: number;
  pressure_change_hpa: number;
  pressure_shift_score: number;
  precipitation_stress_score: number;
  wind_stress_score: number;
  temperature_stress_score: number;
  sp500_abs_return_pct: number;
  rolling_corr: number | null;
  rolling_p_value: number | null;
  pressure_hpa: number | null;
  temp_anomaly_c: number;
  precip_mm: number;
  wind_kmh: number;
};

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
};

const correlationCards = [
  {
    key: "same_day_direction" as const,
    title: "Same-session direction",
    description: "Weather stress versus the signed S&P 500 move.",
  },
  {
    key: "same_day_sensitivity" as const,
    title: "Same-session move size",
    description: "Weather stress versus the absolute S&P 500 move.",
  },
  {
    key: "lag_1d" as const,
    title: "Next-session move size",
    description: "Whether today’s weather stress lines up with tomorrow’s move size.",
  },
  {
    key: "lag_2d" as const,
    title: "Two-session move size",
    description: "Whether today’s weather stress lines up with the move size two sessions later.",
  },
];

const fmtCorr = (corr: CorrelationSummary) => {
  if (corr.pearson_r === null || corr.p_value === null) return "n/a";
  return `r ${corr.pearson_r.toFixed(2)} | p ${corr.p_value.toFixed(3)} | n ${corr.samples}`;
};

const formatComponentRaw = (value: number | null | undefined, unit: string) => {
  if (value === null || value === undefined) return "n/a";
  if (unit === "hPa") return `${value.toFixed(1)} hPa`;
  if (unit === "mm") return `${value.toFixed(1)} mm`;
  if (unit === "km/h") return `${value.toFixed(1)} km/h`;
  return `${value.toFixed(1)} C`;
};

export default function WeatherResearch() {
  const [days, setDays] = useState<DaysPreset>(9490);
  const [window, setWindow] = useState<30 | 60 | 90>(60);

  const endpoint = `/research/weather-market?days=${days}&window=${window}&granularity=auto`;
  const { data, loading, error } = useApi<WeatherPayload>(endpoint);

  const chartData = useMemo(
    () =>
      (data?.history ?? []).map((point) => ({
        date: point.date,
        corr: point.rolling_corr,
        absReturn: point.sp500_abs_return_pct,
        stress: point.weather_stress_score,
      })),
    [data]
  );
  const deferredChartData = useDeferredValue(chartData);
  const latestPoint = data?.latest as Record<string, number | null | undefined> | null;

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
              Weather: {data.source.weather} | Market: {data.source.market}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="control-strip">
            {[365, 1825, 9490].map((p) => (
              <button
                key={p}
                onClick={() => setDays(p as DaysPreset)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  days === p ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-stealth-200"
                }`}
              >
                {p === 365 ? "1y" : p === 1825 ? "5y" : "26y"}
              </button>
            ))}
          </div>
          <div className="control-strip">
            {[30, 60, 90].map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w as 30 | 60 | 90)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  window === w ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-stealth-200"
                }`}
              >
                {w}d window
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {correlationCards.map((card) => (
              <div key={card.key} className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-3 text-xs text-stealth-300">
                <div className="text-stealth-500">{card.title}</div>
                <div className="mt-1 font-medium">{fmtCorr(data.correlations[card.key])}</div>
                <div className="mt-1 leading-relaxed text-stealth-500">{card.description}</div>
              </div>
            ))}
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-3 text-xs text-stealth-300">
              <div className="text-stealth-500">Rendered view</div>
              <div className="mt-1 font-medium capitalize">
                {data.display_granularity} view, {data.display_history_points} plotted points
              </div>
              <div className="mt-1 leading-relaxed text-stealth-500">
                Summarized from {data.raw_history_points} underlying daily observations.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data.score_components.map((component) => (
              <div key={component.key} className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-3 text-xs text-stealth-300">
                <div className="text-stealth-500">{component.label}</div>
                <div className="mt-1 font-medium text-stealth-100">
                  {formatComponentRaw(latestPoint?.[component.raw_field] as number | null | undefined, component.unit)}
                </div>
                <div className="mt-1 leading-relaxed text-stealth-500">{component.description}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-stealth-700 bg-stealth-900/50 p-4">
            <div className="mb-2 text-xs text-stealth-400">
              Drag the lower brush handles to zoom. Hover points for exact values within the current summarized view.
            </div>
            <div className="h-[520px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={deferredChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.22)" />
                  <XAxis
                    dataKey="date"
                    minTickGap={30}
                    tick={{ fontSize: 11 }}
                    stroke="#94a3b8"
                    tickFormatter={(value: string) => value.slice(0, 7)}
                  />
                  <YAxis yAxisId="corr" domain={[-1, 1]} stroke="#f43f5e" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="signal" orientation="right" stroke="#86efac" tick={{ fontSize: 11 }} />
                  <Tooltip
                    labelFormatter={(label: string) => `Date: ${label}`}
                    contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    yAxisId="corr"
                    type="monotone"
                    dataKey="corr"
                    name={`${window}d rolling weather/move relationship`}
                    stroke="#f43f5e"
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="signal"
                    type="monotone"
                    dataKey="absReturn"
                    name="S&P daily move magnitude"
                    stroke="#22c55e"
                    dot={false}
                    strokeWidth={1.6}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="signal"
                    type="monotone"
                    dataKey="stress"
                    name="Weather stress score"
                    stroke="#38bdf8"
                    dot={false}
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    isAnimationActive={false}
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
            The weather stress score blends pressure swing, rainfall shock, wind stress, and temperature departure from the seasonal norm. Correlation is descriptive and non-causal. A relationship should remain stable across windows and hold statistical significance before it is treated as decision-useful.
          </div>
        </>
      )}
    </div>
  );
}
