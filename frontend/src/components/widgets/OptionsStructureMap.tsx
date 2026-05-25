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

function StructureStat({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "support" | "resistance" | "current";
}) {
  const toneClass =
    tone === "support"
      ? "border-emerald-700/40 bg-emerald-950/25 text-emerald-200"
      : tone === "resistance"
      ? "border-rose-700/40 bg-rose-950/25 text-rose-200"
      : tone === "current"
      ? "border-blue-700/40 bg-blue-950/20 text-blue-100"
      : "border-stealth-700 bg-stealth-900/70 text-stealth-200";

  return (
    <div className={`rounded-xl border px-2.5 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
      {detail ? <div className="mt-0.5 text-[10px] text-stealth-400">{detail}</div> : null}
    </div>
  );
}

function StructureBand({
  currentPrice,
  supports,
  resistances,
  sma50,
  sma200,
}: {
  currentPrice: number;
  supports: StructureLevel[];
  resistances: StructureLevel[];
  sma50?: number | null;
  sma200?: number | null;
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
  const pad = rawRange * 0.1;
  const lo = rawMin - pad;
  const hi = rawMax + pad;

  const VW = 560;
  const VH = 150;
  const PLOT_X = 18;
  const PLOT_Y = 60;
  const PLOT_W = VW - 36;
  const LANE_H = 28;
  const scaleX = (price: number) => PLOT_X + ((price - lo) / (hi - lo)) * PLOT_W;
  const currentX = scaleX(currentPrice);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: 150 }} aria-label="Options structure band">
      <defs>
        <linearGradient id="options-structure-lane" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgba(15,23,42,0.92)" />
          <stop offset="50%" stopColor="rgba(17,24,39,0.88)" />
          <stop offset="100%" stopColor="rgba(15,23,42,0.92)" />
        </linearGradient>
        <linearGradient id="options-structure-support" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgba(16,185,129,0.34)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0)" />
        </linearGradient>
        <linearGradient id="options-structure-resistance" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0%" stopColor="rgba(251,113,133,0.34)" />
          <stop offset="100%" stopColor="rgba(251,113,133,0)" />
        </linearGradient>
      </defs>

      <text x={PLOT_X} y="16" fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.8">
        SUPPORT STRUCTURE
      </text>
      <text x={PLOT_X + PLOT_W} y="16" textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace" letterSpacing="1.8">
        RESISTANCE STRUCTURE
      </text>

      <rect x={PLOT_X} y={PLOT_Y} width={PLOT_W} height={LANE_H} rx="14" fill="url(#options-structure-lane)" stroke="rgba(71,85,105,0.85)" />
      <rect x={PLOT_X} y={PLOT_Y + 1} width={PLOT_W * 0.28} height={LANE_H - 2} rx="13" fill="url(#options-structure-support)" />
      <rect x={PLOT_X + PLOT_W * 0.72} y={PLOT_Y + 1} width={PLOT_W * 0.28} height={LANE_H - 2} rx="13" fill="url(#options-structure-resistance)" />
      <line x1={PLOT_X + PLOT_W / 2} x2={PLOT_X + PLOT_W / 2} y1={PLOT_Y + 3} y2={PLOT_Y + LANE_H - 3} stroke="rgba(100,116,139,0.55)" strokeDasharray="3 3" />

      {sma200 ? (
        <g>
          <line x1={scaleX(sma200)} x2={scaleX(sma200)} y1="24" y2={PLOT_Y + LANE_H + 22} stroke="#6b7280" strokeDasharray="4 4" opacity="0.7" />
          <text x={scaleX(sma200)} y="34" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="monospace">
            SMA200
          </text>
        </g>
      ) : null}

      {sma50 ? (
        <g>
          <line x1={scaleX(sma50)} x2={scaleX(sma50)} y1="24" y2={PLOT_Y + LANE_H + 22} stroke="#a78bfa" strokeDasharray="4 4" opacity="0.82" />
          <text x={scaleX(sma50)} y="46" textAnchor="middle" fill="#c4b5fd" fontSize="9" fontFamily="monospace">
            SMA50
          </text>
        </g>
      ) : null}

      {supports.map((level, index) => {
        const x = scaleX(level.price);
        const reach = Math.min(64, Math.max(22, level.intensity * 74));
        const barY = PLOT_Y + LANE_H + 12 + index * 12;
        const width = Math.max(8, Math.min(reach, x - PLOT_X));

        return (
          <g key={`support-${level.price}-${index}`}>
            <line x1={x} x2={x} y1={PLOT_Y + LANE_H} y2={barY - 2} stroke="rgba(16,185,129,0.48)" />
            <rect x={x - width} y={barY} width={width} height="8" rx="4" fill="rgba(52,211,153,0.72)" />
          </g>
        );
      })}

      {resistances.map((level, index) => {
        const x = scaleX(level.price);
        const reach = Math.min(64, Math.max(22, level.intensity * 74));
        const barY = PLOT_Y - 20 - index * 12;
        const width = Math.max(8, Math.min(reach, PLOT_X + PLOT_W - x));

        return (
          <g key={`resistance-${level.price}-${index}`}>
            <line x1={x} x2={x} y1={barY + 8} y2={PLOT_Y} stroke="rgba(251,113,133,0.48)" />
            <rect x={x} y={barY} width={width} height="8" rx="4" fill="rgba(251,113,133,0.72)" />
          </g>
        );
      })}

      <line x1={currentX} x2={currentX} y1="20" y2={PLOT_Y + LANE_H + 26} stroke="rgba(226,232,240,0.88)" />
      <circle cx={currentX} cy={PLOT_Y + LANE_H / 2} r="7.5" fill="rgba(241,245,249,0.18)" />
      <circle cx={currentX} cy={PLOT_Y + LANE_H / 2} r="4.5" fill="#f8fafc" />
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
  const maLabel =
    maAlignment === "bullish"
      ? "Bullish"
      : maAlignment === "bearish"
      ? "Bearish"
      : maAlignment === "mixed"
      ? "Mixed"
      : "Unknown";

  return (
    <div className="space-y-3">
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
            currentPrice={currentPrice}
            supports={supports}
            resistances={resistances}
            sma50={sma50}
            sma200={sma200}
          />

          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2 text-[10px] uppercase tracking-[0.16em] text-stealth-500">
            <div>
              <div>Support</div>
              <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-emerald-300">
                {primarySupport !== null ? fmtPrice(primarySupport) : "n/a"}
              </div>
            </div>
            <div className="text-center">
              <div>Current</div>
              <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-stealth-100">
                {fmtPrice(currentPrice)}
              </div>
            </div>
            <div className="text-right">
              <div>Resistance</div>
              <div className="mt-0.5 text-sm font-semibold normal-case tracking-normal text-rose-300">
                {primaryResistance !== null ? fmtPrice(primaryResistance) : "n/a"}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-stealth-300">{interpretation}</p>
      </div>

      <div className={`grid gap-2 ${putCallRatio !== null && putCallRatio !== undefined ? "grid-cols-2 xl:grid-cols-5" : "grid-cols-2 xl:grid-cols-4"}`}>
        <StructureStat
          label="Support"
          value={primarySupport !== null ? fmtPrice(primarySupport) : "n/a"}
          detail={primarySupport !== null ? formatDistance(primarySupport, currentPrice) : "No nearby support"}
          tone="support"
        />
        <StructureStat
          label="Current"
          value={fmtPrice(currentPrice)}
          detail={describeRangePosition(currentPrice, primarySupport, primaryResistance)}
          tone="current"
        />
        <StructureStat
          label="Resistance"
          value={primaryResistance !== null ? fmtPrice(primaryResistance) : "n/a"}
          detail={primaryResistance !== null ? formatDistance(primaryResistance, currentPrice) : "No nearby resistance"}
          tone="resistance"
        />
        <StructureStat
          label="MA Trend"
          value={maLabel}
          detail={
            sma50 && sma200
              ? `SMA50 ${fmtPrice(sma50)} · SMA200 ${fmtPrice(sma200)}`
              : sma50
              ? `SMA50 ${fmtPrice(sma50)}`
              : "Moving averages unavailable"
          }
        />
        {putCallRatio !== null && putCallRatio !== undefined ? (
          <StructureStat
            label="Optionality"
            value={`P/C ${putCallRatio.toFixed(2)}`}
            detail={
              putCallRatio < 0.7
                ? "Call-heavy skew"
                : putCallRatio > 1.1
                ? "Put-heavy skew"
                : "Balanced skew"
            }
          />
        ) : null}
      </div>
    </div>
  );
}
