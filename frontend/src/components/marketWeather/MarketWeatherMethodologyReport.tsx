import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Database,
  ExternalLink,
  FlaskConical,
  GitBranch,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import type { MarketWeatherResponse } from "../../types/marketWeather";

interface MarketWeatherMethodologyReportProps {
  data: MarketWeatherResponse;
}

interface ReferenceEntry {
  citation: string;
  contribution: string;
  href: string;
}

interface ReferenceGroup {
  title: string;
  framing: string;
  references: ReferenceEntry[];
}

interface EvolutionStep {
  stage: string;
  title: string;
  description: string;
  disposition: "Retained" | "Adapted" | "Retired from primary view" | "Added on the web";
}

const PIPELINE_STAGES = [
  {
    label: "Observed",
    title: "Selected-symbol OHLCV",
    detail: "One bar size, timestamped price and volume, with provider provenance.",
    tone: "border-sky-400/25 bg-sky-400/[0.06]",
  },
  {
    label: "Causally derived",
    title: "Horizon pressure field",
    detail: "EMA spread, true-range scaling, path efficiency, and causal smoothing.",
    tone: "border-cyan-400/25 bg-cyan-400/[0.06]",
  },
  {
    label: "Causally derived",
    title: "Calculus and strata",
    detail: "Time and log-horizon derivatives, organization, disorder, and propagation.",
    tone: "border-teal-400/25 bg-teal-400/[0.06]",
  },
  {
    label: "Fit segment only",
    title: "Empirical Forms",
    detail: "Robustly scaled 15-feature states, clustered without evaluation outcomes.",
    tone: "border-violet-400/25 bg-violet-400/[0.06]",
  },
  {
    label: "Later evidence",
    title: "Range and outcomes",
    detail: "Calibration-relative distance ranks and descriptive forward holdout summaries.",
    tone: "border-amber-400/25 bg-amber-400/[0.06]",
  },
  {
    label: "Translation layer",
    title: "Cloud, timeline, scope",
    detail: "Several views of the same measurements, with exact values available on inspection.",
    tone: "border-rose-400/25 bg-rose-400/[0.06]",
  },
] as const;

const EVIDENCE_LADDER = [
  ["01", "Observed", "Provider bars, timestamps, OHLCV, and quote metadata."],
  ["02", "Causal transform", "Every displayed field value uses information available by that bar."],
  ["03", "Fit-learned", "Form centroids and scaling are learned from the earlier proper-fit segment."],
  ["04", "Calibration-referenced", "Distance-tail evidence asks whether a Form occurrence resembles later calibration examples."],
  ["05", "Evaluation-described", "Forward outcomes summarize later bars; they are not probability forecasts."],
  ["06", "Shadow context", "Technical, options, and cross-market evidence is displayed beside the field but does not alter it."],
] as const;

const RESEARCH_EVOLUTION: EvolutionStep[] = [
  {
    stage: "A",
    title: "Faithful Swami benchmark",
    description: "A time-by-lookback heatmap made phase propagation visible and established a directional reference that could be checked against the original Ehlers/Way idea.",
    disposition: "Retained",
  },
  {
    stage: "B",
    title: "Continuous regime pressure",
    description: "Discrete color states became a bounded EMA/true-range/path-efficiency measure. Derivatives were moved from direction setters to modifiers after early versions became speckled.",
    disposition: "Adapted",
  },
  {
    stage: "C",
    title: "Confidence and latent channels",
    description: "Direction was separated from agreement, persistence, structural strength, expansion, and contraction. Raw RGB experiments proved informative but perceptually muddy.",
    disposition: "Adapted",
  },
  {
    stage: "D",
    title: "State-space experiments",
    description: "Pressure and pressure change were projected into a scope-like state plane. Rich glyph and color grammars explored a machine-native language, but their thresholds lacked empirical units.",
    disposition: "Retired from primary view",
  },
  {
    stage: "E",
    title: "Convection field",
    description: "The matrix was reframed around organization, motion, boundary energy, reflectivity, and instability. The weather vocabulary remained a visual metaphor rather than a physical claim.",
    disposition: "Retained",
  },
  {
    stage: "F",
    title: "Topographic renderer",
    description: "Smoothing, logarithmic compression, contour-like bands, and edge emphasis became alternate renderers over shared channels instead of separate indicators.",
    disposition: "Retained",
  },
];

const PRODUCT_EVOLUTION: EvolutionStep[] = [
  {
    stage: "01",
    title: "Dense web field",
    description: "The ThinkScript experiments became a high-resolution Canvas surface with selectable timeframes, horizons, lenses, hover inspection, and an auditable API response.",
    disposition: "Added on the web",
  },
  {
    stage: "02",
    title: "Field calculus",
    description: "Signed time derivatives through snap, log-horizon geometry, Bandt–Pompe permutation entropy, propagation analogues, scaling geometry, and OHLCV carriers were added.",
    disposition: "Added on the web",
  },
  {
    stage: "03",
    title: "Machine dictionary, then grounding",
    description: "Forms, Motions, Phrases, and glyphs created a native language. The interface later demoted hashes and glyphs in favor of measured labels, chronological splits, support counts, and range evidence.",
    disposition: "Adapted",
  },
  {
    stage: "04",
    title: "Synchronized diagnostic workspace",
    description: "Price, directional phase, Form identity, trend/agreement, carriers, and calibration-distance evidence were placed under a shared cursor, then condensed into selectable lenses for speed and legibility.",
    disposition: "Retained",
  },
  {
    stage: "05",
    title: "Shadow context",
    description: "Prior-bar support/resistance, current optionality, and cached energy, real-estate, agriculture, metals, sector, and crypto relationships were added as parallel evidence only.",
    disposition: "Added on the web",
  },
  {
    stage: "06",
    title: "Cloud plus grounded scope",
    description: "The horizon field became a compact cloud beneath the search controls. The oscilloscope returned inside the Dictionary as a measured pressure-versus-change trajectory tied to learned Forms.",
    disposition: "Adapted",
  },
  {
    stage: "07",
    title: "Relationship scopes and report links",
    description: "The single phase portrait became three linked projections with exact raw traces, a display-only causal EWM, fit-relative color, fixed bounded axes, keyboard inspection, and versioned URLs for reproducible selector recipes.",
    disposition: "Added on the web",
  },
  {
    stage: "08",
    title: "Relative Field Pair",
    description: "Two independently computed same-recipe fields can now be aligned through supported coordinate differences, relative price context, common-axis scopes, and ordered provenance without matching request-local Forms or changing either field.",
    disposition: "Added on the web",
  },
];

const REFERENCE_GROUPS: ReferenceGroup[] = [
  {
    title: "Direct visual and multiscale ancestry",
    framing: "These works motivate looking across horizons and respecting causal scale. The present field is not a wavelet transform.",
    references: [
      {
        citation: "Ehlers & Way (2012), Introducing SwamiCharts",
        contribution: "Direct practitioner ancestor for rendering one indicator across many lookbacks.",
        href: "https://www.traders.com/Documentation/FEEDbk_docs/2012/03/Ehlers.html",
      },
      {
        citation: "Lindeberg (2017), Temporal Scale Selection in Time-Causal Scale Space",
        contribution: "Formal precedent for causal exponential kernels, scale levels, and time/scale derivatives.",
        href: "https://doi.org/10.1007/s10851-016-0691-3",
      },
      {
        citation: "Mallat (1989), A Theory for Multiresolution Signal Decomposition",
        contribution: "A rigorous multiresolution comparator and future benchmark, not the current implementation.",
        href: "https://doi.org/10.1109/34.192463",
      },
      {
        citation: "Torrence & Compo (1998), A Practical Guide to Wavelet Analysis",
        contribution: "Future guidance for red-noise nulls, edge effects, and scale-aware significance.",
        href: "https://doi.org/10.1175/1520-0477(1998)079%3C0061:APGTWA%3E2.0.CO;2",
      },
    ],
  },
  {
    title: "State planes, differentiation, and flow analogies",
    framing: "These are conceptual lineages. The scope is a two-coordinate projection and the cascade measure is a regularized analogy—not an attractor reconstruction or causal flow estimate.",
    references: [
      {
        citation: "Packard et al. (1980), Geometry from a Time Series",
        contribution: "Seminal state-space reconstruction context.",
        href: "https://doi.org/10.1103/PhysRevLett.45.712",
      },
      {
        citation: "Takens (1981), Detecting Strange Attractors in Turbulence",
        contribution: "Defines a much stronger delay-embedding claim than this page makes.",
        href: "https://doi.org/10.1007/BFb0091924",
      },
      {
        citation: "Savitzky & Golay (1964), Smoothing and Differentiation of Data",
        contribution: "Classic warning and method lineage for noisy numerical derivatives.",
        href: "https://doi.org/10.1021/ac60214a047",
      },
      {
        citation: "Horn & Schunck (1981), Determining Optical Flow",
        contribution: "Conceptual ancestor for a time/scale motion constraint; no Horn–Schunck solver is used here.",
        href: "https://doi.org/10.1016/0004-3702(81)90024-2",
      },
    ],
  },
  {
    title: "Entropy, persistence, and scaling",
    framing: "Permutation entropy is implemented directly. Long-memory and multifractal papers are comparators for future work; the displayed scaling slope is neither Hurst nor a multifractal spectrum.",
    references: [
      {
        citation: "Bandt & Pompe (2002), Permutation Entropy",
        contribution: "Direct basis for the order-3 ordinal-pattern information measure.",
        href: "https://doi.org/10.1103/PhysRevLett.88.174102",
      },
      {
        citation: "Zunino et al. (2009), Permutation Entropy and Stock Market Inefficiency",
        contribution: "Financial application precedent, not validation of this implementation's window or thresholds.",
        href: "https://doi.org/10.1016/j.physa.2009.03.042",
      },
      {
        citation: "Hurst (1951), Long-Term Storage Capacity of Reservoirs",
        contribution: "Origin of rescaled-range persistence research.",
        href: "https://doi.org/10.1061/TACEAT.0006518",
      },
      {
        citation: "Mandelbrot & Van Ness (1968), Fractional Brownian Motions",
        contribution: "Foundational self-similar-process reference.",
        href: "https://doi.org/10.1137/1010093",
      },
      {
        citation: "Lo (1991), Long-Term Memory in Stock Market Prices",
        contribution: "Important warning that short-range dependence can masquerade as long memory.",
        href: "https://doi.org/10.2307/2938368",
      },
      {
        citation: "Mandelbrot, Fisher & Calvet (1997), A Multifractal Model of Asset Returns",
        contribution: "Multiscaling research direction; the current local slope does not estimate this model.",
        href: "https://elischolar.library.yale.edu/cowles-discussion-paper-series/1412/",
      },
    ],
  },
  {
    title: "Empirical states and sequential structure",
    framing: "The page uses clustering and descriptive transitions. It is not a hidden Markov or Markov-switching model.",
    references: [
      {
        citation: "MacQueen (1967), Classification and Analysis of Multivariate Observations",
        contribution: "Foundational k-means clustering reference.",
        href: "https://digicoll.lib.berkeley.edu/record/113015",
      },
      {
        citation: "Rousseeuw (1987), Silhouettes",
        contribution: "Direct basis for the cluster-separation screen.",
        href: "https://doi.org/10.1016/0377-0427(87)90125-7",
      },
      {
        citation: "Hamilton (1989), Regime Switching in Nonstationary Time Series",
        contribution: "Formal probabilistic regime benchmark for future comparison.",
        href: "https://doi.org/10.2307/1912559",
      },
      {
        citation: "Rabiner (1989), A Tutorial on Hidden Markov Models",
        contribution: "Sequential latent-state benchmark; current transitions are simple run-collapsed counts.",
        href: "https://doi.org/10.1109/5.18626",
      },
    ],
  },
  {
    title: "Technical structure and optionality",
    framing: "These papers show that price patterns and option information can be studied. They do not make a 20-bar boundary or a current IV–HV gap a validated signal.",
    references: [
      {
        citation: "Lo, Mamaysky & Wang (2000), Foundations of Technical Analysis",
        contribution: "Statistical formulation of technical-pattern questions.",
        href: "https://doi.org/10.1111/0022-1082.00265",
      },
      {
        citation: "Brock, Lakonishok & LeBaron (1992), Simple Technical Trading Rules",
        contribution: "Classic empirical test design for transparent rules.",
        href: "https://doi.org/10.1111/j.1540-6261.1992.tb04681.x",
      },
      {
        citation: "Osler (2000), Support for Resistance",
        contribution: "Evidence that clustered boundaries can be framed and tested in market data.",
        href: "https://www.newyorkfed.org/medialibrary/media/research/epr/00v06n2/0007osle.pdf",
      },
      {
        citation: "Breeden & Litzenberger (1978), State-Contingent Claims in Option Prices",
        contribution: "Foundational mapping from option prices to risk-neutral state prices.",
        href: "https://doi.org/10.1086/296025",
      },
      {
        citation: "Christensen & Prabhala (1998), Implied and Realized Volatility",
        contribution: "Core precedent for maturity-aligned implied-versus-realized volatility research.",
        href: "https://doi.org/10.1016/S0304-405X(98)00034-8",
      },
      {
        citation: "Goyal & Saretto (2009), Option Returns and Volatility",
        contribution: "Cross-sectional evidence motivating disciplined IV–HV research.",
        href: "https://doi.org/10.1016/j.jfineco.2009.01.001",
      },
      {
        citation: "Carr & Wu (2009), Variance Risk Premiums",
        contribution: "Shows why risk premia complicate a casual 'mispricing' interpretation.",
        href: "https://doi.org/10.1093/rfs/hhn038",
      },
      {
        citation: "Pan & Poteshman (2006), Information in Option Volume",
        contribution: "Motivates historically aligned option-flow features beyond a current snapshot.",
        href: "https://doi.org/10.1093/rfs/hhj024",
      },
    ],
  },
  {
    title: "Cross-market dependence and statistical guardrails",
    framing: "The current context uses held-out rank association, block permutation, and false-discovery-rate adjustment. Association still does not establish structural causation.",
    references: [
      {
        citation: "Engle (2002), Dynamic Conditional Correlation",
        contribution: "Formal benchmark for time-varying dependence.",
        href: "https://doi.org/10.1198/073500102288618487",
      },
      {
        citation: "Diebold & Yilmaz (2012), Volatility Spillovers",
        contribution: "Formal connectedness benchmark for future multivariate work.",
        href: "https://doi.org/10.1016/j.ijforecast.2011.02.006",
      },
      {
        citation: "Forbes & Rigobon (2002), No Contagion, Only Interdependence",
        contribution: "Warns that volatility shifts distort naïve correlation comparisons.",
        href: "https://doi.org/10.1111/0022-1082.00494",
      },
      {
        citation: "Epps (1979), Comovements in Stock Prices in the Very Short Run",
        contribution: "Warns that sampling frequency and asynchronous observations change measured correlation.",
        href: "https://doi.org/10.1080/01621459.1979.10482508",
      },
      {
        citation: "Granger (1969), Investigating Causal Relations",
        contribution: "Clarifies why selected lag correlation is weaker than predictive causality testing.",
        href: "https://doi.org/10.2307/1912791",
      },
      {
        citation: "Benjamini & Hochberg (1995), Controlling the False Discovery Rate",
        contribution: "Direct basis for q-value adjustment across cross-market sources.",
        href: "https://doi.org/10.1111/j.2517-6161.1995.tb02031.x",
      },
      {
        citation: "White (2000), A Reality Check for Data Snooping",
        contribution: "Future guardrail for searched relationships and motifs.",
        href: "https://doi.org/10.1111/1468-0262.00152",
      },
      {
        citation: "Politis & Romano (1994), The Stationary Bootstrap",
        contribution: "Dependence-preserving resampling direction for future validation.",
        href: "https://doi.org/10.1080/01621459.1994.10476870",
      },
      {
        citation: "Theiler et al. (1992), Surrogate Data for Nonlinear Time Series",
        contribution: "Null-model direction for testing whether apparent nonlinear structure exceeds linear dependence.",
        href: "https://doi.org/10.1016/0167-2789(92)90102-S",
      },
      {
        citation: "Harvey, Liu & Zhu (2016), …and the Cross-Section of Expected Returns",
        contribution: "Multiple-testing warning for large factor and relationship searches.",
        href: "https://doi.org/10.1093/rfs/hhv059",
      },
    ],
  },
];

function formatInteger(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString() : "Not available";
}

function formatDecimal(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "Not available";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not supplied";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAvailability(value: boolean | undefined): string {
  return value === true ? "available" : value === false ? "unavailable" : "not reported";
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-sky-400/15 bg-slate-950/55 px-3 py-2.5 font-mono text-[11px] leading-5 text-sky-100 sm:text-xs">
      {children}
    </div>
  );
}

function ReportCallout({
  tone = "sky",
  title,
  children,
}: {
  tone?: "sky" | "amber" | "emerald" | "violet";
  title: string;
  children: ReactNode;
}) {
  const tones = {
    sky: "border-sky-400/25 bg-sky-400/[0.055] text-sky-200",
    amber: "border-amber-400/25 bg-amber-400/[0.055] text-amber-200",
    emerald: "border-emerald-400/25 bg-emerald-400/[0.055] text-emerald-200",
    violet: "border-violet-400/25 bg-violet-400/[0.055] text-violet-200",
  };

  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.14em]">{title}</div>
      <div className="mt-1.5 text-xs leading-5 text-slate-300 sm:text-sm sm:leading-6">{children}</div>
    </div>
  );
}

function MethodBlock({ title, formula, children }: { title: string; formula?: ReactNode; children: ReactNode }) {
  return (
    <article className="rounded-xl border border-stealth-700 bg-slate-950/25 p-3 sm:p-4">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      {formula ? <div className="mt-2"><Formula>{formula}</Formula></div> : null}
      <div className="mt-2 text-xs leading-5 text-slate-400 sm:text-sm sm:leading-6">{children}</div>
    </article>
  );
}

const ChapterAccordionContext = createContext<{
  activeChapter: string | null;
  setActiveChapter: (chapter: string | null) => void;
} | null>(null);

function Chapter({ number, title, synopsis, children }: { number: string; title: string; synopsis: string; children: ReactNode }) {
  const accordion = useContext(ChapterAccordionContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = accordion ? accordion.activeChapter === number : localOpen;
  const contentId = useId();

  return (
    <section className="overflow-hidden rounded-2xl border border-stealth-700 bg-slate-950/20">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-4 p-3 text-left transition hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 sm:p-4"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          if (accordion) accordion.setActiveChapter(open ? null : number);
          else setLocalOpen((current) => !current);
        }}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-400/20 bg-sky-400/[0.07] font-mono text-[10px] font-semibold text-sky-200">{number}</span>
          <span className="min-w-0">
            <span role="heading" aria-level={3} className="block text-sm font-semibold text-white sm:text-base">{title}</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-400">{synopsis}</span>
          </span>
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div id={contentId} className="border-t border-stealth-700 p-3 sm:p-4" style={{ contentVisibility: "auto" }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function EvolutionTrack({ title, steps }: { title: string; steps: EvolutionStep[] }) {
  const dispositionTone: Record<EvolutionStep["disposition"], string> = {
    Retained: "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-200",
    Adapted: "border-sky-400/25 bg-sky-400/[0.06] text-sky-200",
    "Retired from primary view": "border-slate-500/35 bg-slate-500/[0.06] text-slate-300",
    "Added on the web": "border-violet-400/25 bg-violet-400/[0.06] text-violet-200",
  };

  return (
    <section>
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {steps.map((step) => (
          <article key={`${title}-${step.stage}`} className="relative rounded-xl border border-stealth-700 bg-slate-950/25 p-3 pl-12">
            <span className="absolute left-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stealth-600 bg-slate-900 font-mono text-[10px] font-semibold text-slate-300">{step.stage}</span>
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-sm font-semibold text-white">{step.title}</h5>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${dispositionTone[step.disposition]}`}>{step.disposition}</span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-400">{step.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReferenceSection({ group }: { group: ReferenceGroup }) {
  return (
    <section className="rounded-xl border border-stealth-700 bg-slate-950/25 p-3 sm:p-4">
      <h4 className="text-sm font-semibold text-white">{group.title}</h4>
      <p className="mt-1 text-xs leading-5 text-slate-400">{group.framing}</p>
      <div className="mt-3 divide-y divide-white/5">
        {group.references.map((reference) => (
          <div key={reference.href} className="grid gap-1 py-2.5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-4">
            <a
              href={reference.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-1.5 text-xs font-medium leading-5 text-sky-200 transition hover:text-sky-100"
            >
              <span>{reference.citation}</span>
              <ExternalLink className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <p className="text-xs leading-5 text-slate-400">{reference.contribution}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SplitBar({ data }: { data: MarketWeatherResponse }) {
  const split = data.research?.lexicon?.training_split;
  if (!split) {
    return <p className="text-xs leading-5 text-slate-400">This response did not include a learned Form split.</p>;
  }

  const evaluationBars = split.evaluation_bars_total ?? split.evaluation_bars;
  const parts = [
    { label: "Proper fit", value: split.fit_bars, color: "bg-sky-400" },
    { label: "Calibration", value: split.calibration_bars, color: "bg-violet-400" },
    { label: "Evaluation", value: evaluationBars, color: "bg-emerald-400" },
  ];
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-950" role="img" aria-label={`Chronological split: ${parts.map((part) => `${part.label} ${part.value} bars`).join(", ")}`}>
        {parts.map((part) => (
          <span key={part.label} className={part.color} style={{ width: `${total ? (part.value / total) * 100 : 0}%` }} />
        ))}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {parts.map((part) => (
          <div key={part.label} className="flex items-center justify-between gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${part.color}`} />{part.label}</span>
            <span className="font-mono text-slate-200">{formatInteger(part.value)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">Denominator: n={formatInteger(total)} chronological bars reported for model fitting, calibration, and later evaluation. Segment widths encode bar counts, not model importance.</p>
    </div>
  );
}

function CurrentRunAudit({ data }: { data: MarketWeatherResponse }) {
  const research = data.research;
  const lexicon = research?.lexicon;
  const split = lexicon?.training_split;
  const current = lexicon?.current;
  const context = research?.context;
  const cells = data.horizons.length * data.available_bars;
  const horizonRange = data.horizons.length
    ? `${Math.min(...data.horizons)}–${Math.max(...data.horizons)} bars`
    : "Not supplied";
  const horizonSteps = data.horizons.slice(1).map((value, index) => value - data.horizons[index]);
  const horizonStep = horizonSteps.length && horizonSteps.every((value) => value === horizonSteps[0])
    ? String(horizonSteps[0])
    : data.horizons.length <= 1
      ? "n/a"
      : "irregular";
  const rangeCutoff = lexicon?.distance_metric.outside_range_cutoff;
  const fieldInfluence = context?.field_influence ?? "none";
  const carrierAvailability = research?.carriers?.availability;

  const settingCandidates: Array<[string, number | undefined]> = [
    ["State EWM", data.settings.state_smoothing],
    ["Cross-horizon blend", data.settings.cross_horizon_blend],
    ["Time EWM", data.settings.renderer_time_blur],
    ["Spatial blend", data.settings.renderer_spatial_blend],
    ["Motion normalizer", data.settings.motion_normalization_length],
    ["Edge gain", data.settings.edge_gain],
    ["Entropy EWM", data.settings.entropy_smoothing],
    ["Reflectivity compression", data.settings.reflectivity_compression],
    ["Contour bands", data.settings.contour_bands],
    ["Confidence gamma", data.settings.confidence_gamma],
  ];
  const appliedSettings = settingCandidates.filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  const calibrationTailRank = current?.calibration_distance_tail_rank ?? current?.distance_tail_score;
  const calibrationTailSupport = current?.calibration_distance_support ?? current?.distance_tail_support;
  const initializationTargetCovered = data.history_context
    ? data.history_context.initialization_target_covered ?? data.history_context.warmup_complete
    : false;
  const minimumInputSatisfied = data.history_context
    ? data.history_context.minimum_input_satisfied ?? data.history_context.status !== "insufficient"
    : false;
  const initializationTargetBars = data.history_context
    ? data.history_context.initialization_target_bars ?? data.history_context.target_warmup_bars
    : null;

  const facts = [
    ["Instrument", `${data.symbol} · ${data.timeframe}`, data.bar_size],
    ["Observed bars", `${formatInteger(data.available_bars)} / ${formatInteger(data.requested_bars)}`, `${data.coverage_start} → ${data.coverage_end}`],
    ["Field matrix", `${formatInteger(data.horizons.length)} × ${formatInteger(data.available_bars)}`, `${horizonRange} · ${formatInteger(cells)} cells`],
    ["Provider", data.data_source.toUpperCase(), `quote: ${data.quote.source.toUpperCase()}${data.quote.quote_source ? ` / ${data.quote.quote_source}` : ""}${data.cache?.history ? ` · history cache ${data.cache.history.status.replace(/_/g, " ")}` : ""}`],
    ["Initialization", data.history_context ? (initializationTargetCovered ? "Target covered" : minimumInputSatisfied ? "Minimum met; target not covered" : "Minimum input not met") : "Unknown", data.history_context && initializationTargetBars !== null ? `${formatInteger(data.history_context.analysis_bars)} calculation bars · target ${formatInteger(initializationTargetBars)} · not convergence` : "Legacy response; initialization metadata unavailable"],
    ["Learned Forms", lexicon ? formatInteger(split?.archetype_count ?? lexicon.archetypes.length) : "Not supplied", split?.fit_mean_silhouette !== undefined ? `fit silhouette ${formatDecimal(split.fit_mean_silhouette, 3)}` : "one-Form fallback remains possible"],
    ["Distance-tail rank", calibrationTailRank !== null && calibrationTailRank !== undefined ? formatDecimal(calibrationTailRank, 3) : "Unavailable", `same-Form support ${formatInteger(calibrationTailSupport)} · extreme below ${rangeCutoff !== undefined ? formatDecimal(rangeCutoff, 2) : "0.05"}`],
    ["Context influence", fieldInfluence === "none" ? "None" : fieldInfluence, context ? `${context.mode.replace("_", " ")} · ${context.version}` : "context not returned"],
  ];

  return (
    <section className="rounded-2xl border border-stealth-700 bg-slate-950/30 p-3 sm:p-4" aria-labelledby="current-run-audit-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <span className="page-kicker">Current-run reproducibility</span>
          <h3 id="current-run-audit-title" className="mt-1 text-base font-semibold text-white">What this exact response contains</h3>
        </div>
        <span className="rounded-full border border-stealth-600 px-2.5 py-1 text-[11px] text-slate-400">Generated {formatTimestamp(data.generated_at)}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-stealth-700 bg-stealth-700 min-[360px]:grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
        {facts.map(([label, value, detail]) => (
          <div key={label} className="min-w-0 bg-slate-950/75 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</div>
            <div className="mt-1 break-words text-xs font-semibold text-white" title={value}>{value}</div>
            <div className="mt-0.5 line-clamp-2 text-xs leading-4 text-slate-400" title={detail}>{detail}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-stealth-700 bg-slate-950/35 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-white">Chronological model split</span>
          <span className="text-xs uppercase tracking-[0.1em] text-slate-400">earlier → later</span>
        </div>
        <SplitBar data={data} />
      </div>
      <div className="mt-3 rounded-xl border border-stealth-700 bg-slate-950/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white">Applied analytical configuration</span>
          <span className="font-mono text-xs text-slate-400" title={data.horizons.join(", ")}>horizons {horizonRange} · step {horizonStep}</span>
        </div>
        {appliedSettings.length ? (
          <div className="mt-2 grid gap-px overflow-hidden rounded-lg border border-stealth-700 bg-stealth-700 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {appliedSettings.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 bg-slate-950/70 px-2.5 py-2 text-[10px]">
                <span className="text-slate-500">{label}</span>
                <span className="font-mono text-slate-200">{Number.isInteger(value) ? value : formatDecimal(value, 2)}</span>
              </div>
            ))}
          </div>
        ) : <p className="mt-2 text-xs text-slate-500">No applied settings were returned.</p>}
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Carrier evidence: realized volatility {formatAvailability(carrierAvailability?.realized_volatility)}; participation {formatAvailability(carrierAvailability?.participation)}; liquidity stress {formatAvailability(carrierAvailability?.liquidity_stress)}. These are response values, not settings-dialog drafts.
        </p>
      </div>
    </section>
  );
}

export default function MarketWeatherMethodologyReport({ data }: MarketWeatherMethodologyReportProps) {
  const [open, setOpen] = useState(false);
  const [activeChapter, setActiveChapter] = useState<string | null>(null);
  const reportId = useId();
  const context = data.research?.context;
  const contextRelationships = context?.cross_market?.relationships ?? [];
  const persistentRelationships = useMemo(
    () => contextRelationships.filter((relationship) => relationship.status === "persistent").length,
    [contextRelationships],
  );

  return (
    <section className="primary-card overflow-hidden" aria-labelledby={`${reportId}-title`} data-testid="methodology-report">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 sm:p-4"
        aria-expanded={open}
        aria-controls={`${reportId}-body`}
        onClick={() => {
          if (open) setActiveChapter(null);
          setOpen((current) => !current);
        }}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.07] text-violet-200">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="page-kicker">Research report & methodology</span>
            <span id={`${reportId}-title`} role="heading" aria-level={2} title="From Swami heatmaps to a Market Field Language" className="mt-0.5 block truncate text-sm font-semibold text-white sm:text-base">From Swami heatmaps to a Market Field Language</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full border border-stealth-600 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 md:inline-flex">10 chapters · source-backed</span>
          <ChevronDown className={`h-5 w-5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open ? (
        <div id={`${reportId}-body`} className="space-y-4 border-t border-stealth-700 p-3 sm:p-4 lg:p-5" style={{ contentVisibility: "auto" }}>
          <header className="relative overflow-hidden rounded-2xl border border-sky-400/15 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.11),transparent_42%),linear-gradient(135deg,rgba(15,23,42,0.92),rgba(2,6,23,0.7))] p-4 sm:p-5">
            <div className="relative z-[1] max-w-4xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="page-kicker">Technical summary · working paper v0.2</span>
                <span className="rounded-full border border-amber-400/25 bg-amber-400/[0.06] px-2 py-0.5 text-[10px] font-semibold text-amber-200">Descriptive research instrument</span>
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">A translation layer for how market structure changes across time and horizon</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                This page begins with one instrument's timestamped OHLCV bars, or two independently constructed same-recipe fields in Pair mode. Each field derives kinematic, geometric, informational, and carrier measurements and learns its own request-specific dictionary. The interface translates those measurements into a compact cloud, synchronized timelines, relationship scopes, plain-language definitions, and separately labeled context. Pair mode adds shared-support coordinate differences and relative price context without merging the fields or matching their Forms. Its purpose is to make multiscale structure inspectable and to generate testable hypotheses—not to hide a trading rule behind a visual metaphor.
              </p>
            </div>
          </header>

          <div className="grid gap-2 lg:grid-cols-3">
            <ReportCallout tone="sky" title="What is measured">
              Directional pressure, change through fourth normalized difference, neighboring-horizon agreement, boundary activity, ordinal disorder, propagation analogues, volatility scaling, and OHLCV carrier ratios.
            </ReportCallout>
            <ReportCallout tone="emerald" title="What it may reveal">
              Alignment or disagreement across horizons; strengthening, fading, boundary formation, reorganization, unusual state distance, and contextual conditions worth investigating across repeated samples.
            </ReportCallout>
            <ReportCallout tone="amber" title="What it does not establish">
              A universal regime, stable attractor, physical market law, causal spillover, calibrated probability, option arbitrage, or profitable forecast. Those require stronger, repeated, cost-aware validation.
            </ReportCallout>
          </div>

          <section className="rounded-2xl border border-stealth-700 bg-slate-950/25 p-3 sm:p-4" aria-labelledby={`${reportId}-pipeline-title`}>
            <div className="flex items-start gap-3">
              <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
              <div>
                <span className="page-kicker">System map</span>
                <h3 id={`${reportId}-pipeline-title`} className="mt-1 text-base font-semibold text-white">Independent field branch(es), one shadow-context branch</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">The numbered stages are ordered transformations. Labels describe evidence status; color is only a secondary cue.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              {PIPELINE_STAGES.map((stage, index) => (
                <article key={stage.title} className={`relative rounded-xl border p-3 ${stage.tone}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-semibold text-slate-300">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{stage.label}</span>
                  </div>
                  <h4 className="mt-2 text-xs font-semibold text-white">{stage.title}</h4>
                  <p className="mt-1 text-[11px] leading-4 text-slate-400">{stage.detail}</p>
                </article>
              ))}
            </div>
            <div className="mt-2 grid gap-2 rounded-xl border border-dashed border-amber-400/25 bg-amber-400/[0.035] p-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-200"><GitBranch className="h-4 w-4" /> Parallel shadow branch</div>
              <p className="text-xs leading-5 text-slate-400">Prior-bar technical structure + current/sparse options evidence + cached daily cross-market pressure relationships</p>
              <span className="w-fit rounded-full border border-amber-400/25 px-2.5 py-1 font-mono text-[10px] text-amber-200">field_influence: none</span>
            </div>
          </section>

          <section className="rounded-2xl border border-stealth-700 bg-slate-950/25 p-3 sm:p-4" aria-labelledby={`${reportId}-ladder-title`}>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              <h3 id={`${reportId}-ladder-title`} className="text-sm font-semibold text-white">Evidence ladder</h3>
            </div>
            <div className="mt-3 grid gap-px overflow-hidden rounded-xl border border-stealth-700 bg-stealth-700 sm:grid-cols-2 xl:grid-cols-6">
              {EVIDENCE_LADDER.map(([number, label, description]) => (
                <div key={number} className="bg-slate-950/75 p-3">
                  <div className="font-mono text-[9px] text-sky-300">{number}</div>
                  <div className="mt-1 text-xs font-semibold text-white">{label}</div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
                </div>
              ))}
            </div>
          </section>

          <CurrentRunAudit data={data} />

          <ChapterAccordionContext.Provider value={{ activeChapter, setActiveChapter }}>
          <div className="space-y-2">
            <Chapter
              number="01"
              title="Research question, scope, and claim boundary"
              synopsis="What the instrument is trying to observe, why the field metaphor helps, and where interpretation must stop."
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <MethodBlock title="Research question">
                  Can a causal representation of direction, organization, disorder, boundary activity, and cross-horizon motion expose structural changes that a single fixed-lookback indicator compresses away? The system treats that as an empirical visualization question first. It asks whether repeated field states can be named, inspected, and later tested without letting outcomes leak into state construction.
                </MethodBlock>
                <MethodBlock title="Unit of analysis">
                  Single mode analyzes one symbol at one selected bar size. Pair mode analyzes target and benchmark independently under that same bar size, horizon grid, settings, and semantic revision, then compares only their shared admissible observations. Every horizon is a count of the selected bars, not a second market timeframe. The page is multihorizon within a timeframe; Pair mode is not a constituent-weighted basket, cross-sectional peer model, or fused nine-timeframe model.
                </MethodBlock>
                <MethodBlock title="Descriptive, diagnostic, predictive">
                  Observed bars and causal transformations are descriptive. Range checks and field states can be diagnostic because they compare current structure with earlier learned examples. Forward outcomes, relationship cards, and motifs remain hypothesis-generating. No component currently earns a calibrated predictive or prescriptive label.
                </MethodBlock>
                <MethodBlock title="Working novelty statement">
                  The ingredients have established lineages. The unusual part is their synthesis: a causal horizon-indexed field, derivative strata, an empirical window-native lexicon, chronological range evidence, and shadow context inside an interactive translation layer. This is a design and research observation—not a patent, priority, or scientific-novelty claim.
                </MethodBlock>
              </div>
              <div className="mt-3">
                <ReportCallout tone="amber" title="Metaphor boundary">
                  “Weather,” “field,” “pressure,” “convection,” “boundary,” and “propagation” are operational names for defined transformations. They make shape and change easier to discuss; they do not imply that markets obey atmospheric or physical field equations.
                </ReportCallout>
              </div>
            </Chapter>

            <Chapter
              number="02"
              title="Data, causality, and base field construction"
              synopsis="The exact path from timestamped OHLCV bars to the bounded pressure matrix displayed in the cloud."
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <MethodBlock title="Input and availability">
                  The endpoint accepts 60–5,000 visible bars, up to 120 horizon rows, and no more than 120,000 returned cells. Supported bar sizes are 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, and 1W. The server requests a leading buffer of max(72, 2×maximum horizon), calculates on every returned bar, and only then trims the visible response. The returned history contract distinguishes visible bars from calculation bars and states whether that initialization reference was covered.
                </MethodBlock>
                <MethodBlock title="Provider and timestamp lineage">
                  The response separately reports bar source, quote source, observed timestamp, coverage, generation time, and cache lineage. History-origin metadata describes the bars used when that analysis was computed; request metadata separately states whether this HTTP request touched history or called a provider. Normalized OHLCV is stored by symbol, timeframe, and timestamp in a persistent read-through cache shared across server workers. Freshness uses the last successful cache update—not the last exchange bar—so weekends do not manufacture staleness. A short-lived, one-entry derived-response cache and identical-request single-flight are local to each worker; retention is skipped above the disclosed cell budget, and its TTL cannot exceed the selected history TTL. Yahoo is the default provider; IBKR can be primary when configured, with method-specific fallback. Yahoo 2h and 4h bars are aggregated from 60-minute bars inside each trading session. Quote failure or cache-database failure does not invalidate otherwise usable provider history; a failed live refresh can use sufficient stored history only when the response marks it as a bounded-age stale fallback.
                </MethodBlock>
                <MethodBlock title="Pair symbol and session alignment">
                  Pair receipts preserve requested, canonical, and provider symbols. The canonical DXY selector resolves to Yahoo&apos;s DX-Y.NYB index identifier; UUP is not silently substituted. Daily and weekly rows align by their serialized market-session date; the service does not independently certify exchange calendars or timezones. Timezone-aware intraday timestamps normalize to UTC before exact matching. If a provider/cache row is timezone-naive, its exact serialized timestamp is matched without relabeling it as UTC and session compatibility remains unknown. No nearest-neighbor match or forward fill is allowed; nonidentity DXY comparisons at 1h, 2h, and 4h are explicitly unavailable under the current provider anchors. The live endpoint uses provider/cache rows as returned and does not independently certify its latest bar as exchange-complete. Common observations, both dropped-row counts, each latest returned timestamp, the latest shared timestamp, and the alignment rule are part of the result. Provider, currency, adjustment, timezone, and session differences remain limitations rather than being normalized away.
                </MethodBlock>
                <MethodBlock title="Midprice and true range" formula={<>Mₜ = (Hₜ + Lₜ) / 2;&nbsp;&nbsp; TRₜ = max(Hₜ−Lₜ, |Hₜ−Cₜ₋₁|, |Lₜ−Cₜ₋₁|)</>}>
                  Midprice reduces a bar to its high–low center. True range introduces local scale while respecting overnight or inter-bar gaps. All rolling and exponential operations are trailing; no centered window is used.
                </MethodBlock>
                <MethodBlock title="Normalized directional spread" formula={<>zₜ,ₕ = (EMAfast(M)ₜ − EMAslow(M)ₜ) / meanₕ(TR)ₜ;&nbsp;&nbsp; dₜ,ₕ = zₜ,ₕ / (1 + |zₜ,ₕ|)</>}>
                  For horizon h, the fast EMA span is max(2, floor(h/2)) and the slow span is h. The rational bound preserves sign and ordering while limiting extreme influence to (−1, 1).
                </MethodBlock>
                <MethodBlock title="Path efficiency" formula={<>eₜ,ₕ = |Mₜ − Mₜ₋ₕ| / Σᵢ₌ₜ₋ₕ₊₁…ₜ |Mᵢ − Mᵢ₋₁|;&nbsp;&nbsp; sraw = d × e</>}>
                  Efficiency approaches one when movement is direct and approaches zero when the path travels without net displacement. Multiplying by direction downweights noisy, reversible movement without changing sign.
                </MethodBlock>
                <MethodBlock title="Causal state and pressure">
                  The raw state is exponentially smoothed, blended 32% with adjacent horizons by default, smoothed again through time with default span 3, and blended again across adjacent rows with default weight 0.42. The resulting matrix is pressure. Despite legacy setting names, “renderer time blur” and “renderer spatial blend” are analytical smoothing parameters because derivatives and Forms are computed after them.
                </MethodBlock>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <ReportCallout tone="emerald" title="Non-anticipative invariant">A field value at t is a deterministic function of bars through t. The frozen audit checked 46 endpoints and 24,472 unrounded values at 1e−12 tolerance with maximum observed difference zero.</ReportCallout>
                <ReportCallout tone="sky" title="Scale coordinate">Rows are drawn at equal visual height, but scale derivatives use natural log horizon. Visual row spacing and analytical scale spacing are intentionally different.</ReportCallout>
                <ReportCallout tone="amber" title="Initialization is separate from causality">A calculation can use no future data and still depend on how much earlier history was retained. In the frozen audit, a 60-bar recomputation had median IQR-normalized error 0.501 versus full retained history; the response therefore exposes both minimum-input sufficiency and initialization-target coverage. Neither is a convergence guarantee.</ReportCallout>
              </div>
            </Chapter>

            <Chapter
              number="03"
              title="Field calculus, strata, and OHLCV carriers"
              synopsis="How change, geometry, information, propagation, and market activity are separated into auditable channels."
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <MethodBlock title="Normalized time derivatives" formula={<>D(x)ₜ = bound(Δxₜ / EWM(|Δx|)ₜ);&nbsp;&nbsp; velocity=D(P), acceleration=D(v), jerk=D(a), snap=D(j)</>}>
                  The default magnitude-normalizer span is 13. These are bounded, dimensionless diagnostic derivatives—not price velocity, acceleration, jerk, or snap in physical units. Higher orders become increasingly sensitive to noise and smoothing choices.
                </MethodBlock>
                <MethodBlock title="Scale geometry">
                  Signed first and second numerical derivatives are calculated against ln(horizon), plus a time derivative of scale gradient. Absolute scale gradient, temporal gradient, and Laplacian-like energy feed boundary measures. “Coherence” is one minus normalized neighboring-horizon disagreement; it is not spectral or wavelet coherence. Under the bounded pressure construction its effective range is (7/27, 1], so its .42 weight contributes more than 49/450 to the legacy Structure coordinate even at maximum disagreement.
                </MethodBlock>
                <MethodBlock title="Activity, agreement, and the legacy display composite" formula={<>activity=clip(1.8|P|); motion=clip(1.4|v|); display composite=.48·agreement + .32·activity + .20·(1−legacy disorder)</>}>
                  Activity measures pressure magnitude; horizon agreement measures neighboring-row similarity. The API's legacy confidence channel controls renderer intensity and is not a probability. On a perfectly flat field, activity and disorder are zero while agreement is one, so this formula returns 0.68. The interface exposes those ingredients separately instead of translating 0.68 as evidence of an active organized market.
                </MethodBlock>
                <MethodBlock title="Boundary, expansion, and convection" formula={<>boundary=clip(.42·vertical + .33·temporal + .25·laplacian); convection=boundary·(.45+.55·motion)</>}>
                  Pressure-sign-aligned velocity, multiplied by 1.8, is split into expansion and contraction. Persistence is the absolute five-bar rolling mean of pressure sign. Reflectivity combines strength, motion, and boundary activity before logarithmic compression.
                </MethodBlock>
                <MethodBlock title="Two different disorder measures">
                  Legacy field disorder is a causal heuristic: an exponential average of 0.60×(1−coherence) + 0.40×motion energy. Permutation entropy is the actual normalized Bandt–Pompe statistic: order 3, six possible ordinal patterns, estimated from at most 24 recent observed pattern instances and normalized by log(3!). They answer different questions and should not be merged. Alternative 8, 12, 48, and 96-instance windows had only 0.34–0.63 correlation with the displayed 24-instance setting in the frozen sensitivity audit.
                </MethodBlock>
                <MethodBlock title="Cascade and propagation" formula={<>gₛ=∂P/∂ln(h);&nbsp;&nbsp; cascade=tanh(−v·gₛ / (gₛ² + .08));&nbsp;&nbsp; propagation=clip(1.8√(|v||gₛ|)(.45+.55·coherence))</>}>
                  Velocity v is the bounded time derivative of pressure and gₛ its bounded log-horizon gradient. Positive cascade values describe a local level-set motion analogue toward longer horizons. This is not Horn–Schunck optical flow, transfer entropy, Granger causality, or evidence that information physically travels between horizons.
                </MethodBlock>
                <MethodBlock title="Five strata">
                  The legacy Structure coordinate is .58 activity + .42 horizon agreement. It therefore equals 0.42 on a flat coherent field; v1.2 presents it as a trend-agreement composite and exposes both ingredients without changing the v1 state vector. Because horizon agreement is strictly above 7/27, its Structure contribution is strictly above 49/450. Reorganization = .18|velocity| + .24|acceleration| + .27|jerk| + .31|snap|. Geometry = .32|scale gradient| + .28|scale curvature| + .20|mixed derivative| + .20 boundary. Information = .72 permutation entropy + .28 legacy disorder. Propagation is mean propagation strength across horizons.
                </MethodBlock>
                <MethodBlock title="Volatility scaling" formula={<>RVₕ,ₜ = √Σᵢ₌ₜ₋ₕ₊₁…ₜ (Δlog Cᵢ)²;&nbsp;&nbsp; scaling slope = local Δlog(RV) / Δlog(h)</>}>
                  Realized volatility is not annualized. For stationary finite-variance increments, square-root-of-time scaling provides a 0.5 reference, so the response reports both the exponent and its excess over 0.5. At a fixed date, expanding the horizon only adds squared returns, so this implemented slope is nonnegative in exact arithmetic. Any per-horizon or aggregate estimate below the declared floating-point tolerance is quality-flagged and withheld—not interpreted as a negative market property. Zero-variation paths are also marked degenerate. The raw channel keeps defensive [−2, 2] storage bounds, but the displayed slope is not Hurst H, long-memory evidence, or a multifractal spectrum.
                </MethodBlock>
                <MethodBlock title="OHLCV carriers" formula={<>cluster carrier = .5 + .5·tanh(2·log(current / EWM baseline));&nbsp;&nbsp; displayed ratio = current / EWM baseline</>}>
                  Carriers are realized volatility, trailing volume participation, and an Amihud-like |log return|/dollar-volume liquidity stress. The baseline span is max(34, 2×maximum horizon). A displayed ratio of 1.00× means baseline. With no positive volume, participation and liquidity evidence remain unavailable even though neutral internal values keep clustering finite.
                </MethodBlock>
                <MethodBlock title="Latest summary aggregation">
                  Field direction is a horizon-weighted average, giving longer configured horizons more weight. Alignment is the fraction of horizons sharing that sign and is forced to 0.5 when |direction|≤0.02. Expansion front is the largest horizon with expansion at least 0.35. The headline regime name is a fixed heuristic—not a learned Form or probability: turbulent when legacy disorder≥0.62 and coherence&lt;0.48; organized bull/bear when direction is at least ±0.25 in magnitude and coherence≥0.58; bullish/bearish expansion when direction is at least ±0.10 and expansion≥0.20; neutral when |direction|&lt;0.12; otherwise developing trend.
                </MethodBlock>
              </div>
            </Chapter>

            <Chapter
              number="04"
              title="The empirical Form dictionary and grammar"
              synopsis="What is learned, when it is learned, how states are named, and how current observations are compared with prior examples."
            >
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <MethodBlock title="Fifteen-dimensional state vector">
                    Each timestamp becomes five horizon-weighted derivative coordinates (pressure through snap), seven aggregate field transforms (structure, kinematics, geometry, information, propagation, cascade bias, scaling exponent), and three horizon-averaged OHLCV carriers. A Form is therefore a state of aggregate measurements—not a cluster of the complete spatial shape of the cloud.
                  </MethodBlock>
                  <MethodBlock title="Chronological partition">
                    Evaluation begins near 60% of the full buffered history. Earlier pre-evaluation data is divided into a proper-fit segment and a later calibration segment, normally reserving about one third for calibration while keeping at least 20 fit observations. Robust scaling and centroids use proper-fit data only. Evaluation outcomes are never used to construct Forms.
                  </MethodBlock>
                  <MethodBlock title="Robust scaling and distance" formula={<>zⱼ=(xⱼ−medianfit,j)/IQRfit,j;&nbsp;&nbsp; distance²=Σⱼ wⱼ(zⱼ−centroidⱼ)²</>}>
                    MAD, standard deviation, then 1 are scale fallbacks when IQR is unusable. Pressure-state, field-transform, and OHLCV-carrier families each receive one third of total distance weight so a large feature family cannot dominate merely by having more columns.
                  </MethodBlock>
                  <MethodBlock title="Form selection">
                    Deterministic farthest-first k-means tests up to five clusters. Every candidate Form needs at least max(20, 5% of fit bars), mean fit silhouette must reach 0.25, and centroids must be numerically and quantization-distinct. Highest silhouette wins with lower k breaking a tie. If evidence is insufficient, the honest result is one Form—not fabricated variety.
                  </MethodBlock>
                  <MethodBlock title="Identity and naming">
                    F.001, F.002, and similar IDs are canonicalized within the current request window. Their internal pronounceable tokens are hashes of quantized centroids, not semantic discoveries. The interface instead names Forms from measured pressure sign, pressure-change alignment, organization, propagation, disorder, and fit-relative deviations. IDs are not yet stable across symbols, timeframes, or requests.
                  </MethodBlock>
                  <MethodBlock title="Distance, resonance, and novelty">
                    Nearest-Form distance is the primary measurement. The legacy match field is retained as an alias for resonance = exp(−distance / median reference distance), an uncalibrated monotone transform rather than a probability. Novelty maps distance between the reference median and 95th percentile. All three are relative to this fitted window and can change when the window or configuration changes.
                  </MethodBlock>
                  <MethodBlock title="State-conditional calibration-distance check" formula={<>upper-tail rank = (1 + #{`{`}dcal ≥ dcurrent{`}`}) / (n + 1)</>}>
                    Current centroid distance is ranked against later calibration distances assigned to the same Form. At least 20 same-Form calibration observations are required; below 0.05 is called an extreme calibration-distance tail and causes the historical analog to be withheld. This does not mean coordinatewise range violation or density exclusion, and the rank is not a formal p-value or conformal coverage guarantee. Legacy <span className="font-mono">outside_learned_range</span> and <span className="font-mono">distance_tail_score</span> keys remain compatibility aliases.
                  </MethodBlock>
                  <MethodBlock title="Grammar, Phrases, and outcomes">
                    Proper-fit Form runs are collapsed before exit transitions are counted; self-persistence is excluded and off-diagonal counts receive 0.5 smoothing. A likely-next Form needs at least five exits and a unique leader. Motifs are repeated run-collapsed sequences of two to four Forms. Five-bar forward outcomes are measured later, overlap, and are serially dependent; they describe history rather than forecast it.
                  </MethodBlock>
                  <MethodBlock title="Internal relationship atlas">
                    Four predeclared exploratory events are screened. Organized expansion requires structure≥70th percentile, propagation≥60th, information≤50th, and |pressure|≥60th. Longward cascade requires propagation≥72nd, cascade bias≥max(0.08, 62nd), and |pressure|≥55th. Geometry/disorder shock requires geometry≥75th and information≥60th. Kinematic exhaustion requires kinematics≥75th, |pressure|≥65th, and aligned velocity no greater than its calibration 35th percentile. Thresholds come from the earlier 60% after up to 20 initialization bars; outcomes use the later 40%. Forward bars equal max(3, min(10, floor(n/60))). Statuses are descriptive sample/uplift heuristics. Windows overlap, there is no purge, and this internal atlas has no multiple-test adjustment.
                  </MethodBlock>
                </div>
                <ReportCallout tone="violet" title="Dictionary interpretation">
                  The dictionary is an empirical compression of this request, not an ontology imposed on every market. Its most useful question is not “What universal regime is this?” but “Which measured configuration does this bar most resemble, how supported is that comparison, and how is the configuration changing?”
                </ReportCallout>
              </div>
            </Chapter>

            <Chapter
              number="05"
              title="Shadow context: price action, optionality, and cross-market structure"
              synopsis="How adjacent systems contribute evidence without contaminating the learned field or overstating causality."
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <MethodBlock title="Causal support and resistance">
                  Support is the minimum low and resistance the maximum high of the prior 20 selected-timeframe bars. Both are shifted one bar so a current breakout cannot move its own boundary. During initialization, the rolling boundary and SMA20 become available after 10 observations. ATR14 is a simple trailing arithmetic mean of true range with a five-bar minimum, not Wilder's recursive ATR. Range position, ATR distances, SMA20 gap, and five-bar return complete the price-action context.
                </MethodBlock>
                <MethodBlock title="What the technical layer is not">
                  The rule is a transparent rolling-extreme heuristic. It is not a learned zone, volume profile, order-book level, pivot system, or validated trading rule. Its purpose is to state where price sits relative to recent boundaries in units that can later be tested.
                </MethodBlock>
                <MethodBlock title="Current optionality snapshot">
                  The page reads the symbol's latest Stock Analysis snapshot plus sparse Secret Options events. It exposes IV30, HV30, their point spread, a current-chain cross-sectional IV percentile, average extrinsic share, and scanner metadata. Freshness is checked through 24 hours. The stock snapshot is overwritten rather than stored as a full historical surface.
                </MethodBlock>
                <MethodBlock title="Why “mispricing” remains a hypothesis">
                  IV at least five points below HV is labeled implied-below-realized; five points above is implied-above-realized; otherwise near. That relative-richness label does not estimate expected option P&amp;L, maturity-aligned variance premium, skew, term structure, jumps, liquidity, transaction costs, or arbitrage. Current values are never stretched backward across field history.
                </MethodBlock>
                <MethodBlock title="Cached cross-market inputs">
                  Energy stability, real-estate stability, agriculture stability, sector-regime alignment, metals instability, and crypto instability are loaded as cached derived scores. Falling stability/alignment becomes rising pressure; metals and crypto are already instability contributions. These are not raw asset returns at this layer.
                </MethodBlock>
                <MethodBlock title="Relationship design">
                  Target is the ticker's daily log return. Input is exact-day change in cached pressure, without forward-filling missing dates. Candidate lags are 0, 1, 5, and 20 trading days. Lag is selected by absolute Spearman rho on the first 70%; the final 30% is held out, requiring at least 40 calibration and 20 holdout observations.
                </MethodBlock>
                <MethodBlock title="Permutation and multiplicity control">
                  Holdout evidence uses a two-sided 199-draw block permutation with five-observation blocks. Benjamini–Hochberg adjusts p-values across available sources. “Persistent” requires the same calibration/holdout sign, q≤0.10, and |holdout rho|≥0.15. A 60-observation rolling Spearman trace is shown descriptively.
                </MethodBlock>
                <MethodBlock title="Interpretation boundary">
                  Cross-market relationships are daily even when the selected field is intraday. Source staleness is labeled but historical estimation can still include older cached observations. Selected lag association is not structural causality, economic transmission, or a guarantee that the relationship will persist.
                </MethodBlock>
                <MethodBlock title="Secret Options field challenger">
                  Scanner hits and position assessments can carry a compact, immutable <span className="font-mono">option_market_field_v1</span> snapshot made only from completed OHLCV bars. Stored v1.0–v1.2 snapshots retain their original revision and compatibility aliases. Semantic v1.3 carries forward the v1.2 scaling and signed-delta/action-alignment corrections, then adds coordinate dependency-support coverage, canonical recipe/input/analysis hashes, and separate direct-versus-indirect authority receipts without changing the v1 field vector. The hashes identify the supplied rows and calculation recipe; they do not certify provider truth. Snapshots deliberately exclude learned Form IDs, forward outcomes, the relationship atlas, and the circular current-options context shown on this page.
                </MethodBlock>
                <MethodBlock title="Decision influence and learning">
                  The deterministic option opportunity model remains the champion. The current Market Field snapshot has 0% direct scanner weight and no eligibility, hard-veto, verdict, target-size, or execution authority; advisory influence is limited to displayed assessment confidence and review priority. Separately, an operator-authorized outcome-learning canary may use historical point-in-time Market Field cohorts alongside four other families to lean the displayed score and order, with all families together capped at 10% and every applied contribution receipted. That bounded experiment is not evidence that the lean improves decisions. Successful terminal-run finalization freezes a separate rank receipt, while authenticated candidate-visibility and detail-open events collect prospective exposure evidence from the deployment boundary forward.
                </MethodBlock>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <ReportCallout tone="amber" title="Mode">{context?.mode ? context.mode.replace("_", " ") : "shadow only"}</ReportCallout>
                <ReportCallout tone="amber" title="Field influence">{context?.field_influence ?? "none"}</ReportCallout>
                <ReportCallout tone="sky" title="Current relationship screen">{formatInteger(contextRelationships.length)} returned · {formatInteger(persistentRelationships)} meet the current persistent rule</ReportCallout>
              </div>
            </Chapter>

            <Chapter
              number="06"
              title="Design breakdown: how the interface translates the model"
              synopsis="Why each visual exists, what its marks encode, and how the page avoids turning complexity into decorative certainty."
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <MethodBlock title="Horizon cloud">
                  Rectangular cells map time left-to-right and configured horizons bottom-to-top. Color encodes the selected lens; it does not add data. The compact height deliberately makes the surface feel like a weather cloud and preserves diagonal fronts without claiming precise contour geometry. Pointer, touch, or keyboard inspection restores the timestamp, horizon, pressure, pressure change, display organization, and legacy disorder.
                </MethodBlock>
                <MethodBlock title="Five renderer lenses">
                  Regime Health maps pressure sign to directional hue while coherence, legacy disorder, and the uncalibrated display-organization score alter intensity. Convection scales the directional base by reflectivity and mixes in blue from convection and expansion. Topographic quantizes reflectivity into bands and mixes in blue from boundary energy and convection. Swami Classic shows the five-category benchmark. Channel Inspector isolates one returned matrix. Every lens renders shared data; changing a lens does not refit the field.
                </MethodBlock>
                <MethodBlock title="Now timeline">
                  Price, directional phase, Form identity, trend/agreement, carriers, and calibration-distance evidence share one time axis and one inspected-bar cursor. This is the primary answer to “what changed together?” Selectable lenses reduce render cost and prevent every derived series from competing simultaneously.
                </MethodBlock>
                <MethodBlock title="Dictionary relationship scopes">
                  Directional phase places pressure on x and pressure change on y with independently auto-fit signed axes. Organization / disorder places structure on x and information / ordinal disorder on y, each fixed from 0 to 1. Scale propagation places propagation on x from 0 to 1 and cascade bias on y from −1 to +1. Every panel joins derivative and strata observations by timestamp and projects the same exact learned Form centroids and current observation.
                </MethodBlock>
                <MethodBlock title="Scope trace, smoothing, and color">
                  A faint dashed line preserves the exact raw path. The brighter trace applies a causal exponential display average with α=0.5 (the standard span parameter is 3) and round line caps only to reduce visual aliasing; it does not feed the field, Form learning, state assignment, outcomes, or any other analysis. The diamond and centroids remain exact. Trace color and redundant width classify the display-smoothed third measure below −1, within ±1, or above +1 model-fit robust-scale units as low, typical, or elevated: structure for direction, reorganization for organization / disorder, and boundary activity for propagation.
                </MethodBlock>
                <MethodBlock title="Relative Field coordinate lenses" formula={<>Δnativeⱼ = Xtarget,ⱼ − Xbenchmark,ⱼ;&nbsp;&nbsp; Δcontextⱼ = Ztarget,ⱼ − Zbenchmark,ⱼ</>}>
                  Native difference uses each coordinate&apos;s implemented 15D scale—not raw market units—and exists only when both observations are finite, source-observed, and fully dependency-supported. The three carrier coordinates are bounded causal-baseline relative levels rather than raw realized variation, volume, or impact. Context difference standardizes each instrument against its own frozen proper-fit median and robust scale, then begins only on the intersection of their evaluation segments. Fit and calibration bars are not backfilled with later reference statistics. Context is therefore fixed-fit-relative and request-window-dependent—not a universal score or a cross-sectional rank.
                </MethodBlock>
                <MethodBlock title="Relative price and Pair scopes">
                  Relative price is indexed to 100 at the first common aligned full-precision close and is kept separate from field-coordinate differences. The log-return residual starts after 20 prior aligned pairs and uses an intercept-inclusive beta estimated from at most 60 strictly prior pairs. A benchmark return standard deviation below 1e−7, a nonfinite estimate, or absolute beta above 25 makes the row unavailable; beta is rejected rather than clipped or carried, and the current contiguous residual chain resets. It never rescales the 15 field coordinates. The family-balanced fit-relative stretch compares mean absolute context separation with five bars earlier over the same supported coordinate intersection. Each scope selector displays target, benchmark, or difference on one shared axis domain, while differential coordinates remain centered at zero and use color as a redundant third measure. These trajectories do not identify a winner, cycle, attractor, lead–lag mechanism, or causal transmission.
                </MethodBlock>
                <MethodBlock title="Pair identity and authority">
                  The ordered comparison hash binds target and benchmark analysis hashes plus alignment and normalization rules. Swapping the instruments reverses signed differences and changes the receipt. Request-local Form IDs and centroids are never matched across instruments. Pair v1 has zero scanner, outcome-learning-canary, veto, verdict, sizing, and execution authority; basket fields, connectedness, cross-sectional peer ranks, and cross-timeframe fusion remain future work.
                </MethodBlock>
                <MethodBlock title="Methods derivative stack">
                  The Methods view unfolds pressure through velocity, acceleration, jerk, and snap so a definition becomes a changing trajectory rather than a paragraph. The stack is an audit surface for sign, timing, and smoothing sensitivity; it is not a claim that higher derivatives are inherently more predictive.
                </MethodBlock>
                <MethodBlock title="Context lens">
                  Price boundaries, optionality, and cross-market relationships are visibly separated from the learned field. This protects the distinction between explaining the current environment and changing the state model. Promotion into the field requires a predeclared, repeated validation protocol.
                </MethodBlock>
                <MethodBlock title="Raw data and this report">
                  Raw profile tables, provenance, and response-specific settings allow the visuals to be checked. Raw Data lazy-mounts only when opened, and the report mounts at most one detailed chapter at a time. The versioned URL records symbol, timeframe, field construction, renderer, inspector channel, language view, and timeline lens/window; it recreates a selector recipe, not a frozen market-data snapshot.
                </MethodBlock>
              </div>
              <div className="mt-3">
                <ReportCallout tone="sky" title="Visual grammar rule">
                  Shape, hue, intensity, position, and text must map to defined values. When a visual metaphor has no rendered mark or empirical unit, it should be removed, labeled experimental, or replaced with direct measurement. The website is a translation layer—not the source of the evidence.
                </ReportCallout>
              </div>
            </Chapter>

            <Chapter
              number="07"
              title="Research and product evolution"
              synopsis="The progression from a replicated indicator to a field, a machine dictionary, and a more grounded, compact research instrument."
            >
              <div className="space-y-5">
                <ReportCallout tone="violet" title="Design archive">
                  The A–F track below is reconstructed from the original internal report, “SwamiCharts to Steve's Convection: Complete Research and Code Report.” The web track follows the implemented product history from the first Canvas field through the current grounded dictionary, context lens, compact cloud, restored state scopes, and Relative Field Pair receipt.
                </ReportCallout>
                <EvolutionTrack title="Research lineage: the original A–F experiments" steps={RESEARCH_EVOLUTION} />
                <EvolutionTrack title="Web evolution: measurement, language, grounding, and context" steps={PRODUCT_EVOLUTION} />
                <ReportCallout tone="emerald" title="What survived the iterations">
                  Time × horizon structure, continuous direction, separately inspectable channels, causal computation, a Swami benchmark, and the idea that organization and transition deserve their own visual vocabulary. What changed was the burden of proof: machine-native names and rich glyphs moved behind measured descriptions, chronological splits, support thresholds, and explicit uncertainty.
                </ReportCallout>
                <ReportCallout tone="amber" title="What is still absent">
                  The earlier Voss tactical-wave concept is not implemented. Nor are Takens embeddings, full optical flow, transfer entropy, Hurst or multifractal estimation, WebGL isolines, persistent cross-window or cross-symbol Forms, constituent-weighted basket fields, cross-sectional peer ranks, nine-timeframe fusion, historical option surfaces, or a validated execution model. Pair v1 compares exactly two independent fields and does not imply any of those broader capabilities.
                </ReportCallout>
              </div>
            </Chapter>

            <Chapter
              number="08"
              title="Validation, limitations, and failure modes"
              synopsis="What the existing checks prove, what they do not prove, and the ways a compelling pattern can still be misleading."
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <MethodBlock title="Implementation invariants already tested">
                  Repository tests cover finite and bounded matrices, chronological atlas separation, deterministic Forms, fit/calibration separation, family-balanced weights, one-Form fallback, all nine timeframes, prior-bar boundaries, lag selection, holdout behavior, and no source-date forward fill. Pair tests additionally cover ordered deterministic identity, same-recipe enforcement, shared-support masking, evaluation-only context, swap-sign symmetry, session/date alignment, DXY alias provenance, and no pair authority. The frozen v2 audit compared 24,472 unrounded live values at 46 prefix endpoints with maximum observed deviation zero at 1e−12, and reports calibration support rather than silently dropping unsupported bars.
                </MethodBlock>
                <MethodBlock title="What those tests do not prove">
                  Passing tests establishes that code follows its declared mechanics. It does not establish stable economic meaning, superior forecasting, statistical significance, robustness across assets or regimes, tradability after costs, or independence from the researcher's many design choices.
                </MethodBlock>
                <MethodBlock title="Dependence and overlapping outcomes">
                  Five-bar Form outcomes, motif outcomes, and internal relationship-atlas windows overlap and are serially dependent. The calibration-distance rank also uses dependent observations. Naïve sample sizes therefore overstate effective information, and ordinary iid interpretations are inappropriate.
                </MethodBlock>
                <MethodBlock title="Multiple research paths">
                  The internal four-hypothesis relationship atlas and motif search currently have no family-wide multiple-test adjustment. The separate cross-market screen does use block permutation and Benjamini–Hochberg correction. That distinction must remain explicit rather than being summarized as one global validation claim.
                </MethodBlock>
                <MethodBlock title="Window and configuration dependence">
                  Forms, centroids, scaling, labels, calibration-distance ranks, and scope geometry can change with symbol, timeframe, history length, horizon set, or analytical smoothing. Pair context inherits two such proper-fit references and can change when either request window changes. A 60-bar trailing recomputation was materially different from full retained history, and entropy-window alternatives correlated only 0.34–0.63 with the displayed 24-instance setting. Single-symbol directional phase independently auto-fits x and y, so visual size and shape are not directly comparable across runs. Pair subjects instead reuse one axis domain per scope and differential coordinates center on zero, but their reference-relative traces are still request-specific.
                </MethodBlock>
                <MethodBlock title="Provider and market microstructure risk">
                  IBKR and Yahoo can differ in session rules, adjustments, partial bars, timestamps, volume, currency, and contract identity. Aggregated 2h/4h Yahoo bars inherit 60m sampling choices. Pair mode exposes the canonical DXY-to-DX-Y.NYB alias and does not substitute UUP. Daily date alignment does not prove identical sessions, while strict intraday timestamp alignment can leave hourly cross-session pairs unavailable. A cache hit reduces upstream requests but does not improve the source observation; TTL choice trades freshness for provider pressure, and stale fallback is explicitly labeled. Asynchronous trading, stale cached sources, and sparse options history limit cross-system comparisons.
                </MethodBlock>
                <MethodBlock title="Derivative and smoothing risk">
                  Normalized derivatives can amplify microstructure noise and change sign near small denominators. Analytical causal smoothing reduces noise but adds lag and changes the field being learned. Separately, the scope deck uses a disclosed display-only EWM and curve interpolation that changes only the rendered trace. Sensitivity analysis must vary analytical smoothing, horizons, baseline span, and data source rather than treating defaults as natural constants.
                </MethodBlock>
                <MethodBlock title="Human interpretation risk">
                  Dense color fields invite pareidolia, especially diagonal bands and loops. A loop in any scope is only a path through two displayed coordinates; no correlation coefficient, recurrence test, cycle detector, attractor reconstruction, or causal-flow estimate is calculated. A positive Pair difference says target minus benchmark on one coordinate—not “target is better”—and only the separate relative-price series describes economic progress. Direct values, raw traces, provenance, support counts, holdout boundaries, and falsifiable promotion rules are safeguards against narrative overreach.
                </MethodBlock>
              </div>
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-400/[0.05] p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
                <p className="text-xs leading-5 text-slate-300"><span className="font-semibold text-rose-200">Decision boundary:</span> this page is research context, not individualized investment advice or an autonomous trading signal. A visually coherent field can still be economically irrelevant, unstable, or too costly to trade.</p>
              </div>
            </Chapter>

            <Chapter
              number="09"
              title="Published foundations and adjacent methods"
              synopsis="Primary sources that directly motivate components, provide formal comparators, or define the statistical guardrails still needed."
            >
              <div className="space-y-3">
                <ReportCallout tone="violet" title="Citation rule">
                  “Implemented” means the named method is actually calculated, such as Bandt–Pompe permutation entropy, k-means, silhouette screening, Spearman association, block permutation, or Benjamini–Hochberg adjustment. “Inspired by” and “future comparator” identify conceptual neighbors that must not be presented as current algorithms.
                </ReportCallout>
                {REFERENCE_GROUPS.map((group) => <ReferenceSection key={group.title} group={group} />)}
              </div>
            </Chapter>

            <Chapter
              number="10"
              title="Future work and a promotion protocol"
              synopsis="A staged plan for turning visual hypotheses into stable measurements without letting discovery outrun evidence."
            >
              <div className="mb-3">
                <ReportCallout tone="emerald" title="What moved out of future work">
                  Pairwise Relative Field instrumentation is now implemented: two independently computed same-recipe fields, supported native and evaluation-only proper-fit-relative differences, separate relative price context, explicit session alignment, ordered hashes, common-axis scopes, and zero decision authority. This closes an engineering gap, not the evidence gap. Baskets, connectedness, cross-sectional ranks, persistent cross-symbol Forms, and economic validation remain future work.
                </ReportCallout>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <MethodBlock title="1. Freeze the measurement registry">
                  Version every formula, feature family, horizon set, smoothing choice, provider rule, Pair alias/alignment/normalization rule, and visual mapping. Separate exploratory features from predeclared confirmatory features. The current URL freezes selector state only; durable replication also requires both exact input-data fingerprints and the ordered comparison receipt or immutable response snapshot.
                </MethodBlock>
                <MethodBlock title="2. Expand persistent historical inputs">
                  Symbol/timeframe OHLCV now uses a persistent read-through store, and scanner hits retain a compact point-in-time field snapshot. The broader options source still needs timestamped surfaces containing maturity, moneyness, bid/ask, volume, open interest, skew, term structure, and realized-volatility alignment. Preserve cached macro/sector source vintages and revisions. Store Forms and immutable input fingerprints so cross-window identity can be studied rather than assumed.
                </MethodBlock>
                <MethodBlock title="3. Test dictionary stability">
                  Refit across rolling origins, assets, bar sizes, horizon subsets, and providers. Match centroids across runs with explicit uncertainty. Measure cluster survival, assignment stability, calibration-tail behavior, and label consistency. Compare against one-state, Gaussian-mixture, HMM, and Markov-switching baselines.
                </MethodBlock>
                <MethodBlock title="4. Use dependence-aware validation">
                  Adopt purged or embargoed rolling-origin evaluation, stationary/block bootstrap intervals, surrogate-data nulls, and an untouched final holdout. Correct the entire research family—not only one screen—for multiplicity and researcher degrees of freedom. Report effective sample size and sensitivity, not only point estimates.
                </MethodBlock>
                <MethodBlock title="5. Define context promotion gates">
                  A support, options, cross-market, Pair, or option-path feature may influence ranking or state assignment only after its definition is frozen, timestamp lineage is complete, direction repeats across rolling folds and an external universe, false-discovery control passes, and incremental out-of-sample value survives costs and simpler baselines. Pair v1 is excluded from the outcome-learning canary. The option field challenger also requires at least 100 independent trade cycles and explicit manual promotion.
                </MethodBlock>
                <MethodBlock title="6. Separate association, prediction, and value">
                  First test whether a relationship is contemporaneously stable. Then test whether lagged information improves a predeclared forecast beyond autoregressive and volatility baselines. Finally test whether the improvement is economically usable after spreads, impact, capacity, and option-specific execution costs.
                </MethodBlock>
                <MethodBlock title="7. Expand the field carefully">
                  Research orthogonal frequency bands, causal wavelet or scale-space baselines, constituent- and vintage-aware baskets, persistent cross-symbol identity, cross-timeframe alignment, connectedness, and explicit information-flow tests. Add them as separate inspectable channels before considering any composite score. Two-symbol Pair alignment is not evidence that a fused or causal model exists. Avoid giving a physics-derived name to a statistic unless its assumptions are met.
                </MethodBlock>
                <MethodBlock title="8. Validate the translation layer">
                  Test color perception, keyboard and screen-reader use, density, mobile behavior, and whether readers can correctly infer sign, transition, uncertainty, and evidence strength. A successful interface should improve calibrated understanding, not merely make the field feel convincing.
                </MethodBlock>
              </div>
              <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.045] p-3 sm:p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><FlaskConical className="h-4 w-4" /> Proposed promotion sequence</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    ["01", "Describe", "Freeze the definition and timestamp lineage."],
                    ["02", "Replicate", "Repeat across folds, assets, sources, and resolutions."],
                    ["03", "Falsify", "Challenge with nulls, simple baselines, and multiplicity control."],
                    ["04", "Validate", "Use untouched holdout evidence with costs and uncertainty."],
                    ["05", "Promote", "Only then allow the feature to influence the learned field."],
                  ].map(([number, title, detail]) => (
                    <div key={number} className="rounded-xl border border-emerald-400/15 bg-slate-950/35 p-3">
                      <div className="font-mono text-[9px] text-emerald-300">{number}</div>
                      <div className="mt-1 text-xs font-semibold text-white">{title}</div>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Chapter>
          </div>
          </ChapterAccordionContext.Provider>

          <footer className="flex flex-col gap-2 rounded-xl border border-stealth-700 bg-slate-950/35 p-3 text-xs leading-5 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2"><Database className="h-3.5 w-3.5" /> Current response: {data.symbol} · {data.bar_size} · {formatInteger(data.available_bars)} bars · {formatInteger(data.horizons.length)} horizons</span>
            <span>Working methodology · definitions should evolve only with versioned evidence</span>
          </footer>
        </div>
      ) : null}
    </section>
  );
}
