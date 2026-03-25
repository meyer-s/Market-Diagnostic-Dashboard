import { useMemo, useState } from "react";
import { useApi } from "../hooks/useApi";
import MarketLoading from "../components/ui/MarketLoading";

interface FlowEvent {
  date: string;
  price: number;
  volume: number;
  volume_z: number;
  clv: number;
  price_change_pct: number;
  notional: number;
  side: "buy" | "sell" | "neutral";
  strength: number;
}

interface FlowSignal {
  symbol: string;
  name: string;
  category: string;
  status: "ok" | "insufficient_data";
  signal: "accumulation" | "distribution" | "neutral";
  confidence: number;
  latest_price: number | null;
  buy_cluster_level: number | null;
  sell_cluster_level: number | null;
  distance_to_buy_pct?: number | null;
  distance_to_sell_pct?: number | null;
  buy_notional_usd?: number;
  sell_notional_usd?: number;
  net_flow_usd: number | null;
  event_count?: number;
  recent_events: FlowEvent[];
}

interface FlowOverviewResponse {
  as_of: string;
  groups: Record<string, FlowSignal[]>;
  leaders: {
    accumulation: FlowSignal[];
    distribution: FlowSignal[];
  };
  stock_selection?: {
    mode: string;
    symbols: string[];
    count: number;
  };
  method: {
    description: string;
    note: string;
  };
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 0 : 2,
  }).format(value);
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function SignalPill({ signal }: { signal: FlowSignal["signal"] }) {
  const styles =
    signal === "accumulation"
      ? "bg-emerald-900/30 text-emerald-300 border-emerald-700/50"
      : signal === "distribution"
        ? "bg-rose-900/30 text-rose-300 border-rose-700/50"
        : "bg-stealth-700 text-stealth-300 border-stealth-600";

  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${styles}`}>
      {signal}
    </span>
  );
}

function GroupBadge({ label, value, tone }: { label: string; value: string | number; tone?: "default" | "buy" | "sell" }) {
  const toneClass =
    tone === "buy"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : tone === "sell"
        ? "border-rose-700/40 bg-rose-950/30 text-rose-300"
        : "border-stealth-700 bg-stealth-900/70 text-stealth-200";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function FlowSignalCard({ row }: { row: FlowSignal }) {
  const flowTone = row.net_flow_usd && row.net_flow_usd > 0 ? "text-emerald-300" : row.net_flow_usd && row.net_flow_usd < 0 ? "text-rose-300" : "text-stealth-300";

  return (
    <article className="rounded-2xl border border-stealth-700 bg-[linear-gradient(180deg,rgba(19,27,40,0.98),rgba(11,17,28,0.96))] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-stealth-100">{row.symbol}</div>
          <div className="text-xs uppercase tracking-[0.18em] text-stealth-500">{row.category}</div>
        </div>
        <SignalPill signal={row.signal} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-stealth-500">Last</div>
          <div className="mt-1 font-medium text-stealth-100">{formatCurrency(row.latest_price)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-stealth-500">Confidence</div>
          <div className="mt-1 font-medium text-stealth-100">{row.confidence.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-stealth-500">Buy Cluster</div>
          <div className="mt-1 font-medium text-emerald-300">{formatCurrency(row.buy_cluster_level)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-stealth-500">Sell Cluster</div>
          <div className="mt-1 font-medium text-rose-300">{formatCurrency(row.sell_cluster_level)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-stealth-900/70 p-3">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-stealth-500">
          <span>Net Flow</span>
          <span>Events {row.event_count ?? row.recent_events.length}</span>
        </div>
        <div className={`mt-2 text-base font-semibold ${flowTone}`}>{formatCompactCurrency(row.net_flow_usd)}</div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-stealth-800">
          <div
            className={`h-full rounded-full ${row.signal === "accumulation" ? "bg-emerald-400/80" : row.signal === "distribution" ? "bg-rose-400/80" : "bg-stealth-500/70"}`}
            style={{ width: `${Math.max(8, Math.min(100, row.confidence))}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2 text-xs">
        <GroupBadge label="To Buy" value={formatPercent(row.distance_to_buy_pct)} tone="buy" />
        <GroupBadge label="To Sell" value={formatPercent(row.distance_to_sell_pct)} tone="sell" />
      </div>
    </article>
  );
}

function GroupSection({
  title,
  rows,
  open,
  onToggle,
}: {
  title: string;
  rows: FlowSignal[];
  open: boolean;
  onToggle: () => void;
}) {
  const accumulationCount = rows.filter((row) => row.signal === "accumulation").length;
  const distributionCount = rows.filter((row) => row.signal === "distribution").length;
  const strongest = [...rows].sort((left, right) => (right.confidence - left.confidence))[0];

  return (
    <section className="rounded-3xl border border-stealth-700 bg-[radial-gradient(circle_at_top,rgba(31,49,73,0.45),rgba(12,17,27,0.98)_60%)] p-4 sm:p-5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div>
          <h2 className="text-xl font-semibold text-stealth-100">{title}</h2>
          <p className="mt-1 text-sm text-stealth-400">
            {strongest ? `Highest conviction: ${strongest.symbol} at ${strongest.confidence.toFixed(1)}` : "No active signals in this group."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GroupBadge label="Accumulations" value={accumulationCount} tone="buy" />
          <GroupBadge label="Distributions" value={distributionCount} tone="sell" />
          <div className="rounded-full border border-stealth-600 p-2 text-stealth-300">
            <svg className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      </button>

      {open && (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <FlowSignalCard key={`${row.category}-${row.symbol}`} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

function LeadersPanel({ title, items, tone }: { title: string; items: FlowSignal[]; tone: "buy" | "sell" }) {
  const sectionClass = tone === "buy"
    ? "border-emerald-700/40 bg-emerald-950/20"
    : "border-rose-700/40 bg-rose-950/20";
  const textClass = tone === "buy" ? "text-emerald-300" : "text-rose-300";

  return (
    <section className={`rounded-3xl border p-4 sm:p-5 ${sectionClass}`}>
      <h2 className={`text-lg font-semibold ${textClass}`}>{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-sm text-stealth-300">No strong signals yet.</p>}
        {items.map((item, index) => (
          <div key={`${title}-${item.symbol}`} className="flex items-center justify-between rounded-xl bg-stealth-900/50 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-stealth-500">#{index + 1}</div>
              <div className="mt-1 font-semibold text-stealth-100">{item.symbol}</div>
            </div>
            <div className="text-right">
              <div className={`font-semibold ${textClass}`}>{formatCompactCurrency(item.net_flow_usd)}</div>
              <div className="text-xs text-stealth-400">confidence {item.confidence.toFixed(1)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function InstitutionalFlow() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sectors: true,
    metals: false,
    crypto: false,
    stocks: true,
  });

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({ lookback_days: "120" });
    return `/flow-signals/overview?${params.toString()}`;
  }, []);

  const { data, loading, error } = useApi<FlowOverviewResponse>(endpoint);

  const groups = data?.groups ?? {};
  const totalAccumulations = Object.values(groups).flat().filter((row) => row.signal === "accumulation").length;
  const totalDistributions = Object.values(groups).flat().filter((row) => row.signal === "distribution").length;
  const totalSignals = Object.values(groups).flat().length;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 text-stealth-100">
      <div className="mb-6 rounded-[28px] border border-stealth-700 bg-[radial-gradient(circle_at_top_left,rgba(58,94,138,0.45),rgba(13,18,29,0.98)_55%)] p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-stealth-400">Institutional Flow</div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Clustered Volume Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-stealth-300">
            Dark-pool style proxy for clustered accumulation/distribution across sectors, metals, crypto, and stocks.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <GroupBadge label="Signals" value={totalSignals} />
            <GroupBadge label="Accumulations" value={totalAccumulations} tone="buy" />
            <GroupBadge label="Distributions" value={totalDistributions} tone="sell" />
          </div>
        </div>

        {!!data?.stock_selection?.symbols?.length && (
          <div className="mt-5 rounded-2xl border border-stealth-700 bg-stealth-950/55 p-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-stealth-500">Auto-selected stock basket</div>
            <div className="mt-2 text-sm text-stealth-200">
              Top {data.stock_selection.count} stocks by close dollar volume: <span className="font-semibold text-stealth-100">{data.stock_selection.symbols.join(", ")}</span>
            </div>
          </div>
        )}
      </div>

      {loading && <MarketLoading label="Scanning for clustered institutional flow..." />}
      {error && <div className="rounded-lg border border-rose-700/50 bg-rose-900/20 p-3 text-rose-200">{error}</div>}

      {data && (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <LeadersPanel title="Top Accumulation" items={data.leaders.accumulation} tone="buy" />
            <LeadersPanel title="Top Distribution" items={data.leaders.distribution} tone="sell" />
          </div>

          <div className="mb-5 rounded-2xl border border-stealth-700 bg-stealth-850/50 p-4 text-xs text-stealth-300">
            <p><strong>Method:</strong> {data.method.description}</p>
            <p className="mt-1"><strong>Important:</strong> {data.method.note}</p>
            <p className="mt-1">As of {new Date(data.as_of).toLocaleString()}</p>
          </div>

          <div className="grid gap-4">
            <GroupSection
              title="Sectors"
              rows={groups.sectors ?? []}
              open={!!openSections.sectors}
              onToggle={() => setOpenSections((current) => ({ ...current, sectors: !current.sectors }))}
            />
            <GroupSection
              title="Precious Metals"
              rows={groups.metals ?? []}
              open={!!openSections.metals}
              onToggle={() => setOpenSections((current) => ({ ...current, metals: !current.metals }))}
            />
            <GroupSection
              title="Crypto"
              rows={groups.crypto ?? []}
              open={!!openSections.crypto}
              onToggle={() => setOpenSections((current) => ({ ...current, crypto: !current.crypto }))}
            />
            <GroupSection
              title="Stocks"
              rows={groups.stocks ?? []}
              open={!!openSections.stocks}
              onToggle={() => setOpenSections((current) => ({ ...current, stocks: !current.stocks }))}
            />
          </div>
        </>
      )}
    </div>
  );
}
