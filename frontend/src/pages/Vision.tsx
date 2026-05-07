import { useState } from "react";
import { Link } from "react-router-dom";

type PrincipleMotif = "board" | "curve" | "decision";

type PrincipleCard = {
  title: string;
  body: string;
  motif: PrincipleMotif;
};

type HeroState = "G" | "Y" | "R";
type VisionHighlightId = "vision" | "goal" | "advantage";

const principles = [
  {
    title: "Learn In Public",
    body:
      "This started as a way to sharpen my own macro process: collect the signals I kept checking, put them in one place, and make the relationships easier to review without rebuilding the same context every day.",
    motif: "curve",
  },
  {
    title: "Keep The Whole Board Visible",
    body:
      "The dashboard is meant to keep rates, credit, breadth, leadership, volatility, commodities, and alternative assets in view together. It is a personal research surface first, built around the belief that macro context is easier to reason about when the moving parts are not scattered across tabs.",
    motif: "board",
  },
  {
    title: "Invite Useful Feedback",
    body:
      "Sharing the project is part of the process. I am looking for thoughtful feedback on the framework, the data choices, the scoring logic, and the way the tool explains market conditions before I think about anything broader.",
    motif: "decision",
  },
] satisfies PrincipleCard[];

const audience = [
  "Macro-curious investors who want to see how different market signals can be organized into a coherent daily read.",
  "Traders and analysts who are willing to challenge the framework, point out blind spots, and suggest better inputs.",
  "Builders and data-minded users who can help pressure test the methodology, presentation, and assumptions.",
];

const heroHighlights = [
  {
    id: "vision" as const,
    eyebrow: "Current State",
    title: "A passion project, not a polished product.",
    summary: "This is a working macro dashboard built around my own research process.",
    detail:
      "Market Diagnostic Dashboard is currently a personal tool for macroeconomic analysis. I use it to organize cross-asset signals, think through regime changes, and make the broader market backdrop easier to review in one place.",
  },
  {
    id: "goal" as const,
    eyebrow: "Why Share It",
    title: "Open the work to better questions.",
    summary: "The project improves when thoughtful people can inspect it and respond to it.",
    detail:
      "I am sharing the tool because feedback is more useful while the framework is still flexible. The goal is to learn what is clear, what is confusing, what is missing, and which assumptions deserve more scrutiny.",
  },
  {
    id: "advantage" as const,
    eyebrow: "Longer View",
    title: "Build toward something more useful.",
    summary: "The near-term goal is learning; the long-term goal is a stronger analytical framework.",
    detail:
      "This may eventually become more product-like, but it is not ready for go-to-market positioning yet. For now, the priority is improving the data model, methodology, explanations, and user experience through real use and grounded feedback.",
  },
];

function HeroSignalIllustration() {
  const statePalette: Record<HeroState, string> = {
    G: "#60BC8C",
    Y: "#E8BF43",
    R: "#E2554D",
  };

  const expandStateRow = (segments: Array<[HeroState, number]>) =>
    segments.flatMap(([state, count]) => Array.from({ length: count }, () => state));

  const denseRows = [
    expandStateRow([["R", 5], ["Y", 3], ["G", 1], ["Y", 2], ["R", 1], ["Y", 1], ["R", 3], ["Y", 3], ["R", 5], ["Y", 2], ["R", 1], ["Y", 1], ["R", 1], ["Y", 4], ["R", 1], ["Y", 7], ["G", 10], ["Y", 5], ["R", 1]]),
    expandStateRow([["Y", 4], ["R", 2], ["Y", 5], ["R", 1], ["Y", 1], ["R", 3], ["Y", 2], ["R", 2], ["Y", 4], ["R", 1], ["Y", 2], ["R", 2], ["Y", 1], ["R", 2], ["Y", 1], ["R", 4], ["Y", 4], ["R", 4], ["Y", 1], ["R", 2], ["Y", 1], ["R", 1], ["Y", 2], ["R", 1], ["Y", 2], ["R", 2], ["Y", 4]]),
    expandStateRow([["Y", 1], ["R", 7], ["Y", 20], ["R", 1], ["Y", 4], ["R", 2], ["Y", 16], ["R", 3]]),
    expandStateRow([["Y", 18], ["G", 1], ["Y", 2], ["G", 2], ["Y", 3], ["G", 14], ["Y", 1], ["G", 17], ["Y", 4]]),
    expandStateRow([["Y", 1], ["R", 7], ["Y", 14], ["G", 1], ["Y", 2], ["G", 1], ["Y", 3], ["G", 1], ["Y", 10], ["R", 1], ["Y", 3], ["G", 1], ["Y", 2], ["G", 3], ["Y", 9], ["R", 4]]),
    expandStateRow([["G", 7], ["Y", 1], ["G", 4], ["Y", 1], ["G", 1], ["Y", 14], ["R", 2], ["Y", 4], ["R", 16], ["Y", 2], ["R", 2], ["Y", 6], ["G", 3], ["Y", 1], ["G", 1], ["Y", 4], ["R", 1]]),
    expandStateRow([["R", 7], ["Y", 2], ["G", 2], ["Y", 1], ["G", 1], ["Y", 1], ["G", 2], ["Y", 2], ["G", 7], ["Y", 3], ["G", 1], ["Y", 5], ["G", 1], ["Y", 1], ["G", 1], ["Y", 6], ["G", 1], ["Y", 9], ["R", 2], ["Y", 1], ["R", 2], ["Y", 1], ["R", 5]]),
  ];

  const blockRows = [
    [
      ["R", 92],
      ["Y", 110],
      ["Y", 110],
      ["Y", 110],
      ["G", 110],
      ["Y", 110],
      ["Y", 110],
    ] as Array<[HeroState, number]>,
    [
      ["Y", 156],
      ["R", 156],
      ["Y", 156],
      ["G", 156],
      ["Y", 156],
      ["R", 156],
      ["Y", 156],
      ["R", 156],
    ] as Array<[HeroState, number]>,
    [
      ["R", 120],
      ["R", 120],
      ["R", 120],
      ["R", 120],
      ["R", 120],
      ["R", 120],
      ["R", 120],
      ["R", 120],
    ] as Array<[HeroState, number]>,
  ];

  const chartX = 782;
  const chartWidth = 640;
  const chartScaleX = 1.18;
  const denseCellWidth = 7;
  const denseCellGap = 2;
  const denseCellStep = denseCellWidth + denseCellGap;
  const denseRowWidth = (count: number) =>
    count * denseCellWidth + Math.max(count - 1, 0) * denseCellGap;
  const denseRowHeight = 18;
  const blockRowHeight = 24;
  const rowGap = 8;
  const fadeStart = chartWidth * 0.28;
  const fadeEnd = chartWidth * 0.48;

  const getBarOpacity = (x: number, width: number) => {
    const center = x + width / 2;
    if (center <= fadeStart) return 0;
    if (center >= fadeEnd) return 0.98;
    return ((center - fadeStart) / (fadeEnd - fadeStart)) * 0.98;
  };

  const chartRows = [
    { kind: "dense" as const, states: denseRows[0] },
    { kind: "dense" as const, states: denseRows[1] },
    { kind: "dense" as const, states: denseRows[2] },
    { kind: "dense" as const, states: denseRows[3] },
    { kind: "dense" as const, states: denseRows[4] },
    { kind: "block" as const, segments: blockRows[0] },
    { kind: "block" as const, segments: blockRows[1] },
    { kind: "dense" as const, states: expandStateRow([["G", 63]]) },
    { kind: "dense" as const, states: denseRows[5] },
    { kind: "dense" as const, states: denseRows[6] },
    { kind: "block" as const, segments: blockRows[2] },
  ];

  const chartContentHeight = chartRows.reduce(
    (sum, row, idx) => sum + (row.kind === "dense" ? denseRowHeight : blockRowHeight) + (idx < chartRows.length - 1 ? rowGap : 0),
    0,
  );

  const renderChartRows = (
    x: number,
    y: number,
    scaleX: number,
    scaleY: number,
    className?: string,
  ) => (
    <g className={className} transform={`translate(${x} ${y})`} opacity="0.98" shapeRendering="crispEdges">
      <g transform={`scale(${scaleX} ${scaleY})`}>
        {chartRows.map((row, rowIdx) => {
          const y =
            chartRows
              .slice(0, rowIdx)
              .reduce((sum, priorRow) => sum + (priorRow.kind === "dense" ? denseRowHeight : blockRowHeight) + rowGap, 0);

          if (row.kind === "dense") {
            const rowWidth = denseRowWidth(row.states.length);
            const rowOffset = chartWidth - rowWidth;

            return (
              <g key={`hero-dense-row-${rowIdx}`} transform={`translate(${rowOffset} ${y})`}>
                {row.states.map((state, idx) => {
                  const x = idx * denseCellStep;
                  return (
                    <rect
                      key={`hero-dense-row-${rowIdx}-cell-${idx}`}
                      x={x}
                      y="0"
                      width={denseCellWidth}
                      height={denseRowHeight}
                      rx="1.4"
                      fill={statePalette[state]}
                      fillOpacity={getBarOpacity(rowOffset + x, denseCellWidth)}
                    />
                  );
                })}
              </g>
            );
          }

          const totalUnits = row.segments.reduce((sum, [, width]) => sum + width, 0);
          const gap = 3;
          const totalGapWidth = gap * Math.max(row.segments.length - 1, 0);
          const scale = (chartWidth - totalGapWidth) / totalUnits;
          let cursor = 0;

          return (
            <g key={`hero-block-row-${rowIdx}`} transform={`translate(0 ${y})`}>
              {row.segments.map(([state, width], idx) => {
                const x = cursor;
                const scaledWidth = width * scale;
                cursor += scaledWidth + gap;
                return (
                  <rect
                    key={`hero-block-row-${rowIdx}-segment-${idx}`}
                    x={x}
                    y="0"
                    width={scaledWidth}
                    height={blockRowHeight}
                    rx="1.2"
                    fill={statePalette[state]}
                    fillOpacity={getBarOpacity(x, scaledWidth)}
                  />
                );
              })}
            </g>
          );
        })}
      </g>
    </g>
  );

  return (
    <svg
      viewBox="0 0 1440 560"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="visionHeroBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0b1220" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
        <radialGradient id="visionOrbA" cx="0%" cy="0%" r="120%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="visionOrbB" cx="100%" cy="100%" r="120%">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="visionRibbonA" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.04" />
          <stop offset="62%" stopColor="#6EE7B7" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#34D399" stopOpacity="0.86" />
        </linearGradient>
        <linearGradient id="visionRibbonB" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.03" />
          <stop offset="62%" stopColor="#93C5FD" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.82" />
        </linearGradient>
        <linearGradient id="visionRibbonFill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.14" />
        </linearGradient>
        <filter id="visionSoftBlur" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="32" />
        </filter>
      </defs>

      <rect x="0" y="0" width="1440" height="560" fill="url(#visionHeroBg)" />
      <circle cx="168" cy="128" r="118" fill="url(#visionOrbA)" filter="url(#visionSoftBlur)" />
      <circle cx="1246" cy="336" r="312" fill="url(#visionOrbB)" filter="url(#visionSoftBlur)" />

      <path
        d="M-20 444 C228 426, 478 430, 714 396 C914 368, 1078 320, 1248 316 C1376 312, 1464 336, 1496 358 L1496 560 L-20 560 Z"
        fill="url(#visionRibbonFill)"
      />
      <path
        d="M-12 392 C206 370, 444 376, 684 346 C900 320, 1084 278, 1248 282 C1376 284, 1462 316, 1496 340"
        stroke="url(#visionRibbonA)"
        strokeWidth="4.1"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-12 330 C192 302, 432 322, 672 292 C904 262, 1088 208, 1252 212 C1378 216, 1464 252, 1496 278"
        stroke="url(#visionRibbonB)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="6 12"
        opacity="0.9"
      />
      <path
        d="M-12 262 C200 244, 432 252, 684 236 C930 220, 1112 164, 1262 164 C1382 164, 1468 198, 1496 220"
        stroke="#cbd5e1"
        strokeOpacity="0.2"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="3 16"
      />
      {renderChartRows(874, -54, 1.44, 680 / chartContentHeight, "md:hidden")}
      {renderChartRows(chartX, -8, chartScaleX, 560 / chartContentHeight, "hidden md:block")}
    </svg>
  );
}

function PrincipleMotifGraphic({ motif }: { motif: PrincipleMotif }) {
  if (motif === "board") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Overlapping board correlation motif" className="w-full h-auto">
        <rect x="0.5" y="0.5" width="239" height="95" rx="15.5" fill="#111827" stroke="#334155" />
        <rect x="30" y="24" width="92" height="48" rx="9" fill="#0d1526" stroke="#93C5FD" strokeOpacity="0.74" strokeWidth="1.6" />
        <rect x="108" y="18" width="96" height="50" rx="9" fill="none" stroke="#64748b" strokeOpacity="0.42" strokeWidth="1.4" />
        <path
          d="M38 54 C54 50, 66 49, 80 52 C92 55, 102 48, 112 40"
          stroke="#6EE7B7"
          strokeOpacity="0.96"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M112 40 C128 36, 144 34, 160 35 C176 36, 188 38, 196 40"
          stroke="#6EE7B7"
          strokeOpacity="0.36"
          strokeWidth="2.1"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="3 7"
        />
        <circle cx="112" cy="40" r="4.4" fill="#f8fafc" fillOpacity="0.86" />
      </svg>
    );
  }

  if (motif === "curve") {
    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Learning shortcut curve motif" className="w-full h-auto">
        <path
          d="M18 76 C38 62, 58 52, 76 56 C90 60, 95 70, 110 76 C126 82, 150 70, 170 48 C188 30, 202 24, 220 24"
          fill="none"
          stroke="#64748b"
          strokeOpacity="0.9"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M18 76 C74 60, 138 44, 220 24"
          fill="none"
          stroke="#6EE7B7"
          strokeOpacity="0.96"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <circle cx="18" cy="74" r="4.5" fill="#93C5FD" fillOpacity="0.85" />
        <circle cx="220" cy="24" r="5.5" fill="#6EE7B7" fillOpacity="0.95" />
      </svg>
    );
  }

    return (
      <svg viewBox="0 0 240 96" role="img" aria-label="Decision reinforcement motif" className="w-full h-auto">
      <path d="M30 16 C44 16, 58 18, 72 22 H186 C198 22, 204 28, 204 34" stroke="#93C5FD" strokeOpacity="0.16" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M118 18 C126 18, 132 22, 140 26 H188 C198 26, 204 30, 204 34" stroke="#93C5FD" strokeOpacity="0.14" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M156 20 C164 20, 170 24, 178 30 H190 C198 30, 204 32, 204 34" stroke="#e2e8f0" strokeOpacity="0.1" strokeWidth="1.2" fill="none" strokeLinecap="round" />

      <path d="M48 82 H122 C138 82, 148 74, 160 74 H190 C200 74, 204 72, 204 68" stroke="#6EE7B7" strokeOpacity="0.18" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M138 64 H192 C200 64, 204 66, 204 68" stroke="#6EE7B7" strokeOpacity="0.14" strokeWidth="1.3" fill="none" strokeLinecap="round" />

      <path d="M102 48 H130 C144 48, 150 36, 164 36 H194 C200 36, 204 35, 204 34" stroke="#64748b" strokeOpacity="0.5" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M102 48 H130 C144 48, 150 62, 164 62 H194 C200 62, 204 65, 204 68" stroke="#64748b" strokeOpacity="0.46" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M104 46 H134 C148 46, 154 34, 168 34 H196" stroke="#6EE7B7" strokeOpacity="0.96" strokeWidth="3.3" fill="none" strokeLinecap="round" />

      <circle cx="30" cy="16" r="5.2" fill="#33455f" />
      <circle cx="48" cy="82" r="5.2" fill="#2b524f" />
      <circle cx="92" cy="48" r="9.5" fill="#f8fafc" fillOpacity="0.9" />
      <circle cx="204" cy="34" r="8.8" fill="#6EE7B7" fillOpacity="0.95" />
      <circle cx="204" cy="68" r="7.4" fill="#64748b" fillOpacity="0.82" />
      <circle cx="118" cy="18" r="4.2" fill="#28374d" />
      <circle cx="138" cy="64" r="3.8" fill="#234143" />
      <circle cx="156" cy="20" r="3.4" fill="#2e3543" />
      <circle cx="92" cy="48" r="3.4" fill="#111827" fillOpacity="0.2" />
    </svg>
  );
}

function FrameworkHouseGraphic() {
  return (
    <svg viewBox="0 0 220 220" role="img" aria-label="House scaffold framework motif" className="w-full h-auto">
      <defs>
        <linearGradient id="frameworkHouseStroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#6EE7B7" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      <path d="M54 146 L110 86 L166 146" fill="none" stroke="url(#frameworkHouseStroke)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M68 146 L68 92 L152 92 L152 146" fill="none" stroke="#94a3b8" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" />
      <path d="M86 146 L86 110 L134 110 L134 146" fill="none" stroke="#64748b" strokeOpacity="0.82" strokeWidth="1.8" strokeLinecap="round" />

      <path d="M110 86 L110 146" fill="none" stroke="#334155" strokeWidth="1.6" />
      <path d="M68 118 L152 118" fill="none" stroke="#334155" strokeWidth="1.6" />
      <path d="M86 128 L134 128" fill="none" stroke="#334155" strokeWidth="1.4" />

      <path d="M68 92 L110 118 L152 92" fill="none" stroke="#6EE7B7" strokeOpacity="0.2" strokeWidth="1.5" />
      <path d="M86 110 L110 86 L134 110" fill="none" stroke="#93C5FD" strokeOpacity="0.2" strokeWidth="1.5" />

      <circle cx="54" cy="146" r="3.6" fill="#93C5FD" fillOpacity="0.84" />
      <circle cx="110" cy="86" r="3.8" fill="#f8fafc" fillOpacity="0.86" />
      <circle cx="166" cy="146" r="3.6" fill="#6EE7B7" fillOpacity="0.86" />
      <circle cx="68" cy="92" r="3.2" fill="#93C5FD" fillOpacity="0.72" />
      <circle cx="152" cy="92" r="3.2" fill="#6EE7B7" fillOpacity="0.72" />
      <circle cx="68" cy="146" r="3.2" fill="#e2e8f0" fillOpacity="0.72" />
      <circle cx="152" cy="146" r="3.2" fill="#e2e8f0" fillOpacity="0.72" />
    </svg>
  );
}

export default function Vision() {
  const [activeHighlight, setActiveHighlight] = useState<VisionHighlightId>("goal");
  const activeHeroHighlight = heroHighlights.find((item) => item.id === activeHighlight) ?? heroHighlights[1];

  return (
    <div className="bg-stealth-900 text-gray-100">
      <section className="relative overflow-hidden border-b border-stealth-700">
        <HeroSignalIllustration />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(110,231,183,0.16),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(96,165,250,0.14),_transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(96deg,_rgba(15,23,42,0.9)_0%,_rgba(15,23,42,0.72)_46%,_rgba(15,23,42,0.42)_100%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Vision
            </div>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold leading-tight text-white">
              A Personal Macro Workbench, Shared In Public.
            </h1>
            <p className="mt-6 max-w-3xl text-lg sm:text-xl leading-8 text-stealth-200">
              Market Diagnostic Dashboard is a passion project and personal tool for organizing macroeconomic context, cross-asset signals, and market regime notes.
            </p>
            <p className="mt-4 max-w-3xl text-base sm:text-lg leading-8 text-stealth-300">
              I am sharing it before it is a finished product because the most useful next step is feedback: what is clear, what is missing, and what would make the framework more trustworthy.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <div className="space-y-3">
            {heroHighlights.map((item) => {
              const isActive = activeHighlight === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveHighlight(item.id)}
                  onMouseEnter={() => setActiveHighlight(item.id)}
                  onFocus={() => setActiveHighlight(item.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors duration-200 ${
                    isActive
                      ? "border-emerald-300/40 bg-white/[0.08] shadow-[0_12px_36px_rgba(0,0,0,0.18)]"
                      : "border-stealth-700 bg-stealth-900/35 hover:border-stealth-500 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stealth-400">
                    {item.eyebrow}
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {item.title}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-[28px] border border-emerald-300/20 bg-gradient-to-br from-white/[0.08] to-white/[0.03] p-5 sm:p-6 shadow-[0_18px_56px_rgba(0,0,0,0.18)]">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              {activeHeroHighlight.eyebrow}
            </div>
            <h2 className="mt-3 text-2xl sm:text-3xl font-semibold text-white">
              {activeHeroHighlight.title}
            </h2>
            <p className="mt-3 text-base sm:text-lg leading-7 text-stealth-200">
              {activeHeroHighlight.summary}
            </p>
            <div className="mt-5 border-t border-white/8 pt-5">
              <p className="text-sm sm:text-base leading-7 text-stealth-300">
                {activeHeroHighlight.detail}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-14 sm:pb-16">
        <div>
          {principles.map((item, idx) => {
            const isReversed = idx % 2 === 1;
            const isBoard = item.motif === "board";

            return (
              <div
                key={item.title}
                className={`grid gap-8 py-12 lg:items-center ${
                  isBoard
                    ? "lg:grid-cols-3 lg:gap-10"
                    : "lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,360px)]"
                } ${
                  isReversed ? "lg:[&>*:first-child]:order-2 lg:[&>*:last-child]:order-1" : ""
                }`}
              >
                <div
                  className={
                    isBoard
                      ? isReversed
                        ? "lg:col-span-2 lg:pl-8"
                        : "lg:col-span-2 lg:pr-8"
                      : isReversed
                        ? "lg:pl-8"
                        : "lg:pr-8"
                  }
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stealth-400">
                    Principle {idx + 1}
                  </div>
                  <h2 className="mt-3 text-3xl sm:text-4xl font-semibold text-white">
                    {item.title}
                  </h2>
                  <p className="mt-5 max-w-2xl text-base sm:text-lg leading-8 text-stealth-200">
                    {item.body}
                  </p>
                </div>

                <div
                  className={`mx-auto w-[68%] max-w-[220px] sm:w-[56%] ${
                    isBoard
                      ? `lg:col-span-1 lg:w-full lg:max-w-[20rem] xl:max-w-[22rem] ${
                          isReversed ? "lg:mr-auto lg:ml-0" : "lg:ml-auto lg:mr-0"
                        }`
                      : `lg:w-full lg:max-w-[340px] ${
                          isReversed ? "lg:mr-auto lg:ml-0" : "lg:ml-auto lg:mr-0"
                        }`
                  }`}
                >
                  <div className="relative">
                    <div className="absolute -inset-6 rounded-full bg-[radial-gradient(circle_at_center,_rgba(96,165,250,0.04),_rgba(110,231,183,0.03)_44%,_transparent_74%)] blur-2xl" />
                    <div className="relative">
                      <PrincipleMotifGraphic motif={item.motif} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-y border-stealth-700 bg-stealth-850/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-start">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stealth-400">
              The Honest Case
            </div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold text-white">
              This is not pretending to be a finished platform.
            </h2>
            <p className="mt-5 text-lg leading-8 text-stealth-200">
              The current version exists because I wanted a better way to read macro conditions without rebuilding the same context from scratch. It pulls together the indicators I care about, exposes the scoring logic, and gives me a more consistent place to evaluate whether market behavior is improving, deteriorating, or simply mixed.
            </p>
            <p className="mt-4 text-lg leading-8 text-stealth-200">
              It is still evolving. Some pieces are more mature than others, and I expect the methodology to keep changing as better data, clearer explanations, and sharper critiques come in. That is why the project is being shared now: not as a sales pitch, but as an open invitation to make the tool more useful.
            </p>
          </div>

          <div className="rounded-3xl border border-stealth-700 bg-gradient-to-br from-stealth-800 to-stealth-900 p-6 sm:p-7">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Who It Helps
            </div>
            <div className="mt-5 space-y-4">
              {audience.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-stealth-700 bg-white/[0.03] px-4 py-4 text-stealth-200 leading-7"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
        <div className="relative overflow-hidden rounded-3xl border border-stealth-700 bg-stealth-800/80 p-8 sm:p-10 lg:min-h-[360px] lg:p-12">
          <div className="absolute inset-y-0 right-0 hidden lg:block lg:w-[460px] xl:w-[520px] pointer-events-none">
            <div className="absolute inset-y-0 left-0 right-0 bg-[radial-gradient(circle_at_center,_rgba(110,231,183,0.08),_transparent_62%)]" />
          </div>

          <div className="relative z-10 max-w-3xl lg:max-w-[60%]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stealth-400">
                Follow The Work
              </div>
              <h2 className="mt-3 text-3xl sm:text-4xl font-semibold text-white">
                Read the methodology, then tell me what breaks.
              </h2>
              <p className="mt-5 text-lg leading-8 text-stealth-200">
                The dashboard is useful to me because it turns scattered macro inputs into a repeatable review process. The next step is making that process easier for other people to inspect, question, and improve.
              </p>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <Link
                to="/"
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-stealth-900 transition-colors hover:bg-emerald-300"
              >
                Explore The Dashboard
              </Link>
              <a
                href="https://github.com/meyer-s/Market-Diagnostic-Dashboard/wiki"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-stealth-600 px-5 py-3 text-sm font-semibold text-stealth-100 transition-colors hover:border-stealth-400 hover:bg-white/[0.03]"
              >
                Read The Wiki
              </a>
            </div>
          </div>

          <div className="relative mx-auto mt-10 w-full max-w-[320px] sm:max-w-[380px] lg:absolute lg:right-[-28px] lg:top-1/2 lg:z-0 lg:mt-0 lg:w-[440px] lg:max-w-none lg:-translate-y-1/2 xl:right-[-8px] xl:w-[500px] pointer-events-none">
            <div className="absolute -inset-10 rounded-full bg-[radial-gradient(circle_at_center,_rgba(96,165,250,0.06),_transparent_74%)] blur-3xl" />
            <div className="relative">
              <FrameworkHouseGraphic />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
