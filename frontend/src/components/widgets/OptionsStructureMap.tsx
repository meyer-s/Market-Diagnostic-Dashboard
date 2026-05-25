import { useId } from "react";

interface OptionsWall {
  strike: number;
  open_interest: number;
}

export interface OptionsStructureMapProps {
  currentPrice: number;
  callWalls?: OptionsWall[];
  putWalls?: OptionsWall[];
  resistanceLevels?: number[];
  supportLevels?: number[];
  sma50?: number | null;
  sma200?: number | null;
  putCallRatio?: number | null;
  label?: string;
}

type SetupRegime = "range" | "breakout-risk" | "breakdown-risk";
type MaAlignment = "bullish" | "bearish" | "mixed" | "unknown";

interface StructureLevel {
  price: number;
  intensity: number;
  detail: string;
}

interface ChartPoint {
  x: number;
  y: number;
}

function fmtPrice(price: number): string {
  if (price >= 10_000) return `$${(price / 1000).toFixed(1)}K`;
  if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (price >= 100) return `$${price.toFixed(1)}`;
  return `$${price.toFixed(2)}`;
}

function fmtCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 10_000 ? 0 : 1,
  }).format(value);
}

function uniqueFinite(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value))));
}

function formatDistance(level: number, currentPrice: number): string {
  if (!Number.isFinite(level) || !Number.isFinite(currentPrice) || currentPrice <= 0) return "n/a";
  const diffPct = ((level - currentPrice) / currentPrice) * 100;
  const direction = diffPct >= 0 ? "above" : "below";
  return `${Math.abs(diffPct).toFixed(1)}% ${direction}`;
}

function describeRangePosition(currentPrice: number, support: number | null, resistance: number | null): string {
  if (support === null || resistance === null || resistance <= support) return "No clear band";
  const position = ((currentPrice - support) / (resistance - support)) * 100;
  const clamped = Math.max(0, Math.min(100, position));
  return `${clamped.toFixed(0)}% through band`;
}

function pickNearestLevel(levels: number[], currentPrice: number, direction: "support" | "resistance"): number | null {
  const filtered = levels.filter((level) =>
    direction === "support" ? level <= currentPrice : level >= currentPrice
  );
  const pool = filtered.length > 0 ? filtered : levels;
  if (!pool.length) return null;
  return [...pool].sort((left, right) => Math.abs(left - currentPrice) - Math.abs(right - currentPrice))[0] ?? null;
}

function deriveSetup(currentPrice: number, resistance: number | null, support: number | null): SetupRegime {
  if (resistance !== null) {
    const distUp = ((resistance - currentPrice) / currentPrice) * 100;
    if (distUp >= 0 && distUp <= 1.8) return "breakout-risk";
  }
  if (support !== null) {
    const distDown = ((currentPrice - support) / currentPrice) * 100;
    if (distDown >= 0 && distDown <= 1.8) return "breakdown-risk";
  }
  return "range";
}

function deriveMaAlignment(price: number, sma50: number | null | undefined, sma200: number | null | undefined): MaAlignment {
  if (!sma50) return "unknown";
  if (!sma200) return price > sma50 ? "bullish" : "bearish";
  if (price > sma50 && sma50 > sma200) return "bullish";
  if (price < sma50 && sma50 < sma200) return "bearish";
  return "mixed";
}

function buildInterpretation(
  setup: SetupRegime,
  maAlignment: MaAlignment,
  support: number | null,
  resistance: number | null,
  putCallRatio: number | null | undefined
): string {
  const maRead =
    maAlignment === "bullish"
      ? "moving averages confirm the uptrend"
      : maAlignment === "bearish"
      ? "moving averages confirm the downtrend"
      : maAlignment === "mixed"
      ? "moving averages are mixed"
      : null;

  const flowRead =
    putCallRatio === null || putCallRatio === undefined
      ? null
      : putCallRatio < 0.7
      ? "options skew is call-heavy"
      : putCallRatio > 1.1
      ? "options skew is put-heavy"
      : "options positioning is balanced";

  if (setup === "breakout-risk" && resistance !== null) {
    return `Price is pressing into ${fmtPrice(resistance)} resistance. ${maRead ? `${maRead[0].toUpperCase()}${maRead.slice(1)}.` : ""}`.trim();
  }

  if (setup === "breakdown-risk" && support !== null) {
    return `Price is testing ${fmtPrice(support)} support. ${maRead ? `${maRead[0].toUpperCase()}${maRead.slice(1)}.` : ""}`.trim();
  }

  if (support !== null && resistance !== null) {
    return `Price is trading between ${fmtPrice(support)} support and ${fmtPrice(resistance)} resistance.${flowRead ? ` ${flowRead[0].toUpperCase()}${flowRead.slice(1)}.` : ""}${maRead ? ` ${maRead[0].toUpperCase()}${maRead.slice(1)}.` : ""}`;
  }

  return `Price is trading against nearby structure.${flowRead ? ` ${flowRead[0].toUpperCase()}${flowRead.slice(1)}.` : ""}${maRead ? ` ${maRead[0].toUpperCase()}${maRead.slice(1)}.` : ""}`;
}

function buildSupportCluster(currentPrice: number, putWalls: OptionsWall[], supportLevels: number[]): StructureLevel[] {
  if (putWalls.length > 0) {
    const maxOI = Math.max(1, ...putWalls.map((wall) => wall.open_interest));
    return [...putWalls]
      .filter((wall) => Number.isFinite(wall.strike) && Number.isFinite(wall.open_interest))
      .sort((left, right) => right.open_interest - left.open_interest)
      .slice(0, 3)
      .map((wall) => ({
        price: wall.strike,
        intensity: Math.max(0.18, wall.open_interest / maxOI),
        detail: `OI ${fmtCompact(wall.open_interest)}`,
      }));
  }

  const levels = uniqueFinite(supportLevels)
    .sort((left, right) => Math.abs(left - currentPrice) - Math.abs(right - currentPrice))
    .slice(0, 3)
    .sort((left, right) => right - left);

  return levels.map((price, index) => ({
    price,
    intensity: Math.max(0.38, 1 - index * 0.18),
    detail: formatDistance(price, currentPrice),
  }));
}

function buildResistanceCluster(currentPrice: number, callWalls: OptionsWall[], resistanceLevels: number[]): StructureLevel[] {
  if (callWalls.length > 0) {
    const maxOI = Math.max(1, ...callWalls.map((wall) => wall.open_interest));
    return [...callWalls]
      .filter((wall) => Number.isFinite(wall.strike) && Number.isFinite(wall.open_interest))
      .sort((left, right) => right.open_interest - left.open_interest)
      .slice(0, 3)
      .map((wall) => ({
        price: wall.strike,
        intensity: Math.max(0.18, wall.open_interest / maxOI),
        detail: `OI ${fmtCompact(wall.open_interest)}`,
      }));
  }

  const levels = uniqueFinite(resistanceLevels)
    .sort((left, right) => Math.abs(left - currentPrice) - Math.abs(right - currentPrice))
    .slice(0, 3)
    .sort((left, right) => left - right);

  return levels.map((price, index) => ({
    price,
    intensity: Math.max(0.38, 1 - index * 0.18),
    detail: formatDistance(price, currentPrice),
  }));
}

function formatChartPoint(point: ChartPoint): string {
  return `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
}

function buildSmoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${formatChartPoint(points[0])}`;

  let d = `M ${formatChartPoint(points[0])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;

    const cp1 = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    };

    d += ` C ${formatChartPoint(cp1)}, ${formatChartPoint(cp2)}, ${formatChartPoint(p2)}`;
  }

  return d;
}

function buildProfileFillPath(points: ChartPoint[], spineX: number, plotTop: number, plotBottom: number): string {
  if (points.length === 0) return "";
  return `${buildSmoothPath(points)} L ${spineX.toFixed(1)} ${plotBottom.toFixed(1)} L ${spineX.toFixed(1)} ${plotTop.toFixed(1)} Z`;
}

function SetupBadge({ setup }: { setup: SetupRegime }) {
  const config = {
    range: { label: "Range Bound", cls: "border-stealth-600 bg-stealth-800/70 text-stealth-300" },
    "breakout-risk": { label: "Breakout Risk", cls: "border-amber-600/60 bg-amber-900/25 text-amber-300" },
    "breakdown-risk": { label: "Breakdown Risk", cls: "border-rose-600/60 bg-rose-900/25 text-rose-300" },
  }[setup];

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${config.cls}`}>
      {config.label}
    </span>
  );
}

function MaBadge({ alignment }: { alignment: MaAlignment }) {
  if (alignment === "unknown") return null;
  const config = {
    bullish: { label: "MAs Bullish", cls: "border-emerald-700/50 bg-emerald-900/20 text-emerald-400" },
    bearish: { label: "MAs Bearish", cls: "border-rose-700/50 bg-rose-900/20 text-rose-400" },
    mixed: { label: "MAs Mixed", cls: "border-stealth-600 bg-stealth-800/70 text-stealth-300" },
  }[alignment];

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${config.cls}`}>
      {config.label}
    </span>
  );
}

function PcBadge({ ratio }: { ratio: number | null | undefined }) {
  if (ratio === null || ratio === undefined) return null;
  const cls =
    ratio > 1.1
      ? "border-rose-700/50 bg-rose-900/20 text-rose-400"
      : ratio < 0.7
      ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-400"
      : "border-stealth-600 bg-stealth-800/70 text-stealth-300";

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${cls}`}>
      P/C {ratio.toFixed(2)}
    </span>
  );
}

function StructureBand({
  idPrefix,
  currentPrice,
  supports,
  resistances,
  sma50,
  sma200,
  primarySupport,
  primaryResistance,
}: {
  idPrefix: string;
  currentPrice: number;
  supports: StructureLevel[];
  resistances: StructureLevel[];
  sma50?: number | null;
  sma200?: number | null;
  primarySupport: number | null;
  primaryResistance: number | null;
}) {
  const allPrices = uniqueFinite([
    currentPrice,
    ...supports.map((level) => level.price),
    ...resistances.map((level) => level.price),
    ...(sma50 ? [sma50] : []),
    ...(sma200 ? [sma200] : []),
  ]);

  if (allPrices.length < 2) return null;

  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const rawRange = rawMax - rawMin || Math.max(rawMax * 0.1, 1);
  const pad = rawRange * 0.12;
  const lo = rawMin - pad;
  const hi = rawMax + pad;

  const VW = 420;
  const VH = 300;
  const PLOT_TOP = 34;
  const PLOT_BOTTOM = 194;
  const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
  const CENTER_X = 210;
  const SPINE_W = 36;
  const SPINE_HALF_W = SPINE_W / 2;
  const LEFT_SPINE_X = CENTER_X - SPINE_HALF_W;
  const RIGHT_SPINE_X = CENTER_X + SPINE_HALF_W;
  const GUIDE_LEFT = 74;
  const GUIDE_RIGHT = VW - 74;
  const PROFILE_BLEND_X = CENTER_X;
  const PROFILE_MAX_REACH = 76;
  const PROFILE_SIGMA = Math.max(13, PLOT_HEIGHT * 0.076);
  const SAMPLE_COUNT = 72;
  const scaleY = (price: number) => PLOT_TOP + ((hi - price) / (hi - lo)) * PLOT_HEIGHT;
  const currentY = scaleY(currentPrice);
  const spineFillId = `${idPrefix}-spine-fill`;
  const leftFillId = `${idPrefix}-left-fill`;
  const rightFillId = `${idPrefix}-right-fill`;
  const leftGlowId = `${idPrefix}-left-glow`;
  const rightGlowId = `${idPrefix}-right-glow`;

  const profileReach = (levels: StructureLevel[], y: number) => {
    if (!levels.length) return 0;

    const total = levels.reduce((sum, level) => {
      const levelY = scaleY(level.price);
      const amplitude = 10 + level.intensity * 42;
      return sum + amplitude * Math.exp(-((y - levelY) ** 2) / (2 * PROFILE_SIGMA ** 2));
    }, 0);

    return Math.min(PROFILE_MAX_REACH, total);
  };

  const sampleYs = Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => PLOT_TOP + (index / SAMPLE_COUNT) * PLOT_HEIGHT);
  const leftProfile = sampleYs.map((y) => ({ x: LEFT_SPINE_X - profileReach(supports, y), y }));
  const rightProfile = sampleYs.map((y) => ({ x: RIGHT_SPINE_X + profileReach(resistances, y), y }));
  const leftProfileFill = buildProfileFillPath(leftProfile, PROFILE_BLEND_X, PLOT_TOP, PLOT_BOTTOM);
  const rightProfileFill = buildProfileFillPath(rightProfile, PROFILE_BLEND_X, PLOT_TOP, PLOT_BOTTOM);
  const leftProfileStroke = buildSmoothPath(leftProfile);
  const rightProfileStroke = buildSmoothPath(rightProfile);
  const primarySupportReach = primarySupport === null ? 0 : profileReach(supports, scaleY(primarySupport));
  const primaryResistanceReach = primaryResistance === null ? 0 : profileReach(resistances, scaleY(primaryResistance));

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: 300 }} aria-label="Options structure band">
      <defs>
        <linearGradient id={spineFillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(71,85,105,0.26)" />
          <stop offset="48%" stopColor="rgba(15,23,42,0.78)" />
          <stop offset="100%" stopColor="rgba(51,65,85,0.32)" />
        </linearGradient>
        <linearGradient id={leftFillId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgba(74,222,128,0)" />
          <stop offset="48%" stopColor="rgba(34,197,94,0.08)" />
          <stop offset="82%" stopColor="rgba(74,222,128,0.18)" />
          <stop offset="100%" stopColor="rgba(110,231,183,0.24)" />
        </linearGradient>
        <linearGradient id={rightFillId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgba(251,146,160,0.24)" />
          <stop offset="18%" stopColor="rgba(251,113,133,0.18)" />
          <stop offset="52%" stopColor="rgba(251,113,133,0.08)" />
          <stop offset="100%" stopColor="rgba(251,113,133,0)" />
        </linearGradient>
        <filter id={leftGlowId} x="-40%" y="-25%" width="200%" height="150%">
          <feGaussianBlur stdDeviation="5.5" />
        </filter>
        <filter id={rightGlowId} x="-40%" y="-25%" width="200%" height="150%">
          <feGaussianBlur stdDeviation="5.5" />
        </filter>
      </defs>

      <text x={24} y="18" fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.8">
        RESISTANCE STRUCTURE
      </text>
      <text x={24} y={PLOT_BOTTOM + 28} fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.8">
        SUPPORT STRUCTURE
      </text>

      {supports.length > 0 ? (
        <>
          <path d={leftProfileFill} fill={`url(#${leftFillId})`} opacity="0.95" stroke="none" />
          <path d={leftProfileFill} fill={`url(#${leftFillId})`} opacity="0.65" filter={`url(#${leftGlowId})`} stroke="none" />
        </>
      ) : null}
      {resistances.length > 0 ? (
        <>
          <path d={rightProfileFill} fill={`url(#${rightFillId})`} opacity="0.95" stroke="none" />
          <path d={rightProfileFill} fill={`url(#${rightFillId})`} opacity="0.65" filter={`url(#${rightGlowId})`} stroke="none" />
        </>
      ) : null}

      <rect
        x={LEFT_SPINE_X}
        y={PLOT_TOP}
        width={SPINE_W}
        height={PLOT_HEIGHT}
        rx="18"
        fill={`url(#${spineFillId})`}
        stroke="rgba(71,85,105,0.68)"
      />
      <rect
        x={LEFT_SPINE_X + 4}
        y={PLOT_TOP + 4}
        width={SPINE_W - 8}
        height={PLOT_HEIGHT - 8}
        rx="14"
        fill="rgba(148,163,184,0.03)"
      />
      <line
        x1={LEFT_SPINE_X + 1}
        x2={LEFT_SPINE_X + 1}
        y1={PLOT_TOP + 12}
        y2={PLOT_BOTTOM - 12}
        stroke="rgba(74,222,128,0.34)"
        strokeWidth="1.5"
        opacity="0.85"
        filter={`url(#${leftGlowId})`}
      />
      <line
        x1={RIGHT_SPINE_X - 1}
        x2={RIGHT_SPINE_X - 1}
        y1={PLOT_TOP + 12}
        y2={PLOT_BOTTOM - 12}
        stroke="rgba(251,113,133,0.34)"
        strokeWidth="1.5"
        opacity="0.85"
        filter={`url(#${rightGlowId})`}
      />
      <line
        x1={CENTER_X}
        x2={CENTER_X}
        y1={PLOT_TOP + 8}
        y2={PLOT_BOTTOM - 8}
        stroke="rgba(100,116,139,0.42)"
        strokeDasharray="3 4"
      />

      {sma200 ? (
        <g>
          <line
            x1={GUIDE_LEFT}
            x2={GUIDE_RIGHT}
            y1={scaleY(sma200)}
            y2={scaleY(sma200)}
            stroke="#6b7280"
            strokeDasharray="4 4"
            opacity="0.55"
          />
          <text x={GUIDE_LEFT - 26} y={scaleY(sma200) + 3} textAnchor="start" fill="#9ca3af" fontSize="9" fontFamily="monospace">
            SMA200
          </text>
        </g>
      ) : null}

      {sma50 ? (
        <g>
          <line
            x1={GUIDE_LEFT}
            x2={GUIDE_RIGHT}
            y1={scaleY(sma50)}
            y2={scaleY(sma50)}
            stroke="#a78bfa"
            strokeDasharray="4 4"
            opacity="0.72"
          />
          <text x={GUIDE_LEFT - 26} y={scaleY(sma50) + 3} textAnchor="start" fill="#c4b5fd" fontSize="9" fontFamily="monospace">
            SMA50
          </text>
        </g>
      ) : null}

      {supports.length > 0 ? (
        <>
          <path
            d={leftProfileStroke}
            fill="none"
            stroke="rgba(16,185,129,0.26)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${leftGlowId})`}
          />
          <path
            d={leftProfileStroke}
            fill="none"
            stroke="rgba(110,231,183,0.72)"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {resistances.length > 0 ? (
        <>
          <path
            d={rightProfileStroke}
            fill="none"
            stroke="rgba(244,63,94,0.26)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${rightGlowId})`}
          />
          <path
            d={rightProfileStroke}
            fill="none"
            stroke="rgba(251,146,160,0.72)"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}

      {primaryResistance !== null ? (
        <text
          x={Math.min(VW - 12, RIGHT_SPINE_X + primaryResistanceReach + 18)}
          y={Math.max(14, scaleY(primaryResistance) + 3)}
          textAnchor="end"
          fill="#fca5a5"
          fontSize="10"
          fontFamily="monospace"
        >
          {fmtPrice(primaryResistance)}
        </text>
      ) : null}
      {primarySupport !== null ? (
        <text
          x={Math.max(12, LEFT_SPINE_X - primarySupportReach - 16)}
          y={Math.min(VH - 72, scaleY(primarySupport) + 3)}
          fill="#6ee7b7"
          fontSize="10"
          fontFamily="monospace"
        >
          {fmtPrice(primarySupport)}
        </text>
      ) : null}

      <line x1={GUIDE_LEFT} x2={GUIDE_RIGHT} y1={currentY} y2={currentY} stroke="rgba(226,232,240,0.18)" strokeDasharray="3 4" />
      <circle cx={CENTER_X} cy={currentY} r="11" fill="rgba(241,245,249,0.12)" />
      <circle cx={CENTER_X} cy={currentY} r="5.5" fill="#f8fafc" />

      <g transform={`translate(0 ${VH - 54})`}>
        <text x={36} y="0" fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.6">SUPPORT</text>
        <text x={CENTER_X} y="0" textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.6">CURRENT</text>
        <text x={VW - 36} y="0" textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.6">RESISTANCE</text>

        <text x={36} y="28" fill="#6ee7b7" fontSize="15" fontWeight="600">{primarySupport !== null ? fmtPrice(primarySupport) : "n/a"}</text>
        <text x={CENTER_X} y="28" textAnchor="middle" fill="#f8fafc" fontSize="15" fontWeight="600">{fmtPrice(currentPrice)}</text>
        <text x={VW - 36} y="28" textAnchor="end" fill="#fca5a5" fontSize="15" fontWeight="600">{primaryResistance !== null ? fmtPrice(primaryResistance) : "n/a"}</text>

        <text x={36} y="47" fill="#94a3b8" fontSize="10">{primarySupport !== null ? formatDistance(primarySupport, currentPrice) : "No nearby support"}</text>
        <text x={CENTER_X} y="47" textAnchor="middle" fill="#94a3b8" fontSize="10">{describeRangePosition(currentPrice, primarySupport, primaryResistance)}</text>
        <text x={VW - 36} y="47" textAnchor="end" fill="#94a3b8" fontSize="10">{primaryResistance !== null ? formatDistance(primaryResistance, currentPrice) : "No nearby resistance"}</text>
      </g>
    </svg>
  );
}

export function OptionsStructureMap({
  currentPrice,
  callWalls = [],
  putWalls = [],
  resistanceLevels = [],
  supportLevels = [],
  sma50,
  sma200,
  putCallRatio,
  label,
}: OptionsStructureMapProps) {
  const idPrefix = useId().replace(/:/g, "");
  const supports = buildSupportCluster(currentPrice, putWalls, supportLevels);
  const resistances = buildResistanceCluster(currentPrice, callWalls, resistanceLevels);
  const hasData = supports.length > 0 || resistances.length > 0;

  if (!hasData && !sma50 && !sma200) return null;

  const supportPrices = supports.map((level) => level.price);
  const resistancePrices = resistances.map((level) => level.price);
  const primarySupport = pickNearestLevel(supportPrices, currentPrice, "support");
  const primaryResistance = pickNearestLevel(resistancePrices, currentPrice, "resistance");
  const setup = deriveSetup(currentPrice, primaryResistance, primarySupport);
  const maAlignment = deriveMaAlignment(currentPrice, sma50, sma200);
  const interpretation = buildInterpretation(setup, maAlignment, primarySupport, primaryResistance, putCallRatio);

  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SetupBadge setup={setup} />
          <MaBadge alignment={maAlignment} />
          <PcBadge ratio={putCallRatio} />
        </div>
        {label ? (
          <span className="text-[10px] uppercase tracking-[0.18em] text-stealth-500">{label}</span>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border border-stealth-700 bg-stealth-950/70 p-3">
        <StructureBand
          idPrefix={idPrefix}
          currentPrice={currentPrice}
          supports={supports}
          resistances={resistances}
          sma50={sma50}
          sma200={sma200}
          primarySupport={primarySupport}
          primaryResistance={primaryResistance}
        />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-stealth-300">{interpretation}</p>
    </div>
  );
}
