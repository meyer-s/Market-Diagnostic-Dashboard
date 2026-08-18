import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import DataScroller from "../ui/DataScroller";
import { apiFetch } from "../../utils/apiUtils";
import { CompactContextDigest, type AgricultureContextData } from "./AgricultureContextPanel";
import { ContractSignalBadge } from "./ContractSignalBadge";

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
  children,
}: {
  title: string;
  interpretation: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-stealth-700 bg-stealth-900/35 open:bg-stealth-900/55">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:px-5">
        <span>
          <span className="block text-sm font-semibold text-white">{title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-stealth-300">{interpretation}</span>
        </span>
        <span className="shrink-0 text-stealth-400 transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
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
  const contextsRef = useRef<Record<string, ContextEntry>>({});
  const inFlightSymbolsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    contextsRef.current = contexts;
  }, [contexts]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!rankedGroups.some((group) => group.group === selectedGroupKey)) {
      setSelectedGroupKey(rankedGroups[0]?.group ?? "");
    }
  }, [rankedGroups, selectedGroupKey]);

  const selectedGroup = rankedGroups.find((group) => group.group === selectedGroupKey) ?? rankedGroups[0];
  const selectedComponents = useMemo(
    () => selectedGroup ? sortGroupComponents(selectedGroup) : [],
    [selectedGroup]
  );
  const selectedComponentCodes = useMemo(
    () => selectedComponents.map((component) => component.code),
    [selectedComponents]
  );
  const selectedCode = selectedGroup
    ? selectedIndicatorsByGroup[selectedGroup.group] ?? selectedComponents[0]?.code
    : undefined;
  const selectedComponent = selectedComponents.find((component) => component.code === selectedCode) ?? selectedComponents[0];
  const selectedContext = selectedComponent ? contexts[selectedComponent.code] : undefined;

  useEffect(() => {
    const missingSymbols = selectedComponentCodes.filter(
      (symbol) => !contextsRef.current[symbol] && !inFlightSymbolsRef.current.has(symbol)
    );
    if (!missingSymbols.length) return;

    for (const symbol of missingSymbols) inFlightSymbolsRef.current.add(symbol);
    setContexts((current) => {
      const next = { ...current };
      for (const symbol of missingSymbols) {
        next[symbol] = { data: null, error: null, loading: true };
      }
      return next;
    });

    let nextIndex = 0;
    const fetchSymbol = async (symbol: string) => {
      try {
        const payload = await apiFetch<AgricultureContextData>(`/agriculture/context?symbol=${encodeURIComponent(symbol)}`);
        if (isMountedRef.current) {
          setContexts((current) => ({ ...current, [symbol]: { data: payload, error: null, loading: false } }));
        }
      } catch (requestError) {
        if (isMountedRef.current) {
          setContexts((current) => ({
            ...current,
            [symbol]: {
              data: null,
              error: requestError instanceof Error ? requestError.message : "Failed to load contract context",
              loading: false,
            },
          }));
        }
      } finally {
        inFlightSymbolsRef.current.delete(symbol);
      }
    };
    const workerCount = Math.min(3, missingSymbols.length);
    void Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < missingSymbols.length) {
        const symbol = missingSymbols[nextIndex];
        nextIndex += 1;
        await fetchSymbol(symbol);
      }
    }));
  }, [selectedComponentCodes]);

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
    <div className="w-[calc(100vw-2rem)] min-w-0 max-w-full overflow-hidden space-y-5 md:w-auto md:space-y-6">
      <section aria-labelledby="sector-ranking-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="sector-ranking-heading" className="text-xl font-semibold text-white">Sector mix</h2>
          <p className="text-xs text-stealth-400">By weight · score / 20d</p>
        </div>

        <div
          className="mt-3 max-w-full overflow-hidden border-b border-stealth-700 md:overflow-x-auto"
          role="region"
          aria-label="Agriculture sector bookmarks"
          tabIndex={0}
        >
          <div role="list" aria-label="Agriculture sector mix" className="grid grid-cols-2 gap-px md:flex md:min-w-max md:gap-1 md:px-1">
            {rankedGroups.map((group, index) => {
              const active = selectedGroup?.group === group.group;
              const read = sectorRead(group.group_composite);
              const change20 = group.changes["20d"];
              return (
                <div key={group.group} role="listitem">
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSelectedGroupKey(group.group)}
                    className={`relative min-h-16 w-full min-w-0 rounded-t-xl px-3 py-2.5 text-left transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 md:min-w-48 ${active ? "bg-stealth-900/90 after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:bg-sky-300" : "hover:bg-stealth-900/55"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2"><span className="w-4 shrink-0 text-xs tabular-nums text-stealth-500">{index + 1}</span><span className="truncate text-sm font-semibold text-white">{group.label}</span>{active ? <span className="ml-auto shrink-0 font-semibold text-sky-200" aria-hidden="true">✓</span> : null}</span>
                    <span className="mt-2 flex items-center justify-between gap-2 text-xs tabular-nums">
                      <span className={read.tone}>{read.label.replace(" momentum", "")} · {group.group_composite.toFixed(1)}</span>
                      <span className={change20 !== null && change20 < 0 ? "text-rose-200" : "text-emerald-200"}>{formatSignedPercent(change20, 1)}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {selectedGroup && selectedComponent ? (
        <section aria-labelledby="contract-workspace-heading" className="overflow-hidden rounded-2xl border border-stealth-700 bg-stealth-900/35">
          <div className="min-w-0 md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="min-w-0 border-b border-stealth-700 bg-stealth-950/25 md:border-b-0 md:border-r">
              <div className="flex items-baseline justify-between gap-3 px-3 py-3">
                <h2 id="contract-workspace-heading" className="truncate text-base font-semibold text-white">{selectedGroup.label}</h2>
                <span className="shrink-0 text-xs text-stealth-500">A / F / T</span>
              </div>
              <p id="agriculture-contract-scroll-hint" className="sr-only">Contracts appear as vertical tabs on larger screens and a compact grid on smaller screens.</p>
              <nav
                className="grid min-w-0 grid-cols-2 gap-px border-t border-stealth-700 md:block"
                aria-label={`${selectedGroup.label} contracts`}
                aria-describedby="agriculture-contract-scroll-hint"
              >
                {selectedComponents.map((component) => {
                  const active = component.code === selectedComponent.code;
                  const contextEntry = contexts[component.code];
                  return (
                    <button
                      key={component.code}
                      type="button"
                      aria-pressed={active}
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelectedIndicatorsByGroup((current) => ({ ...current, [selectedGroup.group]: component.code }))}
                      className={`min-h-16 w-full min-w-0 border-b border-stealth-700/80 px-3 py-2 text-left transition focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 ${active ? "bg-sky-400/20 text-white ring-2 ring-inset ring-sky-300" : "bg-stealth-950/20 text-stealth-300 hover:bg-stealth-800/70 hover:text-white"}`}
                    >
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span aria-hidden="true" className="truncate text-sm font-semibold">{component.name}</span>
                        {active ? <span className="shrink-0 text-sky-200" aria-hidden="true">✓</span> : null}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <ContractSignalBadge
                          contractName={component.name}
                          context={contextEntry?.data}
                          loading={!contextEntry || contextEntry.loading}
                          error={contextEntry?.error}
                        />
                        <span aria-hidden="true" className={`text-xs tabular-nums ${component.changes["20d"] !== null && component.changes["20d"] < 0 ? "text-rose-200" : "text-emerald-200"}`}>
                          {formatSignedPercent(component.changes["20d"], 1)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="min-w-0">
              <div className="px-4 py-3 md:px-5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2"><h3 className="text-base font-semibold text-white">{selectedComponent.name}</h3><p className="text-xs text-stealth-400">{selectedComponent.code}{selectedComponent.ticker ? ` · ${selectedComponent.ticker}` : ""}</p></div>
                  <p className="text-xs tabular-nums text-stealth-400">Score {selectedComponent.score.toFixed(0)} · 20d {formatSignedPercent(selectedComponent.changes["20d"], 1)} · {formatSnapshot(data.as_of)}</p>
                </div>
                {selectedContext?.data ? (
                  <CompactContextDigest context={selectedContext.data} variant="indicator" />
                ) : selectedContext?.loading || !selectedContext ? (
                  <div className="min-h-40 py-8 text-sm text-stealth-300" role="status">Loading the current {selectedComponent.name} thesis…</div>
                ) : (
                  <FallbackContractRead group={selectedGroup} component={selectedComponent} error={selectedContext.error} />
                )}
              </div>

              <section aria-labelledby="secondary-evidence-heading" className="space-y-3 border-t border-stealth-700 px-4 py-4 md:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="secondary-evidence-heading" className="text-base font-semibold text-white">Supporting evidence</h2>
                  <p className="text-xs text-stealth-400">{formatSnapshot(data.as_of)}</p>
                </div>

                <Disclosure title="Relationships" interpretation={correlationSummary}>
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

                <Disclosure title="Macro pressure" interpretation={macroSummary}>
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

                <Disclosure title="Data quality" interpretation={dataQualitySummary}>
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
          </div>
        </section>
      ) : null}

    </div>
  );
}
