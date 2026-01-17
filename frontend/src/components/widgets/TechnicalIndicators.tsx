/**
 * Technical Indicators Component
 * 
 * Displays price history (252 days), RSI, and MACD charts with real data
 */

import { OptionalityMispricingWidget } from "./OptionalityMispricingWidget";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TechnicalData {
  lookback_days: number;
  current_price: number;
  high_52w: number;
  low_52w: number;
  sma_50: number;
  sma_200: number | null;
  trend: string;
  rsi: {
    current: number;
    status: string;
    series?: number[];
  };
  macd: {
    current: number;
    signal: number;
    histogram: number;
    status: string;
    macd_series?: number[];
    signal_series?: number[];
    histogram_series?: number[];
  };
  candles: Candle[];
}

interface OptionsWall {
  strike: number;
  open_interest: number;
  volume: number;
}

interface OptionsFlowData {
  expiry: string;
  as_of: string;
  call_walls: OptionsWall[];
  put_walls: OptionsWall[];
  call_open_interest_total: number;
  put_open_interest_total: number;
  call_volume_total: number;
  put_volume_total: number;
  put_call_oi_ratio: number | null;
}

interface OptionalityMetrics {
  iv30: number | null;
  hv30: number | null;
  iv_percentile: number | null;
  avg_edr: number | null;
}

interface TechnicalIndicatorsProps {
  technicalData?: TechnicalData;
  optionsFlow?: OptionsFlowData | null;
  optionalityMetrics?: OptionalityMetrics | null;
}

export function TechnicalIndicators({
  technicalData,
  optionsFlow,
  optionalityMetrics,
}: TechnicalIndicatorsProps) {
  if (!technicalData && !optionsFlow) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6">
        <p className="text-gray-400">Loading technical analysis...</p>
      </div>
    );
  }

  const optionsAvailable = !!optionsFlow && (
    (optionsFlow.call_walls?.length ?? 0) > 0 || (optionsFlow.put_walls?.length ?? 0) > 0
  );
  const callWall = optionsFlow?.call_walls?.[0];
  const putWall = optionsFlow?.put_walls?.[0];
  const currentPrice = technicalData?.current_price;

  const formatCompact = (value: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

  const formatExpiry = (dateStr: string) => {
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return dateStr;
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatDistance = (strike: number) => {
    if (!currentPrice) return "n/a";
    const diffPct = ((strike - currentPrice) / currentPrice) * 100;
    const direction = diffPct >= 0 ? "above" : "below";
    return `${Math.abs(diffPct).toFixed(1)}% ${direction}`;
  };

  const maxCallOi = Math.max(...(optionsFlow?.call_walls?.map((wall) => wall.open_interest) || [0]));
  const maxPutOi = Math.max(...(optionsFlow?.put_walls?.map((wall) => wall.open_interest) || [0]));

  const optionsFlowCard = (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 font-semibold">Options Flow</p>
        {optionsFlow?.expiry && (
          <span className="text-[10px] text-gray-500">Exp {formatExpiry(optionsFlow.expiry)}</span>
        )}
      </div>
      {optionsAvailable ? (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-gray-900 rounded p-2 border border-gray-700">
              <p className="text-[10px] text-gray-400 mb-1">Call wall (resistance)</p>
              <p className="text-sm font-bold text-green-400">
                ${callWall?.strike.toFixed(2)}
              </p>
              <p className="text-[10px] text-gray-500">OI {formatCompact(callWall?.open_interest || 0)}</p>
              {callWall && (
                <p className="text-[10px] text-gray-500">{formatDistance(callWall.strike)} vs price</p>
              )}
            </div>
            <div className="bg-gray-900 rounded p-2 border border-gray-700">
              <p className="text-[10px] text-gray-400 mb-1">Put wall (support)</p>
              <p className="text-sm font-bold text-red-400">
                ${putWall?.strike.toFixed(2)}
              </p>
              <p className="text-[10px] text-gray-500">OI {formatCompact(putWall?.open_interest || 0)}</p>
              {putWall && (
                <p className="text-[10px] text-gray-500">{formatDistance(putWall.strike)} vs price</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3 text-[10px]">
            <div>
              <p className="text-gray-400 mb-1">Top call walls</p>
              <div className="space-y-1">
                {(optionsFlow?.call_walls || []).slice(0, 3).map((wall) => (
                  <div key={`call-${wall.strike}`} className="flex items-center gap-1.5">
                    <span className="w-12 text-gray-400">${wall.strike.toFixed(0)}</span>
                    <div className="flex-1 bg-gray-700 rounded h-1">
                      <div
                        className="bg-green-500 h-1 rounded"
                        style={{ width: `${maxCallOi ? (wall.open_interest / maxCallOi) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-gray-500">{formatCompact(wall.open_interest)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-gray-400 mb-1">Top put walls</p>
              <div className="space-y-1">
                {(optionsFlow?.put_walls || []).slice(0, 3).map((wall) => (
                  <div key={`put-${wall.strike}`} className="flex items-center gap-1.5">
                    <span className="w-12 text-gray-400">${wall.strike.toFixed(0)}</span>
                    <div className="flex-1 bg-gray-700 rounded h-1">
                      <div
                        className="bg-red-500 h-1 rounded"
                        style={{ width: `${maxPutOi ? (wall.open_interest / maxPutOi) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-gray-500">{formatCompact(wall.open_interest)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1 text-[10px] text-gray-400">
            <div className="flex justify-between">
              <span>Call OI</span>
              <span className="text-green-300">{formatCompact(optionsFlow?.call_open_interest_total || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Put OI</span>
              <span className="text-red-300">{formatCompact(optionsFlow?.put_open_interest_total || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Put/Call OI</span>
              <span className="text-gray-300">
                {optionsFlow?.put_call_oi_ratio !== null && optionsFlow?.put_call_oi_ratio !== undefined
                  ? optionsFlow.put_call_oi_ratio.toFixed(2)
                  : "n/a"}
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-gray-400">Options flow data unavailable for this ticker.</p>
      )}
    </div>
  );

  if (!technicalData) {
    return (
      <div className="space-y-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4 sm:p-6">
          <p className="text-gray-400">Technical analysis unavailable for this ticker.</p>
        </div>
        {optionalityMetrics && (
          <OptionalityMispricingWidget metrics={optionalityMetrics} />
        )}
        {optionsFlowCard}
      </div>
    );
  }

  const {
    candles,
    rsi,
    macd,
    sma_50,
    sma_200,
  } = technicalData;

  // Calculate chart dimensions
  const chartWidth = 1000;
  const chartHeight = 300;
  const padding = { top: 20, right: 50, bottom: 40, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Find price range
  const prices = candles.map((c) => [c.high, c.low]).flat();
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  const padding_price = priceRange * 0.1;

  const scalePrice = (price: number) => {
    const normalized = (price - (minPrice - padding_price)) / (priceRange + padding_price * 2);
    return padding.top + (1 - normalized) * plotHeight;
  };

  const scaleX = (index: number) => {
    return padding.left + (index / (candles.length - 1)) * plotWidth;
  };

  const volumes = candles
    .map((candle) => candle.volume)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const maxVolume = Math.max(...volumes, 0);
  const latestVolume = volumes.length ? volumes[volumes.length - 1] : 0;
  const sortedVolumes = [...volumes].sort((a, b) => a - b);
  const medianVolume = sortedVolumes.length
    ? sortedVolumes[Math.floor(sortedVolumes.length / 2)]
    : 0;

  const volumeChartHeight = 160;
  const volumePadding = { top: 10, right: 30, bottom: 25, left: 55 };
  const volumePlotHeight = volumeChartHeight - volumePadding.top - volumePadding.bottom;
  const scaleVolumeY = (volume: number) => {
    if (!maxVolume) return volumeChartHeight - volumePadding.bottom;
    const normalized = volume / maxVolume;
    return volumePadding.top + (1 - normalized) * volumePlotHeight;
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Price History Chart */}
      <div className="bg-gray-800 rounded-lg p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold">Price History ({technicalData.lookback_days}-Day)</h3>
        </div>

        <div className="bg-gray-900 rounded-lg p-4 mb-4 overflow-x-auto">
          <svg width="100%" height="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" style={{ minWidth: '800px' }}>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((percent) => {
              const y = padding.top + percent * plotHeight;
              const price = minPrice - padding_price + percent * (priceRange + padding_price * 2);
              return (
                <g key={`grid-${percent}`}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={chartWidth - padding.right}
                    y2={y}
                    stroke="#374151"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <text x={padding.left - 10} y={y + 4} fill="#9ca3af" fontSize="10" textAnchor="end">
                    ${price.toFixed(0)}
                  </text>
                </g>
              );
            })}

            {/* Candlesticks */}
            {candles.map((candle, idx) => {
              const x = scaleX(idx);
              const o = scalePrice(candle.open);
              const h = scalePrice(candle.high);
              const l = scalePrice(candle.low);
              const c = scalePrice(candle.close);

              const isGreen = candle.close >= candle.open;
              const bodyTop = Math.min(o, c);
              const bodyBottom = Math.max(o, c);
              const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
              const color = isGreen ? "#22c55e" : "#ef4444";
              const wickWidth = plotWidth / candles.length / 3;

              return (
                <g key={idx}>
                  {/* Wick */}
                  <line x1={x} y1={h} x2={x} y2={l} stroke={color} strokeWidth="1" opacity="0.6" />
                  {/* Body */}
                  <rect x={x - wickWidth} y={bodyTop} width={wickWidth * 2} height={bodyHeight} fill={color} opacity="0.8" />
                </g>
              );
            })}

            {/* SMA 50 line */}
            {sma_50 && (
              <>
                <line
                  x1={padding.left}
                  y1={scalePrice(sma_50)}
                  x2={chartWidth - padding.right}
                  y2={scalePrice(sma_50)}
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                  opacity="0.6"
                />
                <text x={chartWidth - padding.right + 5} y={scalePrice(sma_50) + 4} fill="#f59e0b" fontSize="10">
                  SMA50
                </text>
              </>
            )}

            {/* SMA 200 line */}
            {sma_200 && (
              <>
                <line
                  x1={padding.left}
                  y1={scalePrice(sma_200)}
                  x2={chartWidth - padding.right}
                  y2={scalePrice(sma_200)}
                  stroke="#8b5cf6"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                  opacity="0.6"
                />
                <text x={chartWidth - padding.right + 5} y={scalePrice(sma_200) - 4} fill="#8b5cf6" fontSize="10">
                  SMA200
                </text>
              </>
            )}

            {/* Axes */}
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight - padding.bottom} stroke="#4b5563" strokeWidth="2" />
            <line x1={padding.left} y1={chartHeight - padding.bottom} x2={chartWidth - padding.right} y2={chartHeight - padding.bottom} stroke="#4b5563" strokeWidth="2" />
          </svg>
        </div>

        {/* Price Info Row */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
          <div className="bg-gray-900 rounded p-2 border border-gray-700">
            <p className="text-gray-400 mb-1">Current</p>
            <p className="text-sm font-bold text-blue-300">${technicalData.current_price.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 rounded p-2 border border-gray-700">
            <p className="text-gray-400 mb-1">52W High</p>
            <p className="text-sm font-bold text-green-400">${technicalData.high_52w.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 rounded p-2 border border-gray-700">
            <p className="text-gray-400 mb-1">52W Low</p>
            <p className="text-sm font-bold text-red-400">${technicalData.low_52w.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 rounded p-2 border border-gray-700">
            <p className="text-gray-400 mb-1">SMA50</p>
            <p className="text-sm font-bold text-amber-400">${technicalData.sma_50.toFixed(2)}</p>
          </div>
          <div className="bg-gray-900 rounded p-2 border border-gray-700">
            <p className="text-gray-400 mb-1">SMA200</p>
            <p className="text-sm font-bold text-purple-400">
              {technicalData.sma_200 !== null ? `$${technicalData.sma_200.toFixed(2)}` : "n/a"}
            </p>
          </div>
          <div className="bg-gray-900 rounded p-2 border border-gray-700">
            <p className="text-gray-400 mb-1">Trend</p>
            <p
              className={`text-sm font-bold capitalize ${
                technicalData.trend === "uptrend"
                  ? "text-green-400"
                  : technicalData.trend === "downtrend"
                    ? "text-red-400"
                    : "text-gray-400"
              }`}
            >
              {technicalData.trend}
            </p>
          </div>
        </div>
      </div>

      {/* RSI */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p className="text-xs text-gray-400 mb-3 font-semibold">RSI (14)</p>
        <div className="mb-4">
          <p className="text-3xl font-bold text-blue-400 mb-2">{rsi.current.toFixed(1)}</p>
          <div className="w-full bg-gray-700 rounded-full h-2.5 mb-2">
            <div
              className={`h-2.5 rounded-full transition-all ${
                rsi.current > 70 ? "bg-red-500" : rsi.current < 30 ? "bg-green-500" : "bg-yellow-500"
              }`}
              style={{ width: `${Math.min(Math.max(rsi.current, 0), 100)}%` }}
            />
          </div>
          <p
            className={`text-xs font-semibold capitalize ${
              rsi.status === "overbought"
                ? "text-red-400"
                : rsi.status === "oversold"
                  ? "text-green-400"
                  : "text-yellow-400"
            }`}
          >
            {rsi.status}
          </p>
        </div>
        <div className="space-y-1 text-xs text-gray-400">
          <p>70 = Overbought</p>
          <p>30 = Oversold</p>
        </div>

        {/* RSI Line Chart */}
        {rsi.series && rsi.series.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto mt-3">
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${chartWidth} 150`}
              preserveAspectRatio="xMidYMid meet"
              style={{ minWidth: "800px" }}
            >
              {(() => {
                const rsiPadding = { top: 15, right: 50, bottom: 25, left: 50 };
                const rsiPlotHeight = 150 - rsiPadding.top - rsiPadding.bottom;
                const rsiPlotWidth = chartWidth - rsiPadding.left - rsiPadding.right;

                const scaleRsiY = (value: number) => {
                  const normalized = (100 - value) / 100;
                  return rsiPadding.top + normalized * rsiPlotHeight;
                };

                return (
                  <>
                    {/* Overbought/Oversold zones */}
                    <rect
                      x={rsiPadding.left}
                      y={rsiPadding.top}
                      width={rsiPlotWidth}
                      height={scaleRsiY(70) - rsiPadding.top}
                      fill="#ef4444"
                      opacity="0.1"
                    />
                    <rect
                      x={rsiPadding.left}
                      y={scaleRsiY(30)}
                      width={rsiPlotWidth}
                      height={150 - rsiPadding.bottom - scaleRsiY(30)}
                      fill="#22c55e"
                      opacity="0.1"
                    />

                    {/* Grid lines */}
                    {[0, 30, 50, 70, 100].map((level) => {
                      const y = scaleRsiY(level);
                      return (
                        <g key={`rsi-grid-${level}`}>
                          <line
                            x1={rsiPadding.left}
                            y1={y}
                            x2={chartWidth - rsiPadding.right}
                            y2={y}
                            stroke={level === 70 || level === 30 ? "#4b5563" : "#374151"}
                            strokeWidth={level === 70 || level === 30 ? "1.5" : "1"}
                            strokeDasharray="4 4"
                          />
                          <text
                            x={rsiPadding.left - 10}
                            y={y + 4}
                            fill="#9ca3af"
                            fontSize="10"
                            textAnchor="end"
                          >
                            {level}
                          </text>
                        </g>
                      );
                    })}

                    {/* RSI line */}
                    <polyline
                      points={rsi.series
                        .map((val, idx) => {
                          const x = rsiPadding.left + (idx / (rsi.series!.length - 1)) * rsiPlotWidth;
                          const y = scaleRsiY(val);
                          return `${x},${y}`;
                        })
                        .join(" ")}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                    />

                    {/* Axes */}
                    <line
                      x1={rsiPadding.left}
                      y1={rsiPadding.top}
                      x2={rsiPadding.left}
                      y2={150 - rsiPadding.bottom}
                      stroke="#4b5563"
                      strokeWidth="2"
                    />
                    <line
                      x1={rsiPadding.left}
                      y1={150 - rsiPadding.bottom}
                      x2={chartWidth - rsiPadding.right}
                      y2={150 - rsiPadding.bottom}
                      stroke="#4b5563"
                      strokeWidth="2"
                    />
                  </>
                );
              })()}
            </svg>
          </div>
        )}
      </div>

      {/* Volume */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400 font-semibold">Volume</p>
          <div className="text-[10px] text-gray-500">
            Latest {volumes.length ? formatCompact(latestVolume) : "n/a"} · Median {volumes.length ? formatCompact(medianVolume) : "n/a"}
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${chartWidth} ${volumeChartHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ minWidth: "800px" }}
          >
            {/* Y-axis labels */}
            {[0, 0.5, 1].map((t) => {
              const y = volumePadding.top + t * volumePlotHeight;
              const v = (1 - t) * maxVolume;
              return (
                <g key={`vol-grid-${t}`}>
                  <line
                    x1={volumePadding.left}
                    y1={y}
                    x2={chartWidth - volumePadding.right}
                    y2={y}
                    stroke="#374151"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={volumePadding.left - 10}
                    y={y + 4}
                    fill="#9ca3af"
                    fontSize="10"
                    textAnchor="end"
                  >
                    {formatCompact(v)}
                  </text>
                </g>
              );
            })}

            {candles.map((candle, idx) => {
              const x = scaleX(idx);
              const y = scaleVolumeY(candle.volume);
              const barWidth = plotWidth / candles.length;
              const height = volumeChartHeight - volumePadding.bottom - y;
              const isGreen = candle.close >= candle.open;
              return (
                <rect
                  key={`vol-${idx}`}
                  x={x - barWidth / 2}
                  y={y}
                  width={Math.max(barWidth * 0.8, 1)}
                  height={Math.max(height, 0)}
                  fill={isGreen ? "#22c55e" : "#ef4444"}
                  opacity="0.65"
                />
              );
            })}

            <line
              x1={volumePadding.left}
              y1={volumePadding.top}
              x2={volumePadding.left}
              y2={volumeChartHeight - volumePadding.bottom}
              stroke="#4b5563"
              strokeWidth="2"
            />
            <line
              x1={volumePadding.left}
              y1={volumeChartHeight - volumePadding.bottom}
              x2={chartWidth - volumePadding.right}
              y2={volumeChartHeight - volumePadding.bottom}
              stroke="#4b5563"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* MACD */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p className="text-xs text-gray-400 mb-3 font-semibold">MACD</p>
        <div className="mb-2">
          <div className="space-y-1.5 mb-3">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">MACD:</span>
              <span className="text-blue-300 font-mono">{macd.current.toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Signal:</span>
              <span className="text-orange-300 font-mono">{macd.signal.toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Histogram:</span>
              <span className={`font-mono ${macd.histogram > 0 ? "text-green-300" : "text-red-300"}`}>
                {macd.histogram.toFixed(4)}
              </span>
            </div>
          </div>
          <p className={`text-xs font-semibold capitalize ${macd.status === "bullish" ? "text-green-400" : "text-red-400"}`}>
            {macd.status}
          </p>
        </div>

        {/* MACD Chart with Histogram */}
        <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${chartWidth} 200`}
            preserveAspectRatio="xMidYMid meet"
            style={{ minWidth: "800px" }}
          >
            {(() => {
              const macdPadding = { top: 20, right: 50, bottom: 30, left: 50 };
              const macdPlotHeight = 200 - macdPadding.top - macdPadding.bottom;
              const macdPlotWidth = chartWidth - macdPadding.left - macdPadding.right;

              // Use real MACD data from API
              const macdValues = macd.macd_series || [];
              const signalValues = macd.signal_series || [];
              const histogramValues = macd.histogram_series || [];

              // If no series data, fall back to just showing current values
              if (macdValues.length === 0 || macdValues.length !== candles.length) {
                return (
                  <text x="50%" y="50%" fill="#9ca3af" fontSize="12" textAnchor="middle">
                    Loading MACD data...
                  </text>
                );
              }

              // Find range for scaling
              const allValues = [...macdValues, ...signalValues, ...histogramValues].filter((v) => Number.isFinite(v));
              const maxVal = Math.max(...allValues.map(Math.abs), 0.01);
              const range = maxVal * 2.2;
              const centerY = macdPadding.top + macdPlotHeight / 2;

              const scaleMacdY = (value: number) => {
                if (!Number.isFinite(value)) return centerY;
                const normalized = value / range;
                return centerY - normalized * macdPlotHeight;
              };

              return (
                <>
                  {/* Zero line */}
                  <line
                    x1={macdPadding.left}
                    y1={centerY}
                    x2={chartWidth - macdPadding.right}
                    y2={centerY}
                    stroke="#4b5563"
                    strokeWidth="1.5"
                  />

                  {/* Grid lines */}
                  {[-0.5, 0.5].map((fraction) => {
                    const y = centerY - fraction * macdPlotHeight;
                    const value = fraction * range;
                    return (
                      <g key={`macd-grid-${fraction}`}>
                        <line
                          x1={macdPadding.left}
                          y1={y}
                          x2={chartWidth - macdPadding.right}
                          y2={y}
                          stroke="#374151"
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                        <text
                          x={macdPadding.left - 10}
                          y={y + 4}
                          fill="#9ca3af"
                          fontSize="10"
                          textAnchor="end"
                        >
                          {value.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Histogram bars */}
                  {histogramValues.map((hist, idx) => {
                    const x = macdPadding.left + (idx / (candles.length - 1)) * macdPlotWidth;
                    const barWidth = macdPlotWidth / candles.length;
                    const barHeight = Math.abs(scaleMacdY(hist) - centerY);
                    const y = hist >= 0 ? scaleMacdY(hist) : centerY;
                    
                    return (
                      <rect
                        key={`hist-${idx}`}
                        x={x - barWidth / 2}
                        y={y}
                        width={Math.max(barWidth * 0.8, 1)}
                        height={Math.max(barHeight, 0)}
                        fill={hist >= 0 ? "#22c55e" : "#ef4444"}
                        opacity="0.6"
                      />
                    );
                  })}

                  {/* MACD line */}
                  <polyline
                    points={macdValues
                      .map((val, idx) => {
                        const x = macdPadding.left + (idx / (candles.length - 1)) * macdPlotWidth;
                        const y = scaleMacdY(val);
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                  />

                  {/* Signal line */}
                  <polyline
                    points={signalValues
                      .map((val, idx) => {
                        const x = macdPadding.left + (idx / (candles.length - 1)) * macdPlotWidth;
                        const y = scaleMacdY(val);
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                  />

                  {/* Legend */}
                  <text x={chartWidth - macdPadding.right - 120} y={macdPadding.top} fill="#3b82f6" fontSize="11">
                    MACD
                  </text>
                  <text x={chartWidth - macdPadding.right - 60} y={macdPadding.top} fill="#f97316" fontSize="11">
                    Signal
                  </text>

                  {/* Axes */}
                  <line
                    x1={macdPadding.left}
                    y1={macdPadding.top}
                    x2={macdPadding.left}
                    y2={200 - macdPadding.bottom}
                    stroke="#4b5563"
                    strokeWidth="2"
                  />
                  <line
                    x1={macdPadding.left}
                    y1={200 - macdPadding.bottom}
                    x2={chartWidth - macdPadding.right}
                    y2={200 - macdPadding.bottom}
                    stroke="#4b5563"
                    strokeWidth="2"
                  />
                </>
              );
            })()}
          </svg>
        </div>
      </div>

      {optionalityMetrics && (
        <OptionalityMispricingWidget metrics={optionalityMetrics} />
      )}
      {optionsFlowCard}
    </div>
  );
}
