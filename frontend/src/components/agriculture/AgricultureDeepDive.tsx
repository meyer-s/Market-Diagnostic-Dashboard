import { useEffect, useMemo, useState, type ReactNode } from "react";

import DataScroller from "../ui/DataScroller";
import { apiFetch } from "../../utils/apiUtils";
import { CompactContextDigest, type AgricultureContextData } from "./AgricultureContextPanel";

export type AgricultureGroupRow = {
  group: string;
  label: string;
  effective_weight: number;
  symbol_count: number;
  group_composite: number;
  changes: Record<string, number | null>;
  volatility: number | null;
  breadth_score: number | null;
  strongest: Array<{ code: string; name: string; score: number; ticker: string | null }>;
  weakest: Array<{ code: string; name: string; score: number; ticker: string | null }>;
  components: Array<{
    code: string;
    name: string;
    score: number;
    ticker: string | null;
    changes: Record<string, number | null>;
    volatility: number | null;
  }>;
  stability_contribution: number;
  correlation_to_composite: number | null;
};

type CorrelationRow = { row: string; values: Record<string, number | null> };

export type AgricultureDeepDiveData = {
  as_of: string;
  groups: AgricultureGroupRow[];
  correlations?: {
    group_matrix: Record<string, CorrelationRow[]>;
    pair_insights: Record<string, Record<string, number | null>>;
  };
  special_signals?: {
    soybean_oil_vs_grains: {
      spread_20d: number | null;
      soybean_oil_20d: number | null;
      avg_grains_20d: number | null;
      interpretation: string;
    };
    livestock_feed_margin_pressure: {
      spread_20d: number | null;
      grains_20d: number | null;
      livestock_20d: number | null;
      interpretation: string;
    };
  };
  macro_pressure?: Record<string, {
    name: string;
    status: string;
    change_20d?: number | null;
    spread_20d?: number | null;
  }>;
  availability: {
    missing_symbols: Array<{ code: string; name: string; group: string; attempted_tickers: string[] }>;
    missing_macro_series: string[];
    available_group_count: number;
    total_configured_symbols: number;
    available_symbol_count: number;
  };
  warnings: string[];
};

type ContextEntry = {
  data: AgricultureContextData | null;
  error: string | null;
  loading: boolean;
};

const GROUP_COMPONENT_ORDER: Record<string, string[]> = {
  grains_oilseeds: ["ZC", "ZS", "ZW", "ZM", "ZL", "ZO", "KE", "MW", "ZR"],
  livestock: ["LE", "GF", "HE"],
  dairy: ["DC", "DAIRY_CLASS_IV"],
  softs: ["KC", "CC", "SB", "CT", "OJ", "RS"],
  lumber: ["LBR", "SYP"],
  fertilizer_inputs: ["FERT_N", "FERT_P", "FERT_K"],
};

const USDA_WASDE_URL = "https://www.usda.gov/oce/commodity/wasde";
const USDA_CROP_PROGRESS_URL = "https://www.nass.usda.gov/Charts_and_Maps/Crop_Progress_&_Condition/index.php";
const NOAA_WEATHER_URL = "https://www.weather.gov/";

function formatSnapshot(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSignedPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function sortGroupComponents(group: AgricultureGroupRow): AgricultureGroupRow["components"] {
  const preferredOrder = GROUP_COMPONENT_ORDER[group.group] ?? [];
  const orderMap = new Map(preferredOrder.map((code, index) => [code, index]));
  return [...group.components].sort((left, right) => {
    const leftIndex = orderMap.get(left.code) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderMap.get(right.code) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex === rightIndex ? right.score - left.score : leftIndex - rightIndex;
  });
}

function sectorRead(score: number): { label: string; tone: string } {
  if (score >= 65) return { label: "Strong momentum", tone: "text-emerald-200" };
  if (score <= 35) return { label: "Weak momentum", tone: "text-rose-200" };
  return { label: "Mixed momentum", tone: "text-amber-200" };
}

function trendRead(value: number | null): string {
  if (value === null) return "Trend unavailable";
  if (value >= 2) return "Rising";
  if (value <= -2) return "Falling";
  return "Range-bound";
}

function breadthRead(value: number | null): string {
  if (value === null) return "Unavailable";
  if (value >= 65) return "Broad";
  if (value >= 45) return "Mixed";
  return "Narrow";
}

function correlationMeaning(value: number): string {
  const strength = Math.abs(value) >= 0.7 ? "strongly" : Math.abs(value) >= 0.4 ? "moderately" : "loosely";
  return value >= 0 ? `move together ${strength}` : `move in opposite directions ${strength}`;
}

function correlationCellTone(value: number | null): string {
  if (value === null) return "bg-stealth-900/50 text-stealth-500";
  const strength = Math.abs(value);
  if (value >= 0 && strength >= 0.6) return "bg-sky-400/20 text-sky-100";
  if (value >= 0 && strength >= 0.3) return "bg-sky-400/10 text-sky-200";
  if (value < 0 && strength >= 0.6) return "bg-violet-400/20 text-violet-100";
  if (value < 0 && strength >= 0.3) return "bg-violet-400/10 text-violet-200";
  return "bg-stealth-800/70 text-stealth-300";
}

function formatGroupCode(group: string): string {
  return group.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isHttpUrl(value?: string | null): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function fallbackSources(group: AgricultureGroupRow, ticker: string | null): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  if (ticker) links.push({ label: "Futures price on Yahoo Finance", url: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}` });
  links.push({
    label: group.group === "grains_oilseeds" ? "USDA crop reports" : "USDA commodity reports",
    url: group.group === "grains_oilseeds" ? USDA_CROP_PROGRESS_URL : USDA_WASDE_URL,
  });
  links.push({ label: "National Weather Service", url: NOAA_WEATHER_URL });
  return links.filter((link) => isHttpUrl(link.url));
}

function FallbackContractRead({
  group,
  component,
  error,
}: {
  group: AgricultureGroupRow;
  component: AgricultureGroupRow["components"][number];
  error?: string | null;
}) {
  const read = sectorRead(component.score);
  const sources = fallbackSources(group, component.ticker);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stealth-700/80 pb-4">
        <div>
          <p className="text-sm text-stealth-300">Local market structure</p>
          <p className={`mt-1 text-xl font-semibold ${read.tone}`}>{read.label}</p>
        </div>
        <p className="text-sm text-stealth-300">Momentum score <span className="font-semibold tabular-nums text-white">{component.score.toFixed(1)}/100</span></p>
      </div>
      <p className="mt-4 max-w-3xl text-sm leading-6 text-stealth-200">
        Official contract context is unavailable, so this read is limited to observed price momentum and volatility. No fundamental action state is inferred.
      </p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div><dt className="text-xs font-semibold text-stealth-400">20-day trend</dt><dd className="mt-1 text-sm text-white">{formatSignedPercent(component.changes["20d"])}</dd></div>
        <div><dt className="text-xs font-semibold text-stealth-400">Annualized volatility</dt><dd className="mt-1 text-sm text-white">{formatSignedPercent(component.volatility)}</dd></div>
        <div><dt className="text-xs font-semibold text-stealth-400">Action state</dt><dd className="mt-1 text-sm text-white">Context unavailable</dd></div>
      </dl>
      <div className="mt-6 border-t border-stealth-700/80 pt-4">
        <p className="text-xs font-semibold text-stealth-300">Supporting sources</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {sources.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener" className="field-button field-button-secondary min-h-11 text-xs">
              {link.label}<span aria-hidden="true"> ↗</span><span className="sr-only">, opens in a new tab</span>
            </a>
          ))}
        </div>
      </div>
      {error ? <p className="mt-4 text-sm text-amber-200">Context feed unavailable: {error}</p> : null}
    </div>
  );
}

function Disclosure({
  title,
  interpretation,
  timestamp,
  children,
}: {
  title: string;
  interpretation: string;
  timestamp: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-stealth-700 bg-stealth-900/35 open:bg-stealth-900/55">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5">
        <span>
          <span className="block text-sm font-semibold text-white">{title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-stealth-300">{interpretation}</span>
        </span>
        <span className="shrink-0 text-right text-xs text-stealth-400">
          <span className="hidden sm:block">{timestamp}</span>
          <span className="ml-3 inline-block transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </span>
      </summary>
      <div className="border-t border-stealth-700/80 px-4 py-5 md:px-5">{children}</div>
    </details>
  );
}

export default function AgricultureDeepDive({ data }: { data: AgricultureDeepDiveData }) {
  const rankedGroups = useMemo(
    () => [...data.groups].sort((left, right) => right.effective_weight - left.effective_weight),
    [data.groups]
  );
  const [selectedGroupKey, setSelectedGroupKey] = useState(rankedGroups[0]?.group ?? "");
  const [selectedIndicatorsByGroup, setSelectedIndicatorsByGroup] = useState<Record<string, string>>({});
  const [contexts, setContexts] = useState<Record<string, ContextEntry>>({});

  useEffect(() => {
    if (!rankedGroups.some((group) => group.group === selectedGroupKey)) {
      setSelectedGroupKey(rankedGroups[0]?.group ?? "");
    }
  }, [rankedGroups, selectedGroupKey]);

  const selectedGroup = rankedGroups.find((group) => group.group === selectedGroupKey) ?? rankedGroups[0];
  const selectedComponents = selectedGroup ? sortGroupComponents(selectedGroup) : [];
  const selectedCode = selectedGroup
    ? selectedIndicatorsByGroup[selectedGroup.group] ?? selectedComponents[0]?.code
    : undefined;
  const selectedComponent = selectedComponents.find((component) => component.code === selectedCode) ?? selectedComponents[0];
  const selectedContext = selectedComponent ? contexts[selectedComponent.code] : undefined;

  useEffect(() => {
    const symbol = selectedComponent?.code;
    if (!symbol || contexts[symbol]) return;

    let cancelled = false;
    setContexts((current) => ({ ...current, [symbol]: { data: null, error: null, loading: true } }));
    void apiFetch<AgricultureContextData>(`/agriculture/context?symbol=${encodeURIComponent(symbol)}`)
      .then((payload) => {
        if (!cancelled) setContexts((current) => ({ ...current, [symbol]: { data: payload, error: null, loading: false } }));
      })
      .catch((requestError) => {
        if (!cancelled) {
          setContexts((current) => ({
            ...current,
            [symbol]: {
              data: null,
              error: requestError instanceof Error ? requestError.message : "Failed to load contract context",
              loading: false,
            },
          }));
        }
      });

    return () => { cancelled = true; };
  }, [selectedComponent?.code]);

  const matrix60 = data.correlations?.group_matrix?.["60"] ?? [];
  const groupLabels = useMemo(() => new Map(data.groups.map((group) => [group.group, group.label])), [data.groups]);
  const strongestRelationships = useMemo(() => {
    const pairs: Array<{ left: string; right: string; value: number }> = [];
    const seen = new Set<string>();
    for (const row of matrix60) {
      for (const [column, value] of Object.entries(row.values)) {
        if (value === null || column === row.row) continue;
        const key = [row.row, column].sort().join("::");
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ left: row.row, right: column, value });
      }
    }
    return pairs.sort((left, right) => Math.abs(right.value) - Math.abs(left.value)).slice(0, 3);
  }, [matrix60]);

  const macroEntries = Object.entries(data.macro_pressure ?? {}).filter(([key]) => key !== "biofuel_proxy");
  const pressuringCount = macroEntries.filter(([, item]) => item.status.toLowerCase().includes("pressur")).length;
  const supportiveCount = macroEntries.filter(([, item]) => item.status.toLowerCase().includes("support")).length;
  const snapshot = `Snapshot ${formatSnapshot(data.as_of)}`;
  const correlationSummary = strongestRelationships[0]
    ? `${groupLabels.get(strongestRelationships[0].left) ?? formatGroupCode(strongestRelationships[0].left)} and ${groupLabels.get(strongestRelationships[0].right) ?? formatGroupCode(strongestRelationships[0].right)} are the strongest current relationship.`
    : "Relationship history is not available.";
  const macroSummary = macroEntries.length || data.special_signals
    ? `${pressuringCount} inputs are pressuring agriculture and ${supportiveCount} are supportive.`
    : "Macro evidence is unavailable in this snapshot.";
  const dataQualitySummary = data.availability.missing_symbols.length || data.availability.missing_macro_series.length
    ? `${data.availability.missing_symbols.length + data.availability.missing_macro_series.length} coverage gaps need attention.`
    : "All displayed price and macro inputs are available in this snapshot.";

  return (
    <div className="space-y-6 md:space-y-8">
      <section aria-labelledby="sector-ranking-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="sector-ranking-heading" className="text-xl font-semibold text-white">Where leadership sits</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-stealth-300">Sectors are ranked by their weight in the composite. Select one row to inspect its contracts without expanding the rest of the page.</p>
          </div>
          <p className="text-xs text-stealth-400">Scores are momentum composites from 0–100</p>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-900/35">
          <div className="hidden grid-cols-[minmax(190px,1.4fr)_minmax(120px,.8fr)_100px_120px_120px] gap-4 border-b border-stealth-700 px-4 py-2 text-xs font-semibold text-stealth-400 md:grid">
            <span>Sector</span><span>Momentum score</span><span>Index weight</span><span>20-day trend</span><span>Breadth</span>
          </div>
          <div role="list" aria-label="Ranked agriculture sectors">
            {rankedGroups.map((group, index) => {
              const active = selectedGroup?.group === group.group;
              const read = sectorRead(group.group_composite);
              const change20 = group.changes["20d"];
              return (
                <div key={group.group} role="listitem" className="border-b border-stealth-700/70 last:border-b-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedGroupKey(group.group)}
                    className={`grid min-h-16 w-full grid-cols-2 gap-2 px-4 py-3 text-left transition focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:grid-cols-[minmax(190px,1.4fr)_minmax(120px,.8fr)_100px_120px_120px] md:items-center md:gap-4 ${active ? "bg-sky-400/10" : "hover:bg-stealth-800/60"}`}
                  >
                  <span className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
                    <span className="w-5 shrink-0 text-xs tabular-nums text-stealth-500">{index + 1}</span>
                    <span><span className="block font-semibold text-white">{group.label}</span><span className={`mt-0.5 block text-xs ${read.tone}`}>{read.label}</span></span>
                  </span>
                  <span className="text-sm text-stealth-200"><span className="mr-1 text-xs text-stealth-500 md:hidden">Score</span><span className="font-semibold tabular-nums text-white">{group.group_composite.toFixed(1)}</span>/100</span>
                  <span className="text-sm tabular-nums text-stealth-200"><span className="mr-1 text-xs text-stealth-500 md:hidden">Weight</span>{group.effective_weight.toFixed(1)}%</span>
                  <span className="text-sm text-stealth-200"><span className="block">{trendRead(change20)}</span><span className="text-xs tabular-nums text-stealth-400">{formatSignedPercent(change20)}</span></span>
                  <span className="text-sm text-stealth-200"><span className="block">{breadthRead(group.breadth_score)}</span><span className="text-xs tabular-nums text-stealth-400">{group.breadth_score === null ? "Unavailable" : `${group.breadth_score.toFixed(1)}% participating`}</span></span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {selectedGroup && selectedComponent ? (
        <section aria-labelledby="contract-workspace-heading" className="overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-900/35">
          <div className="border-b border-stealth-700 px-4 py-4 md:px-5">
            <h2 id="contract-workspace-heading" className="text-xl font-semibold text-white">Inspect {selectedGroup.label}</h2>
            <p className="mt-1 text-sm text-stealth-300">Choose one contract; only its thesis stays open.</p>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(260px,.72fr)_minmax(0,1.6fr)]">
            <div className="min-w-0 overflow-hidden border-b border-stealth-700 p-3 lg:border-b-0 lg:border-r">
              <p id="agriculture-contract-scroll-hint" className="sr-only">Scroll horizontally to inspect more contracts on smaller screens.</p>
              <div
                className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:gap-1 lg:overflow-visible lg:pb-0"
                role="group"
                aria-label={`Select a ${selectedGroup.label} contract`}
                aria-describedby="agriculture-contract-scroll-hint"
                tabIndex={0}
              >
                {selectedComponents.map((component) => {
                  const active = component.code === selectedComponent.code;
                  return (
                    <button
                      key={component.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedIndicatorsByGroup((current) => ({ ...current, [selectedGroup.group]: component.code }))}
                      className={`grid min-h-14 min-w-40 grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:min-w-0 ${active ? "bg-sky-400/12 text-white" : "text-stealth-300 hover:bg-stealth-800/70 hover:text-white"}`}
                    >
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{component.name}</span><span className="mt-0.5 block text-xs text-stealth-400">{component.code} · 20d {formatSignedPercent(component.changes["20d"])}</span></span>
                      <span className="text-right text-xs tabular-nums text-stealth-300"><span className="block font-semibold text-white">{component.score.toFixed(1)}</span><span>score</span></span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="min-w-0 p-4 md:p-5">
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
                <div><h3 className="text-lg font-semibold text-white">{selectedComponent.name}</h3><p className="mt-1 text-xs text-stealth-400">{selectedComponent.code}{selectedComponent.ticker ? ` · ${selectedComponent.ticker}` : ""}</p></div>
                <p className="text-xs text-stealth-400">Sector metrics · Snapshot {formatSnapshot(data.as_of)}</p>
              </div>
              {selectedContext?.data ? (
                <CompactContextDigest context={selectedContext.data} variant="indicator" />
              ) : selectedContext?.loading || !selectedContext ? (
                <div className="min-h-40 py-8 text-sm text-stealth-300" role="status">Loading the current {selectedComponent.name} thesis…</div>
              ) : (
                <FallbackContractRead group={selectedGroup} component={selectedComponent} error={selectedContext.error} />
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="secondary-evidence-heading" className="space-y-3">
        <div>
          <h2 id="secondary-evidence-heading" className="text-xl font-semibold text-white">Supporting evidence</h2>
          <p className="mt-1 text-sm text-stealth-300">Open these only when the current read needs a deeper check. Every section uses the same snapshot.</p>
        </div>

        <Disclosure title="Relationships" interpretation={correlationSummary} timestamp={snapshot}>
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-white">Strongest relationships</h3>
              <p className="mt-1 text-xs leading-5 text-stealth-300">Positive values mean sectors moved together; negative values mean they diverged. Neither direction is inherently good or bad.</p>
              {strongestRelationships.length ? <div className="mt-3 divide-y divide-stealth-700/70 rounded-xl border border-stealth-700">
                {strongestRelationships.map((pair) => (
                  <div key={`${pair.left}-${pair.right}`} className="grid gap-1 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <p className="text-sm text-stealth-100">{groupLabels.get(pair.left) ?? formatGroupCode(pair.left)} and {groupLabels.get(pair.right) ?? formatGroupCode(pair.right)}</p>
                    <p className="text-xs text-stealth-300"><span className="font-semibold tabular-nums text-white">r {pair.value.toFixed(2)}</span> · {correlationMeaning(pair.value)}</p>
                  </div>
                ))}
              </div> : <p className="mt-3 text-sm text-stealth-300">No pairwise relationship history is available.</p>}
            </div>

            {matrix60.length ? <div>
              <h3 className="text-sm font-semibold text-white">Full 60-day matrix</h3>
              <div className="mt-3">
                <DataScroller label="60-day agriculture sector correlation matrix" hint="Scroll horizontally. Row and column headers remain visible while you inspect values.">
                  <table className="w-max min-w-[640px] border-separate border-spacing-0 text-xs text-stealth-300">
                    <caption className="sr-only">Pairwise 60-day correlations between agriculture sectors</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="sticky left-0 top-0 z-30 border-b border-r border-stealth-700 bg-stealth-900 px-3 py-2 text-left text-stealth-200">Sector</th>
                        {matrix60[0] ? Object.keys(matrix60[0].values).map((column) => (
                          <th scope="col" key={column} className="sticky top-0 z-20 border-b border-r border-stealth-700 bg-stealth-900 px-3 py-2 text-left text-stealth-200">{groupLabels.get(column) ?? formatGroupCode(column)}</th>
                        )) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix60.map((row) => (
                        <tr key={row.row}>
                          <th scope="row" className="sticky left-0 z-10 border-b border-r border-stealth-700 bg-stealth-900 px-3 py-2 text-left font-medium text-stealth-100">{groupLabels.get(row.row) ?? formatGroupCode(row.row)}</th>
                          {Object.entries(row.values).map(([column, value]) => (
                            <td key={column} className={`border-b border-r border-stealth-700 px-3 py-2 text-center tabular-nums ${correlationCellTone(value)}`}>
                              {value === null ? "—" : value.toFixed(2)}
                              {value !== null ? <span className="sr-only">, {correlationMeaning(value)}</span> : <span className="sr-only">, unavailable</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataScroller>
              </div>
            </div> : null}
          </div>
        </Disclosure>

        <Disclosure title="Macro pressure" interpretation={macroSummary} timestamp={snapshot}>
            <div className="divide-y divide-stealth-700/70 rounded-xl border border-stealth-700">
            {macroEntries.map(([key, item]) => {
              const value = item.change_20d ?? item.spread_20d;
              return (
                <div key={key} className="grid gap-1 px-3 py-3 sm:grid-cols-[minmax(170px,.7fr)_1fr_auto] sm:items-center sm:gap-4">
                  <p className="text-sm font-semibold text-white">{item.name}</p>
                  <p className="text-sm text-stealth-300">{item.status}</p>
                  <p className="text-xs tabular-nums text-stealth-400">20-day change {formatSignedPercent(value, 2)}</p>
                </div>
              );
            })}
            {data.special_signals ? (
              <>
                <div className="grid gap-1 px-3 py-3 sm:grid-cols-[minmax(170px,.7fr)_1fr_auto] sm:items-center sm:gap-4">
                  <p className="text-sm font-semibold text-white">Soybean oil vs grains</p>
                  <p className="text-sm text-stealth-300">{data.special_signals.soybean_oil_vs_grains.interpretation}</p>
                  <p className="text-xs tabular-nums text-stealth-400">20-day spread {formatSignedPercent(data.special_signals.soybean_oil_vs_grains.spread_20d, 2)}</p>
                </div>
                <div className="grid gap-1 px-3 py-3 sm:grid-cols-[minmax(170px,.7fr)_1fr_auto] sm:items-center sm:gap-4">
                  <p className="text-sm font-semibold text-white">Livestock feed margin</p>
                  <p className="text-sm text-stealth-300">{data.special_signals.livestock_feed_margin_pressure.interpretation}</p>
                  <p className="text-xs tabular-nums text-stealth-400">20-day spread {formatSignedPercent(data.special_signals.livestock_feed_margin_pressure.spread_20d, 2)}</p>
                </div>
              </>
            ) : null}
            {!macroEntries.length && !data.special_signals ? <p className="px-3 py-3 text-sm text-stealth-300">Macro evidence is unavailable in this snapshot.</p> : null}
          </div>
        </Disclosure>

        <Disclosure title="Data quality" interpretation={dataQualitySummary} timestamp={snapshot}>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div><dt className="text-xs font-semibold text-stealth-400">Contracts available</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-white">{data.availability.available_symbol_count}/{data.availability.total_configured_symbols}</dd></div>
            <div><dt className="text-xs font-semibold text-stealth-400">Sectors available</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-white">{data.availability.available_group_count}/6</dd></div>
            <div><dt className="text-xs font-semibold text-stealth-400">Coverage gaps</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-white">{data.availability.missing_symbols.length + data.availability.missing_macro_series.length}</dd></div>
          </dl>
          {data.availability.missing_symbols.length ? (
            <div className="mt-5"><h3 className="text-sm font-semibold text-white">Missing contracts</h3><ul className="mt-2 space-y-1 text-sm text-stealth-300">{data.availability.missing_symbols.map((item) => <li key={item.code}>{item.name} ({item.code}) · attempted {item.attempted_tickers.join(", ")}</li>)}</ul></div>
          ) : null}
          {data.availability.missing_macro_series.length ? (
            <div className="mt-5"><h3 className="text-sm font-semibold text-white">Missing macro inputs</h3><ul className="mt-2 space-y-1 text-sm text-stealth-300">{data.availability.missing_macro_series.map((item) => <li key={item}>{formatGroupCode(item)}</li>)}</ul></div>
          ) : null}
          {data.warnings.length ? <div className="mt-5 border-t border-stealth-700/80 pt-4 text-sm text-stealth-300">{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
        </Disclosure>
      </section>
    </div>
  );
}
