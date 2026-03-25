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

function GroupTable({ title, rows }: { title: string; rows: FlowSignal[] }) {
  return (
    <section className="rounded-xl border border-stealth-700 bg-stealth-850/60 p-4">
      <h2 className="mb-3 text-lg font-semibold text-stealth-100">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm text-stealth-200">
          <thead>
            <tr className="border-b border-stealth-700 text-left text-xs uppercase tracking-wide text-stealth-400">
              <th className="py-2 pr-3">Symbol</th>
              <th className="py-2 pr-3">Signal</th>
              <th className="py-2 pr-3">Confidence</th>
              <th className="py-2 pr-3">Last</th>
              <th className="py-2 pr-3">Buy Cluster</th>
              <th className="py-2 pr-3">Sell Cluster</th>
              <th className="py-2 pr-3">Net Flow</th>
              <th className="py-2 pr-3">Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.category}-${row.symbol}`} className="border-b border-stealth-800/80">
                <td className="py-2 pr-3 font-semibold text-stealth-100">{row.symbol}</td>
                <td className="py-2 pr-3"><SignalPill signal={row.signal} /></td>
                <td className="py-2 pr-3">{row.confidence.toFixed(1)}</td>
                <td className="py-2 pr-3">{formatCurrency(row.latest_price)}</td>
                <td className="py-2 pr-3">{formatCurrency(row.buy_cluster_level)}</td>
                <td className="py-2 pr-3">{formatCurrency(row.sell_cluster_level)}</td>
                <td className={`py-2 pr-3 ${row.net_flow_usd && row.net_flow_usd > 0 ? "text-emerald-300" : row.net_flow_usd && row.net_flow_usd < 0 ? "text-rose-300" : "text-stealth-300"}`}>
                  {formatCompactCurrency(row.net_flow_usd)}
                </td>
                <td className="py-2 pr-3">{row.event_count ?? row.recent_events.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function InstitutionalFlow() {
  const [stocksInput, setStocksInput] = useState("AAPL,MSFT,NVDA,AMZN,META,TSLA");
  const [submittedStocks, setSubmittedStocks] = useState(stocksInput);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({ lookback_days: "120" });
    if (submittedStocks.trim()) {
      params.set("stocks", submittedStocks);
    }
    return `/flow-signals/overview?${params.toString()}`;
  }, [submittedStocks]);

  const { data, loading, error } = useApi<FlowOverviewResponse>(endpoint);

  const groups = data?.groups ?? {};

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 text-stealth-100">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Institutional Flow Levels</h1>
          <p className="mt-1 text-sm text-stealth-300">
            Dark-pool style proxy for clustered accumulation/distribution across sectors, metals, crypto, and stocks.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedStocks(stocksInput);
          }}
          className="flex w-full gap-2 sm:w-auto"
        >
          <input
            value={stocksInput}
            onChange={(event) => setStocksInput(event.target.value.toUpperCase())}
            placeholder="AAPL,MSFT,NVDA"
            className="w-full rounded-md border border-stealth-600 bg-stealth-900 px-3 py-2 text-sm text-stealth-100 focus:border-pulse-500 focus:outline-none sm:w-[320px]"
          />
          <button
            type="submit"
            className="rounded-md bg-pulse-600 px-4 py-2 text-sm font-semibold text-white hover:bg-pulse-500"
          >
            Refresh
          </button>
        </form>
      </div>

      {loading && <MarketLoading label="Scanning for clustered institutional flow..." />}
      {error && <div className="rounded-lg border border-rose-700/50 bg-rose-900/20 p-3 text-rose-200">{error}</div>}

      {data && (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4">
              <h2 className="text-lg font-semibold text-emerald-300">Top Accumulation</h2>
              <div className="mt-3 space-y-2 text-sm">
                {data.leaders.accumulation.length === 0 && <p className="text-stealth-300">No strong accumulation signals yet.</p>}
                {data.leaders.accumulation.map((item) => (
                  <div key={`acc-${item.symbol}`} className="flex items-center justify-between rounded-md bg-stealth-900/50 px-3 py-2">
                    <span className="font-semibold text-stealth-100">{item.symbol}</span>
                    <span className="text-emerald-300">{formatCompactCurrency(item.net_flow_usd)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-rose-700/40 bg-rose-950/20 p-4">
              <h2 className="text-lg font-semibold text-rose-300">Top Distribution</h2>
              <div className="mt-3 space-y-2 text-sm">
                {data.leaders.distribution.length === 0 && <p className="text-stealth-300">No strong distribution signals yet.</p>}
                {data.leaders.distribution.map((item) => (
                  <div key={`dist-${item.symbol}`} className="flex items-center justify-between rounded-md bg-stealth-900/50 px-3 py-2">
                    <span className="font-semibold text-stealth-100">{item.symbol}</span>
                    <span className="text-rose-300">{formatCompactCurrency(item.net_flow_usd)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="mb-4 rounded-lg border border-stealth-700 bg-stealth-850/50 p-3 text-xs text-stealth-300">
            <p><strong>Method:</strong> {data.method.description}</p>
            <p className="mt-1"><strong>Important:</strong> {data.method.note}</p>
            <p className="mt-1">As of {new Date(data.as_of).toLocaleString()}</p>
          </div>

          <div className="grid gap-4">
            <GroupTable title="Sectors" rows={groups.sectors ?? []} />
            <GroupTable title="Precious Metals" rows={groups.metals ?? []} />
            <GroupTable title="Crypto" rows={groups.crypto ?? []} />
            <GroupTable title="Stocks" rows={groups.stocks ?? []} />
          </div>
        </>
      )}
    </div>
  );
}
