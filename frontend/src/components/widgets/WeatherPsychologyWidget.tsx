import { useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceArea } from "recharts";
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

const getRelationshipTone = (corr: number | null | undefined, significant: boolean | undefined) => {
  if (corr === null || corr === undefined) return "No stable relationship yet.";
  if (!significant || Math.abs(corr) < 0.15) return "The relationship looks weak and noisy right now.";
  if (corr > 0) return "Stressier weather has lined up with greener sessions.";
  return "Calmer weather has lined up with greener sessions.";
};

const getSignalContext = (label: string, normalizedValue: number | null | undefined) => {
  if (normalizedValue === null || normalizedValue === undefined) return `${label} is unavailable in the current slice.`;
  if (normalizedValue >= 75) return `${label} is near the high end of its recent range.`;
  if (normalizedValue <= 25) return `${label} is near the low end of its recent range.`;
  return `${label} is near the middle of its recent range.`;
};

const buildCorrelationZones = (
  points: Array<{ date: string; rolling_corr: number | null; rollingSignificant: boolean }>
) => {
  const zones: Array<{ start: string; end: string; fill: string; stroke: string }> = [];
  let current: { start: string; end: string; fill: string; stroke: string } | null = null;

  for (const point of points) {
    if (!point.rollingSignificant || point.rolling_corr === null || Math.abs(point.rolling_corr) < 0.15) {
      if (current) {
        zones.push(current);
        current = null;
      }
      continue;
    }

    const fill = point.rolling_corr < 0 ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.22)";
    const stroke = point.rolling_corr < 0 ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)";
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

  const returnScaled = normalizeCenteredSeries(data.history.map((point) => point.sp500_return_pct));
  const signalScaled = normalizeSeries(data.history.map((point) => point[selectedSignal] as number | null | undefined));
  const chartData = data.history.map((point, index) => ({
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    rolling_corr: point.rolling_corr,
    rollingSignificant: point.rolling_corr !== null,
    returnScaled: returnScaled[index],
    returnRaw: point.sp500_return_pct,
    signalScaled: signalScaled[index],
    signalRaw: point[selectedSignal] as number | null | undefined,
  }));
  const selectedSignalMeta = weatherSignalOptions.find((option) => option.key === selectedSignal) ?? weatherSignalOptions[0];
  const latestSignalNormalized = chartData.length ? chartData[chartData.length - 1]?.signalScaled : null;
  const relationshipTone = getRelationshipTone(data.latest?.rolling_corr, data.latest?.rolling_corr !== null && data.latest?.rolling_corr !== undefined);
  const correlationZones = buildCorrelationZones(chartData);

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
          <div className="text-[11px] uppercase tracking-wide text-stealth-500">Current read</div>
          <div className="max-w-[180px] text-right text-sm font-medium text-stealth-200">{relationshipTone}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-3 py-3">
          <div className="text-stealth-500">Weather context</div>
          <div className="mt-1 text-stealth-200">{getSignalContext(selectedSignalMeta.label, latestSignalNormalized)}</div>
        </div>
        <div className="rounded-md border border-stealth-700/70 bg-stealth-900/40 px-3 py-3">
          <div className="text-stealth-500">Background view</div>
          <div className="mt-1 text-stealth-200">Green shading marks periods where calmer conditions have been lining up with greener sessions.</div>
        </div>
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
            {correlationZones.map((zone) => (
              <ReferenceArea key={`${zone.start}-${zone.end}-${zone.fill}`} x1={zone.start} x2={zone.end} yAxisId="corr" fill={zone.fill} stroke={zone.stroke} strokeOpacity={0.9} ifOverflow="extendDomain" />
            ))}
            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} minTickGap={22} />
            <YAxis yAxisId="corr" domain={[-1, 1]} stroke="#fda4af" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="signal" orientation="right" domain={[-100, 100]} stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)}`} />
            <Tooltip
              formatter={(value: string | number | readonly (string | number)[] | null | undefined, _name: string, item: { dataKey?: unknown; payload?: { returnRaw?: number; signalRaw?: number | null } }) => {
                const numericValue = typeof value === "number" ? value : Array.isArray(value) ? Number(value[0]) : Number(value);
                const normalizedValue = Number.isFinite(numericValue) ? numericValue.toFixed(1) : "n/a";
                if (item.dataKey === "returnScaled") {
                  return [`${item.payload?.returnRaw?.toFixed(2) ?? "n/a"}% raw | ${normalizedValue} directional index`, "S&P daily return"];
                }
                if (item.dataKey === "signalScaled") {
                  return [`${formatComponentRaw(item.payload?.signalRaw, selectedSignalMeta.key === "weather_stress_score" ? "score" : selectedSignalMeta.key === "pressure_hpa" ? "hPa" : selectedSignalMeta.key === "precip_mm" ? "mm" : selectedSignalMeta.key === "temp_c" ? "C" : "km/h")} | ${normalizedValue} relative level`, selectedSignalMeta.chartLabel];
                }
                return [Number.isFinite(numericValue) ? numericValue.toFixed(2) : "n/a", "Rolling composite-score relationship"];
              }}
              contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
            />
            <Line yAxisId="corr" type="monotone" dataKey="rolling_corr" name="Rolling composite relationship" stroke="#f43f5e" dot={false} strokeWidth={1.2} strokeOpacity={0.45} connectNulls />
            <Line yAxisId="signal" type="monotone" dataKey="returnScaled" name="S&P daily return (directional)" stroke="#22c55e" dot={false} strokeWidth={1.8} />
            <Line yAxisId="signal" type="monotone" dataKey="signalScaled" name={`${selectedSignalMeta.chartLabel} (normalized)`} stroke={selectedSignalMeta.color} dot={false} strokeWidth={1.4} strokeDasharray={selectedSignalMeta.strokeDasharray} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-stealth-500">
        The right axis is normalized from 0 to 100 within the active window so the selected weather signal and S&P move magnitude remain visually comparable.
      </p>
      <p className="mt-1 text-[11px] text-stealth-500">
        The red line is still the composite relationship, but the shading is meant to carry most of the story and the green line now reflects signed S&P direction rather than absolute move size.
      </p>
    </div>
  );
}
