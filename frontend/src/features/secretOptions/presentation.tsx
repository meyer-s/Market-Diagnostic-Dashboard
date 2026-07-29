import { Link } from "react-router-dom";
import { formatDate, formatNumber } from "../../utils/styleUtils";
import {
  presentOptionMarketField,
  presentScannerPositionMatch,
  type ScannerPositionMatchTone,
} from "../../utils/scannerPositionMatch";
import {
  DEFAULT_MARKET_WEATHER_QUERY_STATE,
  serializeMarketWeatherQuery,
} from "../../utils/marketWeatherQuery";
import type { MarketWeatherTimeframe } from "../../types/marketWeather";
import type {
  PositionOpportunity,
  ScannerRankedOpportunity,
  ScannerRun,
  SpotWeighting,
  VolatilitySignal,
  VolatilitySnapshot,
  VolatilityState,
  VolatilityTrend,
} from "./types";

/** Stateless formatting and scanner presentation for the Secret Options workspace. */
export const EMPTY_SPOT_WEIGHTING: SpotWeighting = {
  technical: null,
  fundamental: null,
  composite: 0,
  confidence: 0,
  signalCount: 0,
  direction: "neutral",
};

export const formatCurrency = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `$${value.toFixed(digits)}`;
};

export const formatPercent = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
};

export const formatSigned = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
};

export const formatVolPct = (value: number | null | undefined, digits = 1) => formatPercent(value, digits);

export const formatPointChange = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${formatSigned(value, digits)} pts`;
};

export const emptyVolatilitySnapshot = (): VolatilitySnapshot => ({
  iv30: null,
  hv30: null,
  iv_hv_spread: null,
  iv_percentile: null,
  avg_edr: null,
  contract_iv: null,
});

export const emptyVolatilitySignal = (): VolatilitySignal => ({
  entry: null,
  current: emptyVolatilitySnapshot(),
  trend: {
    iv30_change: null,
    hv30_change: null,
    iv_hv_spread_change: null,
    iv_percentile_change: null,
    avg_edr_change: null,
    contract_iv_change: null,
    algorithm_state: "unknown",
    contract_iv_state: "unknown",
    value_state: "unknown",
    headline: "Volatility baseline unavailable",
  },
});

export const normalizeVolatilitySnapshot = (
  snapshot: Partial<VolatilitySnapshot> | null | undefined
): VolatilitySnapshot | null => {
  if (!snapshot) return null;
  return {
    ...emptyVolatilitySnapshot(),
    ...snapshot,
    iv30: snapshot.iv30 ?? null,
    hv30: snapshot.hv30 ?? null,
    iv_hv_spread: snapshot.iv_hv_spread ?? null,
    iv_percentile: snapshot.iv_percentile ?? null,
    avg_edr: snapshot.avg_edr ?? null,
    contract_iv: snapshot.contract_iv ?? null,
  };
};

export const normalizeVolatilitySignal = (
  signal: Partial<VolatilitySignal> | null | undefined
): VolatilitySignal => {
  const empty = emptyVolatilitySignal();
  const trend = (signal?.trend ?? {}) as Partial<VolatilityTrend>;
  return {
    entry: normalizeVolatilitySnapshot(signal?.entry),
    current: normalizeVolatilitySnapshot(signal?.current) ?? empty.current,
    trend: {
      ...empty.trend,
      ...trend,
      algorithm_state: trend.algorithm_state ?? "unknown",
      contract_iv_state: trend.contract_iv_state ?? "unknown",
      value_state: trend.value_state ?? "unknown",
      headline: trend.headline ?? empty.trend.headline,
    },
    error: signal?.error ?? null,
  };
};

export const getVolatilityStateClasses = (state: VolatilityState) => {
  if (state === "expanding") {
    return {
      label: "Expanding",
      text: "text-emerald-300",
      border: "border-emerald-500/35",
      bg: "bg-emerald-500/10",
    };
  }
  if (state === "contracting") {
    return {
      label: "Contracting",
      text: "text-rose-300",
      border: "border-rose-500/35",
      bg: "bg-rose-500/10",
    };
  }
  if (state === "stable") {
    return {
      label: "Stable",
      text: "text-sky-200",
      border: "border-sky-500/30",
      bg: "bg-sky-500/10",
    };
  }
  return {
    label: "Unknown",
    text: "text-stealth-400",
    border: "border-stealth-700/70",
    bg: "bg-stealth-900/45",
  };
};

export const getContractHvSpread = (snapshot: VolatilitySnapshot | null, hvFallback?: number | null) => {
  const contractIv = snapshot?.contract_iv ?? null;
  const hv30 = snapshot?.hv30 ?? hvFallback ?? null;
  if (contractIv === null || contractIv === undefined || hv30 === null || hv30 === undefined) {
    return null;
  }
  return Number((contractIv - hv30).toFixed(2));
};

export const buildVolatilityRead = (signal: VolatilitySignal) => {
  const state = signal.trend.value_state;
  const classes = getVolatilityStateClasses(state);
  const contractChange = signal.trend.contract_iv_change;
  const spreadChange = signal.trend.iv_hv_spread_change;
  const currentSpread = signal.current.iv_hv_spread;
  const currentContractHvSpread = getContractHvSpread(signal.current);
  const currentIv30 = signal.current.iv30;
  const currentHv30 = signal.current.hv30;
  const entryContractIv = signal.entry?.contract_iv;
  const currentContractIv = signal.current.contract_iv;
  const label =
    contractChange !== null && contractChange !== undefined
      ? `IV ${formatPointChange(contractChange)}`
      : spreadChange !== null && spreadChange !== undefined
        ? `IV/HV ${formatPointChange(spreadChange)}`
        : signal.trend.headline || classes.label;
  const detail =
    entryContractIv !== null && entryContractIv !== undefined && currentContractIv !== null && currentContractIv !== undefined
      ? `contract ${formatVolPct(entryContractIv)} -> ${formatVolPct(currentContractIv)}`
      : currentContractHvSpread !== null
        ? `contract IV/HV ${formatPointChange(currentContractHvSpread)}`
        : currentSpread !== null && currentSpread !== undefined
      ? `spread ${formatPointChange(currentSpread)}`
      : currentIv30 !== null && currentHv30 !== null
        ? `IV30 ${formatVolPct(currentIv30)} / HV30 ${formatVolPct(currentHv30)}`
        : currentContractIv !== null && currentContractIv !== undefined
          ? `contract IV ${formatVolPct(currentContractIv)}`
          : currentHv30 !== null && currentHv30 !== undefined
            ? `HV30 ${formatVolPct(currentHv30)}`
            : "vol pending";

  return { ...classes, label, detail };
};

export const clusterMomentumClass = (momentum: number) => {
  if (momentum > 0) return "text-emerald-300";
  if (momentum < 0) return "text-rose-300";
  return "text-stealth-400";
};

export const scannerStatusClass = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "running" || normalized === "queued") {
    return "border-sky-500/35 bg-sky-500/10 text-sky-200";
  }
  if (normalized === "completed") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  }
  if (normalized === "stopped") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  }
  if (normalized === "stale") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  }
  return "border-rose-500/35 bg-rose-500/10 text-rose-200";
};

export const SCANNER_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;

export const isActiveScannerRun = (run: ScannerRun) => {
  if (run.status !== "queued" && run.status !== "running") return false;
  const timestamp = run.updated_at || run.started_at;
  if (!timestamp) return true;
  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) return true;
  return Date.now() - parsed < SCANNER_ACTIVE_STALE_MS;
};

export const opportunityScoreClass = (score: number | null | undefined) => {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return "border-stealth-700 bg-stealth-800 text-stealth-300";
  }
  if (score >= 85) return "border-emerald-400/50 bg-emerald-500/15 text-emerald-100";
  if (score >= 75) return "border-lime-400/45 bg-lime-500/15 text-lime-100";
  if (score >= 65) return "border-sky-400/45 bg-sky-500/15 text-sky-100";
  if (score >= 50) return "border-amber-400/45 bg-amber-500/15 text-amber-100";
  return "border-stealth-700 bg-stealth-900 text-stealth-300";
};

export const compactOpportunityGrade = (score: number | null | undefined, fallback?: string | null) => {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return fallback && fallback !== "Watch" ? fallback : "—";
  }
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 60) return "C+";
  if (score >= 55) return "C";
  if (score >= 50) return "C-";
  if (score >= 45) return "D+";
  if (score >= 40) return "D";
  return "D-";
};

export const OpportunityRankBadge = ({
  score,
  grade,
  rankScore,
  modelVersion,
  className = "",
}: {
  score: number | null | undefined;
  grade?: string | null;
  rankScore?: number | null;
  modelVersion?: string | null;
  className?: string;
}) => {
  const label = compactOpportunityGrade(score, grade);
  if (label === "—") return null;
  const titleParts = [
    `Grade ${label}`,
    score !== null && score !== undefined && !Number.isNaN(score) ? `score ${score.toFixed(1)}` : null,
    rankScore !== null && rankScore !== undefined && !Number.isNaN(rankScore) ? `rank ${rankScore.toFixed(1)}` : null,
    modelVersion || null,
  ].filter(Boolean);
  return (
    <span
      title={titleParts.join(" · ")}
      className={`inline-flex min-w-8 items-center justify-center rounded-md border px-1.5 py-0.5 text-xs font-semibold leading-none ${opportunityScoreClass(score)} ${className}`}
    >
      {label}
    </span>
  );
};

export const buildOpportunityRead = (opportunity: PositionOpportunity | null | undefined) => {
  const score = opportunity?.current?.score ?? opportunity?.entry?.score ?? null;
  const grade = opportunity?.current?.grade ?? opportunity?.entry?.grade ?? null;
  const change = opportunity?.score_change ?? null;
  const label = compactOpportunityGrade(score, grade);
  const detail =
    change !== null && change !== undefined
      ? `${opportunity?.headline || "Rank"} ${formatSigned(change, 1)}`
      : opportunity?.error
        ? "—"
        : "—";
  return {
    score,
    grade,
    label,
    detail,
    className: opportunityScoreClass(score),
  };
};

export const capitalizeWord = (value: string) => {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

export const formatDataSource = (source?: string | null, quoteSource?: string | null) => {
  const normalized = source?.trim().toLowerCase();
  const provider =
    normalized === "ibkr"
      ? "IBKR"
      : normalized === "yahoo" || normalized === "yfinance"
        ? "yfinance"
        : source?.trim() || "Unknown";
  const detail = quoteSource?.trim();
  return detail ? `${provider} (${detail.replace(/_/g, " ")})` : provider;
};

export interface ParsedScannerAlertSection {
  title: string;
  rows: Array<{ label: string; value: string }>;
  lines: string[];
}

export const scannerAlertHeaders = [
  "MISPRICING",
  "OPPORTUNITY RANK",
  "DIRECTION",
  "MACD 1W",
  "HORIZONS",
  "EXAMPLE TRADE",
];

export const cleanScannerAlertMessage = (message?: string | null) =>
  (message || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/```ansi|```/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !/^[-=─]{6,}$/.test(trimmed);
    });

export const scannerHeaderForLine = (line: string) => {
  const normalized = line.trim().toUpperCase();
  return scannerAlertHeaders.find((header) => normalized.startsWith(header)) || null;
};

export const parseScannerAlertSections = (message?: string | null): ParsedScannerAlertSection[] => {
  const lines = cleanScannerAlertMessage(message);
  const sections: ParsedScannerAlertSection[] = [];
  let current: ParsedScannerAlertSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const header = scannerHeaderForLine(trimmed);
    if (header) {
      current = { title: trimmed, rows: [], lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const rowMatch = trimmed.match(/^([^:]{2,28})\s*:\s*(.+)$/);
    if (rowMatch) {
      current.rows.push({
        label: rowMatch[1].trim(),
        value: rowMatch[2].trim(),
      });
    } else {
      current.lines.push(trimmed);
    }
  }

  return sections;
};

export const scannerAlertSection = (sections: ParsedScannerAlertSection[], title: string) =>
  sections.find((section) => section.title.toUpperCase().startsWith(title.toUpperCase()));

export const scannerAlertValue = (
  sections: ParsedScannerAlertSection[],
  sectionTitle: string,
  label: string
) =>
  scannerAlertSection(sections, sectionTitle)?.rows.find(
    (row) => row.label.toLowerCase() === label.toLowerCase()
  )?.value || null;

export const formatComponentLabel = (value: string) =>
  value
    .replace(/^selected_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const MARKET_FIELD_TIMEFRAMES = new Set<MarketWeatherTimeframe>([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1D",
  "1W",
]);

export const marketFieldPath = (symbol: string, requestedTimeframe?: string | null) => {
  const timeframe = requestedTimeframe && MARKET_FIELD_TIMEFRAMES.has(requestedTimeframe as MarketWeatherTimeframe)
    ? requestedTimeframe as MarketWeatherTimeframe
    : DEFAULT_MARKET_WEATHER_QUERY_STATE.config.timeframe;
  const query = serializeMarketWeatherQuery({
    ...DEFAULT_MARKET_WEATHER_QUERY_STATE,
    config: {
      ...DEFAULT_MARKET_WEATHER_QUERY_STATE.config,
      symbol: symbol.trim().toUpperCase(),
      timeframe,
    },
  });
  return `/market-weather?${query.toString()}`;
};

export const scannerPositionMatchBadgeClass: Record<ScannerPositionMatchTone, string> = {
  neutral: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  negative: "border-rose-500/35 bg-rose-500/10 text-rose-200",
};

export const scannerPositionMatchTextClass: Record<ScannerPositionMatchTone, string> = {
  neutral: "text-sky-300",
  positive: "text-emerald-300",
  warning: "text-amber-300",
  negative: "text-rose-300",
};

export const replacementGateClass: Record<string, string> = {
  pass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  watch: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  fail: "border-rose-500/25 bg-rose-500/10 text-rose-200",
};

export const formatLearningCanaryLabel = (
  nominalWeightCap?: number | null,
  version?: string,
) => {
  const cap =
    nominalWeightCap ??
    (version === "option_learning_influence_canary_v2" ? 0.05 : null);
  return cap === null ? "Live bounded canary" : `Live ≤${(cap * 100).toFixed(0)}% canary`;
};

export const ScannerHitDetail = ({ opportunity }: { opportunity: ScannerRankedOpportunity }) => {
  const contract = opportunity.selected_contract;
  const learning = opportunity.learning_evaluation;
  const liveCanaryLabel = formatLearningCanaryLabel(
    learning?.nominal_weight_cap ?? learning?.maximum_applied_weight,
    learning?.version,
  );
  const positionMatch = presentScannerPositionMatch(opportunity.position_match);
  const marketField = presentOptionMarketField(opportunity.field_context);
  const marketFieldHref = marketField ? marketFieldPath(opportunity.symbol, marketField.timeframe) : null;
  const replacementDecision = opportunity.position_match?.replacement_decision || null;
  const replacementComparison = replacementDecision?.comparison || null;
  const sections = parseScannerAlertSections(opportunity.message);
  const directionSection = scannerAlertSection(sections, "DIRECTION");
  const macdSection = scannerAlertSection(sections, "MACD 1W");
  const horizonsSection = scannerAlertSection(sections, "HORIZONS");
  const exampleSection = scannerAlertSection(sections, "EXAMPLE TRADE");
  const components = Object.entries(opportunity.components || {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .sort((a, b) => b[1] - a[1]);
  const dataSource = scannerAlertValue(sections, "MISPRICING", "Data Src") || contract.price_source || "—";
  const reviewWindowLabel =
    scannerAlertValue(sections, "EXAMPLE TRADE", "Review Window") ||
    (opportunity.review_window?.min_hold_days && opportunity.review_window?.max_hold_days
      ? `${opportunity.review_window.min_hold_days}-${opportunity.review_window.max_hold_days} trading days`
      : null);
  const ivHvEdr =
    scannerAlertValue(sections, "MISPRICING", "IV/HV/EDR") ||
    `${formatPercent(opportunity.iv30, 1)} / ${formatPercent(opportunity.hv30, 1)} / ${formatPercent(opportunity.avg_edr, 1)}`;

  const detailRow = (label: string, value: string | number | null | undefined, className = "text-stealth-100") => (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 uppercase tracking-wide text-stealth-500">{label}</span>
      <span className={`min-w-0 max-w-[72%] break-words text-right tabular-nums ${className}`}>{value ?? "—"}</span>
    </div>
  );

  const sectionBlock = (title: string, rows: Array<{ label: string; value: string }>, lines: string[] = []) => {
    if (rows.length === 0 && lines.length === 0) return null;
    return (
      <div className="min-w-0 border-t border-stealth-800/70 pt-2">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stealth-500">{title}</div>
        <div className="space-y-1">
          {rows.map((row) => detailRow(row.label, row.value))}
          {lines.map((line, index) => (
            <div key={`${title}-${index}`} className="break-words text-xs leading-snug text-stealth-300">
              {line}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-x-hidden bg-stealth-950/40 px-3 py-3 sm:px-4">
      {replacementDecision && replacementComparison ? (
        <section className={`mb-3 rounded-lg border p-3 ${scannerPositionMatchBadgeClass[positionMatch?.tone || "neutral"]}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">Replacement decision</div>
              <div className="mt-0.5 text-sm font-semibold">{replacementDecision.label}</div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-stealth-300">
                {replacementDecision.summary}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs font-semibold uppercase tracking-wide">
                {replacementDecision.structure.label}
              </div>
              <div className="mt-0.5 text-xs text-stealth-400">
                {replacementDecision.confidence} confidence · shadow only
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-stealth-700/70 bg-stealth-700/70 sm:grid-cols-3">
            <div className="bg-stealth-950/80 p-2">
              <div className="text-xs uppercase tracking-wide text-stealth-500">Held</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-stealth-100">
                {replacementComparison.held.contract || "Held contract"}
              </div>
              <div className="mt-1 text-xs text-stealth-400 tabular-nums">
                Score {formatNumber(replacementComparison.held.score, 1)} · P/L {formatPercent(replacementComparison.held.pnl_pct, 1)}
              </div>
              <div className="text-xs text-stealth-500 tabular-nums">
                {replacementComparison.held.dte ?? "—"} DTE · spread {formatPercent(replacementComparison.held.spread_pct, 1)}
              </div>
            </div>
            <div className="bg-stealth-950/80 p-2">
              <div className="text-xs uppercase tracking-wide text-stealth-500">Scanner candidate</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-stealth-100">
                {replacementComparison.candidate.contract || "Candidate contract"}
              </div>
              <div className="mt-1 text-xs text-stealth-400 tabular-nums">
                Score {formatNumber(replacementComparison.candidate.score, 1)} · premium {formatCurrency(replacementComparison.candidate.premium)}
              </div>
              <div className="text-xs text-stealth-500 tabular-nums">
                {replacementComparison.candidate.dte ?? "—"} DTE · spread {formatPercent(replacementComparison.candidate.spread_pct, 1)}
              </div>
            </div>
            <div className="bg-stealth-950/80 p-2">
              <div className="text-xs uppercase tracking-wide text-stealth-500">Net change</div>
              <div className="mt-0.5 text-xs font-semibold text-stealth-100 tabular-nums">
                Score {replacementComparison.change.score !== null && replacementComparison.change.score !== undefined ? formatSigned(replacementComparison.change.score, 1) : "—"}
              </div>
              <div className="mt-1 text-xs text-stealth-400 tabular-nums">
                {replacementComparison.change.dte !== null && replacementComparison.change.dte !== undefined ? `${formatSigned(replacementComparison.change.dte, 0)} DTE` : "DTE —"}
              </div>
              <div className="text-xs text-stealth-500 tabular-nums">
                {replacementComparison.change.strike !== null && replacementComparison.change.strike !== undefined ? `${formatSigned(replacementComparison.change.strike, 2)} strike` : "Strike —"}
              </div>
            </div>
          </div>

          <details className="mt-2 rounded-md border border-stealth-700/60 bg-stealth-950/45 px-2.5 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-stealth-300">
              Why this decision · {replacementDecision.gates.length} gates
            </summary>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {replacementDecision.gates.map((gate) => (
                <div key={gate.key} className="flex items-start gap-2 rounded border border-stealth-800 bg-stealth-950/50 p-2">
                  <span className={`mt-px shrink-0 rounded border px-1 py-0.5 text-xs font-semibold uppercase ${replacementGateClass[gate.status] || replacementGateClass.watch}`}>
                    {gate.status}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-stealth-200">{gate.label}</div>
                    <div className="text-xs leading-snug text-stealth-500">{gate.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 border-t border-stealth-800/70 pt-2 text-xs leading-relaxed text-stealth-500">
              {replacementDecision.journal_rule}
            </p>
          </details>
        </section>
      ) : null}
      {positionMatch && !replacementDecision ? (
        <div
          role="note"
          aria-label={positionMatch.accessibleLabel}
          className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-stealth-800/70 pb-2 text-xs"
        >
          <span
            aria-hidden="true"
            className={`rounded border px-1.5 py-0.5 font-semibold tracking-wide ${scannerPositionMatchBadgeClass[positionMatch.tone]}`}
          >
            {positionMatch.badgeLabel}
          </span>
          <span aria-hidden="true" className={scannerPositionMatchTextClass[positionMatch.tone]}>
            {positionMatch.evidenceLine}
          </span>
          <span aria-hidden="true" className="ml-auto text-stealth-500">
            Evidence only · no add signal
          </span>
        </div>
      ) : null}
      {learning ? (
        <details className="mb-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.04] px-2.5 py-2">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-300">
                Outcome-learning challenger
              </span>
              <span className="rounded border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 text-xs font-semibold text-violet-200">
                {learning.applied_weight > 0
                  ? liveCanaryLabel
                  : learning.point_in_time_receipt === false
                    ? "Legacy shadow"
                    : "Canary waiting"}
              </span>
              <span className="text-xs text-stealth-500">
                Champion {formatNumber(learning.champion_score, 1)}
                {" · "}
                learned {learning.learning_score === null ? "waiting" : formatNumber(learning.learning_score, 1)}
                {" · "}
                applied weight {(learning.applied_weight * 100).toFixed(1)}%
              </span>
              <span className="ml-auto text-xs text-stealth-500">Evidence &amp; gates</span>
            </div>
          </summary>
          <div className="mt-2 grid gap-px overflow-hidden rounded-md border border-stealth-800 bg-stealth-800 sm:grid-cols-3">
            <div className="bg-stealth-950/70 p-2">
              <div className="text-xs uppercase tracking-wide text-stealth-500">Production</div>
              <div className="mt-0.5 text-xs font-semibold tabular-nums text-stealth-100">
                {formatNumber(learning.applied_score, 2)}
              </div>
              <div className="text-xs text-stealth-500">
                {learning.applied_weight > 0 ? "Bounded outcome-learning lean" : "Champion remains authoritative"}
              </div>
            </div>
            <div className="bg-stealth-950/70 p-2">
              <div className="text-xs uppercase tracking-wide text-stealth-500">Counterfactual</div>
              <div className="mt-0.5 text-xs font-semibold tabular-nums text-violet-200">
                {formatNumber(learning.counterfactual_score, 2)}
                {" "}
                <span className="text-xs font-normal text-stealth-500">
                  ({formatSigned(learning.counterfactual_delta, 2)})
                </span>
              </div>
              <div className="text-xs text-stealth-500">
                {(learning.counterfactual_weight * 100).toFixed(1)}% hypothetical blend
              </div>
            </div>
            <div className="bg-stealth-950/70 p-2">
              <div className="text-xs uppercase tracking-wide text-stealth-500">Rank test</div>
              <div className="mt-0.5 text-xs font-semibold tabular-nums text-stealth-100">
                #{learning.champion_rank ?? "—"} → #{learning.applied_rank ?? "—"}
              </div>
              <div className="text-xs text-stealth-500">
                {learning.applied_rank_delta
                  ? `Applied move ${formatSigned(learning.applied_rank_delta, 0)}`
                  : "No applied reorder"}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(learning.gates).map(([gate, passed]) => (
              <span
                key={gate}
                className={`rounded border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                  passed
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                    : "border-stealth-700 bg-stealth-900/70 text-stealth-500"
                }`}
              >
                {gate.replace(/_/g, " ")}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-stealth-400">
            {learning.reasons.join(" ")}
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-3">
            {learning.signals.map((signal) => (
              <div key={signal.family} className="rounded border border-stealth-800 bg-stealth-950/50 p-2">
                <div className="text-xs uppercase tracking-wide text-stealth-500">
                  {signal.family.replace(/_/g, " ")}
                </div>
                <div className="mt-0.5 text-xs font-semibold text-stealth-200">
                  {signal.cohort.replace(/_/g, " ")}
                </div>
                {learning.family_attribution?.[signal.family] ? (
                  <div className="mt-0.5 text-xs tabular-nums text-violet-300">
                    {learning.family_attribution[signal.family].applied_score_delta === 0
                      ? "No applied score effect"
                      : `${formatSigned(learning.family_attribution[signal.family].applied_score_delta, 3)} applied`}
                    {learning.family_attribution[signal.family].applied_rank_changed
                      ? ` · rank ${formatSigned(learning.family_attribution[signal.family].applied_rank_delta ?? 0, 0)}`
                      : ""}
                  </div>
                ) : null}
                <div className="mt-0.5 text-xs leading-snug text-stealth-500">{signal.reason}</div>
              </div>
            ))}
          </div>
          {learning.authority?.note ? (
            <p className="mt-2 border-t border-stealth-800 pt-2 text-xs leading-relaxed text-stealth-500">
              {learning.authority.note}
            </p>
          ) : null}
        </details>
      ) : null}
      {marketField && marketFieldHref ? (
        <section className="mb-3 rounded-lg border border-stealth-700/80 bg-stealth-950/45 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-stealth-500">
              Mispricing × path fit
            </span>
            <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-semibold text-emerald-200">
              IV pct {formatPercent(opportunity.iv_percentile, 0)}
            </span>
            <span
              aria-label={marketField.accessibleLabel}
              title={marketField.accessibleLabel}
              className={`rounded border px-1.5 py-0.5 text-xs font-semibold tracking-wide ${scannerPositionMatchBadgeClass[marketField.tone]}`}
            >
              {marketField.badgeLabel}
            </span>
            {[
              marketField.directionLabel,
              marketField.trendAgreementLabel,
              marketField.boundaryLabel,
              marketField.alignmentLabel,
              marketField.maturityLabel,
            ].filter((label): label is string => Boolean(label)).map((label) => (
              <span
                key={label}
                title={label === marketField.alignmentLabel ? marketField.alignmentCaveat || undefined : label === marketField.maturityLabel ? marketField.maturityReason || undefined : undefined}
                className="rounded-full border border-stealth-700 bg-stealth-900/70 px-1.5 py-0.5 text-xs text-stealth-300"
              >
                {label}
              </span>
            ))}
            <Link
              to={marketFieldHref}
              className="ml-auto rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-500/20"
            >
              Open Market Field
            </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stealth-500 tabular-nums">
            <span>{marketField.pathStateLabel}</span>
            <span>IV/HV {formatPointChange(opportunity.iv_hv_spread, 1)}</span>
            <span>{marketField.timeframe} · as of {opportunity.field_context?.as_of_bar || "recorded bar"}</span>
            {opportunity.field_context?.analysis_identity?.analysis_hash ? (
              <span title={opportunity.field_context.analysis_identity.analysis_hash}>
                analysis {opportunity.field_context.analysis_identity.analysis_hash.slice(0, 10)}
              </span>
            ) : null}
            <span>{marketField.authorityLabel}</span>
            <span>{marketField.advisoryEffectsLabel}</span>
          </div>
          {marketField.authorityCaveat || marketField.alignmentCaveat || marketField.maturityLabel || marketField.diagnosticsCaveat ? (
            <div className="mt-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-xs leading-relaxed text-amber-100/80">
              {[marketField.authorityCaveat, marketField.alignmentCaveat, marketField.maturityLabel ? marketField.maturityReason : null, marketField.diagnosticsCaveat]
                .filter((value): value is string => Boolean(value))
                .join(" ")}
            </div>
          ) : null}
          <details className="mt-1.5 border-t border-stealth-800/80 pt-1.5">
            <summary className="cursor-pointer text-xs font-semibold text-stealth-400">
              Field diagnostics{marketField.diagnosticsLabel ? ` · ${marketField.diagnosticsLabel}` : ""}
            </summary>
            {marketField.diagnosticsCaveat ? (
              <p className="mt-1.5 text-xs leading-relaxed text-amber-100/80">{marketField.diagnosticsCaveat}</p>
            ) : null}
            <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-stealth-950/80 p-2 text-xs leading-relaxed text-stealth-400">
              {JSON.stringify(opportunity.field_context, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr]">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-stealth-500">Mispricing</div>
          {detailRow("Consensus", scannerAlertValue(sections, "MISPRICING", "Consensus") || "Cheap", "text-emerald-200")}
          {detailRow("IV pct", formatPercent(opportunity.iv_percentile, 1))}
          {detailRow("IV/HV/EDR", ivHvEdr)}
          {detailRow("Data", dataSource)}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-stealth-500">Rank Drivers</div>
          {detailRow("Grade", compactOpportunityGrade(opportunity.score, opportunity.grade), opportunityScoreClass(opportunity.score).split(" ").filter((part) => part.startsWith("text-")).join(" ") || "text-stealth-100")}
          {detailRow("Score", opportunity.score.toFixed(1))}
          {opportunity.reasons.length > 0 ? (
            <div className="text-xs leading-snug text-stealth-300">{opportunity.reasons.slice(0, 3).join(" / ")}</div>
          ) : null}
          {components.length > 0 ? (
            <div className="space-y-1.5">
              {components.slice(0, 5).map(([key, value]) => (
                <div key={key}>
                  <div className="mb-0.5 flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-stealth-500">
                    <span className="truncate">{formatComponentLabel(key)}</span>
                    <span className="tabular-nums">{value.toFixed(0)}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-stealth-900">
                    <div className="h-full rounded-full bg-sky-300/70" style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-stealth-500">Contract</div>
          {detailRow(
            "Selected",
            contract.option_type && contract.strike !== null && contract.strike !== undefined
              ? `${contract.option_type.toUpperCase()} ${formatNumber(contract.strike, 2)}${contract.expiry ? ` / ${formatDate(contract.expiry)}` : ""}`
              : "contract pending"
          )}
          {detailRow("Bid / Ask", `${formatCurrency(contract.bid)} / ${formatCurrency(contract.ask)}`)}
          {detailRow("Premium", formatCurrency(contract.premium))}
          {detailRow("Spread", formatPercent(contract.spread_pct, 1))}
          {detailRow(
            "OI / Vol / IV",
            `${contract.open_interest ?? "—"} / ${contract.volume ?? "—"} / ${
              contract.implied_volatility !== null && contract.implied_volatility !== undefined
                ? formatPercent(contract.implied_volatility * 100, 1)
                : "—"
            }`
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {sectionBlock("Direction", directionSection?.rows || [], directionSection?.lines || [])}
        {sectionBlock("Momentum", macdSection?.rows || [], macdSection?.lines || [])}
        {sectionBlock("Horizons", horizonsSection?.rows || [], horizonsSection?.lines || [])}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <div className="border-t border-stealth-800/70 pt-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stealth-500">Training Trade</div>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {detailRow("Hump exit", scannerAlertValue(sections, "EXAMPLE TRADE", "Hump Exit") || formatPercent(contract.convexity_profit_pct, 0))}
            {detailRow("Hump prob", scannerAlertValue(sections, "EXAMPLE TRADE", "Hump Prob") || (contract.convexity_probability_itm !== null && contract.convexity_probability_itm !== undefined ? formatPercent(contract.convexity_probability_itm * 100, 0) : "—"))}
            {detailRow("Base target", scannerAlertValue(sections, "EXAMPLE TRADE", "Base Tgt") || formatPercent(contract.target_profit_pct, 0))}
            {detailRow("Risk cut", scannerAlertValue(sections, "EXAMPLE TRADE", "Risk Cut") || (contract.planned_loss_pct !== null && contract.planned_loss_pct !== undefined ? `-${formatPercent(contract.planned_loss_pct, 0)}` : "—"))}
            {detailRow("Reward/risk", scannerAlertValue(sections, "EXAMPLE TRADE", "Reward/Risk") || (contract.reward_risk !== null && contract.reward_risk !== undefined ? `${contract.reward_risk.toFixed(2)}R` : "—"))}
            {detailRow("Window", reviewWindowLabel)}
            {detailRow("Gate", scannerAlertValue(sections, "EXAMPLE TRADE", "Hold") || (contract.dte !== null && contract.dte !== undefined ? `${contract.dte} DTE` : "—"))}
          </div>
        </div>

        {exampleSection && exampleSection.rows.length > 0 ? (
          <div className="border-t border-stealth-800/70 pt-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stealth-500">Quote Context</div>
            <div className="space-y-1">
              {["Setup", "Quote", "OI/Vol/IV", "Est Prem", "Est G/L", "Stop/Tgt"].map((label) => {
                const value = scannerAlertValue(sections, "EXAMPLE TRADE", label);
                return value ? detailRow(label, value) : null;
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
