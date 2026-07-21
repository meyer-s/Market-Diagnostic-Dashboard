import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ExternalLink, FlaskConical, Layers, Orbit } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  MarketWeatherDerivativePoint,
  MarketWeatherRelationshipResult,
  MarketWeatherResearch,
  MarketWeatherStrataLatest,
  MarketWeatherTimeframe,
} from "../../types/marketWeather";
import { formatSigned } from "../../utils/marketWeather";

type LabTab = "derivatives" | "strata" | "evidence";
type DerivativeKey = "pressure" | "velocity" | "acceleration" | "jerk" | "snap";

interface MarketWeatherResearchLabProps {
  research: MarketWeatherResearch;
  symbol: string;
  timeframe: MarketWeatherTimeframe;
  barSize: string;
}

const DERIVATIVES: Array<{ key: DerivativeKey; order: string; label: string; read: string }> = [
  { key: "pressure", order: "0", label: "Pressure", read: "Field state" },
  { key: "velocity", order: "1", label: "Velocity", read: "State change" },
  { key: "acceleration", order: "2", label: "Acceleration", read: "Change in velocity" },
  { key: "jerk", order: "3", label: "Jerk", read: "Acceleration shock" },
  { key: "snap", order: "4", label: "Snap", read: "Jerk instability" },
];

const STRATA: Array<{
  key: keyof Pick<MarketWeatherStrataLatest, "structure" | "kinematics" | "geometry" | "information" | "propagation">;
  label: string;
  question: string;
  color: string;
}> = [
  { key: "structure", label: "Structure", question: "How organized and directional is the field?", color: "#5eead4" },
  { key: "kinematics", label: "Kinematics", question: "How violently are state changes changing?", color: "#fbbf24" },
  { key: "geometry", label: "Geometry", question: "How sharply does behavior bend across scale?", color: "#a78bfa" },
  { key: "information", label: "Information", question: "How disordered are the ordinal patterns?", color: "#f472b6" },
  { key: "propagation", label: "Propagation", question: "How strongly is a pattern migrating through horizons?", color: "#60a5fa" },
];

const CARRIERS = [
  { key: "price_structure", label: "Price structure", read: "Location and path of price itself", color: "#34d399" },
  { key: "realized_volatility", label: "Realized volatility", read: "Distinct dispersion carrier", color: "#f59e0b" },
  { key: "participation", label: "Participation", read: "Volume-confirmation carrier", color: "#38bdf8" },
  { key: "liquidity_stress", label: "Liquidity stress", read: "Return per unit dollar volume proxy", color: "#fb7185" },
] as const;

const RESEARCH_FOUNDATIONS = [
  {
    status: "Implemented",
    title: "Permutation entropy",
    authors: "Bandt & Pompe (2002)",
    use: "A causal ordinal-pattern disorder layer, distinct from the renderer's legacy field-disagreement proxy.",
    url: "https://link.aps.org/doi/10.1103/PhysRevLett.88.174102",
  },
  {
    status: "Implemented",
    title: "Optical-flow constraint",
    authors: "Horn & Schunck (1981)",
    use: "Inspires a regularized estimate of how pressure features migrate from shorter toward longer horizons or back.",
    url: "https://doi.org/10.1016/0004-3702(81)90024-2",
  },
  {
    status: "Implemented",
    title: "Multiscaling in asset returns",
    authors: "Mandelbrot, Fisher & Calvet (1997)",
    use: "Motivates the local realized-volatility scaling exponent across nested horizons.",
    url: "https://cowles.yale.edu/node/145456",
  },
  {
    status: "Adjacent",
    title: "Time-causal scale-space",
    authors: "Lindeberg (2017)",
    use: "The rigorous precedent for real-time multiscale derivatives; the current log-horizon calculus is an adaptation, not an implementation of the full scale-selection theory.",
    url: "https://link.springer.com/article/10.1007/s10851-016-0691-3",
  },
  {
    status: "Adjacent",
    title: "State-space reconstruction",
    authors: "Takens (1981)",
    use: "The pressure–velocity portrait is a readable two-coordinate projection, not a full delay-embedding reconstruction.",
    url: "https://doi.org/10.1007/BFb0091924",
  },
  {
    status: "Adjacent",
    title: "Rough volatility",
    authors: "Gatheral, Jaisson & Rosenbaum (2018)",
    use: "A warning that volatility's scale geometry is unusually rough; local exponents should be treated as state descriptors.",
    url: "https://doi.org/10.1111/mafi.12151",
  },
  {
    status: "Next",
    title: "Transfer entropy",
    authors: "Schreiber (2000)",
    use: "A candidate test for directional information flow between horizon bands after strong null-model controls.",
    url: "https://link.aps.org/doi/10.1103/PhysRevLett.85.461",
  },
  {
    status: "Next",
    title: "Wavelet coherence",
    authors: "Torrence & Compo (1998)",
    use: "A path to localized scale/time coupling without assuming stationary oscillations.",
    url: "https://journals.ametsoc.org/view/journals/bams/79/1/1520-0477_1998_079_0061_apgtwa_2_0_co_2.xml",
  },
  {
    status: "Next",
    title: "Topological crash landscapes",
    authors: "Gidea & Katz (2018)",
    use: "A path to testing whether persistent field shapes change before stress rather than merely during it.",
    url: "https://doi.org/10.1016/j.physa.2017.09.028",
  },
  {
    status: "Next",
    title: "Empirical mode decomposition",
    authors: "Huang et al. (1998)",
    use: "A future adaptive phase-and-mode layer, provided endpoint estimates are made causal and explicitly uncertainty-flagged.",
    url: "https://doi.org/10.1098/rspa.1998.0193",
  },
  {
    status: "Next",
    title: "Dynamic market modes",
    authors: "Mann & Kutz (2016)",
    use: "A path to rolling growth, decay, and oscillatory modes of the complete horizon profile rather than another cellwise indicator.",
    url: "https://arxiv.org/abs/1508.04487",
  },
  {
    status: "Next",
    title: "Recurrence structure",
    authors: "Fabretti & Ausloos (2005)",
    use: "A basis for historical field-state analogs and tests of whether regimes recur before transitions rather than only after them.",
    url: "https://doi.org/10.1142/S0129183105007492",
  },
  {
    status: "Next",
    title: "Sparse field equations",
    authors: "Rudy, Brunton, Proctor & Kutz (2017)",
    use: "A disciplined future test of whether parsimonious evolution equations describe the constructed field; this would be system identification, not market physics.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5406137/",
  },
  {
    status: "Guardrail",
    title: "Surrogate-data nulls",
    authors: "Theiler et al. (1992)",
    use: "The validation path for asking whether field topology, entropy, and apparent propagation survive linear, shuffled, and phase-randomized controls.",
    url: "https://doi.org/10.1016/0167-2789(92)90102-S",
  },
  {
    status: "Guardrail",
    title: "Multiple-test discipline",
    authors: "Harvey, Liu & Zhu (2016)",
    use: "The reason every attempted relationship must be counted and stronger evidence thresholds imposed as the hypothesis registry grows.",
    url: "https://academic.oup.com/rfs/article/29/1/5/1843824",
  },
] as const;

const TAB_OPTIONS: Array<{ value: LabTab; label: string }> = [
  { value: "derivatives", label: "Nth derivatives" },
  { value: "strata", label: "Strata" },
  { value: "evidence", label: "Evidence" },
];

const CHART_TOOLTIP_STYLE = {
  background: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: 12,
};

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
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

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "–";
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  return `${(value * 100).toFixed(1)}%`;
}

function formatReturn(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  const pct = value * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function signedColor(value: number): string {
  const magnitude = clamp(Math.abs(value));
  const base = value >= 0 ? [45, 212, 191] : [251, 113, 133];
  const dark = [15, 23, 42];
  const mixed = dark.map((channel, index) => Math.round(channel + (base[index] - channel) * (0.16 + magnitude * 0.84)));
  return `rgb(${mixed.join(",")})`;
}

function DerivativeHeatmap({ series, timeframe }: { series: MarketWeatherDerivativePoint[]; timeframe: MarketWeatherTimeframe }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 292 });
  const [hover, setHover] = useState<{ row: number; column: number; x: number; y: number } | null>(null);
  const padding = { left: 84, right: 12, top: 12, bottom: 34 };

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => setSize({ width: wrapper.clientWidth, height: wrapper.clientWidth < 640 ? 272 : 292 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || !series.length) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "rgb(10, 17, 29)";
    context.fillRect(0, 0, size.width, size.height);

    const plotWidth = size.width - padding.left - padding.right;
    const plotHeight = size.height - padding.top - padding.bottom;
    const cellWidth = plotWidth / series.length;
    const cellHeight = plotHeight / DERIVATIVES.length;
    DERIVATIVES.forEach((derivative, row) => {
      series.forEach((point, column) => {
        context.fillStyle = signedColor(point[derivative.key]);
        context.fillRect(
          padding.left + column * cellWidth,
          padding.top + row * cellHeight,
          Math.max(1.05, Math.ceil(cellWidth + 0.25)),
          Math.ceil(cellHeight + 0.25),
        );
      });
      const y = padding.top + (row + 0.5) * cellHeight;
      context.fillStyle = "rgba(203, 213, 225, .78)";
      context.font = "11px IBM Plex Sans, Segoe UI, sans-serif";
      context.textAlign = "right";
      context.fillText(`d${derivative.order} ${derivative.label}`, padding.left - 8, y + 4);
      context.strokeStyle = "rgba(148, 163, 184, .15)";
      context.beginPath();
      context.moveTo(padding.left, padding.top + (row + 1) * cellHeight);
      context.lineTo(size.width - padding.right, padding.top + (row + 1) * cellHeight);
      context.stroke();
    });

    context.textAlign = "center";
    context.fillStyle = "rgba(148, 163, 184, .78)";
    const tickCount = size.width < 640 ? 3 : 5;
    for (let tick = 0; tick < tickCount; tick += 1) {
      const column = Math.round((tick / (tickCount - 1)) * (series.length - 1));
      const x = padding.left + (column + 0.5) * cellWidth;
      context.fillText(formatDate(series[column].date, timeframe), x, size.height - 11);
    }
  }, [series, size, timeframe]);

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const plotWidth = rect.width - padding.left - padding.right;
    const plotHeight = size.height - padding.top - padding.bottom;
    if (x < padding.left || x > padding.left + plotWidth || y < padding.top || y > padding.top + plotHeight) {
      setHover(null);
      return;
    }
    setHover({
      row: Math.min(DERIVATIVES.length - 1, Math.floor(((y - padding.top) / plotHeight) * DERIVATIVES.length)),
      column: Math.min(series.length - 1, Math.floor(((x - padding.left) / plotWidth) * series.length)),
      x,
      y,
    });
  };

  const hoveredDerivative = hover ? DERIVATIVES[hover.row] : null;
  const hoveredPoint = hover ? series[hover.column] : null;

  return (
    <div ref={wrapperRef} className="relative min-w-0 overflow-hidden rounded-2xl border border-stealth-700 bg-slate-950/70">
      <canvas
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        className="block w-full touch-none"
        aria-label="Aggregate field pressure and its first through fourth causal differences over time"
      />
      {hover && hoveredDerivative && hoveredPoint ? (
        <div
          className="pointer-events-none absolute z-10 w-[210px] rounded-xl border border-slate-500/70 bg-slate-950/95 p-3 text-xs shadow-2xl"
          style={{
            left: Math.min(Math.max(8, hover.x + 12), Math.max(8, size.width - 218)),
            top: Math.min(Math.max(8, hover.y + 12), size.height - 92),
          }}
        >
          <div className="font-semibold text-white">d{hoveredDerivative.order} · {hoveredDerivative.label}</div>
          <div className="mt-0.5 text-slate-400">{formatDate(hoveredPoint.date, timeframe)}</div>
          <div className="mt-2 font-mono text-base text-slate-100">{formatSigned(hoveredPoint[hoveredDerivative.key], 3)}</div>
        </div>
      ) : null}
    </div>
  );
}

function PhasePortrait({ series }: { series: MarketWeatherDerivativePoint[] }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = 292;

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
    if (!canvas || width <= 0 || series.length < 2) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "rgb(10, 17, 29)";
    context.fillRect(0, 0, width, height);
    const padding = { left: 38, right: 16, top: 14, bottom: 35 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const x = (value: number) => padding.left + clamp((value + 1) / 2) * plotWidth;
    const y = (value: number) => padding.top + (1 - clamp((value + 1) / 2)) * plotHeight;
    context.strokeStyle = "rgba(148, 163, 184, .24)";
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x(0), padding.top);
    context.lineTo(x(0), height - padding.bottom);
    context.moveTo(padding.left, y(0));
    context.lineTo(width - padding.right, y(0));
    context.stroke();
    context.setLineDash([]);

    const visible = series.slice(-Math.min(series.length, 420));
    for (let index = 1; index < visible.length; index += 1) {
      const prior = visible[index - 1];
      const point = visible[index];
      const age = index / Math.max(1, visible.length - 1);
      context.strokeStyle = `rgba(96, 165, 250, ${0.08 + age * 0.7})`;
      context.lineWidth = 0.8 + age * 1.15;
      context.beginPath();
      context.moveTo(x(prior.pressure), y(prior.velocity));
      context.lineTo(x(point.pressure), y(point.velocity));
      context.stroke();
    }
    const current = visible[visible.length - 1];
    context.fillStyle = current.pressure >= 0 ? "#5eead4" : "#fb7185";
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 10;
    context.beginPath();
    context.arc(x(current.pressure), y(current.velocity), 4.5, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    context.fillStyle = "rgba(148, 163, 184, .82)";
    context.font = "11px IBM Plex Sans, Segoe UI, sans-serif";
    context.textAlign = "center";
    context.fillText("Aggregate pressure →", padding.left + plotWidth / 2, height - 11);
    context.save();
    context.translate(11, padding.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("Velocity →", 0, 0);
    context.restore();
  }, [series, width]);

  return (
    <div ref={wrapperRef} className="min-w-0 overflow-hidden rounded-2xl border border-stealth-700 bg-slate-950/70">
      <canvas ref={canvasRef} className="block w-full" aria-label="Phase portrait of aggregate pressure against its velocity; brighter segments are more recent" />
    </div>
  );
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("interesting") || normalized.includes("promising")) return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (normalized.includes("insufficient")) return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  return "border-amber-400/25 bg-amber-400/10 text-amber-200";
}

function foundationTone(status: typeof RESEARCH_FOUNDATIONS[number]["status"]): string {
  if (status === "Implemented") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (status === "Adjacent") return "border-sky-400/25 bg-sky-400/10 text-sky-200";
  if (status === "Guardrail") return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  return "border-violet-400/25 bg-violet-400/10 text-violet-200";
}

function RelationshipCard({ result }: { result: MarketWeatherRelationshipResult }) {
  return (
    <article className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{result.forward_bars}-bar forward test</div>
          <h4 className="mt-1 font-semibold text-white">{result.label}</h4>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusTone(result.status)}`}>{result.status}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-300">{result.hypothesis}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">Outcome: {result.outcome}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Events</div>
          <div className="mt-1 font-mono text-sm text-white">{result.sample_size.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Event mean</div>
          <div className="mt-1 font-mono text-sm text-white">{formatReturn(result.event_mean)}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Baseline</div>
          <div className="mt-1 font-mono text-sm text-slate-300">{formatReturn(result.baseline_mean)}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Uplift</div>
          <div className={`mt-1 font-mono text-sm ${(result.uplift ?? 0) > 0 ? "text-emerald-300" : (result.uplift ?? 0) < 0 ? "text-rose-300" : "text-slate-300"}`}>{formatReturn(result.uplift)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
        <span>Event hit rate <strong className="font-mono font-medium text-slate-200">{formatRate(result.event_hit_rate)}</strong></span>
        <span>Baseline <strong className="font-mono font-medium text-slate-200">{formatRate(result.baseline_hit_rate)}</strong></span>
      </div>
      <details className="mt-3 border-t border-white/5 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-sky-300">Method and threshold discipline</summary>
        <p className="mt-2 text-xs leading-5 text-slate-400">{result.method}</p>
      </details>
    </article>
  );
}

export default function MarketWeatherResearchLab({ research, symbol, timeframe, barSize }: MarketWeatherResearchLabProps) {
  const [tab, setTab] = useState<LabTab>("derivatives");
  const chartSeries = useMemo(() => {
    const series = research.strata.series;
    const step = Math.max(1, Math.ceil(series.length / 420));
    return series.filter((_point, index) => index % step === 0 || index === series.length - 1);
  }, [research.strata.series]);
  const latest = research.strata.latest;
  const definitionEntries = Object.entries(research.definitions ?? {});

  return (
    <section className="primary-card overflow-hidden">
      <div className="border-b border-stealth-700 p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="page-kicker">{research.model ?? "Research lab · second-order market lens"}</span>
              <span className="page-badge border-violet-400/20 text-violet-200"><FlaskConical className="h-3.5 w-3.5" /> Exploratory</span>
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white">From field state to motion, geometry, information, and propagation</h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-400">
              This layer asks how the multi-horizon field is changing—not only whether it is bullish or bearish. The individual methods have established precedents; their combination in one causal horizon field appears uncommon in the literature reviewed so far. That is a research direction, not proof of invention or predictive power.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1 rounded-2xl border border-stealth-700 bg-slate-950/45 p-1.5">
            {TAB_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTab(option.value)}
                className={`rounded-xl px-3 py-2 text-xs font-medium transition ${tab === option.value ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/30" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {tab === "derivatives" ? (
          <div className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.75fr)]">
              <div className="min-w-0">
                <div className="mb-3">
                  <span className="page-kicker">Derivative-order stack</span>
                  <h3 className="mt-1 font-semibold text-white">The field through its fourth causal difference</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">Each row is normalized independently so faint higher-order motion remains visible. Color shows sign; intensity shows magnitude. Successive differences amplify microstructure noise, so jerk and snap are instability sensors—not standalone signals.</p>
                </div>
                <DerivativeHeatmap series={research.derivative_series} timeframe={timeframe} />
              </div>
              <div className="min-w-0">
                <div className="mb-3">
                  <span className="page-kicker">Phase portrait</span>
                  <h3 className="mt-1 font-semibold text-white">Pressure × velocity trajectory</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">A compact state-space projection. Brighter segments are newer; the terminal point is the current aggregate state.</p>
                </div>
                <PhasePortrait series={research.derivative_series} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {DERIVATIVES.map((derivative) => (
                <div key={derivative.key} className="rounded-xl border border-stealth-700 bg-slate-950/30 p-3">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Derivative order {derivative.order}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{derivative.label}</div>
                  <div className="mt-1 text-xs text-slate-400">{derivative.read}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-2 lg:grid-cols-3">
              <div className="rounded-xl border border-violet-400/15 bg-violet-950/10 p-3">
                <div className="font-mono text-sm text-violet-200">s = ln(horizon)</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">The vertical coordinate is physical log scale, so adding denser horizon rows does not redefine the geometry.</p>
              </div>
              <div className="rounded-xl border border-violet-400/15 bg-violet-950/10 p-3">
                <div className="font-mono text-sm text-violet-200">J⁴ₜ(P) = {`{P, Pₜ, Pₜₜ, Pₜₜₜ, Pₜₜₜₜ}`}</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">This derivative jet describes one field from several orders; it does not pretend the orders are independent market dimensions.</p>
              </div>
              <div className="rounded-xl border border-violet-400/15 bg-violet-950/10 p-3">
                <div className="font-mono text-sm text-violet-200">vₛ ≈ −PₜPₛ / (Pₛ² + λ)</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">The regularized level-set estimate asks whether a field feature is migrating toward longer or shorter horizons.</p>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "strata" ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-sky-400/15 bg-sky-950/15 p-4 text-xs leading-5 text-slate-400">
              <strong className="text-sky-200">Keep the ontology honest:</strong> kinematics, geometry, information, and propagation are different transforms of the same price-derived horizon field—not statistically independent dimensions. The carrier row below adds distinct OHLCV evidence so agreement is harder to manufacture by transformation alone.
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {STRATA.map((stratum) => (
                <div key={stratum.key} className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{stratum.label}</span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stratum.color, boxShadow: `0 0 14px ${stratum.color}` }} />
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">{formatScore(latest[stratum.key])}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full" style={{ width: `${clamp(latest[stratum.key]) * 100}%`, backgroundColor: stratum.color }} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-400">{stratum.question}</p>
                </div>
              ))}
            </div>

            {research.carriers ? (
              <div>
                <div className="mb-3">
                  <span className="page-kicker">Independent evidence carriers</span>
                  <h3 className="mt-1 font-semibold text-white">Four OHLCV observations beneath the transforms</h3>
                  <p className="mt-1 text-xs text-slate-400">Normalized context channels reduce double-counting; they do not make OHLCV sources fully independent of one another.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {CARRIERS.map((carrier) => {
                    const value = research.carriers?.latest[carrier.key] ?? 0;
                    return (
                      <div key={carrier.key} className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{carrier.label}</span>
                          <span className="font-mono text-sm font-semibold text-slate-100">{formatScore(value)}</span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full" style={{ width: `${clamp(value) * 100}%`, backgroundColor: carrier.color }} /></div>
                        <p className="mt-2 text-xs text-slate-400">{carrier.read}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.65fr)]">
              <div className="min-w-0 rounded-2xl border border-stealth-700 bg-slate-950/25 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <span className="page-kicker">Strata history</span>
                    <h3 className="mt-1 font-semibold text-white">Five normalized lenses through time</h3>
                    <p className="mt-1 text-xs text-slate-400">Shared 0–1 scale supports comparison; it does not imply equal economic meaning.</p>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
                    {STRATA.map((stratum) => <span key={stratum.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: stratum.color }} />{stratum.label}</span>)}
                  </div>
                </div>
                <div className="mt-3 h-[320px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={chartSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(100,116,139,0.16)" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="date" minTickGap={60} tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => formatDate(String(value), timeframe)} />
                      <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "var(--chart-tooltip-label)" }} labelFormatter={(value) => formatDate(String(value), timeframe)} formatter={(value, name) => [formatScore(Number(value)), String(name).charAt(0).toUpperCase() + String(name).slice(1)]} />
                      {STRATA.map((stratum) => <Line key={stratum.key} type="monotone" dataKey={stratum.key} stroke={stratum.color} strokeWidth={1.7} dot={false} isAnimationActive={false} />)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-4">
                  <div className="flex items-center gap-2 text-sky-200"><Orbit className="h-4 w-4" /><span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Cascade bias</span></div>
                  <div className={`mt-2 font-mono text-2xl ${latest.cascade_bias > 0.05 ? "text-sky-300" : latest.cascade_bias < -0.05 ? "text-rose-300" : "text-slate-200"}`}>{formatSigned(latest.cascade_bias)}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">Positive means pressure features are estimated to migrate toward longer horizons; negative means migration toward shorter horizons. This is an optical-flow analogy, not physical transport.</p>
                </div>
                <div className="rounded-2xl border border-stealth-700 bg-slate-950/35 p-4">
                  <div className="flex items-center gap-2 text-violet-200"><Layers className="h-4 w-4" /><span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Local volatility scaling</span></div>
                  <div className="mt-2 font-mono text-2xl text-violet-200">{formatSigned(latest.scaling_exponent)}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">The slope of log realized volatility across nested field horizons. It is a local scale descriptor—not a Hurst exponent and not evidence of a stable fractal law.</p>
                </div>
                <div className="rounded-2xl border border-sky-400/15 bg-sky-950/15 p-4 text-xs leading-5 text-slate-400">
                  Read strata jointly. A high structure score with weak propagation is a different state from high structure with a strong longward cascade, even when the price trend looks identical.
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "evidence" ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-950/15 p-4 text-sm leading-6 text-amber-100/80">
              <strong className="text-amber-200">Exploration, not discovery.</strong> These are overlapping observations from one symbol and window. Thresholds are calibrated chronologically, but repeated hypothesis search still creates multiple-testing and selection bias. Treat “interesting” as permission to test out-of-sample—not as a trading conclusion.
              {research.validation ? (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                  <span className="rounded-full border border-white/10 bg-slate-950/25 px-2.5 py-1">Calibration: {research.validation.calibration_bars.toLocaleString()} bars</span>
                  <span className="rounded-full border border-white/10 bg-slate-950/25 px-2.5 py-1">Evaluation: {research.validation.evaluation_bars.toLocaleString()} bars</span>
                  <span className="rounded-full border border-white/10 bg-slate-950/25 px-2.5 py-1">Forward window: {research.validation.forward_bars} bars</span>
                  <span className="rounded-full border border-rose-400/20 bg-rose-950/20 px-2.5 py-1 text-rose-200">Multiple-test adjustment: {research.validation.multiple_testing_adjusted ? "yes" : "not yet"}</span>
                </div>
              ) : null}
            </div>

            <div>
              <div className="mb-3">
                <span className="page-kicker">Live relationship atlas</span>
                <h3 className="mt-1 font-semibold text-white">Falsifiable hypotheses on {symbol} · {barSize}</h3>
                <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">Each card compares event outcomes with its stated evaluation baseline. The historical outcomes are retrospective; the field itself remains causal at every timestamp.</p>
              </div>
              {research.relationship_atlas.length ? (
                <div className="grid gap-3 xl:grid-cols-2">
                  {research.relationship_atlas.map((result) => <RelationshipCard key={result.id} result={result} />)}
                </div>
              ) : (
                <div className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-5 text-sm text-slate-400">This window does not contain enough observations to evaluate the relationship atlas.</div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-start gap-3">
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                <div>
                  <span className="page-kicker">Published foundations</span>
                  <h3 className="mt-1 font-semibold text-white">What is established, adjacent, and still ahead</h3>
                  <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">Primary papers anchor the mathematical ingredients. “Implemented” means the current field uses an adapted idea; it does not mean the paper validates this market application.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {RESEARCH_FOUNDATIONS.map((reference) => (
                  <a key={reference.title} href={reference.url} target="_blank" rel="noreferrer" className="group rounded-2xl border border-stealth-700 bg-slate-950/30 p-4 transition hover:border-violet-400/35 hover:bg-violet-950/10">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${foundationTone(reference.status)}`}>{reference.status}</span>
                      <ExternalLink className="h-3.5 w-3.5 text-slate-600 transition group-hover:text-violet-300" />
                    </div>
                    <h4 className="mt-3 text-sm font-semibold text-white">{reference.title}</h4>
                    <p className="mt-1 text-[11px] text-slate-500">{reference.authors}</p>
                    <p className="mt-3 text-xs leading-5 text-slate-400">{reference.use}</p>
                  </a>
                ))}
              </div>
            </div>

            {definitionEntries.length || research.notes.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {definitionEntries.length ? (
                  <details className="rounded-2xl border border-stealth-700 bg-slate-950/25 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-200">Field definitions</summary>
                    <dl className="mt-3 space-y-3 text-xs leading-5">
                      {definitionEntries.map(([term, definition]) => <div key={term}><dt className="font-semibold text-slate-300">{term.split("_").join(" ")}</dt><dd className="text-slate-500">{definition}</dd></div>)}
                    </dl>
                  </details>
                ) : null}
                {research.notes.length ? (
                  <div className="rounded-2xl border border-stealth-700 bg-slate-950/25 p-4">
                    <h4 className="text-sm font-semibold text-slate-200">Research notes</h4>
                    <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-500">
                      {research.notes.map((note) => <li key={note}>• {note}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
