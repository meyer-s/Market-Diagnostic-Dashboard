import { useMemo, useState } from "react";
import { useApi } from "../hooks/useApi";
import MarketLoading from "../components/ui/MarketLoading";
import PriceVolumeDetail from "../features/price-volume/PriceVolumeDetail";
import { money, percent, refreshTime, sessionDate } from "../features/price-volume/format";
import type { PriceVolumeSignal } from "../features/price-volume/types";

interface ActivityOverview {
  as_of: string;
  groups: Record<string, PriceVolumeSignal[]>;
  leaders: { positive: PriceVolumeSignal[]; negative: PriceVolumeSignal[] };
  stock_selection: { mode: string; symbols: string[]; count: number; candidate_count: number; note: string };
  method: { name: string; description: string; note: string; source: string; turnover_units: string; bar_timing: string; window_start: string; window_end: string; thresholds: { lookback_calendar_days: number } };
}
const groupTitles = { stocks: "Stocks", sectors: "Sector ETFs", metals: "Metals & mining funds", crypto: "Crypto" };
type GroupKey = keyof typeof groupTitles;
const groupKeys = Object.keys(groupTitles) as GroupKey[];

export default function InstitutionalFlow() {
  const { data, loading, error, refetch } = useApi<ActivityOverview>("/flow-signals/overview?lookback_days=120");
  const [selection, setSelection] = useState<{ group: GroupKey; symbol: string } | null>(null);
  const rows = useMemo(() => Object.values(data?.groups ?? {}).flat(), [data]);
  const selected = useMemo(() => {
    if (selection) {
      const match = data?.groups[selection.group]?.find(row => row.symbol === selection.symbol);
      if (match) return match;
    }
    return [...rows].sort((a, b) => (b.latest_event_date ?? "").localeCompare(a.latest_event_date ?? "") || (b.mean_volume_z ?? 0) - (a.mean_volume_z ?? 0))[0];
  }, [selection, data, rows]);
  const usable = rows.filter(row => row.status === "ok").length;

  return <div className="page-shell-wide text-stealth-100">
    <section className="page-hero mb-5">
      <p className="page-kicker">Evidence workspace</p>
      <h1 className="page-title">Unusual Volume &amp; Price Pressure</h1>
      <p className="page-subtitle">Find unusually active days across stocks, sector ETFs, metals funds, and crypto. Select a symbol to inspect its price-volume evidence.</p>
      <div className="page-meta">
        <span className="page-badge">Refreshed {refreshTime(data?.as_of)}</span>
        <span className="page-badge">{usable}/{rows.length} symbols with baseline history</span>
        <span className="page-badge">{data?.method.thresholds.lookback_calendar_days ?? 120} calendar days</span>
        <button type="button" className="page-badge min-h-11" disabled={loading} onClick={refetch}>Refresh</button>
      </div>
      <p className="mt-3 text-sm text-stealth-300">Daily bar patterns describe trading activity; they do not establish who traded or net institutional buying.</p>
    </section>
    {loading && !data && <MarketLoading label="Loading price and volume evidence…" />}
    {loading && data && <p role="status" className="mb-3 text-sm">Refreshing price-volume evidence…</p>}
    {error && <div className="surface-card mb-4 p-4 text-rose-200" role="alert">{error}{data ? " Previously loaded evidence remains visible." : ""}<button type="button" onClick={refetch} className="ml-3 min-h-11 underline">Try again</button></div>}
    {data && <>
      <section aria-labelledby="pressure-leaders" className="mb-5">
        <h2 id="pressure-leaders" className="text-xl font-semibold">Flagged turnover balance</h2>
        <p className="mt-1 text-xs text-stealth-300">Ranked by positive/negative turnover balance over the full window, then flagged-day count. A single day can dominate.</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">{(["positive", "negative"] as const).map(direction => <div key={direction} className="surface-card p-3">
          <h3 className="text-sm font-semibold">{direction === "positive" ? "Positive-bar balance" : "Negative-bar balance"}</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{data.leaders[direction].slice(0, 4).map(row => <button key={row.symbol} type="button" className="surface-card-muted min-h-11 p-3 text-left" onClick={() => setSelection({ group: row.category as GroupKey, symbol: row.symbol })}>
            <div className="flex justify-between gap-2 font-semibold"><span>{row.symbol.replace(/-USD$/, "")}</span><span>{percent(row.pressure_balance_pct)}</span></div>
            <div className="mt-1 text-xs text-stealth-300">{row.event_count} flagged days · latest {sessionDate(row.latest_event_date)}</div>
          </button>)}</div>
          {!data.leaders[direction].length && <p className="mt-2 text-sm text-stealth-300">No {direction}-bar balance in this window.</p>}
        </div>)}</div>
      </section>
      <section aria-labelledby="activity-evidence">
        <h2 id="activity-evidence" className="mb-3 text-xl font-semibold">Activity groups and selected detail</h2>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
          <div className="order-2 space-y-4 xl:order-1">{groupKeys.map(group => {
            const members = data.groups[group] ?? [];
            const scale = Math.max(1, ...members.map(row => row.total_turnover_usd));
            return <section key={group} className="surface-card p-4" aria-labelledby={`group-${group}`}>
              <h3 id={`group-${group}`} className="text-lg font-semibold">{groupTitles[group]}</h3>
              {group === "stocks" && <details className="mt-2 text-xs text-stealth-300"><summary className="cursor-pointer">{data.stock_selection.mode === "manual" ? "Selected stock basket" : `Top ${data.stock_selection.count} of ${data.stock_selection.candidate_count} candidate stocks`}</summary><p className="mt-2">{data.stock_selection.note} {data.stock_selection.symbols.join(", ")}</p></details>}
              <p className="mt-2 text-xs text-stealth-300">Circle size: flagged turnover within this group. Each group has its own size scale.</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-3">{members.map(row => {
                const size = 88 + Math.sqrt(row.total_turnover_usd / scale) * 26;
                const active = selected?.symbol === row.symbol && selected.category === row.category;
                const tone = row.pressure === "positive" ? "border-emerald-400" : row.pressure === "negative" ? "border-rose-400" : "border-stealth-400";
                return <button key={row.symbol} type="button" aria-pressed={active} aria-label={`${row.symbol}, ${row.pressure}-bar balance, ${row.event_count} flagged days, ${money(row.total_turnover_usd, true)} turnover`} onClick={() => setSelection({ group, symbol: row.symbol })} style={{ width: size, height: size }} className={`flex shrink-0 flex-col items-center justify-center rounded-full border-2 bg-stealth-950 p-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 ${tone} ${active ? "ring-2 ring-white ring-offset-2 ring-offset-stealth-900" : ""}`}>
                  <span className="text-sm font-semibold">{row.symbol.replace(/-USD$/, "")}</span><span className="mt-1 text-xs">{row.status !== "ok" ? "Limited history" : row.pressure}</span><span className="mt-1 text-xs">{money(row.total_turnover_usd, true)}</span><span className="mt-1 text-xs text-stealth-300">{row.event_count} flagged days</span>
                </button>;
              })}</div>
              {!members.length && <p className="mt-3 text-sm text-stealth-300">No symbols available.</p>}
            </section>;
          })}</div>
          <div className="order-1 min-w-0 xl:order-2">{selected ? <PriceVolumeDetail signal={selected} /> : <p className="surface-card p-4">No symbol evidence available.</p>}</div>
        </div>
      </section>
      <section className="surface-card mt-5 p-4" aria-labelledby="activity-method">
        <h2 id="activity-method" className="text-lg font-semibold">How to read price &amp; volume evidence</h2>
        <p className="mt-2 text-sm text-stealth-200">{data.method.description}</p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Method, units &amp; source coverage</summary>
          <div className="mt-3 space-y-2 text-stealth-300"><p>{data.method.note}</p><p>{data.method.turnover_units}</p><p>{data.method.bar_timing}</p>
            <p>All symbols share {sessionDate(data.method.window_start)}–{sessionDate(data.method.window_end)}. The baseline uses the 20 earlier observed bars, excluding the flagged day. Missing or constant baselines cannot produce a z-score.</p>
            <p>Source: {data.method.source}. Method: {data.method.name}.</p>
            <p>Metals funds include physical-metal products and mining-equity funds. Raw turnover is instrument-specific and does not measure institutional participation.</p>
            <p>Fund creations/redemptions and investor holdings require separate source data; this view does not supply them.</p>
            <a className="inline-block min-h-11 underline" href="https://finance.yahoo.com/markets/crypto/all/" target="_blank" rel="noopener noreferrer">Yahoo volume definitions ↗</a>
          </div>
        </details>
      </section>
    </>}
    {!loading && !error && !data && <p role="status" className="surface-card p-4">No price-volume evidence is available.</p>}
  </div>;
}