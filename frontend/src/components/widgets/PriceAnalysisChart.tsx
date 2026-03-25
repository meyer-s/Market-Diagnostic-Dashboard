import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

interface PriceHistoryPoint {
  date: string;
  close: number;
}

interface FlowEventPoint {
  date: string;
  price: number;
  volume: number;
  notional: number;
  volume_z: number;
  side: "buy" | "sell" | "neutral";
  strength: number;
}

interface PriceAnalysisChartProps {
  currentPrice: number;
  takeProfit: number;
  stopLoss: number;
  trailingReturn: number;
  horizon: string;
  analystTarget?: number | null;
  analystCount?: number | null;
  priceHistory?: PriceHistoryPoint[];
  flowEvents?: FlowEventPoint[];
}

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function PriceAnalysisChart({
  currentPrice,
  takeProfit,
  stopLoss,
  trailingReturn,
  horizon,
  analystTarget,
  analystCount,
  priceHistory = [],
  flowEvents = [],
}: PriceAnalysisChartProps) {
  // Calculate percentages for visualization
  const safeStopLoss = Math.max(0, stopLoss);
  const tpUpside = ((takeProfit - currentPrice) / currentPrice) * 100;
  const slDownside = ((currentPrice - safeStopLoss) / currentPrice) * 100;
  const trailingPercent = trailingReturn;

  // Color coding
  const isPositive = trailingReturn > 0;
  const returnColor = isPositive ? "text-green-400" : "text-red-400";
  const returnBg = isPositive ? "bg-green-500/10" : "bg-red-500/10";
  const returnBorder = isPositive ? "border-green-500/50" : "border-red-500/50";
  
  const modelTarget = takeProfit;
  const hasAnalystTarget =
    analystTarget !== null && analystTarget !== undefined && analystTarget > 0;
  const analystDiffPct = hasAnalystTarget
    ? ((modelTarget - analystTarget) / analystTarget) * 100
    : null;
  let analystAlignment = "n/a";
  let analystColor = "text-gray-400";
  if (analystDiffPct !== null) {
    if (Math.abs(analystDiffPct) <= 5) {
      analystAlignment = "Aligned";
      analystColor = "text-green-400";
    } else if (analystDiffPct > 5) {
      analystAlignment = "Above analysts";
      analystColor = "text-orange-300";
    } else {
      analystAlignment = "Below analysts";
      analystColor = "text-blue-300";
    }
  }

  const historyStart = priceHistory[0]?.date;
  const historyEnd = priceHistory[priceHistory.length - 1]?.date;
  const overlayEvents = flowEvents
    .filter((event) => !historyStart || !historyEnd || (event.date >= historyStart && event.date <= historyEnd))
    .map((event) => ({
      ...event,
      markerSize: Math.max(60, Math.min(220, event.strength * 30)),
    }));
  const buyEvents = overlayEvents.filter((event) => event.side === "buy");
  const sellEvents = overlayEvents.filter((event) => event.side === "sell");
  const neutralEvents = overlayEvents.filter((event) => event.side === "neutral");
  const hasPriceHistory = priceHistory.length > 1;
  
  return (
    <div className="bg-gray-900 rounded-lg p-3 sm:p-4 border border-gray-700">
      {/* Header */}
      <div className="mb-3">
        <p className="text-xs text-gray-400 mb-1">Price Analysis for {horizon}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-gray-400">Current Price</p>
            <p className="text-xl font-bold text-white">${currentPrice.toFixed(2)}</p>
          </div>
          <div className={`text-right px-2 py-1 rounded text-xs ${returnBg} border ${returnBorder}`}>
            <p className="text-xs text-gray-300 mb-0.5">Trailing Return</p>
            <p className={`text-base font-bold ${returnColor}`}>
              {trailingReturn > 0 ? "+" : ""}{trailingPercent.toFixed(1)}%
            </p>
          </div>
        </div>
        {hasAnalystTarget && (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
            <span>
              Analyst target: ${analystTarget!.toFixed(2)}
              {analystCount ? ` (${analystCount})` : ""}
            </span>
            <span className={`font-semibold ${analystColor}`}>
              Analyst Alignment: {analystAlignment}
            </span>
          </div>
        )}
      </div>

      <div className="mb-3 rounded-lg border border-gray-800 bg-gray-950/70 p-3">
        {hasPriceHistory ? (
          <>
            <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
              <span>Price history with stored large-trade overlays</span>
              <span>{overlayEvents.length} markers</span>
            </div>
            <div className="h-64" style={{ minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={priceHistory} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateLabel}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    minTickGap={24}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={["dataMin - 5", "dataMax + 5"]}
                    tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ZAxis dataKey="markerSize" range={[60, 220]} />
                  <Tooltip
                    contentStyle={{
                      background: "#111827",
                      border: "1px solid #374151",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelFormatter={(label) => formatDateLabel(String(label))}
                    formatter={(value, name, item) => {
                      const payload = item?.payload as (PriceHistoryPoint & Partial<FlowEventPoint> & { markerSize?: number }) | undefined;
                      if (name === "close") {
                        return [`$${Number(value).toFixed(2)}`, "Close"];
                      }
                      if (payload?.notional) {
                        return [
                          `${payload.side?.toUpperCase()} | ${formatCompactCurrency(payload.notional)} | z ${Number(payload.volume_z ?? 0).toFixed(2)}`,
                          `$${Number(payload.price ?? value).toFixed(2)}`,
                        ];
                      }
                      return [value, name];
                    }}
                  />
                  <ReferenceLine y={safeStopLoss} stroke="#f87171" strokeDasharray="5 5" />
                  <ReferenceLine y={takeProfit} stroke="#4ade80" strokeDasharray="5 5" />
                  {hasAnalystTarget && <ReferenceLine y={analystTarget!} stroke="#60a5fa" strokeDasharray="3 3" />}
                  <Line type="monotone" dataKey="close" stroke="#cbd5e1" strokeWidth={2.2} dot={false} />
                  <Scatter name="buy_events" data={buyEvents} fill="#4ade80" />
                  <Scatter name="sell_events" data={sellEvents} fill="#f87171" />
                  <Scatter name="neutral_events" data={neutralEvents} fill="#94a3b8" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-400">
              <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-1 text-green-300">Buy events</span>
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-300">Sell events</span>
              <span className="rounded-full border border-gray-500/30 bg-gray-500/10 px-2 py-1 text-gray-300">Neutral events</span>
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-blue-300">Analyst target</span>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-400">Price history unavailable for overlay.</div>
        )}
        </div>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 gap-1 text-xs">
        <div className="bg-red-500/10 border border-red-500/30 rounded p-1.5">
          <p className="text-red-300 text-xs mb-0.5">Risk/Reward</p>
          <p className="text-red-200 font-semibold text-xs">
            1 : {(tpUpside / slDownside).toFixed(2)}
          </p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded p-1.5">
          <p className="text-blue-300 text-xs mb-0.5">Risk</p>
          <p className="text-blue-200 font-semibold text-xs">
            {slDownside.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}
