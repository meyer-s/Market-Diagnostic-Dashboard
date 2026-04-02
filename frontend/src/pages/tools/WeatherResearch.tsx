import { useMemo, useState } from "react";
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

type WeatherPayload = {
  location: string;
  days: number;
  window_days: number;
  latest: WeatherHistoryPoint | null;
  history: WeatherHistoryPoint[];
  correlations: {
    same_day_direction: CorrelationSummary;
    same_day_sensitivity: CorrelationSummary;
    lag_1d: CorrelationSummary;
    lag_2d: CorrelationSummary;
  };
};

const fmtCorr = (corr: CorrelationSummary) => {
  if (corr.pearson_r === null || corr.p_value === null) return "n/a";
  return `r ${corr.pearson_r.toFixed(2)} | p ${corr.p_value.toFixed(3)} | n ${corr.samples}`;
};

export default function WeatherResearch() {
  const [days, setDays] = useState<DaysPreset>(9490);
  const [window, setWindow] = useState<30 | 60 | 90>(60);

  const endpoint = `/research/weather-market?days=${days}&window=${window}`;
  const { data, loading, error } = useApi<WeatherPayload>(endpoint);

  const chartData = useMemo(
    () =>
      (data?.history ?? []).map((point) => ({
        date: point.date,
        corr: point.rolling_corr,
        absReturn: point.sp500_abs_return_pct,
        disruption: point.weather_disruption_index,
        pressure: point.pressure_hpa,
      })),
    [data]
  );

  return (
    <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stealth-100">Weather Research Explorer</h1>
          <p className="mt-1 text-sm text-stealth-400">
            Long-horizon NYC weather and S&P sensitivity view. Includes dot-com and GFC windows when source coverage is available.
          </p>
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
                {w}d corr
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-3 text-xs text-stealth-300">
              <div className="text-stealth-500">Same-day direction</div>
              <div className="mt-1 font-medium">{fmtCorr(data.correlations.same_day_direction)}</div>
            </div>
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-3 text-xs text-stealth-300">
              <div className="text-stealth-500">Same-day sensitivity</div>
              <div className="mt-1 font-medium">{fmtCorr(data.correlations.same_day_sensitivity)}</div>
            </div>
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-3 text-xs text-stealth-300">
              <div className="text-stealth-500">Lag +1d</div>
              <div className="mt-1 font-medium">{fmtCorr(data.correlations.lag_1d)}</div>
            </div>
            <div className="rounded-xl border border-stealth-700 bg-stealth-800/70 p-3 text-xs text-stealth-300">
              <div className="text-stealth-500">Lag +2d</div>
              <div className="mt-1 font-medium">{fmtCorr(data.correlations.lag_2d)}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-stealth-700 bg-stealth-900/50 p-4">
            <div className="mb-2 text-xs text-stealth-400">
              Drag the lower brush handles to zoom. Hover points for exact daily values.
            </div>
            <div className="h-[520px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
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
                  <Line yAxisId="corr" type="monotone" dataKey="corr" name={`${window}d rolling corr`} stroke="#f43f5e" dot={false} strokeWidth={2} connectNulls />
                  <Line yAxisId="signal" type="monotone" dataKey="absReturn" name="S&P abs return %" stroke="#22c55e" dot={false} strokeWidth={1.6} />
                  <Line yAxisId="signal" type="monotone" dataKey="disruption" name="Weather disruption" stroke="#38bdf8" dot={false} strokeWidth={1.4} strokeDasharray="4 4" />
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

          <div className="rounded-2xl border border-stealth-700 bg-stealth-800/60 p-4 text-xs text-stealth-300 leading-relaxed">
            Correlation is descriptive and non-causal. A persistent relationship should remain directionally stable across windows and maintain significance before any practical interpretation.
          </div>
        </>
      )}
    </div>
  );
}
