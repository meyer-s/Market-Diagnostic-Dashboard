/**
 * OptionsStructureMap
 *
 * Reusable visual module showing where price sits relative to options walls,
 * support/resistance levels, and moving averages. Works for both stock and
 * metals analysis pages.
 *
 * For stocks:  uses call_walls / put_walls (OI-sized horizontal bars)
 * For metals:  uses support / resistance arrays (plain tick markers, no OI)
 *
 * Always shows: current price line, SMA 50 / SMA 200 dashes (if provided),
 *               setup regime badge, MA alignment badge, 1-sentence read.
 */

interface OptionsWall {
  strike: number;
  open_interest: number;
}

export interface OptionsStructureMapProps {
  currentPrice: number;
  /** Options call walls (stocks). Displayed as right-side bars proportional to OI. */
  callWalls?: OptionsWall[];
  /** Options put walls (stocks). Displayed as left-side bars proportional to OI. */
  putWalls?: OptionsWall[];
  /** Plain resistance levels (metals / technical). Displayed as right-side tick marks. */
  resistanceLevels?: number[];
  /** Plain support levels (metals / technical). Displayed as left-side tick marks. */
  supportLevels?: number[];
  sma50?: number | null;
  sma200?: number | null;
  putCallRatio?: number | null;
  /** Optional display label shown in header (e.g. ticker or metal name) */
  label?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(price: number): string {
  if (price >= 10_000) return `$${(price / 1000).toFixed(1)}K`;
  if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (price >= 100) return `$${price.toFixed(1)}`;
  return `$${price.toFixed(2)}`;
}

type SetupRegime = "range" | "breakout-risk" | "breakdown-risk";
type MaAlignment = "bullish" | "bearish" | "mixed" | "unknown";

function deriveSetup(
  currentPrice: number,
  topCallWall: number | null,
  topPutWall: number | null,
  topResistance: number | null,
  topSupport: number | null
): SetupRegime {
  const resistance = topCallWall ?? topResistance;
  const support = topPutWall ?? topSupport;

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

function deriveMaAlignment(
  price: number,
  sma50: number | null | undefined,
  sma200: number | null | undefined
): MaAlignment {
  if (!sma50) return "unknown";
  if (!sma200) return price > sma50 ? "bullish" : "bearish";
  if (price > sma50 && sma50 > sma200) return "bullish";
  if (price < sma50 && sma50 < sma200) return "bearish";
  return "mixed";
}

function buildInterpretation(
  setup: SetupRegime,
  maAlignment: MaAlignment,
  _currentPrice: number,
  topCallWall: number | null,
  topPutWall: number | null,
  topResistance: number | null,
  topSupport: number | null,
  putCallRatio: number | null | undefined
): string {
  const resistance = topCallWall ?? topResistance;
  const support = topPutWall ?? topSupport;

  const pcRead =
    putCallRatio !== null && putCallRatio !== undefined
      ? putCallRatio < 0.7
        ? "call-skewed options flow"
        : putCallRatio > 1.1
        ? "put-skewed hedging flow"
        : "balanced options flow"
      : null;

  const maRead =
    maAlignment === "bullish"
      ? "moving averages confirm the uptrend"
      : maAlignment === "bearish"
      ? "moving averages confirm the downtrend"
      : maAlignment === "mixed"
      ? "moving averages are mixed"
      : null;

  if (setup === "breakout-risk" && resistance !== null) {
    const parts = [`Price is pressing against ${fmtPrice(resistance)} — breakout or rejection ahead.`];
    if (maRead) parts.push(`${maRead[0].toUpperCase() + maRead.slice(1)}.`);
    return parts.join(" ");
  }

  if (setup === "breakdown-risk" && support !== null) {
    const parts = [`Price is testing ${fmtPrice(support)} support — hold here or flush lower.`];
    if (maRead) parts.push(`${maRead[0].toUpperCase() + maRead.slice(1)}.`);
    return parts.join(" ");
  }

  // range
  const rangeStr =
    support !== null && resistance !== null
      ? `Price is range-bound between ${fmtPrice(support)} and ${fmtPrice(resistance)}.`
      : "Price is trading between key levels.";

  const flowStr = pcRead ? ` ${pcRead[0].toUpperCase() + pcRead.slice(1)}.` : "";
  const maStr = maRead ? ` ${maRead[0].toUpperCase() + maRead.slice(1)}.` : "";

  return rangeStr + flowStr + maStr;
}

// ─── Badge helpers ─────────────────────────────────────────────────────────────

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
    bullish: { label: "MAs ↑", cls: "border-emerald-700/50 bg-emerald-900/20 text-emerald-400" },
    bearish: { label: "MAs ↓", cls: "border-rose-700/50 bg-rose-900/20 text-rose-400" },
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
  const label = `P/C ${ratio.toFixed(2)}`;
  const cls =
    ratio > 1.1
      ? "border-rose-700/50 bg-rose-900/20 text-rose-400"
      : ratio < 0.7
      ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-400"
      : "border-stealth-600 bg-stealth-800/70 text-stealth-300";
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${cls}`}>
      {label}
    </span>
  );
}

// ─── SVG Price Map ─────────────────────────────────────────────────────────────

interface PriceMapProps {
  currentPrice: number;
  callWalls: OptionsWall[];
  putWalls: OptionsWall[];
  resistanceLevels: number[];
  supportLevels: number[];
  sma50: number | null | undefined;
  sma200: number | null | undefined;
}

function PriceMap({
  currentPrice,
  callWalls,
  putWalls,
  resistanceLevels,
  supportLevels,
  sma50,
  sma200,
}: PriceMapProps) {
  // Gather all prices to establish the display range
  const allPrices: number[] = [
    currentPrice,
    ...callWalls.map((w) => w.strike),
    ...putWalls.map((w) => w.strike),
    ...resistanceLevels,
    ...supportLevels,
    ...(sma50 ? [sma50] : []),
    ...(sma200 ? [sma200] : []),
  ].filter((p) => typeof p === "number" && isFinite(p));

  if (allPrices.length < 2) return null;

  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const rawRange = rawMax - rawMin || rawMax * 0.1;
  const pad = rawRange * 0.18;
  const lo = rawMin - pad;
  const hi = rawMax + pad;

  // SVG coordinate system
  const VW = 300;
  const VH = 160;
  const ML = 50; // left margin for price axis labels
  const MR = 6;
  const MT = 8;
  const MB = 8;
  const PLOT_W = VW - ML - MR; // 244
  const PLOT_H = VH - MT - MB; // 144
  const CX = ML + PLOT_W / 2; // center divider x (170)
  const MAX_HALF = (PLOT_W / 2) * 0.92; // max bar half-width

  const scaleY = (price: number) =>
    MT + (1 - (price - lo) / (hi - lo)) * PLOT_H;

  // Normalize OI
  const allOI = [...callWalls.map((w) => w.open_interest), ...putWalls.map((w) => w.open_interest)];
  const maxOI = Math.max(1, ...allOI);

  // Clamp and deduplicate levels to max 4 per side (keep highest OI for walls, closest price for plain)
  const topCalls = [...callWalls].sort((a, b) => b.open_interest - a.open_interest).slice(0, 4);
  const topPuts = [...putWalls].sort((a, b) => b.open_interest - a.open_interest).slice(0, 4);
  const topResist = [...resistanceLevels].slice(0, 3);
  const topSupport = [...supportLevels].slice(0, 3);

  const AXIS_COLOR = "#374151";
  const TICK_COLOR = "#6b7280";
  const PRICE_LABEL_COLOR = "#9ca3af";
  const CURRENT_COLOR = "#e5e7eb";
  const SMA50_COLOR = "#a78bfa"; // violet
  const SMA200_COLOR = "#6b7280"; // muted gray
  const CALL_COLOR = "#f87171"; // rose
  const PUT_COLOR = "#34d399"; // emerald
  const CENTER_LINE_COLOR = "#374151";

  // Y ticks: current + all unique wall/level prices, max 8 total
  const yTickPrices = Array.from(
    new Set([
      currentPrice,
      ...topCalls.map((w) => w.strike),
      ...topPuts.map((w) => w.strike),
      ...topResist,
      ...topSupport,
      ...(sma50 ? [sma50] : []),
      ...(sma200 ? [sma200] : []),
    ])
  )
    .sort((a, b) => b - a)
    .slice(0, 8);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: 144 }} aria-label="Options price structure map">
      {/* Background */}
      <rect x={ML} y={MT} width={PLOT_W} height={PLOT_H} fill="#0a0a0f" rx="4" />

      {/* Center divider */}
      <line x1={CX} y1={MT} x2={CX} y2={MT + PLOT_H} stroke={CENTER_LINE_COLOR} strokeWidth="0.75" />

      {/* Side labels */}
      <text x={ML + 4} y={MT + 10} fill={TICK_COLOR} fontSize="7.5" fontFamily="monospace">SUPPORT</text>
      <text x={CX + 4} y={MT + 10} fill={TICK_COLOR} fontSize="7.5" fontFamily="monospace">RESISTANCE</text>

      {/* ── Put walls (left side bars) */}
      {topPuts.map((w) => {
        const y = scaleY(w.strike);
        const barW = (w.open_interest / maxOI) * MAX_HALF;
        return (
          <g key={`put-${w.strike}`}>
            <rect x={CX - barW} y={y - 4.5} width={barW} height={9} fill={PUT_COLOR} opacity={0.55} rx="1.5" />
            <rect x={CX - barW} y={y - 4.5} width={barW} height={9} fill="url(#putGrad)" rx="1.5" opacity="0.3" />
          </g>
        );
      })}

      {/* ── Call walls (right side bars) */}
      {topCalls.map((w) => {
        const y = scaleY(w.strike);
        const barW = (w.open_interest / maxOI) * MAX_HALF;
        return (
          <g key={`call-${w.strike}`}>
            <rect x={CX} y={y - 4.5} width={barW} height={9} fill={CALL_COLOR} opacity={0.55} rx="1.5" />
          </g>
        );
      })}

      {/* ── Plain resistance tick marks (metals) */}
      {topResist.map((level) => {
        const y = scaleY(level);
        return (
          <g key={`res-${level}`}>
            <line x1={CX} x2={CX + 16} y1={y} y2={y} stroke={CALL_COLOR} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8" />
          </g>
        );
      })}

      {/* ── Plain support tick marks (metals) */}
      {topSupport.map((level) => {
        const y = scaleY(level);
        return (
          <g key={`sup-${level}`}>
            <line x1={CX - 16} x2={CX} y1={y} y2={y} stroke={PUT_COLOR} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8" />
          </g>
        );
      })}

      {/* ── SMA 200 (behind SMA 50) */}
      {sma200 && (
        <line
          x1={ML}
          x2={ML + PLOT_W}
          y1={scaleY(sma200)}
          y2={scaleY(sma200)}
          stroke={SMA200_COLOR}
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.6"
        />
      )}

      {/* ── SMA 50 */}
      {sma50 && (
        <line
          x1={ML}
          x2={ML + PLOT_W}
          y1={scaleY(sma50)}
          y2={scaleY(sma50)}
          stroke={SMA50_COLOR}
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.7"
        />
      )}

      {/* ── Current price line */}
      <line
        x1={ML}
        x2={ML + PLOT_W}
        y1={scaleY(currentPrice)}
        y2={scaleY(currentPrice)}
        stroke={CURRENT_COLOR}
        strokeWidth="1.5"
        opacity="0.85"
      />
      {/* Diamond marker */}
      <polygon
        points={`${CX},${scaleY(currentPrice) - 4} ${CX + 4},${scaleY(currentPrice)} ${CX},${scaleY(currentPrice) + 4} ${CX - 4},${scaleY(currentPrice)}`}
        fill={CURRENT_COLOR}
        opacity="0.9"
      />

      {/* ── Price axis (left side labels) */}
      {yTickPrices.map((price) => {
        const y = scaleY(price);
        if (y < MT + 4 || y > MT + PLOT_H - 4) return null;
        const isCurrent = price === currentPrice;
        return (
          <g key={`tick-${price}`}>
            <line x1={ML - 3} x2={ML} y1={y} y2={y} stroke={AXIS_COLOR} strokeWidth="0.75" />
            <text
              x={ML - 5}
              y={y + 3.5}
              textAnchor="end"
              fill={isCurrent ? CURRENT_COLOR : PRICE_LABEL_COLOR}
              fontSize={isCurrent ? "8" : "7.5"}
              fontWeight={isCurrent ? "600" : "400"}
              fontFamily="monospace"
            >
              {fmtPrice(price)}
            </text>
          </g>
        );
      })}

      {/* ── Legend (bottom right) */}
      <g>
        <rect x={ML + PLOT_W - 86} y={MT + PLOT_H - 22} width={7} height={7} fill={PUT_COLOR} opacity="0.6" rx="1" />
        <text x={ML + PLOT_W - 77} y={MT + PLOT_H - 15.5} fill={TICK_COLOR} fontSize="7.5" fontFamily="monospace">Put Wall</text>
        <rect x={ML + PLOT_W - 86} y={MT + PLOT_H - 12} width={7} height={7} fill={CALL_COLOR} opacity="0.6" rx="1" />
        <text x={ML + PLOT_W - 77} y={MT + PLOT_H - 5.5} fill={TICK_COLOR} fontSize="7.5" fontFamily="monospace">Call Wall</text>
      </g>

      {/* SMA legend */}
      {(sma50 || sma200) && (
        <g>
          {sma50 && (
            <>
              <line x1={ML + 2} y1={MT + PLOT_H - 16} x2={ML + 10} y2={MT + PLOT_H - 16} stroke={SMA50_COLOR} strokeWidth="1" strokeDasharray="3 2" opacity="0.7" />
              <text x={ML + 13} y={MT + PLOT_H - 12.5} fill={SMA50_COLOR} fontSize="7.5" fontFamily="monospace" opacity="0.8">SMA50</text>
            </>
          )}
          {sma200 && (
            <>
              <line x1={ML + 2} y1={MT + PLOT_H - 7} x2={ML + 10} y2={MT + PLOT_H - 7} stroke={SMA200_COLOR} strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
              <text x={ML + 13} y={MT + PLOT_H - 3.5} fill={SMA200_COLOR} fontSize="7.5" fontFamily="monospace" opacity="0.7">SMA200</text>
            </>
          )}
        </g>
      )}

      {/* Gradient defs */}
      <defs>
        <linearGradient id="putGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={PUT_COLOR} stopOpacity="0.6" />
          <stop offset="100%" stopColor={PUT_COLOR} stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

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
  const hasData =
    callWalls.length > 0 ||
    putWalls.length > 0 ||
    resistanceLevels.length > 0 ||
    supportLevels.length > 0;

  if (!hasData && !sma50 && !sma200) return null;

  // Primary walls: highest OI (or first resistance/support)
  const topCallWall = callWalls.length
    ? callWalls.reduce((best, w) => (w.open_interest > best.open_interest ? w : best)).strike
    : null;
  const topPutWall = putWalls.length
    ? putWalls.reduce((best, w) => (w.open_interest > best.open_interest ? w : best)).strike
    : null;
  const topResistance = resistanceLevels[0] ?? null;
  const topSupport = supportLevels[0] ?? null;

  const setup = deriveSetup(currentPrice, topCallWall, topPutWall, topResistance, topSupport);
  const maAlignment = deriveMaAlignment(currentPrice, sma50, sma200);
  const interpretation = buildInterpretation(
    setup,
    maAlignment,
    currentPrice,
    topCallWall,
    topPutWall,
    topResistance,
    topSupport,
    putCallRatio
  );

  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-950/55 p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SetupBadge setup={setup} />
          <MaBadge alignment={maAlignment} />
          {putCallRatio !== null && putCallRatio !== undefined && (
            <PcBadge ratio={putCallRatio} />
          )}
        </div>
        {label && (
          <span className="text-[10px] text-stealth-500 uppercase tracking-[0.18em]">{label}</span>
        )}
      </div>

      {/* SVG Price Map */}
      <PriceMap
        currentPrice={currentPrice}
        callWalls={callWalls}
        putWalls={putWalls}
        resistanceLevels={resistanceLevels}
        supportLevels={supportLevels}
        sma50={sma50}
        sma200={sma200}
      />

      {/* 1-line interpretation */}
      <p className="mt-2 text-[11px] leading-relaxed text-stealth-300">{interpretation}</p>
    </div>
  );
}
