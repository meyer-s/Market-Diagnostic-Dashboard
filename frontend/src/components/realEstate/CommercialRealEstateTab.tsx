import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MarketLoading from "../ui/MarketLoading";
import { useApi } from "../../hooks/useApi";
import {
  CHART_MARGIN,
  commonGridProps,
  commonXAxisProps,
  commonYAxisProps,
} from "../../utils/chartUtils";

type DataPoint = { date: string; value: number };

type CommercialGroup = {
  group: string;
  label: string;
  weight: number;
  score: number;
  components: string[];
  changes: Record<string, number | null>;
};

type CommercialSymbol = {
  ticker: string;
  name: string;
  group: string;
  current_price: number | null;
  changes: Record<string, number | null>;
  momentum_score: number;
  volatility: number | null;
};

type CommercialFactor = {
  key: string;
  label: string;
  weight: number;
  score: number;
};

type CommercialMetrics = {
  cre_price_yoy?: number | null;
  cre_loan_balance_bil?: number | null;
  cre_loan_growth_yoy?: number | null;
  cre_delinquency_rate?: number | null;
  cre_delinquency_delta_1y?: number | null;
  treasury_10y?: number | null;
  treasury_10y_delta_60d?: number | null;
  credit_spread_bps?: number | null;
  credit_spread_delta_60d_bps?: number | null;
};

type CommercialPayload = {
  as_of: string;
  regime_label: string;
  pressure_score: number;
  stability_score: number;
  summary: string;
  groups: CommercialGroup[];
  symbols: CommercialSymbol[];
  factors: CommercialFactor[];
  metrics: CommercialMetrics;
  property_type_history: Array<Record<string, string | number | null>>;
  macro: {
    cre_price_yoy: DataPoint[];
    cre_loans: DataPoint[];
    cre_delinquency: DataPoint[];
    treasury_10y: DataPoint[];
    credit_spread: DataPoint[];
  };
  availability: {
    available_count: number;
    total_configured: number;
  };
  warnings: string[];
};

const GROUP_COLORS: Record<string, string> = {
  office: "#fb7185",
  industrial: "#38bdf8",
  retail: "#fbbf24",
  multifamily: "#a78bfa",
  digital: "#34d399",
};

const chartTooltip = {
  contentStyle: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 10,
    color: "#e2e8f0",
    fontSize: 12,
  },
  labelStyle: { color: "#94a3b8" },
};

function pressureTone(score: number) {
  if (score >= 60) return "text-rose-300";
  if (score <= 40) return "text-emerald-300";
  return "text-amber-300";
}

function stabilityTone(score: number) {
  if (score >= 60) return "text-emerald-400";
  if (score <= 40) return "text-rose-400";
  return "text-amber-400";
}

function changeTone(value: number | null | undefined) {
  if (value == null) return "text-stealth-500";
  if (value > 0) return "text-emerald-300";
  if (value < 0) return "text-rose-300";
  return "text-stealth-300";
}

function formatChange(value: number | null | undefined, decimals = 1) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function regimeBadgeStyle(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("stress") || lower.includes("pressure")) {
    return "border-rose-400/30 bg-rose-500/10 text-rose-300";
  }
  if (lower.includes("expansion") || lower.includes("stabilization")) {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";
  }
  return "border-amber-400/30 bg-amber-500/10 text-amber-300";
}

function nearestValue(points: DataPoint[], date: string) {
  if (!points.length) return null;
  const target = new Date(date).getTime();
  let nearest = points[0];
  let nearestDistance = Math.abs(new Date(nearest.date).getTime() - target);
  for (const point of points.slice(1)) {
    const distance = Math.abs(new Date(point.date).getTime() - target);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest.value;
}

function SectionHeader({ kicker, title, detail }: { kicker: string; title: string; detail: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stealth-500">{kicker}</p>
      <h2 className="mt-1 text-lg font-semibold text-stealth-100">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-stealth-400">{detail}</p>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  tone = "text-stealth-100",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-stealth-700 bg-stealth-900/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stealth-500">{label}</p>
      <p className={`mt-1.5 text-lg font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-stealth-400">{detail}</p>
    </div>
  );
}

function PropertyTypeChart({ data, groups }: { data: CommercialPayload["property_type_history"]; groups: CommercialGroup[] }) {
  if (!data.length) return null;
  return (
    <div className="surface-card p-3 sm:p-4">
      <SectionHeader
        kicker="Listed Breadth"
        title="Property-type performance"
        detail="Equal-weighted listed proxies, indexed to 100 at the start of the selected window. This separates office from logistics, retail, apartments, and digital infrastructure."
      />
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(date: string) => date.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} />
            <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 4" />
            <Tooltip
              {...chartTooltip}
              formatter={(value: number, name: string) => [value.toFixed(1), groups.find((group) => group.group === name)?.label ?? name]}
            />
            {groups.map((group) => (
              <Line
                key={group.group}
                type="monotone"
                dataKey={group.group}
                stroke={GROUP_COLORS[group.group] ?? "#94a3b8"}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {groups.map((group) => (
          <span key={group.group} className="inline-flex items-center gap-1.5 rounded-full border border-stealth-700 px-2 py-1 text-[11px] text-stealth-300">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: GROUP_COLORS[group.group] ?? "#94a3b8" }} />
            {group.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function CreditCycleChart({ price, delinquency }: { price: DataPoint[]; delinquency: DataPoint[] }) {
  const data = useMemo(
    () => price.map((point) => ({
      date: point.date,
      price: point.value,
      delinquency: nearestValue(delinquency, point.date),
    })),
    [delinquency, price],
  );

  if (!data.length) return null;
  return (
    <div className="surface-card p-3 sm:p-4">
      <SectionHeader
        kicker="Credit Fundamentals"
        title="Prices versus bank delinquencies"
        detail="Broad commercial-property price growth is paired with the delinquency rate on bank CRE loans. Falling prices alongside rising delinquencies is the clearest fundamental stress combination."
      />
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(date: string) => date.slice(0, 7)} />
            <YAxis {...commonYAxisProps} yAxisId="price" tickFormatter={(value: number) => `${value}%`} />
            <YAxis {...commonYAxisProps} yAxisId="delinquency" orientation="right" tickFormatter={(value: number) => `${value}%`} />
            <ReferenceLine yAxisId="price" y={0} stroke="#334155" strokeDasharray="4 4" />
            <Tooltip
              {...chartTooltip}
              formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name === "price" ? "CRE Prices YoY" : "CRE Delinquency"]}
            />
            <Line yAxisId="price" type="monotone" dataKey="price" stroke="#38bdf8" strokeWidth={2.2} dot={false} name="price" isAnimationActive={false} />
            <Line yAxisId="delinquency" type="monotone" dataKey="delinquency" stroke="#fb7185" strokeWidth={2} dot={false} name="delinquency" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LendingChart({ loans }: { loans: DataPoint[] }) {
  if (!loans.length) return null;
  return (
    <div className="surface-card p-3 sm:p-4">
      <SectionHeader
        kicker="Bank Exposure"
        title="Commercial-bank CRE loan balance"
        detail="Outstanding CRE loans at U.S. commercial banks. The balance is context for system exposure; growth by itself is not scored as healthy or unhealthy."
      />
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={loans} margin={CHART_MARGIN}>
            <CartesianGrid {...commonGridProps} />
            <XAxis {...commonXAxisProps} dataKey="date" tickFormatter={(date: string) => date.slice(0, 7)} />
            <YAxis {...commonYAxisProps} domain={["auto", "auto"]} tickFormatter={(value: number) => `$${(value / 1000).toFixed(1)}T`} />
            <Tooltip {...chartTooltip} formatter={(value: number) => [`$${value.toFixed(1)}B`, "CRE Loans"]} />
            <Line type="monotone" dataKey="value" stroke="#a78bfa" strokeWidth={2.2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function CommercialRealEstateTab({ days }: { days: number }) {
  const api = useApi<CommercialPayload>(`/real-estate/commercial?days=${days}`);

  if (api.loading && !api.data) {
    return <MarketLoading label="Loading commercial real-estate data..." />;
  }

  if (!api.data) {
    return (
      <div className="surface-card p-5 text-sm text-stealth-400">
        Commercial real-estate data unavailable. {api.error}
      </div>
    );
  }

  const data = api.data;
  const metrics = data.metrics;
  const orderedGroups = [...data.groups].sort((left, right) => right.score - left.score);
  const loanBalance = metrics.cre_loan_balance_bil;

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="surface-card-strong p-4 md:p-5">
        <div className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-stealth-500">Commercial Real Estate Stability</p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <p className={`text-4xl font-semibold ${stabilityTone(data.stability_score)}`}>{data.stability_score.toFixed(0)}</p>
              <span className={`mb-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${regimeBadgeStyle(data.regime_label)}`}>
                {data.regime_label}
              </span>
            </div>
            <div className="mt-2 h-2 w-56 max-w-full rounded-full bg-stealth-700">
              <div
                className={`h-2 rounded-full ${data.stability_score >= 60 ? "bg-emerald-500" : data.stability_score <= 40 ? "bg-rose-500" : "bg-amber-500"}`}
                style={{ width: `${data.stability_score}%` }}
              />
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-stealth-300">{data.summary}</p>
            <p className="mt-3 text-xs text-stealth-500">As of {new Date(data.as_of).toLocaleString()}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="CRE Prices"
              value={metrics.cre_price_yoy != null ? formatChange(metrics.cre_price_yoy) : "—"}
              tone={changeTone(metrics.cre_price_yoy)}
              detail="Year-over-year broad property price change"
            />
            <StatTile
              label="Loan Delinquency"
              value={metrics.cre_delinquency_rate != null ? `${metrics.cre_delinquency_rate.toFixed(2)}%` : "—"}
              tone={metrics.cre_delinquency_rate != null && metrics.cre_delinquency_rate >= 3 ? "text-rose-300" : "text-amber-300"}
              detail={metrics.cre_delinquency_delta_1y != null ? `${metrics.cre_delinquency_delta_1y > 0 ? "+" : ""}${metrics.cre_delinquency_delta_1y.toFixed(2)} pp vs one year ago` : "Quarterly bank CRE delinquency rate"}
            />
            <StatTile
              label="Bank CRE Loans"
              value={loanBalance != null ? `$${(loanBalance / 1000).toFixed(2)}T` : "—"}
              tone="text-violet-300"
              detail={metrics.cre_loan_growth_yoy != null ? `${formatChange(metrics.cre_loan_growth_yoy)} year over year` : "Outstanding commercial-bank exposure"}
            />
            <StatTile
              label="Funding Backdrop"
              value={metrics.treasury_10y != null ? `${metrics.treasury_10y.toFixed(2)}% 10Y` : "—"}
              tone={metrics.treasury_10y != null && metrics.treasury_10y >= 5 ? "text-rose-300" : "text-sky-300"}
              detail={metrics.credit_spread_bps != null ? `HY OAS ${metrics.credit_spread_bps.toFixed(0)} bps` : "Treasury and credit-spread context"}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader
          kicker="Pressure Map"
          title="What is driving the commercial read"
          detail="Higher scores mean more pressure. The top-line score combines listed property-type breadth, bank loan performance, property prices, and the funding backdrop."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.factors.map((factor) => (
            <div key={factor.key} className="surface-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-stealth-200">{factor.label}</p>
                  <p className="mt-1 text-[11px] text-stealth-500">{factor.weight.toFixed(0)}% of CRE pressure</p>
                </div>
                <p className={`text-xl font-semibold ${pressureTone(factor.score)}`}>{factor.score.toFixed(0)}</p>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-stealth-700">
                <div className="h-1.5 rounded-full bg-sky-500" style={{ width: `${factor.score}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader
          kicker="Property Types"
          title="Commercial is not one market"
          detail="Each basket uses three liquid listed proxies. Office is shown beside logistics, retail, apartments, and digital infrastructure instead of being treated as the commercial market by itself."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {orderedGroups.map((group) => (
            <div key={group.group} className="surface-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="mb-2 block h-1 w-8 rounded-full" style={{ backgroundColor: GROUP_COLORS[group.group] ?? "#94a3b8" }} />
                  <p className="text-sm font-semibold text-stealth-100">{group.label}</p>
                </div>
                <p className={`text-lg font-semibold ${pressureTone(group.score)}`}>{group.score.toFixed(0)}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-stealth-500">20D</p>
                  <p className={`mt-0.5 font-mono ${changeTone(group.changes["20d"])}`}>{formatChange(group.changes["20d"])}</p>
                </div>
                <div>
                  <p className="text-stealth-500">60D</p>
                  <p className={`mt-0.5 font-mono ${changeTone(group.changes["60d"])}`}>{formatChange(group.changes["60d"])}</p>
                </div>
              </div>
              <p className="mt-3 text-[10px] leading-4 text-stealth-500">{group.components.join(" · ")}</p>
            </div>
          ))}
        </div>
        <PropertyTypeChart data={data.property_type_history} groups={data.groups} />
      </div>

      <div className="space-y-3">
        <SectionHeader
          kicker="Fundamentals"
          title="Credit cycle and bank exposure"
          detail="Quarterly property prices and delinquencies provide the slower fundamental check beneath the daily listed-market signal."
        />
        <div className="grid items-start gap-3 md:gap-4 xl:grid-cols-2">
          <CreditCycleChart price={data.macro.cre_price_yoy} delinquency={data.macro.cre_delinquency} />
          <LendingChart loans={data.macro.cre_loans} />
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeader
          kicker="Constituents"
          title="Listed commercial real-estate proxies"
          detail="Price action is a timely market signal, not a direct appraisal or property-level valuation. Use the table to see which names are driving each property-type basket."
        />
        <div className="surface-card-strong overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-stealth-700 text-[10px] uppercase tracking-[0.12em] text-stealth-500">
              <tr>
                <th className="px-4 py-3">Property Type</th>
                <th className="px-3 py-3">Proxy</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 py-3 text-right">20D</th>
                <th className="px-3 py-3 text-right">60D</th>
                <th className="px-3 py-3 text-right">120D</th>
                <th className="px-4 py-3 text-right">Pressure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stealth-800">
              {[...data.symbols]
                .sort((left, right) => left.group.localeCompare(right.group) || right.momentum_score - left.momentum_score)
                .map((symbol) => (
                  <tr key={symbol.ticker} className="transition-colors hover:bg-stealth-800/60">
                    <td className="px-4 py-3 text-stealth-300">{data.groups.find((group) => group.group === symbol.group)?.label ?? symbol.group}</td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-stealth-100">{symbol.ticker}</p>
                      <p className="mt-0.5 text-[10px] text-stealth-500">{symbol.name}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-stealth-200">{symbol.current_price != null ? `$${symbol.current_price.toFixed(2)}` : "—"}</td>
                    <td className={`px-3 py-3 text-right font-mono ${changeTone(symbol.changes["20d"])}`}>{formatChange(symbol.changes["20d"])}</td>
                    <td className={`px-3 py-3 text-right font-mono ${changeTone(symbol.changes["60d"])}`}>{formatChange(symbol.changes["60d"])}</td>
                    <td className={`px-3 py-3 text-right font-mono ${changeTone(symbol.changes["120d"])}`}>{formatChange(symbol.changes["120d"])}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${pressureTone(symbol.momentum_score)}`}>{symbol.momentum_score.toFixed(0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          {data.warnings.join(" · ")}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] leading-5 text-stealth-500">
        <p>{data.availability.available_count}/{data.availability.total_configured} listed proxies available.</p>
        <p className="max-w-4xl text-right">
          Sources: Yahoo Finance listed proxies; FRED BOGZ1FL010000386Q, CREACBM027NBOG, DRCRELEXFACBS, DGS10, and BAMLH0A0HYM2.
        </p>
      </div>
    </div>
  );
}
