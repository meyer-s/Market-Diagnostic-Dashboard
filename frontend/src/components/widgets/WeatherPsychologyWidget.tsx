import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useApi } from "../../hooks/useApi";

interface CorrelationSummary {
  pearson_r: number | null;
  p_value: number | null;
  samples: number;
  significant: boolean;
}

interface WeatherHistoryPoint {
  date: string;
  sp500_return_pct: number;
  sp500_abs_return_pct: number;
  weather_disruption_index: number;
  rolling_corr: number | null;
}

interface WeatherMarketPayload {
  location: string;
  days: number;
  latest: WeatherHistoryPoint | null;
  correlations: {
    same_day_direction: CorrelationSummary;
    same_day_sensitivity: CorrelationSummary;
    lag_1d: CorrelationSummary;
    lag_2d: CorrelationSummary;
  };
  history: WeatherHistoryPoint[];
}

interface Props {
  days?: 90 | 180 | 365;
}

const renderCorr = (corr: CorrelationSummary) => {
  if (corr.pearson_r === null || corr.p_value === null) {
    return "n/a";
  }
  return `r ${corr.pearson_r.toFixed(2)} | p ${corr.p_value.toFixed(3)}`;
};

const corrClass = (corr: CorrelationSummary) => {
  if (corr.pearson_r === null) return "text-stealth-400";
  if (!corr.significant) return "text-yellow-300";
  return corr.pearson_r >= 0 ? "text-red-300" : "text-emerald-300";
};

export default function WeatherPsychologyWidget({ days = 180 }: Props) {
  const { data, loading, error } = useApi<WeatherMarketPayload>(`/research/weather-market?days=${days}&window=30`);

  if (loading) {
    return (
      <div className="primary-card p-4 md:p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-stealth-700 rounded mb-3 w-1/2"></div>
          <div className="h-28 bg-stealth-800 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-sm font-semibold text-stealth-100">Weather Sensitivity</h3>
        <p className="mt-2 text-xs text-red-300">Data unavailable right now.</p>
      </div>
    );
  }

  const chartData = data.history.map((point) => ({
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    rolling_corr: point.rolling_corr,
    abs_return: point.sp500_abs_return_pct,
    disruption: point.weather_disruption_index,
  }));

  return (
    <div className="primary-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-stealth-400">Research Prototype</div>
          <h3 className="text-sm font-semibold text-stealth-100">Weather Sensitivity</h3>
          <p className="text-xs text-stealth-400">{data.location}</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-stealth-500">Current 30d Corr</div>
          <div className={`text-sm font-semibold ${data.latest?.rolling_corr !== null && data.latest?.rolling_corr !== undefined ? (data.latest.rolling_corr > 0 ? "text-red-300" : "text-emerald-300") : "text-stealth-300"}`}>
            {data.latest?.rolling_corr !== null && data.latest?.rolling_corr !== undefined
              ? data.latest.rolling_corr.toFixed(2)
              : "n/a"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-2 py-2">
          <div className="text-stealth-500">Same-day direction</div>
          <div className={`mt-1 font-medium ${corrClass(data.correlations.same_day_direction)}`}>
            {renderCorr(data.correlations.same_day_direction)}
          </div>
        </div>
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-2 py-2">
          <div className="text-stealth-500">Same-day sensitivity</div>
          <div className={`mt-1 font-medium ${corrClass(data.correlations.same_day_sensitivity)}`}>
            {renderCorr(data.correlations.same_day_sensitivity)}
          </div>
        </div>
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-2 py-2">
          <div className="text-stealth-500">Lag +1d sensitivity</div>
          <div className={`mt-1 font-medium ${corrClass(data.correlations.lag_1d)}`}>
            {renderCorr(data.correlations.lag_1d)}
          </div>
        </div>
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-2 py-2">
          <div className="text-stealth-500">Lag +2d sensitivity</div>
          <div className={`mt-1 font-medium ${corrClass(data.correlations.lag_2d)}`}>
            {renderCorr(data.correlations.lag_2d)}
          </div>
        </div>
      </div>

      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.2)" />
            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} minTickGap={22} />
            <YAxis yAxisId="corr" domain={[-1, 1]} stroke="#fda4af" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="signal" orientation="right" stroke="#86efac" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
            />
            <Line yAxisId="corr" type="monotone" dataKey="rolling_corr" stroke="#f43f5e" dot={false} strokeWidth={2} connectNulls />
            <Line yAxisId="signal" type="monotone" dataKey="abs_return" stroke="#22c55e" dot={false} strokeWidth={1.8} />
            <Line yAxisId="signal" type="monotone" dataKey="disruption" stroke="#38bdf8" dot={false} strokeWidth={1.4} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-stealth-500">
        Sensitivity uses absolute S&P 500 daily return vs composite weather disruption index.
      </p>
      <p className="mt-1 text-[11px] text-stealth-500">
        Correlation is descriptive only and should be treated as non-causal unless persistent and statistically significant.
      </p>
    </div>
  );
}
