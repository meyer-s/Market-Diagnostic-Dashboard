/**
 * Technical Indicators Component
 * 
 * Displays price history (252 days), RSI, and MACD charts with real data
 */

import { useRef, useState } from "react";
import { OptionalityMispricingWidget } from "./OptionalityMispricingWidget";
import { CHART_NEUTRAL } from "../../utils/chartUtils";
import { getFamilyColor, statePalette } from "../../theme/metricColors";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalData {
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

interface FlowEventPoint {
  date: string;
  price: number;
  volume: number;
  notional: number;
  volume_z: number;
  side: "buy" | "sell" | "neutral";
  strength: number;
}

interface TechnicalIndicatorsProps {
  technicalData?: TechnicalData;
  optionsFlow?: OptionsFlowData | null;
  optionalityMetrics?: OptionalityMetrics | null;
  flowEvents?: FlowEventPoint[];
  hideOptionsContext?: boolean;
}

export function TechnicalIndicators({
  technicalData,
  optionsFlow,
  optionalityMetrics,
  flowEvents = [],
  hideOptionsContext = false,
}: TechnicalIndicatorsProps) {
  const [activeFlowEventKey, setActiveFlowEventKey] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

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
        {!hideOptionsContext && optionalityMetrics && (
          <OptionalityMispricingWidget metrics={optionalityMetrics} />
        )}
        {!hideOptionsContext && optionsFlowCard}
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
  const chartColors = {
    grid: CHART_NEUTRAL.grid,
    axis: CHART_NEUTRAL.axis,
    tick: CHART_NEUTRAL.tick,
    priceUp: statePalette.green,
    priceDown: statePalette.red,
    sma50: getFamilyColor("equity", "muted"),
    sma200: getFamilyColor("equity", "faint"),
    rsiLine: getFamilyColor("equity"),
    rsiAxis: "#a855f7",
    macdLine: getFamilyColor("market"),
    macdSignal: getFamilyColor("benchmark"),
  };

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

  const candleIndexByDate = new Map(candles.map((candle, index) => [candle.date, index]));
  const overlayEvents = flowEvents
    .map((event) => {
      const candleIndex = candleIndexByDate.get(event.date);
      if (candleIndex === undefined) {
        return null;
      }

      const candle = candles[candleIndex];

      return {
        ...event,
        eventKey: `${event.date}-${event.side}-${event.price}-${event.volume}`,
        anchorPrice: candle.open,
        candleIndex,
        markerRadius: Math.max(4, Math.min(9, 3 + event.strength * 1.15)),
        tooltipX: scaleX(candleIndex),
        tooltipY: scalePrice(candle.open),
      };
    })
    .filter((event): event is FlowEventPoint & { eventKey: string; anchorPrice: number; candleIndex: number; markerRadius: number; tooltipX: number; tooltipY: number } => event !== null);
  const activeFlowEvent = overlayEvents.find((event) => event.eventKey === activeFlowEventKey) ?? null;
  const handleFlowMarkerPointer = (mouseX: number, mouseY: number, eventKey: string) => {
    const container = chartContainerRef.current;
    if (!container) {
      setActiveFlowEventKey(eventKey);
      return;
    }

    const bounds = container.getBoundingClientRect();
    setActiveFlowEventKey(eventKey);
    setTooltipPosition({
      x: mouseX - bounds.left,
      y: mouseY - bounds.top,
    });
  };

  const clearFlowTooltip = (_eventKey: string) => {
    setActiveFlowEventKey(null);
    setTooltipPosition(null);
  };

  const volumeChartHeight = 160;
  const volumePadding = { top: 10, right: 40, bottom: 25, left: 55 };
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
          <div className="text-[10px] text-gray-500">{overlayEvents.length} flow markers</div>
        </div>

        <div ref={chartContainerRef} className="relative bg-gray-900 rounded-lg p-4 mb-4 overflow-x-auto">
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
                    stroke={chartColors.grid}
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <text x={padding.left - 10} y={y + 4} fill={chartColors.tick} fontSize="10" textAnchor="end">
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
              const color = isGreen ? chartColors.priceUp : chartColors.priceDown;
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
                  stroke={chartColors.sma50}
                  strokeWidth="2"
                  strokeDasharray="4 2"
                  opacity="0.6"
                />
                <text x={chartWidth - padding.right + 5} y={scalePrice(sma_50) + 4} fill={chartColors.sma50} fontSize="10">
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
                  stroke={chartColors.sma200}
                  strokeWidth="2"
                  strokeDasharray="4 2"
                  opacity="0.6"
                />
                <text x={chartWidth - padding.right + 5} y={scalePrice(sma_200) - 4} fill={chartColors.sma200} fontSize="10">
                  SMA200
                </text>
              </>
            )}

            {overlayEvents.map((event) => {
              const x = scaleX(event.candleIndex);
              const y = scalePrice(event.anchorPrice);
              const fill = event.side === "buy" ? chartColors.priceUp : event.side === "sell" ? chartColors.priceDown : chartColors.tick;
              const stroke = event.side === "buy" ? "#bbf7d0" : event.side === "sell" ? "#fecaca" : "#e2e8f0";

              return (
                <g key={`flow-${event.eventKey}`}>
                  <circle cx={x} cy={y} r={event.markerRadius + 2} fill={fill} opacity="0.08" />
                  <circle
                    cx={x}
                    cy={y}
                    r={event.markerRadius}
                    fill={fill}
                    fillOpacity="0.54"
                    stroke={stroke}
                    strokeWidth="1.1"
                    tabIndex={0}
                    role="button"
                    aria-label={`${event.side} event on ${event.date} anchored to candle open at $${event.anchorPrice.toFixed(2)}`}
                    onMouseEnter={(hoverEvent) => handleFlowMarkerPointer(hoverEvent.clientX, hoverEvent.clientY, event.eventKey)}
                    onMouseMove={(moveEvent) => handleFlowMarkerPointer(moveEvent.clientX, moveEvent.clientY, event.eventKey)}
                    onMouseLeave={() => clearFlowTooltip(event.eventKey)}
                    onFocus={() => {
                      setActiveFlowEventKey(event.eventKey);
                      setTooltipPosition({ x: event.tooltipX, y: event.tooltipY });
                    }}
                    onBlur={() => clearFlowTooltip(event.eventKey)}
                  />
                </g>
              );
            })}

            {/* Axes */}
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={chartHeight - padding.bottom} stroke={chartColors.axis} strokeWidth="2" />
            <line x1={padding.left} y1={chartHeight - padding.bottom} x2={chartWidth - padding.right} y2={chartHeight - padding.bottom} stroke={chartColors.axis} strokeWidth="2" />
          </svg>

          {activeFlowEvent && tooltipPosition && (
            <div
              className="pointer-events-none absolute z-10 max-w-[240px] rounded-lg border border-gray-700 bg-gray-950/95 px-3 py-2 text-xs text-gray-200 shadow-2xl"
              style={{
                left: Math.max(12, Math.min(tooltipPosition.x + 14, chartWidth - 250)),
                top: Math.max(12, tooltipPosition.y - 70),
              }}
            >
              <div className="mb-1 font-medium text-gray-50">
                {activeFlowEvent.side.toUpperCase()} · {activeFlowEvent.date}
              </div>
              <div className="text-gray-300">
                open ${activeFlowEvent.anchorPrice.toFixed(2)} · event ${activeFlowEvent.price.toFixed(2)}
              </div>
              <div className="text-gray-400">
                z {activeFlowEvent.volume_z.toFixed(2)} · {formatCompact(activeFlowEvent.notional)}
              </div>
            </div>
          )}
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

        {overlayEvents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-400">
            <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-1 text-green-300">Buy events</span>
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-300">Sell events</span>
            <span className="rounded-full border border-gray-500/30 bg-gray-500/10 px-2 py-1 text-gray-300">Neutral events</span>
          </div>
        )}

      {/* MACD — moved above Volume/RSI */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 mt-4">
        <p className="text-xs text-gray-400 mb-3 font-semibold">MACD</p>

        <div className="bg-gray-950 rounded-lg p-3 overflow-x-auto">
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

              const macdValues = macd.macd_series || [];
              const signalValues = macd.signal_series || [];
              const histogramValues = macd.histogram_series || [];

              if (macdValues.length === 0 || macdValues.length !== candles.length) {
                return (
                  <text x="50%" y="50%" fill={chartColors.tick} fontSize="12" textAnchor="middle">
                    Loading MACD data...
                  </text>
                );
              }

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
                  <line
                    x1={macdPadding.left}
                    y1={centerY}
                    x2={chartWidth - macdPadding.right}
                    y2={centerY}
                    stroke={chartColors.axis}
                    strokeWidth="1.5"
                  />

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
                          stroke={chartColors.grid}
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                        <text
                          x={macdPadding.left - 10}
                          y={y + 4}
                          fill={chartColors.tick}
                          fontSize="10"
                          textAnchor="end"
                        >
                          {value.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

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
                        fill={hist >= 0 ? chartColors.priceUp : chartColors.priceDown}
                        opacity="0.6"
                      />
                    );
                  })}

                  <polyline
                    points={macdValues
                      .map((val, idx) => {
                        const x = macdPadding.left + (idx / (candles.length - 1)) * macdPlotWidth;
                        const y = scaleMacdY(val);
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke={chartColors.macdLine}
                    strokeWidth="2"
                  />

                  <polyline
                    points={signalValues
                      .map((val, idx) => {
                        const x = macdPadding.left + (idx / (candles.length - 1)) * macdPlotWidth;
                        const y = scaleMacdY(val);
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke={chartColors.macdSignal}
                    strokeWidth="2"
                    strokeDasharray="4 2"
                  />

                  <line
                    x1={macdPadding.left}
                    y1={macdPadding.top}
                    x2={macdPadding.left}
                    y2={200 - macdPadding.bottom}
                    stroke={chartColors.axis}
                    strokeWidth="2"
                  />
                  <line
                    x1={macdPadding.left}
                    y1={200 - macdPadding.bottom}
                    x2={chartWidth - macdPadding.right}
                    y2={200 - macdPadding.bottom}
                    stroke={chartColors.axis}
                    strokeWidth="2"
                  />
                </>
              );
            })()}
          </svg>
        </div>

      </div>

      {/* Volume + RSI overlay (dual-axis) */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400 font-semibold">Volume &amp; RSI (14)</p>
          <div className="flex items-center gap-3 text-[10px] text-gray-500">
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/60" /> Vol</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: "#a855f7" }} /> RSI</span>
            <span style={{ color: rsi.current > 70 ? "#f87171" : rsi.current < 30 ? "#4ade80" : "#eab308", fontWeight: 600 }}>
              RSI {rsi.current.toFixed(1)} · {rsi.status}
            </span>
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
            {/* Volume Y-axis (left) */}
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
                    stroke={chartColors.grid}
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={volumePadding.left - 10}
                    y={y + 4}
                    fill={chartColors.tick}
                    fontSize="10"
                    textAnchor="end"
                  >
                    {formatCompact(v)}
                  </text>
                </g>
              );
            })}

            {/* Volume bars */}
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
                  fill={isGreen ? chartColors.priceUp : chartColors.priceDown}
                  opacity="0.65"
                />
              );
            })}

            {/* RSI right axis labels (0, 30, 50, 70, 100) */}
            {(() => {
              const rsiSeries = rsi.series || [];
              const rsiRightX = chartWidth - volumePadding.right + 8;
              const scaleRsiY = (v: number) =>
                volumePadding.top + (1 - v / 100) * volumePlotHeight;
              return (
                <>
                  {[0, 30, 50, 70, 100].map((level) => {
                    const y = scaleRsiY(level);
                    const isKey = level === 30 || level === 70;
                    return (
                      <g key={`rsi-ref-${level}`}>
                        <line
                          x1={volumePadding.left}
                          y1={y}
                          x2={chartWidth - volumePadding.right}
                          y2={y}
                          stroke={isKey ? "#a855f7" : "transparent"}
                          strokeWidth="1"
                          strokeDasharray="3 5"
                          opacity="0.35"
                        />
                        <text
                          x={rsiRightX}
                          y={y + 4}
                          fill="#a855f7"
                          fontSize="10"
                          textAnchor="start"
                          opacity="0.8"
                        >
                          {level}
                        </text>
                      </g>
                    );
                  })}
                  {rsiSeries.length > 1 && (
                    <polyline
                      points={rsiSeries
                        .map((val, idx) => {
                          const x = volumePadding.left + (idx / (rsiSeries.length - 1)) * (chartWidth - volumePadding.left - volumePadding.right);
                          const y = scaleRsiY(val);
                          return `${x},${y}`;
                        })
                        .join(" ")}
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="1.75"
                      opacity="0.9"
                    />
                  )}
                </>
              );
            })()}

            {/* Axes */}
            <line
              x1={volumePadding.left}
              y1={volumePadding.top}
              x2={volumePadding.left}
              y2={volumeChartHeight - volumePadding.bottom}
              stroke={chartColors.axis}
              strokeWidth="2"
            />
            <line
              x1={volumePadding.left}
              y1={volumeChartHeight - volumePadding.bottom}
              x2={chartWidth - volumePadding.right}
              y2={volumeChartHeight - volumePadding.bottom}
              stroke={chartColors.axis}
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      </div>

      {!hideOptionsContext && optionalityMetrics && (
        <OptionalityMispricingWidget metrics={optionalityMetrics} />
      )}
      {!hideOptionsContext && optionsFlowCard}
    </div>
  );
}
