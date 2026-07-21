import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, BookOpen, FlaskConical, Languages, Layers } from "lucide-react";

import type {
  MarketWeatherDerivativePoint,
  MarketWeatherLexiconArchetype,
  MarketWeatherLexiconMotif,
  MarketWeatherResearch,
  MarketWeatherStrataLatest,
  MarketWeatherTimeframe,
} from "../../types/marketWeather";
import {
  buildMarketGlyphEncoding,
  clampUnit,
  describeMarketGlyph,
  marketStateColor,
} from "../../utils/marketWeatherLexicon";

type WorkbenchTab = "orders" | "strata" | "evidence";
type LanguageView = "now" | "dictionary" | "audit";
type DerivativeKey = "pressure" | "velocity" | "acceleration" | "jerk" | "snap";

interface MarketWeatherResearchLabProps {
  research: MarketWeatherResearch;
  symbol: string;
  timeframe: MarketWeatherTimeframe;
  barSize: string;
}

interface SyntaxRunSelection {
  stateId: string;
  start: number;
  stop: number;
  match: number;
  novelty: number;
  surprise: number;
}

const DERIVATIVES: Array<{ key: DerivativeKey; order: string }> = [
  { key: "pressure", order: "P" },
  { key: "velocity", order: "P′" },
  { key: "acceleration", order: "P″" },
  { key: "jerk", order: "P‴" },
  { key: "snap", order: "P⁗" },
];

const STRATA: Array<{
  key: keyof Pick<MarketWeatherStrataLatest, "structure" | "kinematics" | "geometry" | "information" | "propagation">;
  symbol: string;
  label: string;
}> = [
  { key: "structure", symbol: "S", label: "structure" },
  { key: "kinematics", symbol: "K", label: "kinematics" },
  { key: "geometry", symbol: "G", label: "geometry" },
  { key: "information", symbol: "I", label: "information" },
  { key: "propagation", symbol: "R", label: "propagation" },
];

const FOUNDATIONS = [
  ["Permutation entropy", "Bandt & Pompe (2002)", "https://link.aps.org/doi/10.1103/PhysRevLett.88.174102"],
  ["Optical-flow constraint", "Horn & Schunck (1981)", "https://doi.org/10.1016/0004-3702(81)90024-2"],
  ["Multiscaling", "Mandelbrot, Fisher & Calvet (1997)", "https://cowles.yale.edu/node/145456"],
  ["Time-causal scale-space", "Lindeberg (2017)", "https://link.springer.com/article/10.1007/s10851-016-0691-3"],
  ["State-space reconstruction", "Takens (1981)", "https://doi.org/10.1007/BFb0091924"],
  ["Surrogate-data nulls", "Theiler et al. (1992)", "https://doi.org/10.1016/0167-2789(92)90102-S"],
  ["Multiple-test discipline", "Harvey, Liu & Zhu (2016)", "https://academic.oup.com/rfs/article/29/1/5/1843824"],
] as const;

function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : `${Math.round(value * 100)}%`;
}

function formatReturn(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const percent = value * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function parseTimestamp(value: string): Date {
  return new Date(value.includes("T") ? value : `${value}T00:00:00`);
}

function formatDate(value: string, timeframe: MarketWeatherTimeframe): string {
  const date = parseTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  return ["1D", "1W"].includes(timeframe)
    ? date.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}

function polygonPoints(facets: number, radius: number, center = 100): string {
  return Array.from({ length: facets }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / facets;
    return `${center + Math.cos(angle) * radius},${center + Math.sin(angle) * radius}`;
  }).join(" ");
}

function StateGlyph({
  archetype,
  size = 220,
  muted = false,
  match = 1,
  novelty = 0,
  decorative = false,
}: {
  archetype: MarketWeatherLexiconArchetype;
  size?: number;
  muted?: boolean;
  match?: number;
  novelty?: number;
  decorative?: boolean;
}) {
  const instanceId = useId().replace(/:/g, "");
  const encoding = buildMarketGlyphEncoding(archetype.centroid);
  const color = marketStateColor(archetype.id);
  const dash = Math.max(2, (Math.PI * 2 * 76) / encoding.textureDashes);
  const boundedMatch = clampUnit(match);
  const boundedNovelty = clampUnit(novelty);
  const label = `${archetype.token}, state ${archetype.id}: ${describeMarketGlyph(archetype.centroid)}. ${encoding.facetCount} geometry facets, ${encoding.ringCount} structure rings, ${encoding.trailCount} propagation trails.`;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      focusable="false"
      className={`h-auto max-w-full ${muted ? "opacity-75" : ""}`}
    >
      <defs>
        <radialGradient id={`core-${instanceId}`} cx="50%" cy="44%" r="64%">
          <stop offset="0%" stopColor={color} stopOpacity="0.36" />
          <stop offset="100%" stopColor={color} stopOpacity="0.03" />
        </radialGradient>
        <filter id={`glow-${instanceId}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g transform={`rotate(${encoding.cascadeTilt} 100 100)`}>
        {Array.from({ length: encoding.trailCount }, (_, index) => {
          const offset = (index - (encoding.trailCount - 1) / 2) * 9;
          return (
            <path
              key={index}
              d={`M ${48 - encoding.trailLength} ${100 + offset} Q ${58 - encoding.trailLength / 3} ${90 + offset} 72 ${100 + offset}`}
              fill="none"
              stroke={color}
              strokeWidth={1.2 + index * 0.35}
              strokeDasharray="4 5"
              opacity={0.3 + index * 0.13}
            />
          );
        })}
        <circle cx="100" cy="100" r="82" fill={`url(#core-${instanceId})`} opacity="0.52" />
        <circle
          cx="100"
          cy="100"
          r="86"
          fill="none"
          stroke="#cbd5e1"
          strokeWidth={1.2 + boundedMatch * 1.4}
          strokeDasharray={boundedMatch >= 0.72 ? undefined : `${2 + boundedMatch * 8} ${4 + (1 - boundedMatch) * 8}`}
          opacity={0.24 + boundedMatch * 0.48}
        />
        {boundedNovelty > 0.05 ? (
          <circle
            cx="100"
            cy="100"
            r="92"
            fill="none"
            stroke="#fbbf24"
            strokeWidth={0.8 + boundedNovelty * 2.2}
            strokeDasharray="13 9"
            opacity={0.18 + boundedNovelty * 0.72}
          />
        ) : null}
        <circle
          cx="100"
          cy="100"
          r="76"
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          strokeDasharray={`${dash * 0.34} ${dash * 0.66}`}
          opacity="0.48"
        />
        {Array.from({ length: encoding.ringCount }, (_, index) => (
          <circle
            key={index}
            cx="100"
            cy="100"
            r={encoding.structureRadius - index * 8}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(1, encoding.pulseWidth - index * 0.7)}
            opacity={0.2 + (encoding.ringCount - index) * 0.16}
          />
        ))}
        <polygon
          points={polygonPoints(encoding.facetCount, 27 + Math.abs(encoding.pressure) * 8)}
          fill={color}
          fillOpacity="0.08"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          filter={`url(#glow-${instanceId})`}
        />
        <g transform={`translate(100 100) rotate(${encoding.coreRotation}) scale(${encoding.coreScale})`}>
          {encoding.direction === "level" ? (
            <path d="M -13 0 H 13" stroke={color} strokeWidth="5" strokeLinecap="round" />
          ) : (
            <path d="M -11 -9 L 12 0 L -11 9 Z" fill={color} />
          )}
        </g>
        <circle cx="100" cy="100" r="3.5" fill="#e2e8f0" />
      </g>
    </svg>
  );
}

function MachineMeter({ label, symbol, value, inverse = false }: { label: string; symbol: string; value: number; inverse?: boolean }) {
  const normalized = clampUnit(value);
  return (
    <div className="min-w-0" title={`${label}: ${Math.round(normalized * 100)}%`}>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-slate-500">
        <span>{symbol}</span><span>{Math.round(normalized * 100).toString().padStart(2, "0")}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-label={`${label} ${Math.round(normalized * 100)} percent`}>
        <div className={`h-full rounded-full ${inverse ? "bg-amber-300" : "bg-sky-300"}`} style={{ width: `${normalized * 100}%` }} />
      </div>
    </div>
  );
}

function SyntaxRibbon({
  sequence,
  archetypes,
  selectedRunStart,
  onSelect,
}: {
  sequence: NonNullable<MarketWeatherResearch["lexicon"]>["evaluation_sequence"];
  archetypes: MarketWeatherLexiconArchetype[];
  selectedRunStart: number | null;
  onSelect: (run: SyntaxRunSelection) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const lookup = useMemo(() => new Map(archetypes.map((archetype) => [archetype.id, archetype])), [archetypes]);
  const runs = useMemo(() => {
    const grouped: Array<SyntaxRunSelection & { matchTotal: number; observations: number }> = [];
    sequence.forEach((point) => {
      const previous = grouped[grouped.length - 1];
      if (previous?.stateId === point.state_id) {
        previous.stop = point.index;
        previous.matchTotal += point.match;
        previous.observations += 1;
        previous.match = previous.matchTotal / previous.observations;
        previous.novelty = Math.max(previous.novelty, point.novelty);
        previous.surprise = Math.max(previous.surprise, point.transition_surprise);
      } else {
        grouped.push({ stateId: point.state_id, start: point.index, stop: point.index, match: point.match, matchTotal: point.match, observations: 1, novelty: point.novelty, surprise: point.transition_surprise });
      }
    });
    return grouped.slice(-15);
  }, [sequence]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = viewport.scrollWidth;
  }, [runs]);

  return (
    <div ref={viewportRef} className="h-[108px] overflow-x-auto overflow-y-hidden rounded-2xl border border-stealth-700 bg-slate-950/45 px-3 py-2" aria-label="Evaluation syntax ribbon">
      <div className="flex h-full min-w-max items-center gap-2">
        {runs.map((run, runIndex) => {
          const archetype = lookup.get(run.stateId);
          const selected = selectedRunStart === null ? runIndex === runs.length - 1 : run.start === selectedRunStart;
          const duration = run.stop - run.start + 1;
          const surprise = clampUnit(run.surprise / 4);
          if (!archetype) return null;
          return (
            <button
              key={`${run.start}-${run.stateId}`}
              type="button"
              onClick={() => onSelect(run)}
              style={{ width: `${Math.max(58, Math.min(154, 46 + duration * 8))}px` }}
              className={`relative flex h-[88px] shrink-0 items-center justify-center rounded-lg border px-1 pb-3 outline-none transition focus-visible:ring-2 focus-visible:ring-white ${selected ? "border-white/35 bg-white/[0.04]" : "border-transparent hover:bg-white/[0.025]"}`}
              title={`${archetype.token} · ${duration} bars · resonance ${formatRate(run.match)} · novelty ${formatRate(run.novelty)} · surprise ${run.surprise.toFixed(2)}`}
              aria-label={`${archetype.token}, ${duration} bar run, resonance ${formatRate(run.match)}, novelty ${formatRate(run.novelty)}`}
            >
              {runIndex > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -left-[6px] top-2 h-14 border-l border-amber-300"
                  style={{ borderLeftStyle: surprise > 0.55 ? "dashed" : "solid", borderLeftWidth: `${1 + surprise * 4}px`, opacity: 0.2 + surprise * 0.75 }}
                />
              ) : null}
              <StateGlyph archetype={archetype} size={58} muted={!selected} match={run.match} novelty={run.novelty} decorative />
              <span className="absolute bottom-1.5 left-1/2 z-[1] -translate-x-1/2 font-mono text-[10px] text-slate-400">{duration}</span>
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-1 right-1 border-t border-amber-200/70 bg-[repeating-linear-gradient(90deg,rgba(251,191,36,.8)_0_3px,transparent_3px_6px)]"
                style={{ height: `${1 + clampUnit(run.novelty) * 7}px`, opacity: 0.2 + clampUnit(run.novelty) * 0.8 }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TransitionMatrix({
  lexicon,
  selectedId,
  onSelect,
  translate,
}: {
  lexicon: NonNullable<MarketWeatherResearch["lexicon"]>;
  selectedId: string;
  onSelect: (stateId: string) => void;
  translate: boolean;
}) {
  const tokenById = new Map(lexicon.archetypes.map((archetype) => [archetype.id, archetype.token]));
  const archetypeById = new Map(lexicon.archetypes.map((archetype) => [archetype.id, archetype]));
  const stateIds = lexicon.grammar.state_ids;
  const selectedIndex = Math.max(0, stateIds.indexOf(selectedId));
  const likely = lexicon.grammar.likely_next.find((item) => item.from_state === selectedId);

  return (
    <div className="min-w-0 rounded-2xl border border-stealth-700 bg-slate-950/35 p-4">
      <div className="flex min-h-10 items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">M · Motion</div>
          <div className="mt-1 font-mono text-sm text-slate-100">
            {tokenById.get(selectedId) ?? selectedId} <ArrowRight className="inline h-3.5 w-3.5" /> {likely?.reliable ? likely.to_token : "unresolved"}
          </div>
          <div className="mt-1 font-mono text-[10px] text-slate-500">exit support n={likely?.support ?? 0}</div>
        </div>
        <span className="font-mono text-xs text-sky-300">{likely?.reliable ? formatRate(likely.probability) : "–"}</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="mx-auto border-separate border-spacing-1" aria-label="Calibration-only state transition matrix">
          <thead>
            <tr><th className="w-8" />{stateIds.map((stateId) => {
              const archetype = archetypeById.get(stateId);
              return <th key={stateId} className="pb-1 text-center font-mono text-[10px] text-slate-500">{archetype ? <StateGlyph archetype={archetype} size={30} muted decorative /> : stateId}</th>;
            })}</tr>
          </thead>
          <tbody>
            {stateIds.map((fromState, rowIndex) => (
              <tr key={fromState}>
                <th className="pr-1 text-right font-mono text-[10px] text-slate-500">
                  <button type="button" onClick={() => onSelect(fromState)} className={fromState === selectedId ? "text-white" : "hover:text-white"} aria-label={`Select ${tokenById.get(fromState)}`}>{archetypeById.get(fromState) ? <StateGlyph archetype={archetypeById.get(fromState)!} size={28} muted={fromState !== selectedId} decorative /> : fromState}</button>
                </th>
                {stateIds.map((toState, columnIndex) => {
                  const probability = lexicon.grammar.probabilities[rowIndex]?.[columnIndex] ?? 0;
                  return (
                    <td key={toState}>
                      <button
                        type="button"
                        onClick={() => onSelect(toState)}
                        className={`grid h-10 w-10 place-items-center rounded-md border font-mono text-[10px] transition hover:brightness-150 sm:h-11 sm:w-11 ${rowIndex === selectedIndex ? "border-white/20" : "border-white/5"}`}
                        style={{ backgroundColor: `${marketStateColor(toState)}${Math.round((0.1 + probability * 0.9) * 255).toString(16).padStart(2, "0")}` }}
                        title={`${tokenById.get(fromState)} → ${tokenById.get(toState)}: ${formatRate(probability)}`}
                        aria-label={`${tokenById.get(fromState)} to ${tokenById.get(toState)}, ${formatRate(probability)}`}
                      >
                        {Math.round(probability * 100)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 min-h-5 text-center text-[10px] text-slate-500">
        {translate ? "Rows are current states; columns are calibration-estimated next states." : "P(Lₜ₊₁ | Lₜ) · calibration only"}
      </div>
    </div>
  );
}

function MotifCard({
  motif,
  archetypes,
  translate,
}: {
  motif: MarketWeatherLexiconMotif;
  archetypes: MarketWeatherLexiconArchetype[];
  translate: boolean;
}) {
  const lookup = new Map(archetypes.map((archetype) => [archetype.id, archetype]));
  return (
    <article className={`rounded-xl border p-3 ${motif.current ? "border-sky-300/45 bg-sky-950/20" : "border-stealth-700 bg-slate-950/30"}`}>
      <div className="flex items-center gap-1.5 overflow-hidden">
        {motif.states.map((stateId, index) => {
          const archetype = lookup.get(stateId);
          if (!archetype) return null;
          return (
            <div key={`${stateId}-${index}`} className="flex min-w-0 items-center gap-1">
              <StateGlyph archetype={archetype} size={38} muted decorative />
              {index < motif.states.length - 1 ? <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" /> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-slate-200">{motif.id} · {motif.tokens.join("·")}</span>
        <span className="shrink-0 font-mono text-[10px] text-slate-500">×{motif.count}</span>
      </div>
      <div className="mt-1 min-h-4 text-[10px] text-slate-500">
        {translate ? `${motif.typical_span_bars} bars · next ${formatReturn(motif.outcome.mean_return)} · n=${motif.outcome.sample_size}` : motif.current ? "⌁ current phrase" : `Δ${motif.length} · τ${motif.typical_span_bars}`}
      </div>
    </article>
  );
}

function DerivativeHeatmap({ series, timeframe }: { series: MarketWeatherDerivativePoint[]; timeframe: MarketWeatherTimeframe }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = 216;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => setWidth(wrapper.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || !series.length) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "rgb(10,17,29)";
    context.fillRect(0, 0, width, height);
    const left = 38;
    const bottom = 24;
    const cellWidth = (width - left - 8) / series.length;
    const cellHeight = (height - bottom - 8) / DERIVATIVES.length;
    DERIVATIVES.forEach((derivative, row) => {
      series.forEach((point, column) => {
        const value = Math.max(-1, Math.min(1, point[derivative.key]));
        const alpha = 0.12 + Math.abs(value) * 0.88;
        context.fillStyle = value >= 0 ? `rgba(45,212,191,${alpha})` : `rgba(251,113,133,${alpha})`;
        context.fillRect(left + column * cellWidth, 7 + row * cellHeight, Math.max(1, cellWidth + 0.2), cellHeight + 0.2);
      });
      context.fillStyle = "rgba(148,163,184,.8)";
      context.font = "11px IBM Plex Mono, monospace";
      context.textAlign = "right";
      context.fillText(derivative.order, left - 7, 7 + (row + 0.58) * cellHeight);
    });
    context.textAlign = "left";
    context.fillStyle = "rgba(100,116,139,.85)";
    context.fillText(formatDate(series[0].date, timeframe), left, height - 7);
    context.textAlign = "right";
    context.fillText(formatDate(series[series.length - 1].date, timeframe), width - 8, height - 7);
  }, [series, timeframe, width]);

  return <div ref={wrapperRef} className="overflow-hidden rounded-xl border border-stealth-700"><canvas ref={canvasRef} className="block w-full" aria-label="Pressure derivative order heatmap" /></div>;
}

function Workbench({ research, symbol, timeframe, barSize }: MarketWeatherResearchLabProps) {
  const [tab, setTab] = useState<WorkbenchTab>("orders");
  const latest = research.strata.latest;
  return (
    <div className="bg-slate-950/20">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-stealth-700 px-4 py-3 text-sm font-medium text-slate-300 sm:px-5">
        <span className="inline-flex items-center gap-2"><Layers className="h-4 w-4 text-violet-300" /> Audit / Workbench</span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{symbol} · {barSize}</span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="mb-4 flex w-full max-w-md rounded-xl border border-stealth-700 bg-slate-950/50 p-1" role="tablist" aria-label="Research workbench">
          {(["orders", "strata", "evidence"] as WorkbenchTab[]).map((option) => (
            <button key={option} type="button" role="tab" aria-selected={tab === option} onClick={() => setTab(option)} className={`min-h-9 flex-1 rounded-lg px-3 text-xs capitalize transition ${tab === option ? "bg-violet-500/20 text-violet-200" : "text-slate-500 hover:text-slate-200"}`}>{option}</button>
          ))}
        </div>
        {tab === "orders" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,.5fr)]">
            <DerivativeHeatmap series={research.derivative_series} timeframe={timeframe} />
            <div className="grid grid-cols-5 gap-2 lg:grid-cols-1">
              {DERIVATIVES.map((derivative, index) => (
                <div key={derivative.key} className="rounded-lg border border-stealth-700 bg-slate-950/30 px-3 py-2 font-mono text-xs text-slate-300"><span className="text-violet-300">{derivative.order}</span><span className="ml-2 text-slate-600">d{index}</span></div>
              ))}
            </div>
          </div>
        ) : null}
        {tab === "strata" ? (
          <div className="grid gap-3 sm:grid-cols-5">
            {STRATA.map((stratum) => (
              <div key={stratum.key} className="rounded-xl border border-stealth-700 bg-slate-950/30 p-3">
                <div className="flex items-center justify-between font-mono text-xs"><span className="text-violet-300">{stratum.symbol}</span><span className="text-slate-200">{formatRate(latest[stratum.key])}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-300" style={{ width: `${clampUnit(latest[stratum.key]) * 100}%` }} /></div>
                <div className="mt-2 text-[10px] uppercase tracking-wider text-slate-600">{stratum.label}</div>
              </div>
            ))}
          </div>
        ) : null}
        {tab === "evidence" ? (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-stealth-700">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="bg-slate-950/60 text-[9px] uppercase tracking-[0.16em] text-slate-600"><tr><th className="px-3 py-2">Test</th><th className="px-3 py-2">n</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Baseline</th><th className="px-3 py-2">Uplift</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-white/5">
                  {research.relationship_atlas.map((result) => <tr key={result.id}><td className="px-3 py-2 text-slate-200">{result.label}</td><td className="px-3 py-2 font-mono text-slate-400">{result.sample_size}</td><td className="px-3 py-2 font-mono text-slate-300">{formatReturn(result.event_mean)}</td><td className="px-3 py-2 font-mono text-slate-500">{formatReturn(result.baseline_mean)}</td><td className="px-3 py-2 font-mono text-sky-300">{formatReturn(result.uplift)}</td><td className="px-3 py-2 text-slate-500">{result.status}</td></tr>)}
                </tbody>
              </table>
            </div>
            <details className="rounded-xl border border-stealth-700 bg-slate-950/25 p-3">
              <summary className="cursor-pointer text-xs text-slate-400"><BookOpen className="mr-2 inline h-3.5 w-3.5" /> Published foundations</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {FOUNDATIONS.map(([title, authors, url]) => <a key={title} href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-white/5 px-3 py-2 text-xs text-slate-400 hover:border-violet-400/30 hover:text-white"><span className="block text-slate-200">{title}</span><span className="text-[10px] text-slate-600">{authors}</span></a>)}
              </div>
            </details>
            <div className="text-[10px] text-slate-600">{symbol} · {barSize} · chronological evaluation · overlapping outcomes · no multiple-test adjustment</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function MarketWeatherResearchLab({ research, symbol, timeframe, barSize }: MarketWeatherResearchLabProps) {
  const lexicon = research.lexicon;
  const [view, setView] = useState<LanguageView>("now");
  const [translate, setTranslate] = useState(false);
  const [selectedId, setSelectedId] = useState(lexicon?.current.state_id ?? "");
  const [selectedRun, setSelectedRun] = useState<SyntaxRunSelection | null>(null);

  useEffect(() => {
    setSelectedId(lexicon?.current.state_id ?? "");
    setSelectedRun(null);
  }, [lexicon?.current.state_id]);

  const archetypeById = useMemo(() => new Map(lexicon?.archetypes.map((archetype) => [archetype.id, archetype]) ?? []), [lexicon?.archetypes]);
  const selected = archetypeById.get(selectedId) ?? lexicon?.archetypes[0];
  const selectedIsCurrent = selectedRun === null && selectedId === lexicon?.current.state_id;
  const selectedMatch = selectedRun?.match ?? (selectedIsCurrent ? lexicon?.current.match ?? 0 : 0);
  const selectedNovelty = selectedRun?.novelty ?? (selectedIsCurrent ? lexicon?.current.novelty ?? 0 : 0);
  const selectedSurprise = selectedRun?.surprise ?? (selectedIsCurrent ? lexicon?.current.transition_surprise ?? 0 : 0);
  const selectedAge = selectedRun ? selectedRun.stop - selectedRun.start + 1 : (selectedIsCurrent ? lexicon?.current.age_bars ?? 0 : selected?.typical_duration_bars ?? 0);
  const selectedIsUnknown = selectedNovelty >= 0.75;
  const phrase = useMemo(() => {
    if (!lexicon) return [];
    const runCollapsed: string[] = [];
    for (const point of lexicon.evaluation_sequence.slice().reverse()) {
      if (runCollapsed[0] !== point.state_id) runCollapsed.unshift(point.state_id);
      if (runCollapsed.length >= 6) break;
    }
    return runCollapsed.map((stateId) => archetypeById.get(stateId)).filter((item): item is MarketWeatherLexiconArchetype => Boolean(item));
  }, [archetypeById, lexicon]);
  const motifs = useMemo(() => lexicon?.motifs.slice().sort((a, b) => Number(b.current) - Number(a.current) || b.count - a.count).slice(0, 6) ?? [], [lexicon?.motifs]);
  const likelyNext = lexicon?.grammar.likely_next.find((item) => item.from_state === selectedId);
  const currentPhrase = motifs.find((motif) => motif.current);

  return (
    <section className="primary-card relative isolate overflow-hidden">
      <div className="relative z-0 border-b border-stealth-700 p-4 sm:p-5">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-violet-300" /><span className="page-kicker">Field language · {lexicon?.version ?? "learning"}</span></div>
            <h2 className="mt-1 text-xl font-semibold text-white">Now · Dictionary · Motion · Phrase</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-h-10 rounded-xl border border-stealth-700 bg-slate-950/45 p-1" role="tablist" aria-label="Field language view">
              {(["now", "dictionary", "audit"] as LanguageView[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  id={`field-language-${option}-tab`}
                  aria-controls={`field-language-${option}-panel`}
                  aria-selected={view === option}
                  onClick={() => {
                    setView(option);
                    if (option === "now" && lexicon) {
                      setSelectedId(lexicon.current.state_id);
                      setSelectedRun(null);
                    }
                  }}
                  className={`min-w-[76px] rounded-lg px-3 text-xs capitalize transition ${view === option ? "bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/25" : "text-slate-500 hover:text-white"}`}
                >
                  {option}
                </button>
              ))}
            </div>
            {view !== "audit" ? <button
              type="button"
              onClick={() => setTranslate((current) => !current)}
              aria-pressed={translate}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition ${translate ? "border-sky-300/40 bg-sky-400/15 text-sky-100" : "border-stealth-600 bg-slate-950/45 text-slate-400 hover:text-white"}`}
            >
              <Languages className="h-4 w-4" /> Translate {translate ? "on" : "off"}
            </button> : null}
          </div>
        </div>
      </div>

      {view !== "audit" && lexicon && selected ? (
        <div id={`field-language-${view}-panel`} role="tabpanel" aria-labelledby={`field-language-${view}-tab`} className="relative z-0 p-4 sm:p-5">
          <div className={`grid gap-4 ${view === "now" ? "xl:grid-cols-[minmax(360px,.85fr)_minmax(0,1.15fr)]" : "grid-cols-1"}`}>
            <div className={`relative min-h-[430px] overflow-hidden rounded-3xl border border-stealth-700 bg-[radial-gradient(circle_at_50%_34%,rgba(88,80,180,0.15),rgba(2,6,23,0.7)_68%)] p-4 ${view === "now" ? "" : "hidden"}`}>
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:28px_28px]" />
              <div className="relative flex min-h-[397px] flex-col items-center justify-center">
                <div className="absolute left-0 top-0 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">{selectedIsCurrent ? "Now" : `Form ${selected.id}`}</div>
                <StateGlyph archetype={selected} size={268} match={selectedMatch} novelty={selectedNovelty} />
                <div className="-mt-5 text-center">
                  <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-slate-600">{selected.id}</div>
                  <div className={`mt-1 font-mono text-3xl font-semibold tracking-[0.08em] ${selectedIsUnknown ? "text-amber-200" : "text-white"}`}>{selectedIsUnknown ? "Unknown" : selected.token}</div>
                  <div className="mt-2 h-10 max-w-sm overflow-hidden text-xs leading-5 text-slate-400">{translate ? (selectedIsUnknown ? `Outside learned Form distance; nearest Fieldmark is ${selected.token}.` : describeMarketGlyph(selected.centroid)) : `⌬${selected.id} · φ${formatRate(selected.window_frequency)} · τ${selectedAge}`}</div>
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className={`grid min-h-[126px] grid-cols-2 gap-3 rounded-2xl border border-stealth-700 bg-slate-950/35 p-4 sm:grid-cols-4 ${view === "now" ? "" : "hidden"}`}>
                <MachineMeter label="Form resonance" symbol="μ" value={selectedMatch} />
                <MachineMeter label="novelty" symbol="ν" value={selectedNovelty} inverse />
                <MachineMeter label="state persistence" symbol="τ" value={Math.min(1, selectedAge / 20)} />
                <MachineMeter label="transition surprise" symbol="σ" value={Math.min(1, selectedSurprise / 4)} inverse />
                <div className="col-span-2 min-h-7 text-[11px] text-slate-500 sm:col-span-4">{translate ? "Form resonance · Unknown distance · persistence · Motion surprise" : "μ(F) · ν(x|F) · τ(F) · −ln P(Fₜ|Fₜ₋₁)"}</div>
              </div>

              {view === "now" ? (
                <div className="grid min-h-[184px] gap-3 rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 sm:grid-cols-2">
                  <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">M · likely Motion</div>
                    <div className="my-3 flex items-center gap-2 font-mono text-sm text-slate-200">
                      <StateGlyph archetype={selected} size={54} muted decorative />
                      <ArrowRight className="h-4 w-4 text-slate-600" />
                      {likelyNext?.reliable && likelyNext.to_state && archetypeById.get(likelyNext.to_state) ? <StateGlyph archetype={archetypeById.get(likelyNext.to_state)!} size={54} decorative /> : <span>–</span>}
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">{likelyNext?.reliable && likelyNext.to_token ? `${selected.token} → ${likelyNext.to_token} · ${formatRate(likelyNext.probability)} · n=${likelyNext.support}` : `Motion unresolved · n=${likelyNext?.support ?? 0}`}</div>
                  </div>
                  <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">P · current Phrase</div>
                    {currentPhrase ? <MotifCard motif={currentPhrase} archetypes={lexicon.archetypes} translate={translate} /> : <div className="my-3 font-mono text-xs text-slate-600">P = ∅</div>}
                    {!currentPhrase ? <div className="font-mono text-[10px] text-slate-600">No repeated Phrase at Now</div> : null}
                  </div>
                </div>
              ) : null}

              <div className={view === "dictionary" ? "font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600" : "hidden"}>D · Fieldmark dictionary</div>
              <div className={view === "dictionary" ? "grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5" : "hidden"} aria-label="Learned Fieldmark dictionary">
                {lexicon.archetypes.map((archetype) => (
                  <button
                    key={archetype.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(archetype.id);
                      setSelectedRun(null);
                    }}
                    aria-pressed={selectedId === archetype.id}
                    className={`min-h-[188px] rounded-2xl border px-2 py-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${selectedId === archetype.id ? "border-sky-300/50 bg-sky-950/20" : "border-stealth-700 bg-slate-950/25 hover:border-stealth-500"}`}
                  >
                    <StateGlyph archetype={archetype} size={92} muted={selectedId !== archetype.id} decorative />
                    <span className="block font-mono text-xs font-semibold text-slate-100">{archetype.token}</span>
                    <span className="mt-1 block h-8 overflow-hidden text-[10px] leading-4 text-slate-500">{translate ? describeMarketGlyph(archetype.centroid) : `${archetype.id} · ${formatRate(archetype.window_frequency)}`}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={view === "now" ? "mt-4" : "hidden"}>
            <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">{translate ? "Evaluation syntax" : "Σ · syntax"}</div>
              <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden font-mono text-[10px] text-slate-500">
                {phrase.map((archetype, index) => <span key={`${archetype.id}-${index}`} className="inline-flex items-center gap-1"><span style={{ color: marketStateColor(archetype.id) }}>{archetype.token}</span>{index < phrase.length - 1 ? <span className="text-slate-700">›</span> : null}</span>)}
              </div>
            </div>
            <SyntaxRibbon
              sequence={lexicon.evaluation_sequence}
              archetypes={lexicon.archetypes}
              selectedRunStart={selectedRun?.start ?? null}
              onSelect={(run) => {
                const latestPoint = lexicon.evaluation_sequence[lexicon.evaluation_sequence.length - 1];
                setSelectedId(run.stateId);
                setSelectedRun(latestPoint && run.stop === latestPoint.index && run.stateId === lexicon.current.state_id ? null : run);
              }}
            />
          </div>

          <div className={view === "dictionary" ? "mt-4 grid gap-4 xl:grid-cols-[minmax(320px,.72fr)_minmax(0,1.28fr)]" : "hidden"}>
            <TransitionMatrix lexicon={lexicon} selectedId={selectedId} onSelect={setSelectedId} translate={translate} />
            <div className="rounded-2xl border border-stealth-700 bg-slate-950/25 p-4">
              <div className="flex min-h-10 items-start justify-between gap-3">
                <div><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">P · Phrase</div><div className="mt-1 text-xs text-slate-400">{translate ? "Repeated run-collapsed Form sequences" : "2 ≤ |P| ≤ 4"}</div></div>
                <span className="font-mono text-xs text-slate-600">{lexicon.motifs.length}</span>
              </div>
              {motifs.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{motifs.map((motif) => <MotifCard key={motif.id} motif={motif} archetypes={lexicon.archetypes} translate={translate} />)}</div>
              ) : (
                <div className="mt-3 grid min-h-[116px] place-items-center rounded-xl border border-dashed border-stealth-700 font-mono text-xs text-slate-600">P = ∅ · still learning</div>
              )}
            </div>
          </div>

          <div className={view === "now" ? "mt-4 grid min-h-[68px] gap-2 rounded-2xl border border-stealth-700 bg-slate-950/30 p-3 sm:grid-cols-[1fr_auto] sm:items-center" : "hidden"}>
            <div className="min-w-0 font-mono text-xs text-slate-300">
              {translate ? "Core = pressure · rings = structure · facets = geometry" : `${selected.token} · age ${selectedAge} · resonance ${formatRate(selectedMatch)} · novelty ${formatRate(selectedNovelty)}`}
            </div>
            <div className="text-[10px] text-slate-600">
              {translate ? "weight = kinematics · dashes = information · trails = propagation · tilt = cascade" : `D₀:${lexicon.training_split.calibration_bars} | D₁:${lexicon.training_split.evaluation_bars} | y∉fit`}
            </div>
          </div>
        </div>
      ) : view !== "audit" ? (
        <div className="grid min-h-[260px] place-items-center p-8 text-center">
          <div><Activity className="mx-auto h-7 w-7 text-violet-300" /><div className="mt-3 font-mono text-sm text-slate-300">Lexicon calibration pending</div><div className="mt-1 text-xs text-slate-600">The workbench remains available below.</div></div>
        </div>
      ) : null}

      {view === "audit" ? <div id="field-language-audit-panel" role="tabpanel" aria-labelledby="field-language-audit-tab"><Workbench research={research} symbol={symbol} timeframe={timeframe} barSize={barSize} /></div> : null}
    </section>
  );
}
