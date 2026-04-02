import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApi } from "../../hooks/useApi";

interface RateSeriesMeta {
  label: string;
  source: string;
  is_proxy: boolean;
}

interface RatesHistoryPoint {
  date: string;
  spread_fed_minus_cd: number;
  spread_cd_minus_muni: number;
  spread_fed_minus_muni: number;
  spread_regime_score: number;
}

interface RadarPoint {
  metric: string;
  value: number;
  raw_value: number;
}

interface RatesSpreadPayload {
  status?: "ok" | "unavailable";
  reason?: string;
  latest: RatesHistoryPoint | null;
  history: RatesHistoryPoint[];
  radar_snapshot: RadarPoint[];
  series_meta: {
    fed_rate: RateSeriesMeta;
    cd_proxy: RateSeriesMeta;
    muni_proxy: RateSeriesMeta;
  } | null;
}

interface Props {
  days?: 90 | 180 | 365;
}

export default function RatesSpreadWidget({ days = 180 }: Props) {
  const { data, loading, error } = useApi<RatesSpreadPayload>(`/research/rates-spread?days=${days}&allow_proxies=false`);

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
        <h3 className="text-sm font-semibold text-stealth-100">Rates Spread Monitor</h3>
        <p className="mt-2 text-xs text-red-300">Data unavailable right now.</p>
      </div>
    );
  }

  if (data.status === "unavailable" || !data.series_meta) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-sm font-semibold text-stealth-100">Rates Spread Monitor</h3>
        <p className="mt-2 text-xs text-stealth-300">
          Direct Fed/CD/Muni series are unavailable for the selected range. Proxy fallback series remain hidden by policy.
        </p>
        {data.reason && <p className="mt-1 text-[11px] text-stealth-500">Reason: {data.reason}</p>}
      </div>
    );
  }

  const hasProxySeries =
    data.series_meta.cd_proxy.is_proxy || data.series_meta.muni_proxy.is_proxy || data.series_meta.fed_rate.is_proxy;

  if (hasProxySeries) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-sm font-semibold text-stealth-100">Rates Spread Monitor</h3>
        <p className="mt-2 text-xs text-stealth-300">
          Direct Fed/CD/Muni series are unavailable for the selected range. Proxy fallback series are hidden by policy.
        </p>
      </div>
    );
  }

  const chartData = data.history.map((point) => ({
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    fed_cd: point.spread_fed_minus_cd,
    cd_muni: point.spread_cd_minus_muni,
    fed_muni: point.spread_fed_minus_muni,
    regime: point.spread_regime_score,
  }));

  const regimeTone = data.latest
    ? data.latest.spread_regime_score > 60
      ? "Wide"
      : data.latest.spread_regime_score < 40
      ? "Compressed"
      : "Balanced"
    : "n/a";

  return (
    <div className="primary-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-stealth-400">Research Prototype</div>
          <h3 className="text-sm font-semibold text-stealth-100">Rates Spread Monitor</h3>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-stealth-500">Regime</div>
          <div className="text-sm font-semibold text-sky-300">{regimeTone}</div>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-stealth-500">All three legs are direct series.</div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="h-52 xl:col-span-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.2)" />
              <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} minTickGap={22} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="fed_cd" name="Fed-CD" stroke="#60a5fa" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="cd_muni" name="CD-Muni" stroke="#22c55e" dot={false} strokeWidth={1.8} />
              <Line type="monotone" dataKey="fed_muni" name="Fed-Muni" stroke="#f97316" dot={false} strokeWidth={1.8} />
              <Line type="monotone" dataKey="regime" name="Regime Score" stroke="#f43f5e" dot={false} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="h-52 xl:col-span-2">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data.radar_snapshot}>
              <PolarGrid stroke="rgba(148,163,184,0.3)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "#cbd5e1", fontSize: 11 }} />
              <Radar name="Relative Level" dataKey="value" stroke="#38bdf8" fill="#0ea5e9" fillOpacity={0.45} />
              <Tooltip
                formatter={(value: number, _name: string, props: { payload?: RadarPoint }) => [
                  `${value.toFixed(1)} (raw ${props.payload?.raw_value?.toFixed(2) ?? "n/a"}%)`,
                  "Relative level",
                ]}
                contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-stealth-500">
        Interpret as spread regime context, not a directional prediction model.
      </p>
    </div>
  );
}
