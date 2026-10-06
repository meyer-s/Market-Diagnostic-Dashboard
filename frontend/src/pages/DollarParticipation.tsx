/*
THESIS: Dollar participation is a time-aligned evidence field, not a flow gauge or a trading signal.
OWN-WORLD: Evidence Field navy surfaces, direct labels, a white DXY trace, blue bullish activity, and coral bearish activity.
STORY: Read the current relationship, scan its history, inspect unusual episodes, then audit the instruments and method.
FIRST VIEWPORT: A compact header leads into one wide synchronized chart with an adjacent factual current-read panel.
FORM: Participation field, sixth assigned Operate structure, integrated chart staging, seed 397736be.
*/

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  Database,
  Info,
  Scale,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AccessibleChartFrame from "../components/ui/AccessibleChartFrame";
import MarketLoading from "../components/ui/MarketLoading";
import PageHeader from "../components/ui/PageHeader";
import PageState from "../components/ui/PageState";
import SegmentedControl from "../components/ui/SegmentedControl";
import { useApi } from "../hooks/useApi";
import { commonGridProps, commonXAxisProps, commonYAxisProps } from "../utils/chartUtils";


type Period = 252 | 504 | 756 | 1260;

type Regime =
  | "insufficient"
  | "two_sided"
  | "price_led"
  | "aligned_bull"
  | "aligned_bear"
  | "bear_against_price"
  | "bull_against_price"
  | "activity_led"
  | "balanced";

type HistoryPoint = {
  date: string;
  dxy_close: number;
  dxy_indexed: number;
  dxy_return_20d_pct: number;
  bull_activity_z: number;
  bear_activity_z: number;
  bull_excess: number;
  bear_excess: number;
  bear_plot: number;
  participation_tilt: number;
  participation_intensity: number;
  bull_activity_ratio: number;
  bear_activity_ratio: number;
  same_day_association_63d: number | null;
  regime: Regime;
  regime_label: string;
};

type Episode = {
  start_date: string;
  end_date: string;
  sessions: number;
  regime: Regime;
  label: string;
  dxy_change_pct: number | null;
  average_tilt: number | null;
  average_bull_excess: number | null;
  average_bear_excess: number | null;
};

type Instrument = {
  code: string;
  provider_symbol: string;
  name: string;
  role: string;
  direction: string;
  leverage: string;
  observations_returned: number;
  shared_observations: number;
  normalization: string;
};

type DollarParticipationPayload = {
  as_of: string;
  generated_at: string;
  period: {
    requested_sessions: number;
    returned_sessions: number;
    start_date: string;
    end_date: string;
  };
  current: {
    regime: Regime;
    regime_label: string;
    summary: string;
    dxy_level: number;
    dxy_return_20d_pct: number;
    bull_activity_z: number;
    bear_activity_z: number;
    bull_activity_ratio: number;
    bear_activity_ratio: number;
    bull_dollar_activity: number;
    bear_dollar_activity: number;
    participation_tilt: number;
    participation_intensity: number;
    same_day_association_63d: number | null;
  };
  history: HistoryPoint[];
  episodes: Episode[];
  instruments: Instrument[];
  data_quality: {
    status: "ok" | "partial";
    provider: string;
    price_field: string;
    volume_field: string;
    alignment: string;
    shared_observations_before_scoring: number;
    warnings: string[];
  };
  methodology: Record<string, string>;
  sources: Array<{ label: string; url: string; role: string }>;
};

type TooltipEntry = {
  dataKey?: string;
  value?: number;
  color?: string;
  payload?: HistoryPoint;
};

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 252, label: "1Y" },
  { value: 504, label: "2Y" },
  { value: 756, label: "3Y" },
  { value: 1260, label: "5Y" },
];

const REGIME_TONE: Record<Regime, string> = {
  insufficient: "border-stealth-700 bg-stealth-900 text-stealth-300",
  two_sided: "border-violet-400/40 bg-violet-500/10 text-violet-200",
  price_led: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  aligned_bull: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  aligned_bear: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  bear_against_price: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  bull_against_price: "border-rose-400/40 bg-rose-500/10 text-rose-200",
  activity_led: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  balanced: "border-stealth-700 bg-stealth-900 text-stealth-200",
};

function fmtSigned(value: number | null | undefined, digits = 1, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function fmtDate(value: string, includeYear = true) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function fmtCompactDollar(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function scoreMeaning(value: number) {
  if (value >= 2) return "Very unusual";
  if (value >= 1) return "Unusually high";
  if (value >= 0) return "Near or above baseline";
  return "Below baseline";
}

function axisDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

function ActivityTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  const row = payload.find((entry) => entry.payload)?.payload;
  if (!row) return null;
  return (
    <div className="max-w-[290px] rounded-xl border border-stealth-600 bg-stealth-950 p-3 text-xs shadow-2xl">
      <div className="font-semibold text-stealth-100">{fmtDate(label)}</div>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-stealth-300">
        <dt>DXY</dt><dd className="font-mono text-stealth-100">{row.dxy_close.toFixed(2)}</dd>
        <dt>20-session move</dt><dd className="font-mono text-stealth-100">{fmtSigned(row.dxy_return_20d_pct, 2, "%")}</dd>
        <dt>Bull activity</dt><dd className="font-mono text-sky-300">{fmtSigned(row.bull_activity_z, 2, "σ")}</dd>
        <dt>Bear activity</dt><dd className="font-mono text-rose-300">{fmtSigned(row.bear_activity_z, 2, "σ")}</dd>
        <dt>Participation tilt</dt><dd className="font-mono text-stealth-100">{fmtSigned(row.participation_tilt, 2)}</dd>
      </dl>
      <p className="mt-2 border-t border-stealth-800 pt-2 text-stealth-400">{row.regime_label}</p>
    </div>
  );
}

function ToneBadge({ regime, children }: { regime: Regime; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${REGIME_TONE[regime]}`}>
      {children}
    </span>
  );
}

function ChartDataTable({ rows }: { rows: HistoryPoint[] }) {
  const sampled = rows.filter((_, index) => index % Math.max(1, Math.floor(rows.length / 24)) === 0 || index === rows.length - 1);
  return (
    <table className="min-w-full text-left text-xs text-stealth-300">
      <thead className="text-stealth-100">
        <tr>
          <th className="px-3 py-2">Date</th>
          <th className="px-3 py-2 text-right">DXY</th>
          <th className="px-3 py-2 text-right">20-session move</th>
          <th className="px-3 py-2 text-right">UUP activity</th>
          <th className="px-3 py-2 text-right">UDN activity</th>
          <th className="px-3 py-2">Relationship</th>
        </tr>
      </thead>
      <tbody>
        {sampled.map((row) => (
          <tr key={row.date} className="border-t border-stealth-800">
            <td className="px-3 py-2">{fmtDate(row.date)}</td>
            <td className="px-3 py-2 text-right font-mono">{row.dxy_close.toFixed(2)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtSigned(row.dxy_return_20d_pct, 2, "%")}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtSigned(row.bull_activity_z, 2, "σ")}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtSigned(row.bear_activity_z, 2, "σ")}</td>
            <td className="px-3 py-2">{row.regime_label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ParticipationChart({ data }: { data: DollarParticipationPayload }) {
  const dxyDomain = useMemo(() => {
    const values = data.history.map((row) => row.dxy_indexed);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const padding = Math.max(0.75, (maximum - minimum) * 0.12);
    return [Math.floor((minimum - padding) * 10) / 10, Math.ceil((maximum + padding) * 10) / 10];
  }, [data.history]);

  return (
    <AccessibleChartFrame
      title="DXY movement and above-baseline product activity"
      description="DXY is indexed to 100 at the start of the selected window. Activity shows only above-baseline UUP and UDN scores; below-baseline trading stays at zero in the field. Dashed +/-1 sigma lines mark the threshold used for unusual-activity labels."
      summary={`Current relationship: ${data.current.regime_label}. ${data.current.summary}`}
      dataTable={<ChartDataTable rows={data.history} />}
      dataLabel="Sampled DXY and product activity history"
      className="h-full"
    >
      <div className="h-[430px] min-w-[720px]" aria-label="Time-aligned DXY and product activity chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data.history}
            margin={{ top: 18, right: 18, bottom: 8, left: 0 }}
            accessibilityLayer
            aria-label="DXY and above-baseline dollar product activity over time"
          >
            <defs>
              <linearGradient id="bullParticipationFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#83bfff" stopOpacity={0.7} />
                <stop offset="100%" stopColor="#83bfff" stopOpacity={0.12} />
              </linearGradient>
              <linearGradient id="bearParticipationFill" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#ff8a93" stopOpacity={0.72} />
                <stop offset="100%" stopColor="#ff8a93" stopOpacity={0.12} />
              </linearGradient>
            </defs>
            <CartesianGrid {...commonGridProps} vertical={false} />
            <XAxis
              {...commonXAxisProps}
              dataKey="date"
              minTickGap={42}
              tickFormatter={axisDate}
            />
            <YAxis
              {...commonYAxisProps}
              yAxisId="activity"
              domain={[-3, 3]}
              ticks={[-3, -2, -1, 0, 1, 2, 3]}
              tickFormatter={(value: number) => `${value > 0 ? "+" : ""}${value.toFixed(0)}σ`}
              width={44}
            />
            <YAxis
              {...commonYAxisProps}
              yAxisId="dxy"
              orientation="right"
              domain={dxyDomain}
              tickFormatter={(value: number) => value.toFixed(1)}
              width={44}
            />
            <Tooltip content={<ActivityTooltip />} />
            <Legend verticalAlign="top" align="right" height={34} wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine yAxisId="activity" y={0} stroke="#91a4bd" strokeWidth={1} />
            <ReferenceLine yAxisId="activity" y={1} stroke="#62758e" strokeDasharray="4 6" />
            <ReferenceLine yAxisId="activity" y={-1} stroke="#62758e" strokeDasharray="4 6" />
            <Area
              yAxisId="activity"
              type="monotone"
              dataKey="bull_excess"
              name="UUP above-baseline activity"
              stroke="#83bfff"
              fill="url(#bullParticipationFill)"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <Area
              yAxisId="activity"
              type="monotone"
              dataKey="bear_plot"
              name="UDN above-baseline activity"
              stroke="#ff8a93"
              fill="url(#bearParticipationFill)"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <Line
              yAxisId="dxy"
              type="monotone"
              dataKey="dxy_indexed"
              name="DXY indexed (right axis)"
              stroke="#f4f7fb"
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4, fill: "#f4f7fb", stroke: "#0e1520", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </AccessibleChartFrame>
  );
}

function CurrentRead({ data }: { data: DollarParticipationPayload }) {
  const { current } = data;
  return (
    <section className="rounded-2xl bg-stealth-900 p-5 shadow-lg shadow-black/20" aria-labelledby="current-read-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="current-read-title" className="text-lg font-semibold text-stealth-50">Current read</h2>
        <span className="text-xs tabular-nums text-stealth-400">{fmtDate(data.as_of)}</span>
      </div>
      <div className="mt-4"><ToneBadge regime={current.regime}>{current.regime_label}</ToneBadge></div>
      <p className="mt-4 text-sm leading-6 text-stealth-200">{current.summary}</p>

      <dl className="mt-5 divide-y divide-stealth-800 border-y border-stealth-800 text-sm">
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-stealth-400">DXY 20-session move</dt>
          <dd className="font-mono font-semibold text-stealth-50">{fmtSigned(current.dxy_return_20d_pct, 2, "%")}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-stealth-400">UUP activity score</dt>
          <dd className="text-right"><span className="block font-mono font-semibold text-sky-300">{fmtSigned(current.bull_activity_z, 2, "σ")}</span><span className="text-xs text-stealth-500">{scoreMeaning(current.bull_activity_z)}</span></dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-stealth-400">UDN activity score</dt>
          <dd className="text-right"><span className="block font-mono font-semibold text-rose-300">{fmtSigned(current.bear_activity_z, 2, "σ")}</span><span className="text-xs text-stealth-500">{scoreMeaning(current.bear_activity_z)}</span></dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-stealth-400">Participation tilt</dt>
          <dd className="font-mono font-semibold text-stealth-50">{fmtSigned(current.participation_tilt, 2)}</dd>
        </div>
      </dl>
      <p className="mt-4 flex gap-2 text-xs leading-5 text-stealth-400">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        Activity describes trading intensity. It does not identify buyers, sellers, creations, holdings, or net positioning.
      </p>
    </section>
  );
}

function ActivityBalance({ data }: { data: DollarParticipationPayload }) {
  const rows = [
    {
      code: "UUP",
      label: "Bullish product",
      activityValue: data.current.bull_activity_z,
      ratio: data.current.bull_activity_ratio,
      dollars: data.current.bull_dollar_activity,
      tone: "text-sky-300",
      fill: "bg-sky-400",
    },
    {
      code: "UDN",
      label: "Bearish product",
      activityValue: data.current.bear_activity_z,
      ratio: data.current.bear_activity_ratio,
      dollars: data.current.bear_dollar_activity,
      tone: "text-rose-300",
      fill: "bg-rose-400",
    },
  ];
  return (
    <section className="rounded-2xl bg-stealth-900 p-5 shadow-lg shadow-black/20" aria-labelledby="activity-balance-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="activity-balance-title" className="text-lg font-semibold text-stealth-50">Two sides, kept separate</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-stealth-400">A net tilt can hide simultaneous activity. These scores compare each product with itself before any subtraction.</p>
        </div>
        <div className="rounded-xl bg-stealth-950 px-3 py-2 text-right">
          <div className="text-xs text-stealth-400">Combined above-baseline score</div>
          <div className="font-mono text-lg font-semibold text-stealth-50">{data.current.participation_intensity.toFixed(2)}</div>
        </div>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {rows.map((row) => {
          const width = Math.max(0, Math.min(100, ((row.activityValue + 3) / 6) * 100));
          return (
            <article key={row.code} className="rounded-xl bg-stealth-950 p-4">
              <div className="flex items-start justify-between gap-4">
                <div><div className={`text-sm font-semibold ${row.tone}`}>{row.code}</div><div className="mt-1 text-xs text-stealth-400">{row.label}</div></div>
                <div className={`font-mono text-2xl font-semibold ${row.tone}`}>{fmtSigned(row.activityValue, 2, "σ")}</div>
              </div>
              <div
                className="relative mt-4 h-2 rounded-full bg-stealth-800"
                role="meter"
                aria-label={`${row.code} activity score`}
                aria-valuemin={-3}
                aria-valuemax={3}
                aria-valuenow={row.activityValue}
              >
                <div className="absolute left-1/2 top-[-4px] h-4 w-px bg-stealth-500" />
                <div className={`absolute top-0 h-2 rounded-full ${row.fill}`} style={{ left: "50%", width: `${Math.abs(width - 50)}%`, transform: width < 50 ? "translateX(-100%)" : undefined }} />
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-stealth-400">
                <span>{row.ratio.toFixed(2)}× trailing median</span>
                <span>{fmtCompactDollar(row.dollars)} daily activity</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EpisodeLedger({ episodes }: { episodes: Episode[] }) {
  return (
    <section aria-labelledby="episode-ledger-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="episode-ledger-title" className="text-xl font-semibold text-stealth-50">Recent relationship episodes</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300">Contiguous descriptive states show whether alignment or divergence persisted. Short labels are not event studies or forecasts.</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl bg-stealth-900 shadow-lg shadow-black/20" role="region" tabIndex={0} aria-label="Recent dollar participation episodes">
        <table className="min-w-[840px] w-full text-left text-sm">
          <thead className="border-b border-stealth-700 text-xs text-stealth-400">
            <tr>
              <th className="px-5 py-3 font-semibold">Period</th>
              <th className="px-5 py-3 font-semibold">Observed relationship</th>
              <th className="px-5 py-3 text-right font-semibold">Sessions</th>
              <th className="px-5 py-3 text-right font-semibold">DXY move</th>
              <th className="px-5 py-3 text-right font-semibold">Avg. tilt</th>
              <th className="px-5 py-3 text-right font-semibold">Bull / bear excess</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stealth-800">
            {episodes.slice(0, 8).map((episode) => (
              <tr key={`${episode.start_date}-${episode.end_date}-${episode.regime}`}>
                <td className="px-5 py-4 text-stealth-200">{fmtDate(episode.start_date)} – {fmtDate(episode.end_date)}</td>
                <td className="px-5 py-4"><ToneBadge regime={episode.regime}>{episode.label}</ToneBadge></td>
                <td className="px-5 py-4 text-right font-mono text-stealth-200">{episode.sessions}</td>
                <td className="px-5 py-4 text-right font-mono text-stealth-100">{fmtSigned(episode.dxy_change_pct, 2, "%")}</td>
                <td className="px-5 py-4 text-right font-mono text-stealth-100">{fmtSigned(episode.average_tilt, 2)}</td>
                <td className="px-5 py-4 text-right font-mono text-stealth-300">{fmtSigned(episode.average_bull_excess, 2)} / {fmtSigned(episode.average_bear_excess, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InstrumentAudit({ data }: { data: DollarParticipationPayload }) {
  return (
    <section aria-labelledby="instrument-audit-title">
      <div className="flex items-center gap-3">
        <Scale className="h-5 w-5 text-sky-300" aria-hidden="true" />
        <h2 id="instrument-audit-title" className="text-xl font-semibold text-stealth-50">Instrument audit</h2>
      </div>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-stealth-300">The matched UUP/UDN pair keeps direction, basket, sponsor, and 1x futures construction as comparable as the available products allow. Raw fund volumes are never weighed against each other, but matching does not eliminate tracking differences.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl bg-stealth-900 shadow-lg shadow-black/20" role="region" tabIndex={0} aria-label="Instrument comparison">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="border-b border-stealth-700 text-xs text-stealth-400">
            <tr>
              <th className="px-5 py-3 font-semibold">Instrument</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Tracked exposure</th>
              <th className="px-5 py-3 font-semibold">Leverage</th>
              <th className="px-5 py-3 font-semibold">Comparison treatment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stealth-800">
            {data.instruments.map((instrument) => (
              <tr key={instrument.code}>
                <td className="px-5 py-4"><div className="font-semibold text-stealth-50">{instrument.code}</div><div className="mt-1 text-xs text-stealth-400">{instrument.name}</div></td>
                <td className="px-5 py-4 text-stealth-200">{instrument.role}</td>
                <td className="px-5 py-4 text-stealth-200">{instrument.direction}</td>
                <td className="px-5 py-4 text-stealth-200">{instrument.leverage}</td>
                <td className="px-5 py-4 text-stealth-300">{instrument.normalization}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MeaningAndLimits({ data }: { data: DollarParticipationPayload }) {
  return (
    <section className="rounded-2xl bg-stealth-900 p-5 shadow-lg shadow-black/20" aria-labelledby="limits-title">
      <div className="flex items-center gap-3">
        <Info className="h-5 w-5 text-sky-300" aria-hidden="true" />
        <h2 id="limits-title" className="text-xl font-semibold text-stealth-50">What this can and cannot tell you</h2>
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-emerald-200">Supported comparisons</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-stealth-300">
            <li>Whether DXY moved while bullish or bearish product trading was unusual relative to that product’s own history.</li>
            <li>Whether unusual activity was one-sided, two-sided, aligned with price, or opposed to price.</li>
            <li>Whether the same-day price/activity relationship has been positive, negative, or weak over the latest 63 sessions.</li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-rose-200">Unsupported inferences</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-stealth-300">
            <li>Volume does not reveal who initiated trades, whether shares were created or redeemed, or the net beliefs of investors.</li>
            <li>Divergence does not establish crowding, conviction, causal disagreement, or an impending reversal.</li>
            <li>The feature does not cover the OTC FX market, USDX futures activity, options positioning, or the full currency-investor population.</li>
            <li>Futures carry and roll, fees, premium or discount to NAV, market hours, and session timing can separate fund behavior from the DXY spot benchmark.</li>
          </ul>
        </div>
      </div>
      <details className="mt-5 rounded-xl bg-stealth-950 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-stealth-100">Calculation and data-quality detail</summary>
        <div className="mt-4 grid gap-4 text-sm leading-6 text-stealth-300 md:grid-cols-2">
          {Object.entries(data.methodology).map(([key, value]) => (
            <div key={key}><div className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">{key.replace(/_/g, " ")}</div><p className="mt-1">{value}</p></div>
          ))}
        </div>
      </details>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-stealth-800 pt-4 text-xs text-stealth-400">
        <div className="flex items-start gap-2"><Database className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{data.data_quality.provider} · {data.data_quality.price_field} · {data.data_quality.volume_field}<br />{data.data_quality.alignment}</span></div>
        <div className="flex flex-wrap gap-3">
          {data.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
              {source.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function DollarParticipation() {
  const [requestedPeriod, setRequestedPeriod] = useState<Period>(504);
  const { data, loading, error, refetch } = useApi<DollarParticipationPayload>(
    `/dollar-participation?days=${requestedPeriod}`,
    { timeoutMs: 35_000 },
  );

  if (!data && loading) {
    return (
      <div className="page-shell-wide page-stack">
        <PageHeader title="Dollar Participation" kicker="Market participation" description="Comparing DXY movement with normalized bullish and bearish product activity." />
        <div className="rounded-2xl bg-stealth-900 py-16"><MarketLoading label="Building the shared DXY, UUP, and UDN history…" variant="scan" /></div>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="page-shell-wide page-stack">
        <PageState
          variant="error"
          headingLevel={1}
          title="Dollar participation is unavailable"
          message="The shared DXY, UUP, and UDN history could not be prepared. No activity relationship has been inferred."
          details={<p>{error}</p>}
          actions={<button type="button" className="field-button field-button-primary" onClick={refetch}>Try again</button>}
        />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="page-shell-wide page-stack">
      <PageHeader
        kicker="Market participation"
        title="Dollar Participation"
        description="Is DXY moving with unusual activity in the matched bullish and bearish dollar products? Compare movement first, then separate what was observed from what cannot be inferred."
        meta={(
          <>
            <span className="page-badge"><Activity className="h-4 w-4 text-sky-300" aria-hidden="true" />As of {fmtDate(data.as_of)}</span>
            <span className="page-badge">{data.period.returned_sessions} shared sessions</span>
            <span className="page-badge">Activity is not positioning</span>
          </>
        )}
        actions={<SegmentedControl label="History window" value={data.period.requested_sessions as Period} options={PERIODS} onChange={setRequestedPeriod} accent="sky" />}
      />

      {loading ? <div className="text-xs text-stealth-400" role="status">Refreshing the selected history while the prior result remains visible…</div> : null}
      {error ? <PageState variant="stale" title="Showing the prior result" message="The selected period could not refresh; the previous completed result remains visible." actions={<button type="button" className="field-button field-button-secondary" onClick={refetch}>Retry refresh</button>} /> : null}
      {data.data_quality.warnings.length ? <PageState variant="partial" title="Partial data-quality note" message={data.data_quality.warnings.join(" ")} /> : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]" aria-label="Current dollar participation evidence">
        <div className="xl:order-2"><CurrentRead data={data} /></div>
        <div className="min-w-0 rounded-2xl xl:order-1">
          <p className="mb-2 px-1 text-xs text-stealth-400 xl:hidden">Chart scrolls horizontally for the full history <span aria-hidden="true">&rarr;</span></p>
          <div className="overflow-x-auto rounded-2xl" role="region" tabIndex={0} aria-label="Scrollable dollar participation chart"><ParticipationChart data={data} /></div>
        </div>
      </section>

      <ActivityBalance data={data} />

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" aria-labelledby="association-title">
        <div className="rounded-2xl bg-stealth-900 p-5 shadow-lg shadow-black/20">
          <h2 id="association-title" className="text-xl font-semibold text-stealth-50">Is the relationship persistent?</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300">Use the chart and episode ledger to judge persistence. The correlation is a compact descriptive check, not the conclusion.</p>
          <div className="mt-5 h-px bg-stealth-800" />
          <p className="mt-5 text-sm leading-6 text-stealth-300">Positive values mean same-day DXY returns tended to be higher when activity tilted toward UUP; negative values mean the opposite. A value near zero means no stable linear relationship was visible over the latest window.</p>
        </div>
        <div className="rounded-2xl bg-stealth-950 p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-stealth-500">Latest 63-session association</div>
          <div className="mt-3 font-mono text-4xl font-semibold text-stealth-50">{fmtSigned(data.current.same_day_association_63d, 2)}</div>
          <p className="mt-3 text-xs leading-5 text-stealth-400">Pearson correlation of same-day DXY return and participation tilt. Session timing and common volatility can affect it.</p>
        </div>
      </section>

      <EpisodeLedger episodes={data.episodes} />
      <InstrumentAudit data={data} />
      <MeaningAndLimits data={data} />
    </div>
  );
}
