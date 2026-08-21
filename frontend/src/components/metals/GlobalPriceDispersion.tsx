import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Clock3, Database, RefreshCw, Scale, X } from "lucide-react";

import { useApi } from "../../hooks/useApi";

/*
THESIS: Price differences earn meaning through visible evidence; this refuses a wall of exchange cards that flattens incompatible instruments.
OWN-WORLD: An Evidence Field rail uses a dark measured plane, one centered reference rule, compact status marks, and warm metal accents only on verified observations.
STORY: Scan venue coverage, identify the reference, select a row, then verify the instrument and unexplained basis before treating a gap as comparable.
FIRST VIEWPORT: Controls and an evidence summary lead into a ranked rail; the selected venue's receipt sits beside it on desktop and directly below on mobile.
FORM: Evidence rail, first choice; staged as scan, compare, explain within the established Operate surface. Seed key: established-route extension.
*/

type ComparabilityStatus = "reference" | "reference_only" | "comparable" | "adjusted" | "headline_only" | "unavailable";

interface VenueObservation {
  registry_id: string;
  venue: string;
  country: string;
  market_type: string;
  product_name: string;
  symbol: string | null;
  contract_month: string | null;
  local_price: number | null;
  currency: string;
  native_currency: string;
  native_unit: string;
  contract_size: string | null;
  fx_rate_local_per_usd: number | null;
  fx_timestamp: string | null;
  normalized_price: number | null;
  premium_pct: number | null;
  premium_type: "comparable_premium" | "headline_gap" | null;
  price_type: string | null;
  quote_timestamp: string | null;
  session_status: string;
  freshness_status: "fresh" | "delayed" | "stale" | "unknown" | "unavailable";
  quote_age_hours: number | null;
  data_delay: string;
  volume: number | null;
  open_interest: number | null;
  liquidity_tier: string;
  purity: string | null;
  delivery_location: string | null;
  tax_basis: string;
  source_name: string;
  redistribution_status: string;
  availability_status: "observed" | "unavailable";
  comparability_status: ComparabilityStatus;
  comparability_reasons: string[];
  decomposition: {
    reference_price: number | null;
    fx_conversion_pct: number | null;
    carry_adjustment_pct: number | null;
    tax_adjustment_pct: number | null;
    delivery_adjustment_pct: number | null;
    unexplained_basis_pct: number | null;
  } | null;
}

interface DispersionResponse {
  as_of: string;
  metal: string;
  metal_name: string;
  canonical_currency: string;
  canonical_unit: string;
  comparison_ready: boolean;
  controls: {
    comparison_time_requested: string;
    comparison_time_applied: string;
    reference_requested: string;
    reference_resolution: string;
    basis_requested: string;
    basis_applied: string;
  };
  reference: {
    registry_id: string | null;
    label: string;
    normalized_price: number | null;
  };
  summary: {
    global_median: number | null;
    highest: { venue: string; price: number } | null;
    lowest: { venue: string; price: number } | null;
    dispersion_pct: number | null;
    registered_venues: number;
    observed_venues: number;
    comparable_venues: number;
    status_counts: {
      fresh: number;
      delayed: number;
      stale: number;
      unavailable: number;
      session_unverified: number;
    };
  };
  venues: VenueObservation[];
  limitations: string[];
  method: {
    normalization: string;
    premium: string;
    comparability_rule: string;
    license_rule: string;
  };
  supported_metals: Array<{ metal: string; name: string; canonical_unit: string }>;
}

const DEFAULT_METALS = [
  { metal: "AG", name: "Silver" },
  { metal: "AU", name: "Gold" },
  { metal: "PT", name: "Platinum" },
  { metal: "PD", name: "Palladium" },
  { metal: "CU", name: "Copper" },
  { metal: "AL", name: "Aluminum" },
];

const STATUS_LABELS: Record<ComparabilityStatus, { mark: string; label: string; className: string }> = {
  reference: { mark: "●", label: "Reference", className: "text-amber-200" },
  reference_only: { mark: "○", label: "Reference only", className: "text-orange-200" },
  comparable: { mark: "●", label: "Comparable", className: "text-emerald-200" },
  adjusted: { mark: "◆", label: "Adjusted", className: "text-sky-200" },
  headline_only: { mark: "○", label: "Headline only", className: "text-orange-200" },
  unavailable: { mark: "×", label: "Feed unavailable", className: "text-stealth-300" },
};

function formatTimestamp(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
}

function priceDigits(unit: string): number {
  if (unit === "lb") return 4;
  if (unit === "metric tonne") return 0;
  return 2;
}

function formatCanonical(value: number | null, currency: string, unit: string): string {
  if (value == null) return "Not available";
  return `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: priceDigits(unit),
    maximumFractionDigits: priceDigits(unit),
  })} per ${unit}`;
}

function formatLocal(row: VenueObservation): string {
  if (row.local_price == null) return "Not connected";
  return `${row.currency} ${row.local_price.toLocaleString("en-US", { maximumFractionDigits: 4 })} per ${row.native_unit}`;
}

function formatGap(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) < 0.005) return "Reference 0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function freshnessLabel(row: VenueObservation): string {
  if (row.availability_status === "unavailable") return "No quote";
  if (row.quote_age_hours == null) return "Age unknown";
  const age = row.quote_age_hours < 48
    ? `${Math.max(1, Math.round(row.quote_age_hours))}h old`
    : `${Math.round(row.quote_age_hours / 24)}d old`;
  return `${row.freshness_status} · ${age}`;
}

function formatFx(row: VenueObservation): string {
  if (row.fx_rate_local_per_usd == null) return "FX rate not connected";
  return `${row.fx_rate_local_per_usd.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${row.currency} per USD · ${formatTimestamp(row.fx_timestamp)}`;
}

function DetailValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-stealth-800 py-2.5 last:border-b-0">
      <dt className="text-xs text-stealth-400">{label}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed text-stealth-100">{children}</dd>
    </div>
  );
}

function BasisValue({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-stealth-800 py-2 text-xs last:border-b-0">
      <span className="text-stealth-300">{label}</span>
      <span className={value == null ? "text-orange-200" : "font-semibold text-stealth-100"}>
        {value == null ? "Unexplained / not sourced" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}
      </span>
    </div>
  );
}

export default function GlobalPriceDispersion() {
  const [metal, setMetal] = useState("AG");
  const [comparisonTime, setComparisonTime] = useState("latest_available");
  const [reference, setReference] = useState("auto");
  const [basis, setBasis] = useState("raw_converted");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailRef = useRef<HTMLElement | null>(null);

  const endpoint = `/precious-metals/global-price-dispersion?${new URLSearchParams({
    metal,
    comparison_time: comparisonTime,
    reference,
    basis,
  }).toString()}`;
  const { data, loading, error, refetch } = useApi<DispersionResponse>(endpoint, { retainPreviousData: false });

  useEffect(() => {
    if (!data?.venues.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => data.venues.some((row) => row.registry_id === current)
      ? current
      : (data.venues.find((row) => row.availability_status === "observed") ?? data.venues[0]).registry_id);
    setShowAll(false);
    setDetailOpen(false);
  }, [data]);

  useEffect(() => {
    if (!detailOpen || !selectedId || typeof window.matchMedia !== "function") return undefined;
    if (!window.matchMedia("(max-width: 1279px)").matches) return undefined;
    const frame = window.requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailOpen, selectedId]);

  const closeDetail = () => {
    setDetailOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-venue-id="${selectedId}"]`)?.focus();
    });
  };

  const selected = data?.venues.find((row) => row.registry_id === selectedId) ?? null;
  const observedPremiums = data?.venues
    .map((row) => row.premium_pct)
    .filter((value): value is number => value != null) ?? [];
  const premiumDomain = Math.max(1, ...observedPremiums.map((value) => Math.abs(value))) * 1.15;
  const visibleRows = showAll ? data?.venues ?? [] : data?.venues.slice(0, 4) ?? [];
  const metalOptions = data?.supported_metals ?? DEFAULT_METALS.map((item) => ({ ...item, canonical_unit: "" }));

  const statusText = useMemo(() => {
    if (!data) return "Coverage unavailable";
    if (data.comparison_ready) return `${data.summary.comparable_venues} matched venues`;
    if (data.summary.observed_venues === 0) return "Registry only · no connected quote";
    return `${data.summary.observed_venues} connected observation · comparison not ready`;
  }, [data]);

  return (
    <section id="global-price-dispersion" className="section-anchor surface-card-strong overflow-hidden" aria-labelledby="global-dispersion-heading">
      <div className="border-b border-stealth-700 px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="global-dispersion-heading" className="text-lg font-bold text-white md:text-xl">Global Price Dispersion</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-stealth-600 bg-stealth-900 px-2.5 py-1 text-xs font-semibold text-stealth-200">
                <Database size={13} aria-hidden="true" /> {statusText}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-stealth-300">Normalized venue evidence. A converted gap is only promoted to comparable after its contract, time, and basis match.</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Dispersion controls">
            <label className="text-xs text-stealth-300">
              Metal
              <select value={metal} onChange={(event) => { setMetal(event.target.value); setReference("auto"); }} className="mt-1 min-h-11 w-full rounded-xl border border-stealth-600 bg-stealth-950 px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                {metalOptions.map((item) => <option key={item.metal} value={item.metal}>{item.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-stealth-300">
              Comparison time
              <select value={comparisonTime} onChange={(event) => setComparisonTime(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-stealth-600 bg-stealth-950 px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                <option value="latest_available">Latest available</option>
                <option value="common_timestamp" disabled>Common timestamp · needs feeds</option>
                <option value="daily_settlement" disabled>Daily settlement · needs feeds</option>
              </select>
            </label>
            <label className="text-xs text-stealth-300">
              Reference
              <select value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-stealth-600 bg-stealth-950 px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                <option value="auto">Auto · best observed</option>
                {data?.venues.filter((row) => row.availability_status === "observed").map((row) => (
                  <option key={row.registry_id} value={row.registry_id}>{row.venue}</option>
                ))}
                <option value="global_median" disabled={!data?.comparison_ready}>Global median</option>
              </select>
            </label>
            <label className="text-xs text-stealth-300">
              Basis
              <select value={basis} onChange={(event) => setBasis(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-stealth-600 bg-stealth-950 px-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                <option value="raw_converted">Raw converted</option>
                <option value="tax_adjusted" disabled>Tax-adjusted · inputs missing</option>
                <option value="delivery_adjusted" disabled>Delivery-adjusted · inputs missing</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-10 md:px-5" role="status">
          <div className="h-1 w-full overflow-hidden rounded-full bg-stealth-800"><div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" /></div>
          <p className="mt-3 text-sm text-stealth-300">Loading registered venues and quote evidence…</p>
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-6 md:px-5" role="alert">
          <div className="flex items-start gap-3 text-red-100"><AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" /><div><div className="font-semibold">Venue comparison could not load</div><div className="mt-1 text-sm text-red-200">{error}</div></div></div>
          <button type="button" onClick={refetch} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-400/60 px-3 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200"><RefreshCw size={15} aria-hidden="true" /> Try again</button>
        </div>
      ) : !data ? (
        <div className="px-4 py-8 text-sm text-stealth-300 md:px-5">No registry response was returned.</div>
      ) : (
        <>
          <dl className="grid grid-cols-2 border-b border-stealth-700 bg-stealth-950/35 xl:grid-cols-4">
            <div className="border-b border-r border-stealth-800 px-4 py-3 xl:border-b-0 md:px-5"><dt className="text-xs text-stealth-400">Coverage</dt><dd className="mt-1 text-sm font-semibold text-white">{data.summary.observed_venues} observed / {data.summary.registered_venues} registered</dd></div>
            <div className="border-b border-stealth-800 px-4 py-3 xl:border-b-0 xl:border-r md:px-5"><dt className="text-xs text-stealth-400">Reference</dt><dd className="mt-1 text-sm font-semibold text-white">{data.reference.label} · {formatCanonical(data.reference.normalized_price, data.canonical_currency, data.canonical_unit)}</dd></div>
            <div className="border-r border-stealth-800 px-4 py-3 md:px-5"><dt className="text-xs text-stealth-400">Median / credible range</dt><dd className="mt-1 text-sm font-semibold text-white">{data.comparison_ready && data.summary.dispersion_pct != null ? `${formatCanonical(data.summary.global_median, data.canonical_currency, data.canonical_unit)} · ${data.summary.dispersion_pct.toFixed(2)}% · ${data.summary.lowest?.venue} to ${data.summary.highest?.venue}` : "Needs two matched venues"}</dd></div>
            <div className="px-4 py-3 md:px-5"><dt className="text-xs text-stealth-400">Quote state</dt><dd className="mt-1 text-sm font-semibold text-white">{data.summary.status_counts.fresh} fresh · {data.summary.status_counts.stale + data.summary.status_counts.delayed} aged · {data.summary.status_counts.unavailable} unavailable</dd></div>
          </dl>

          {!data.comparison_ready && (
            <div className="flex items-start gap-2 border-b border-amber-700/40 bg-amber-950/20 px-4 py-2.5 text-sm text-amber-100 md:px-5" role="status">
              <Scale className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
              <span>Coverage is not comparison-ready. Dispersion, high/low, and median stay blank until a second matched feed is connected.</span>
            </div>
          )}

          <div className="grid xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
            <div className="min-w-0 border-b border-stealth-700 xl:border-b-0 xl:border-r">
              <div className="hidden grid-cols-[minmax(150px,0.7fr)_minmax(250px,1.3fr)_120px] gap-3 border-b border-stealth-800 px-4 py-2 text-xs text-stealth-400 md:grid md:px-5">
                <span>Venue / instrument</span>
                <span className="text-center">Normalized premium vs {data.reference.label}</span>
                <span className="text-right">Evidence state</span>
              </div>

              <div role="group" aria-label={`${data.metal_name} venue price ranking; reference ${data.reference.label}; ${data.controls.comparison_time_applied.replace(/_/g, " ")}; response as of ${formatTimestamp(data.as_of)}`}>
                {visibleRows.map((row) => {
                  const status = STATUS_LABELS[row.comparability_status];
                  const position = row.premium_pct == null ? null : 50 + (row.premium_pct / (premiumDomain * 2)) * 100;
                  const isSelected = selected?.registry_id === row.registry_id;
                  return (
                    <button
                      key={row.registry_id}
                      type="button"
                      aria-pressed={isSelected}
                      aria-controls="global-dispersion-detail"
                      data-venue-id={row.registry_id}
                      onClick={() => { setSelectedId(row.registry_id); setDetailOpen(true); }}
                      className={`grid min-h-[78px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-stealth-800 px-4 py-3 text-left transition last:border-b-0 md:grid-cols-[minmax(150px,0.7fr)_minmax(250px,1.3fr)_120px] md:px-5 ${isSelected ? "bg-blue-500/10 shadow-[inset_3px_0_0_0_rgba(96,165,250,0.9)]" : "hover:bg-stealth-800/45"} focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2"><span className="font-semibold text-white">{row.venue}</span><span className="text-xs text-stealth-400">{row.country}</span></div>
                        <div className="mt-1 truncate text-xs text-stealth-300">{row.product_name}{row.symbol ? ` · ${row.symbol}` : ""}</div>
                      </div>

                      <div className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
                        {row.normalized_price != null && position != null ? (
                          <div>
                            <div className="relative h-6" aria-hidden="true">
                              <div className="absolute inset-x-0 top-1/2 h-px bg-stealth-700" />
                              <div className="absolute bottom-0 top-0 left-1/2 w-px bg-stealth-400" />
                              <span className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg leading-none ${status.className}`} style={{ left: `${Math.max(2, Math.min(98, position))}%` }}>{status.mark}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-stealth-100">{formatCanonical(row.normalized_price, data.canonical_currency, data.canonical_unit)}</span><span className={status.className}>{formatGap(row.premium_pct)}</span></div>
                          </div>
                        ) : (
                          <div className="flex h-9 items-center justify-center border-y border-dashed border-stealth-800 text-xs text-stealth-400">Registered · quote feed not connected</div>
                        )}
                      </div>

                      <div className="text-right">
                        <div className={`text-xs font-semibold ${status.className}`}><span aria-hidden="true">{status.mark}</span> {status.label}</div>
                        <div className="mt-1 flex items-center justify-end gap-1 text-xs text-stealth-400"><Clock3 size={12} aria-hidden="true" /> {freshnessLabel(row)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {data.venues.length > 4 && (
                <button type="button" onClick={() => setShowAll((value) => !value)} className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-stealth-700 px-4 text-sm font-semibold text-stealth-200 hover:bg-stealth-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300" aria-expanded={showAll}>
                  {showAll ? "Show core venues" : `Show all ${data.venues.length} registered venues`}<ChevronDown size={15} className={showAll ? "rotate-180" : ""} aria-hidden="true" />
                </button>
              )}
            </div>

            <aside ref={detailRef} id="global-dispersion-detail" tabIndex={-1} className={`${detailOpen ? "block" : "hidden"} scroll-mt-20 bg-stealth-950/35 px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 md:px-5 xl:block`} aria-label="Selected venue evidence drawer">
              {selected ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="text-xs text-stealth-400">Selected venue</div><h3 className="mt-1 text-base font-bold text-white">{selected.venue} · {selected.product_name}</h3></div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className={`text-xs font-semibold ${STATUS_LABELS[selected.comparability_status].className}`}><span aria-hidden="true">{STATUS_LABELS[selected.comparability_status].mark}</span> {STATUS_LABELS[selected.comparability_status].label}</span>
                      <button type="button" onClick={closeDetail} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-stealth-600 px-3 text-xs font-semibold text-stealth-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 xl:hidden"><X size={14} aria-hidden="true" /> Close</button>
                    </div>
                  </div>

                  <dl className="mt-3">
                    <DetailValue label="Instrument">{selected.symbol ?? "Symbol not connected"} · {selected.market_type}{selected.contract_month ? ` · ${selected.contract_month}` : " · contract month unavailable"}</DetailValue>
                    <DetailValue label="Native quote">{formatLocal(selected)}</DetailValue>
                    <DetailValue label="FX conversion">{formatFx(selected)}</DetailValue>
                    <DetailValue label="Contract size">{selected.contract_size ?? "Contract size not verified"}</DetailValue>
                    <DetailValue label={`Normalized · ${data.canonical_currency}/${data.canonical_unit}`}>{formatCanonical(selected.normalized_price, data.canonical_currency, data.canonical_unit)}</DetailValue>
                    <DetailValue label="Gap vs reference">{selected.premium_type === "headline_gap" ? "Headline gap " : ""}{formatGap(selected.premium_pct)}</DetailValue>
                    <DetailValue label="Quote receipt">{selected.price_type ?? "Price type unavailable"} · {formatTimestamp(selected.quote_timestamp)} · {selected.data_delay}</DetailValue>
                  </dl>

                  {selected.comparability_reasons.length > 0 && (
                    <div className="mt-3 border border-orange-700/40 bg-orange-950/20 p-3 text-xs text-orange-100">
                      <div className="font-semibold">Why this is not like-for-like</div>
                      <div className="mt-1">{selected.comparability_reasons.join(" · ")}</div>
                    </div>
                  )}

                  <details className="mt-4 border-t border-stealth-700 pt-3">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stealth-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">Explain basis and provenance <ChevronDown size={15} aria-hidden="true" /></summary>
                    <div className="mt-2">
                      {selected.decomposition ? (
                        <div aria-label="Price gap decomposition">
                          <BasisValue label="FX conversion" value={selected.decomposition.fx_conversion_pct} />
                          <BasisValue label="Contract month / carry" value={selected.decomposition.carry_adjustment_pct} />
                          <BasisValue label="Tax / VAT" value={selected.decomposition.tax_adjustment_pct} />
                          <BasisValue label="Delivery / purity / logistics" value={selected.decomposition.delivery_adjustment_pct} />
                          <BasisValue label="Unexplained basis" value={selected.decomposition.unexplained_basis_pct} />
                        </div>
                      ) : <div className="text-xs text-stealth-300">No quote exists to decompose.</div>}
                      <div className="mt-3 space-y-2 text-xs leading-relaxed text-stealth-300">
                        <p><strong className="text-stealth-100">Basis:</strong> {selected.tax_basis} · {selected.purity ?? "Purity unavailable"} · {selected.delivery_location ?? "Delivery location unavailable"}</p>
                        <p><strong className="text-stealth-100">Source/access:</strong> {selected.source_name} · {selected.redistribution_status}</p>
                        <p><strong className="text-stealth-100">Premium history:</strong> Starts only after matched observations are persisted; no synthetic history is drawn.</p>
                      </div>
                    </div>
                  </details>
                </>
              ) : <div className="text-sm text-stealth-300">Select a venue to inspect its evidence.</div>}
            </aside>
          </div>

          <details className="border-t border-stealth-700">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-stealth-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 md:px-5">Table reading mode and methodology <ChevronDown size={15} aria-hidden="true" /></summary>
            <div className="border-t border-stealth-800">
              <div className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300" role="region" aria-label={`Scrollable ${data.metal_name} venue comparison table`} tabIndex={0}>
                <table className="min-w-[1420px] w-full text-left text-xs">
                  <caption className="sr-only">Table-equivalent reading of {data.metal_name} registered venues and normalized price evidence</caption>
                  <thead className="bg-stealth-950 text-stealth-300"><tr>{["Venue / country", "Type", "Product / symbol", "Contract", "Native quote", "FX / time", "Normalized", "Gap type", "Quote / delay", "Liquidity", "Tax / purity / delivery", "Source / access"].map((heading) => <th key={heading} scope="col" className="border-b border-stealth-700 px-3 py-2 font-semibold">{heading}</th>)}</tr></thead>
                  <tbody>{data.venues.map((row) => (
                    <tr key={row.registry_id} className="border-b border-stealth-800 align-top text-stealth-200 last:border-b-0">
                      <td className="px-3 py-3 font-semibold text-white">{row.venue}<div className="mt-1 font-normal text-stealth-400">{row.country}</div></td>
                      <td className="px-3 py-3">{row.market_type}</td>
                      <td className="px-3 py-3">{row.product_name}<div className="mt-1 text-stealth-400">{row.symbol ?? "Symbol unavailable"}</div></td>
                      <td className="px-3 py-3">{row.contract_month ?? "Not matched"}<div className="mt-1 text-stealth-400">{row.contract_size ?? "Size unavailable"}</div></td>
                      <td className="px-3 py-3">{formatLocal(row)}</td>
                      <td className="px-3 py-3">{formatFx(row)}</td>
                      <td className="px-3 py-3">{formatCanonical(row.normalized_price, data.canonical_currency, data.canonical_unit)}</td>
                      <td className="px-3 py-3">{STATUS_LABELS[row.comparability_status].label}<div className="mt-1 text-stealth-400">{formatGap(row.premium_pct)}</div></td>
                      <td className="px-3 py-3">{row.price_type ?? "Unavailable"}<div className="mt-1 text-stealth-400">{formatTimestamp(row.quote_timestamp)} · {row.session_status} · {row.data_delay}</div></td>
                      <td className="px-3 py-3">{row.liquidity_tier}<div className="mt-1 text-stealth-400">Vol {row.volume?.toLocaleString() ?? "—"} · OI {row.open_interest?.toLocaleString() ?? "—"}</div></td>
                      <td className="px-3 py-3">{row.tax_basis}<div className="mt-1 text-stealth-400">{row.purity ?? "Purity unavailable"} · {row.delivery_location ?? "Delivery unavailable"}</div></td>
                      <td className="px-3 py-3">{row.source_name}<div className="mt-1 text-stealth-400">{row.redistribution_status}</div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="grid gap-3 bg-stealth-950/45 px-4 py-4 text-xs leading-relaxed text-stealth-300 md:grid-cols-2 md:px-5">
                <p><strong className="text-stealth-100">Normalization:</strong> {data.method.normalization}</p>
                <p><strong className="text-stealth-100">Comparability:</strong> {data.method.comparability_rule}</p>
                <p><strong className="text-stealth-100">Premium:</strong> <code>{data.method.premium}</code></p>
                <p><strong className="text-stealth-100">Access:</strong> {data.method.license_rule}</p>
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
