import { useState } from "react";
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
  pressure_change_hpa: number;
  pressure_shift_score: number;
  precipitation_stress_score: number;
  wind_stress_score: number;
  temperature_stress_score: number;
  weather_stress_score: number;
  weather_disruption_index: number;
  rolling_corr: number | null;
  pressure_hpa?: number | null;
  temp_c?: number | null;
  precip_mm?: number;
  wind_kmh?: number;
}

type WeatherSignalOption = "weather_stress_score" | "pressure_hpa" | "precip_mm" | "temp_c" | "wind_kmh";

interface ScoreComponent {
  key: string;
  label: string;
  description: string;
  weight: number;
  raw_field: keyof WeatherHistoryPoint;
  score_field: keyof WeatherHistoryPoint;
  unit: string;
}

interface WeatherMarketPayload {
  location: string;
  days: number;
  window_days: number;
  source: {
    weather: string;
    market: string;
  };
  latest: WeatherHistoryPoint | null;
  correlations: {
    same_day_direction: CorrelationSummary;
    same_day_sensitivity: CorrelationSummary;
    lag_1d: CorrelationSummary;
    lag_2d: CorrelationSummary;
  };
  score_components: ScoreComponent[];
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
    label: "Pressure",
    chartLabel: "Barometric pressure",
    color: "#f59e0b",
  },
  {
    key: "precip_mm",
    label: "Precip",
    chartLabel: "Total precipitation",
    color: "#60a5fa",
  },
  {
    key: "temp_c",
    label: "Temp",
    chartLabel: "Average temperature",
    color: "#fb7185",
  },
  {
    key: "wind_kmh",
    label: "Wind",
    chartLabel: "Peak wind speed",
    color: "#a78bfa",
  },
];

const formatComponentRaw = (value: number | null | undefined, unit: string) => {
  if (value === null || value === undefined) return "n/a";
  if (unit === "score") return value.toFixed(2);
  if (unit === "hPa") return `${value.toFixed(1)} hPa`;
  if (unit === "mm") return `${value.toFixed(1)} mm`;
  if (unit === "km/h") return `${value.toFixed(1)} km/h`;
  return `${value.toFixed(1)} C`;
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

export default function WeatherPsychologyWidget({ days = 180 }: Props) {
  const [selectedSignal, setSelectedSignal] = useState<WeatherSignalOption>("weather_stress_score");
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

  const absReturnScaled = normalizeSeries(data.history.map((point) => point.sp500_abs_return_pct));
  const signalScaled = normalizeSeries(data.history.map((point) => point[selectedSignal] as number | null | undefined));
  const chartData = data.history.map((point, index) => ({
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    rolling_corr: point.rolling_corr,
    absReturnScaled: absReturnScaled[index],
    absReturnRaw: point.sp500_abs_return_pct,
    signalScaled: signalScaled[index],
    signalRaw: point[selectedSignal] as number | null | undefined,
  }));
  const latestPoint = data.latest as Record<string, number | null | undefined> | null;
  const selectedSignalMeta = weatherSignalOptions.find((option) => option.key === selectedSignal) ?? weatherSignalOptions[0];

  return (
    <div className="primary-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-stealth-400">Research Prototype</div>
          <h3 className="text-sm font-semibold text-stealth-100">Weather Sensitivity</h3>
          <p className="text-xs text-stealth-400">{data.location}</p>
          <p className="mt-1 text-[11px] text-stealth-500">Weather: {data.source.weather} | Market: {data.source.market}</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-stealth-500">Current rolling relationship</div>
          <div className={`text-sm font-semibold ${data.latest?.rolling_corr !== null && data.latest?.rolling_corr !== undefined ? (data.latest.rolling_corr > 0 ? "text-red-300" : "text-emerald-300") : "text-stealth-300"}`}>
            {data.latest?.rolling_corr !== null && data.latest?.rolling_corr !== undefined
              ? data.latest.rolling_corr.toFixed(2)
              : "n/a"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        {correlationCards.map((card) => (
          <div key={card.key} className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-2 py-2">
            <div className="text-stealth-500">{card.title}</div>
            <div className={`mt-1 font-medium ${corrClass(data.correlations[card.key])}`}>
              {renderCorr(data.correlations[card.key])}
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-stealth-500">{card.description}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
        {data.score_components.map((component) => (
          <div key={component.key} className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-3 py-2">
            <div className="text-stealth-400">{component.label}</div>
            <div className="mt-1 font-medium text-stealth-100">
              {formatComponentRaw(latestPoint?.[component.raw_field] as number | null | undefined, component.unit)}
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-stealth-500">{component.description}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        {weatherSignalOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => setSelectedSignal(option.key)}
            className={`rounded-full px-3 py-1 transition ${
              selectedSignal === option.key ? "bg-stealth-700 text-white" : "bg-stealth-900/40 text-stealth-400 hover:text-stealth-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-4 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.2)" />
            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} minTickGap={22} />
            <YAxis yAxisId="corr" domain={[-1, 1]} stroke="#fda4af" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="signal" orientation="right" domain={[0, 100]} stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)}`} />
            <Tooltip
              formatter={(value: string | number | readonly (string | number)[] | null | undefined, _name: string, item: { dataKey?: unknown; payload?: { absReturnRaw?: number; signalRaw?: number | null } }) => {
                const numericValue = typeof value === "number" ? value : Array.isArray(value) ? Number(value[0]) : Number(value);
                const normalizedValue = Number.isFinite(numericValue) ? numericValue.toFixed(1) : "n/a";
                if (item.dataKey === "absReturnScaled") {
                  return [`${item.payload?.absReturnRaw?.toFixed(2) ?? "n/a"}% raw | ${normalizedValue} normalized`, "S&P move magnitude"];
                }
                if (item.dataKey === "signalScaled") {
                  return [`${formatComponentRaw(item.payload?.signalRaw, selectedSignalMeta.key === "weather_stress_score" ? "score" : selectedSignalMeta.key === "pressure_hpa" ? "hPa" : selectedSignalMeta.key === "precip_mm" ? "mm" : selectedSignalMeta.key === "temp_c" ? "C" : "km/h")} | ${normalizedValue} normalized`, selectedSignalMeta.chartLabel];
                }
                return [Number.isFinite(numericValue) ? numericValue.toFixed(2) : "n/a", "Rolling composite-score relationship"];
              }}
              contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
            />
            <Line yAxisId="corr" type="monotone" dataKey="rolling_corr" name="Rolling composite-score relationship" stroke="#f43f5e" dot={false} strokeWidth={2} connectNulls />
            <Line yAxisId="signal" type="monotone" dataKey="absReturnScaled" name="S&P move magnitude (normalized)" stroke="#22c55e" dot={false} strokeWidth={1.8} />
            <Line yAxisId="signal" type="monotone" dataKey="signalScaled" name={`${selectedSignalMeta.chartLabel} (normalized)`} stroke={selectedSignalMeta.color} dot={false} strokeWidth={1.4} strokeDasharray={selectedSignalMeta.strokeDasharray} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-stealth-500">
        The right axis is normalized from 0 to 100 within the active window so the selected weather signal and S&P move magnitude remain visually comparable.
      </p>
      <p className="mt-1 text-[11px] text-stealth-500">
        The red line always uses the composite weather stress score, so scoring changes affect that line even when the selectable weather line is pressure, rain, temperature, or wind.
      </p>
    </div>
  );
}
