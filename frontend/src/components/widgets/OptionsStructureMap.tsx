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
  const LANE_W = 40;
  const LEFT_MIN_X = 66;
  const RIGHT_MAX_X = VW - 66;
  const scaleY = (price: number) => PLOT_TOP + ((hi - price) / (hi - lo)) * PLOT_HEIGHT;
  const currentY = scaleY(currentPrice);
  const supportGlowId = `${idPrefix}-support-glow`;
  const resistanceGlowId = `${idPrefix}-resistance-glow`;
  const laneGlowId = `${idPrefix}-lane-glow`;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: 300 }} aria-label="Options structure band">
      <defs>
        <linearGradient id={laneGlowId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(251,113,133,0.16)" />
          <stop offset="50%" stopColor="rgba(148,163,184,0.05)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0.18)" />
        </linearGradient>
        <linearGradient id={supportGlowId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgba(16,185,129,0)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0.34)" />
        </linearGradient>
        <linearGradient id={resistanceGlowId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgba(251,113,133,0.34)" />
          <stop offset="100%" stopColor="rgba(251,113,133,0)" />
        </linearGradient>
      </defs>

      <text x={24} y="18" fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.8">
        RESISTANCE STRUCTURE
      </text>
      <text x={24} y={PLOT_BOTTOM + 28} fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.8">
        SUPPORT STRUCTURE
      </text>

      <rect
        x={CENTER_X - LANE_W / 2}
        y={PLOT_TOP}
        width={LANE_W}
        height={PLOT_HEIGHT}
        rx="20"
        fill="rgba(15,23,42,0.94)"
        stroke="rgba(71,85,105,0.85)"
      />
      <rect
        x={CENTER_X - LANE_W / 2 + 1}
        y={PLOT_TOP + 1}
        width={LANE_W - 2}
        height={PLOT_HEIGHT - 2}
        rx="19"
        fill={`url(#${laneGlowId})`}
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
            x1={LEFT_MIN_X}
            x2={RIGHT_MAX_X}
            y1={scaleY(sma200)}
            y2={scaleY(sma200)}
            stroke="#6b7280"
            strokeDasharray="4 4"
            opacity="0.55"
          />
          <text x={LEFT_MIN_X - 10} y={scaleY(sma200) + 3} textAnchor="start" fill="#9ca3af" fontSize="9" fontFamily="monospace">
            SMA200
          </text>
        </g>
      ) : null}

      {sma50 ? (
        <g>
          <line
            x1={LEFT_MIN_X}
            x2={RIGHT_MAX_X}
            y1={scaleY(sma50)}
            y2={scaleY(sma50)}
            stroke="#a78bfa"
            strokeDasharray="4 4"
            opacity="0.72"
          />
          <text x={LEFT_MIN_X - 10} y={scaleY(sma50) + 3} textAnchor="start" fill="#c4b5fd" fontSize="9" fontFamily="monospace">
            SMA50
          </text>
        </g>
      ) : null}

      {supports.map((level, index) => {
        const y = scaleY(level.price);
        const reach = Math.min(78, Math.max(28, level.intensity * 86));
        const barH = 10;
        const x = CENTER_X - LANE_W / 2 - 10 - reach;

        return (
          <g key={`support-${level.price}-${index}`}>
            <line
              x1={CENTER_X - LANE_W / 2}
              x2={CENTER_X - LANE_W / 2 - 6}
              y1={y}
              y2={y}
              stroke="rgba(16,185,129,0.54)"
            />
            <rect x={x} y={y - barH / 2} width={reach} height={barH} rx="5" fill={`url(#${supportGlowId})`} />
            <rect x={x + reach * 0.22} y={y - barH / 2} width={reach * 0.78} height={barH} rx="5" fill="rgba(52,211,153,0.8)" />
          </g>
        );
      })}

      {resistances.map((level, index) => {
        const y = scaleY(level.price);
        const reach = Math.min(78, Math.max(28, level.intensity * 86));
        const barH = 10;
        const x = CENTER_X + LANE_W / 2 + 10;

        return (
          <g key={`resistance-${level.price}-${index}`}>
            <line
              x1={CENTER_X + LANE_W / 2}
              x2={CENTER_X + LANE_W / 2 + 6}
              y1={y}
              y2={y}
              stroke="rgba(251,113,133,0.54)"
            />
            <rect x={x} y={y - barH / 2} width={reach} height={barH} rx="5" fill={`url(#${resistanceGlowId})`} />
            <rect x={x} y={y - barH / 2} width={reach * 0.78} height={barH} rx="5" fill="rgba(251,113,133,0.8)" />
          </g>
        );
      })}

      {primaryResistance !== null ? (
        <text
          x={RIGHT_MAX_X + 10}
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
          x={LEFT_MIN_X - 8}
          y={Math.min(VH - 72, scaleY(primarySupport) + 3)}
          fill="#6ee7b7"
          fontSize="10"
          fontFamily="monospace"
        >
          {fmtPrice(primarySupport)}
        </text>
      ) : null}

      <line x1={LEFT_MIN_X} x2={RIGHT_MAX_X} y1={currentY} y2={currentY} stroke="rgba(226,232,240,0.18)" strokeDasharray="3 4" />
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
