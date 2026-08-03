/**
 * Technical Indicators Component
 * 
 * Displays price history (252 days), RSI, and MACD charts with real data
 */

import { OptionalityMispricingWidget } from "./OptionalityMispricingWidget";
import { CHART_NEUTRAL } from "../../utils/chartUtils";
import { getFamilyColor, statePalette } from "../../theme/metricColors";
import { memo, useId, useRef, useState } from "react";
import DataScroller from "../ui/DataScroller";
import {
  buildProxyEventClusters,
  percentile,
  proxyClusterHalo,
  proxyEventRadius,
  type ProxyClusterTone,
  type ProxyEventInput,
} from "../../utils/proxyEventClusters";

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

type FlowEventPoint = ProxyEventInput;

interface OhlcHistoryPoint {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface DailyHistoryPoint extends OhlcHistoryPoint {
  date: string;
}

interface IntradayHistoryPoint extends OhlcHistoryPoint {
  timestamp: string;
}

interface CandleChartPoint extends OhlcHistoryPoint {
  x: string;
}

type HistoryWindow = "252d" | "1y" | "5y" | "max";

interface TechnicalIndicatorsProps {
  technicalData?: TechnicalData;
  optionsFlow?: OptionsFlowData | null;
  optionalityMetrics?: OptionalityMetrics | null;
  flowEvents?: FlowEventPoint[];
  priceHistory?: DailyHistoryPoint[];
  intradayHistory2h?: IntradayHistoryPoint[];
  historyWindow?: HistoryWindow;
  onHistoryWindowChange?: (window: HistoryWindow) => void;
  hideOptionsContext?: boolean;
  closeLabel?: string;
}

function aggregateCandles<T extends OhlcHistoryPoint>(
  points: T[],
  getBucketKey: (point: T) => string,
  getLabel: (point: T) => string
): CandleChartPoint[] {
  if (!points.length) return [];

  const buckets = new Map<string, CandleChartPoint>();
  const order: string[] = [];

  points.forEach((point) => {
    const bucketKey = getBucketKey(point);
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        x: getLabel(point),
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      });
      order.push(bucketKey);
      return;
    }

    const bucket = buckets.get(bucketKey)!;
    bucket.high = Math.max(bucket.high, point.high);
    bucket.low = Math.min(bucket.low, point.low);
    bucket.close = point.close;
  });

  return order.map((key) => buckets.get(key)!);
}

function calcEmaSeries(values: number[], span: number): Array<number | null> {
  if (!values.length) return [];
  const alpha = 2 / (span + 1);
  const result: Array<number | null> = [];
  let ema: number | null = null;

  values.forEach((value, idx) => {
    if (idx === 0) {
      ema = value;
    } else if (ema !== null) {
      ema = value * alpha + ema * (1 - alpha);
    }

    result.push(idx >= span - 1 ? ema : null);
  });

  return result;
}

function TechnicalIndicatorsComponent({
  technicalData,
  optionsFlow,
  optionalityMetrics,
  flowEvents = [],
  priceHistory = [],
  intradayHistory2h = [],
  historyWindow = "252d",
  onHistoryWindowChange,
  hideOptionsContext = false,
  closeLabel = "Latest Close",
}: TechnicalIndicatorsProps) {
  const chartIdBase = `technical-${useId().replace(/:/g, "")}`;
  const priceChartRef = useRef<SVGSVGElement | null>(null);
  const [activeProxyClusterId, setActiveProxyClusterId] = useState<string | null>(null);

  if (!technicalData && !optionsFlow) {
    return (
      <div className="surface-card-strong p-4 sm:p-6 mb-6">
        <p className="text-stealth-400">Loading technical analysis...</p>
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
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
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
    <div className="secondary-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-stealth-400 font-semibold">Options Flow</p>
        {optionsFlow?.expiry && (
          <span className="text-xs text-stealth-500">Exp {formatExpiry(optionsFlow.expiry)}</span>
        )}
      </div>
      {optionsAvailable ? (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="secondary-card p-2">
              <p className="text-xs text-stealth-400 mb-1">Call wall (resistance)</p>
              <p className="text-sm font-bold text-green-400">
                ${callWall?.strike.toFixed(2)}
              </p>
              <p className="text-xs text-stealth-500">OI {formatCompact(callWall?.open_interest || 0)}</p>
              {callWall && (
                <p className="text-xs text-stealth-500">{formatDistance(callWall.strike)} vs price</p>
              )}
            </div>
            <div className="secondary-card p-2">
              <p className="text-xs text-stealth-400 mb-1">Put wall (support)</p>
              <p className="text-sm font-bold text-red-400">
                ${putWall?.strike.toFixed(2)}
              </p>
              <p className="text-xs text-stealth-500">OI {formatCompact(putWall?.open_interest || 0)}</p>
              {putWall && (
                <p className="text-xs text-stealth-500">{formatDistance(putWall.strike)} vs price</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div>
              <p className="text-stealth-400 mb-1">Top call walls</p>
              <div className="space-y-1">
                {(optionsFlow?.call_walls || []).slice(0, 3).map((wall) => (
                  <div key={`call-${wall.strike}`} className="flex items-center gap-1.5">
                    <span className="w-12 text-stealth-400">${wall.strike.toFixed(0)}</span>
                    <div className="flex-1 bg-stealth-800 rounded h-1">
                      <div
                        className="bg-green-500 h-1 rounded"
                        style={{ width: `${maxCallOi ? (wall.open_interest / maxCallOi) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-stealth-500">{formatCompact(wall.open_interest)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-stealth-400 mb-1">Top put walls</p>
              <div className="space-y-1">
                {(optionsFlow?.put_walls || []).slice(0, 3).map((wall) => (
                  <div key={`put-${wall.strike}`} className="flex items-center gap-1.5">
                    <span className="w-12 text-stealth-400">${wall.strike.toFixed(0)}</span>
                    <div className="flex-1 bg-stealth-800 rounded h-1">
                      <div
                        className="bg-red-500 h-1 rounded"
                        style={{ width: `${maxPutOi ? (wall.open_interest / maxPutOi) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-stealth-500">{formatCompact(wall.open_interest)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1 text-xs text-stealth-400">
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
              <span className="text-stealth-300">
                {optionsFlow?.put_call_oi_ratio !== null && optionsFlow?.put_call_oi_ratio !== undefined
                  ? optionsFlow.put_call_oi_ratio.toFixed(2)
                  : "n/a"}
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-stealth-400">Options flow data unavailable for this ticker.</p>
      )}
    </div>
  );

  if (!technicalData) {
    return (
      <div className="space-y-4 mb-6">
        <div className="surface-card-strong p-4 sm:p-6">
          <p className="text-stealth-400">Technical analysis unavailable for this ticker.</p>
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
  } = technicalData;

  // Calculate chart dimensions
  const chartWidth = 1000;
  const padding = { top: 20, right: 50, bottom: 40, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
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

  const scaleX = (index: number) => {
    return padding.left + (index / (candles.length - 1)) * plotWidth;
  };

  const volumes = candles
    .map((candle) => candle.volume)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const maxVolume = Math.max(...volumes, 0);

  const isShortView = historyWindow === "252d";

  const unifiedChartData: CandleChartPoint[] = (() => {
    if (isShortView && intradayHistory2h.length > 0) {
      return intradayHistory2h.map((point) => ({
        x: point.timestamp,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      }));
    }

    if (isShortView) {
      return priceHistory.map((point) => ({
        x: point.date,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      }));
    }

    if (historyWindow === "1y") {
      return priceHistory.map((point) => ({
        x: point.date,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      }));
    }

    if (historyWindow === "5y") {
      return aggregateCandles(
        priceHistory,
        (point) => {
          const date = new Date(point.date);
          const start = new Date(date);
          const day = start.getUTCDay();
          const offset = day === 0 ? -6 : 1 - day;
          start.setUTCDate(start.getUTCDate() + offset);
          return start.toISOString().slice(0, 10);
        },
        (point) => point.date
      );
    }

    return aggregateCandles(
      priceHistory,
      (point) => point.date.slice(0, 7),
      (point) => `${point.date.slice(0, 7)}-01`
    );
  })();

  const priceValues = unifiedChartData.flatMap((point) => [point.high, point.low]);
  const minPrice = priceValues.length ? Math.min(...priceValues) : 0;
  const maxPrice = priceValues.length ? Math.max(...priceValues) : 0;
  const priceRange = Math.max(maxPrice - minPrice, maxPrice * 0.02 || 1);
  const pricePadding = priceRange * 0.08;
  const priceChartHeight = 300;
  const pricePaddingBox = { top: 20, right: 50, bottom: 40, left: 50 };
  const pricePlotWidth = chartWidth - pricePaddingBox.left - pricePaddingBox.right;
  const pricePlotHeight = priceChartHeight - pricePaddingBox.top - pricePaddingBox.bottom;

  const scalePrice = (price: number) => {
    const normalized = (price - (minPrice - pricePadding)) / (priceRange + pricePadding * 2);
    return pricePaddingBox.top + (1 - normalized) * pricePlotHeight;
  };

  const scalePriceX = (index: number) => {
    if (unifiedChartData.length <= 1) return pricePaddingBox.left + pricePlotWidth / 2;
    return pricePaddingBox.left + (index / (unifiedChartData.length - 1)) * pricePlotWidth;
  };

  const sessionKeys: string[] = [];
  const sessionSequenceByDate = new Map<string, number>();
  const finalChartIndexByDate = new Map<string, number>();
  unifiedChartData.forEach((point, index) => {
    const dateKey = point.x.slice(0, 10);
    if (!sessionSequenceByDate.has(dateKey)) {
      sessionSequenceByDate.set(dateKey, sessionKeys.length);
      sessionKeys.push(dateKey);
    }
    // Daily proxy events represent the completed session, so intraday overlays
    // anchor once at that session's final visible candle instead of every candle.
    finalChartIndexByDate.set(dateKey, index);
  });

  const proxyClusters = isShortView
    ? buildProxyEventClusters(flowEvents, (event) => {
        const dateKey = event.date.slice(0, 10);
        const chartIndex = finalChartIndexByDate.get(dateKey);
        const sequence = sessionSequenceByDate.get(dateKey);
        if (chartIndex === undefined || sequence === undefined) return null;
        const y = scalePrice(event.price);
        if (
          y < pricePaddingBox.top ||
          y > priceChartHeight - pricePaddingBox.bottom
        ) {
          return null;
        }
        return { x: scalePriceX(chartIndex), y, sequence };
      })
    : [];
  const visibleProxyEvents = proxyClusters.flatMap((cluster) => cluster.events);
  const proxyEventCount = visibleProxyEvents.length;
  const proxyNotionalReference = percentile(
    visibleProxyEvents.map((event) => event.weight),
    0.75,
  );
  const medianClusterNotional = percentile(
    proxyClusters.map((cluster) => cluster.totalNotional),
    0.5,
  );
  const proxyClusterRank = new Map(
    [...proxyClusters]
      .sort((left, right) => right.totalNotional - left.totalNotional)
      .map((cluster, index) => [cluster.id, index + 1]),
  );

  const shortViewCloses = isShortView ? unifiedChartData.map((point) => point.close) : [];
  const ema50Series = isShortView ? calcEmaSeries(shortViewCloses, 50) : [];
  const ema200Series = isShortView ? calcEmaSeries(shortViewCloses, 200) : [];

  const candleIntervalLabel =
    historyWindow === "252d"
      ? intradayHistory2h.length > 0 ? "2H candles" : "Daily candles"
      : historyWindow === "1y" ? "Daily candles" : historyWindow === "5y" ? "Weekly candles" : "Monthly candles";
  const usesIntradayCandles = isShortView && intradayHistory2h.length > 0;
  const dailyDateOptions = { timeZone: "UTC" } as const;
  const proxyOverlayLabel =
    proxyEventCount === 0
      ? "0 proxy bars"
      : proxyEventCount === 1
        ? "1 proxy bar · notional-scaled"
        : `${proxyClusters.length} ${proxyClusters.length === 1 ? "cluster" : "clusters"} · ${proxyEventCount} bars · notional-scaled`;
  const proxyToneStyle: Record<
    ProxyClusterTone,
    { color: string; dash?: string; label: string }
  > = {
    buy: { color: statePalette.green, label: "Positive-bar" },
    sell: { color: statePalette.red, dash: "4 2", label: "Negative-bar" },
    neutral: { color: "#94a3b8", dash: "1 2", label: "Neutral" },
    mixed: { color: "#cbd5e1", dash: "2 2", label: "Mixed" },
  };

  const formatProxyDate = (date: string) => {
    const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };

  const proxyClusterDateRange = (cluster: (typeof proxyClusters)[number]) =>
    cluster.startDate === cluster.endDate
      ? formatProxyDate(cluster.startDate)
      : `${formatProxyDate(cluster.startDate)}–${formatProxyDate(cluster.endDate)}`;

  const proxyClusterMix = (cluster: (typeof proxyClusters)[number]) => {
    const buyCount = cluster.events.filter((event) => event.side === "buy").length;
    const sellCount = cluster.events.filter((event) => event.side === "sell").length;
    const neutralCount = cluster.events.length - buyCount - sellCount;
    return [
      buyCount ? `${buyCount} positive` : null,
      sellCount ? `${sellCount} negative` : null,
      neutralCount ? `${neutralCount} neutral` : null,
    ].filter(Boolean).join(", ");
  };

  const formatProxyClusterTitle = (cluster: (typeof proxyClusters)[number]) => {
    const dateRange = proxyClusterDateRange(cluster);
    const rank = proxyClusterRank.get(cluster.id) ?? proxyClusters.length;
    const relativeMultiple =
      medianClusterNotional > 0
        ? cluster.totalNotional / medianClusterNotional
        : 1;
    const mix = proxyClusterMix(cluster);

    return `${proxyToneStyle[cluster.tone].label} proxy cluster · ${dateRange} · ${cluster.events.length} qualifying ${cluster.events.length === 1 ? "bar" : "bars"} · ${formatCompact(cluster.totalNotional)} flagged-bar notional · ${relativeMultiple.toFixed(1)}× visible median · rank ${rank} of ${proxyClusters.length} · weighted price $${cluster.weightedPrice.toFixed(2)} · ${mix}`;
  };

  const activeProxyCluster =
    proxyClusters.find((cluster) => cluster.id === activeProxyClusterId) ?? null;
  const activeProxyClusterIndex = activeProxyCluster
    ? proxyClusters.findIndex((cluster) => cluster.id === activeProxyCluster.id)
    : -1;
  const activeProxyRelativeMultiple =
    activeProxyCluster && medianClusterNotional > 0
      ? activeProxyCluster.totalNotional / medianClusterNotional
      : 1;
  const activeProxyRank = activeProxyCluster
    ? proxyClusterRank.get(activeProxyCluster.id) ?? proxyClusters.length
    : null;
  const proxyTooltipWidth = 300;
  const proxyTooltipHeight = 68;
  const proxyTooltipXFor = (cluster: (typeof proxyClusters)[number]) =>
    Math.max(
      pricePaddingBox.left + 4,
      Math.min(
        chartWidth - pricePaddingBox.right - proxyTooltipWidth - 4,
        cluster.centerX + 12,
      ),
    );
  const proxyTooltipX = activeProxyCluster
    ? proxyTooltipXFor(activeProxyCluster)
    : 0;
  const proxyTooltipY = activeProxyCluster
    ? Math.max(
        pricePaddingBox.top + 4,
        Math.min(
          priceChartHeight - pricePaddingBox.bottom - proxyTooltipHeight - 4,
          activeProxyCluster.centerY - proxyTooltipHeight - 12,
        ),
      )
    : 0;

  const keepProxyTooltipVisible = (cluster: (typeof proxyClusters)[number]) => {
    const chart = priceChartRef.current;
    const scroller = chart?.closest<HTMLElement>(".data-scroller");
    if (
      !chart ||
      !scroller ||
      scroller.clientWidth <= 0 ||
      typeof scroller.scrollTo !== "function"
    ) {
      return;
    }

    const chartRect = chart.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    if (chartRect.width <= 0) return;

    const scale = chartRect.width / chartWidth;
    const chartContentLeft = chartRect.left - scrollerRect.left + scroller.scrollLeft;
    const tooltipLeft = chartContentLeft + proxyTooltipXFor(cluster) * scale;
    const tooltipRight = tooltipLeft + proxyTooltipWidth * scale;
    const visibleLeft = scroller.scrollLeft;
    const visibleRight = visibleLeft + scroller.clientWidth;
    const margin = 8;
    let nextScrollLeft = visibleLeft;

    if (tooltipLeft < visibleLeft + margin) {
      nextScrollLeft = tooltipLeft - margin;
    } else if (tooltipRight > visibleRight - margin) {
      nextScrollLeft = tooltipRight - scroller.clientWidth + margin;
    }

    const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const boundedScrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
    if (Math.abs(boundedScrollLeft - visibleLeft) > 1) {
      scroller.scrollTo({ left: boundedScrollLeft, behavior: "auto" });
    }
  };

  const moveActiveProxyCluster = (nextIndex: number) => {
    if (!proxyClusters.length) return;
    const boundedIndex = Math.max(0, Math.min(proxyClusters.length - 1, nextIndex));
    const nextCluster = proxyClusters[boundedIndex];
    setActiveProxyClusterId(nextCluster.id);
    keepProxyTooltipVisible(nextCluster);
  };

  const formatTick = (value: string) => {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    if (usesIntradayCandles) {
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    if (isShortView) {
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", ...dailyDateOptions });
    }
    if (historyWindow === "1y") {
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", ...dailyDateOptions });
    }
    if (historyWindow === "5y") {
      return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit", ...dailyDateOptions });
    }
    return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit", ...dailyDateOptions });
  };

  const formatLabel = (value: string) => {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    if (usesIntradayCandles) {
      return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
    return dt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...dailyDateOptions,
    });
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
      <div className="surface-card-strong p-4 sm:p-6">
        <div
          data-testid="price-history-header"
          className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <h3 className="text-base sm:text-lg font-semibold">Price History</h3>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <div className="text-xs leading-4 text-stealth-500 sm:whitespace-nowrap">
              {isShortView ? proxyOverlayLabel : candleIntervalLabel}
            </div>
            <div
              className="flex items-center gap-1 rounded-full border border-stealth-700 bg-stealth-900/70 p-0.5"
              role="group"
              aria-label="Price history window"
            >
              {([
                { value: "252d", label: "252D" },
                { value: "1y", label: "1Y" },
                { value: "5y", label: "5Y" },
                { value: "max", label: "Max" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onHistoryWindowChange?.(opt.value)}
                  aria-pressed={historyWindow === opt.value}
                  className={`min-h-11 min-w-11 rounded-full px-2 text-xs font-semibold uppercase tracking-[0.08em] ${
                    historyWindow === opt.value ? "bg-stealth-700 text-white" : "text-stealth-300 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DataScroller
          label="Price history chart"
          className="secondary-card mb-4 p-4"
          hint="Scroll horizontally to inspect the full price history."
        >
          {isShortView && proxyEventCount > 0 && (
            <p
              id={`${chartIdBase}-proxy-live`}
              data-testid="proxy-cluster-live-region"
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {activeProxyCluster
                ? formatProxyClusterTitle(activeProxyCluster)
                : `${proxyClusters.length} proximity ${proxyClusters.length === 1 ? "cluster" : "clusters"} contain ${proxyEventCount} qualifying bars. Focus the chart and use the arrow keys to inspect their relative size.`}
            </p>
          )}
          {unifiedChartData.length > 0 ? (
            <svg
              ref={priceChartRef}
              role="img"
              aria-labelledby={`${chartIdBase}-price-title ${chartIdBase}-price-desc`}
              aria-describedby={
                isShortView && proxyEventCount > 0
                  ? `${chartIdBase}-proxy-live`
                  : undefined
              }
              aria-keyshortcuts={
                isShortView && proxyEventCount > 0
                  ? "ArrowLeft ArrowRight ArrowUp ArrowDown Home End Escape"
                  : undefined
              }
              tabIndex={isShortView && proxyEventCount > 0 ? 0 : undefined}
              onFocus={() => {
                if (proxyClusters.length > 0 && activeProxyClusterIndex < 0) {
                  moveActiveProxyCluster(0);
                }
              }}
              onBlur={() => setActiveProxyClusterId(null)}
              onKeyDown={(event) => {
                if (!proxyClusters.length) return;
                const currentIndex = activeProxyClusterIndex >= 0
                  ? activeProxyClusterIndex
                  : 0;
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  moveActiveProxyCluster(currentIndex + 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveActiveProxyCluster(currentIndex - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  moveActiveProxyCluster(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  moveActiveProxyCluster(proxyClusters.length - 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setActiveProxyClusterId(null);
                }
              }}
              width="100%"
              height="100%"
              viewBox={`0 0 ${chartWidth} ${priceChartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-stealth-950"
              style={{ minWidth: "800px" }}
            >
              <title id={`${chartIdBase}-price-title`}>Price history</title>
              <desc id={`${chartIdBase}-price-desc`}>
                Price history for the selected {historyWindow} window. {closeLabel} is
                {" "}${technicalData.current_price.toFixed(2)} and the classified trend is
                {" "}{technicalData.trend}.
                {isShortView && proxyEventCount > 0
                  ? ` ${proxyEventCount} qualifying high-volume bars are grouped into ${proxyClusters.length} proximity clusters. Child bubble area scales to flagged-bar notional relative to the visible window; enclosing halos identify nearby bars without moving them from their observed date and price.`
                  : ""}
              </desc>
              <defs>
                <clipPath id={`${chartIdBase}-proxy-plot-clip`}>
                  <rect
                    x={pricePaddingBox.left}
                    y={pricePaddingBox.top}
                    width={pricePlotWidth}
                    height={pricePlotHeight}
                  />
                </clipPath>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((percent) => {
                const y = pricePaddingBox.top + percent * pricePlotHeight;
                const price = maxPrice + pricePadding - percent * (priceRange + pricePadding * 2);
                return (
                  <g key={`price-grid-${percent}`}>
                    <line
                      x1={pricePaddingBox.left}
                      y1={y}
                      x2={chartWidth - pricePaddingBox.right}
                      y2={y}
                      stroke={chartColors.grid}
                      strokeWidth="1"
                      strokeDasharray="4 4"
                    />
                    <text x={pricePaddingBox.left - 10} y={y + 4} fill={chartColors.tick} fontSize="12" textAnchor="end">
                      ${price.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {isShortView && ema50Series.some((value) => value !== null) && (
                <polyline
                  points={ema50Series
                    .map((value, idx) => value === null ? null : `${scalePriceX(idx)},${scalePrice(value)}`)
                    .filter((point): point is string => point !== null)
                    .join(" ")}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                />
              )}

              {isShortView && ema200Series.some((value) => value !== null) && (
                <polyline
                  points={ema200Series
                    .map((value, idx) => value === null ? null : `${scalePriceX(idx)},${scalePrice(value)}`)
                    .filter((point): point is string => point !== null)
                    .join(" ")}
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="1.5"
                />
              )}

              {unifiedChartData.map((candle, idx) => {
                const x = scalePriceX(idx);
                const openY = scalePrice(candle.open);
                const highY = scalePrice(candle.high);
                const lowY = scalePrice(candle.low);
                const closeY = scalePrice(candle.close);
                const isGreen = candle.close >= candle.open;
                const bodyTop = Math.min(openY, closeY);
                const bodyBottom = Math.max(openY, closeY);
                const bodyHeight = Math.max(bodyBottom - bodyTop, 1.5);
                const candleStep = unifiedChartData.length > 1 ? pricePlotWidth / (unifiedChartData.length - 1) : pricePlotWidth;
                const halfWidth = Math.max(1.5, Math.min(8, candleStep * (historyWindow === "252d" ? 0.28 : historyWindow === "1y" ? 0.32 : 0.4)));
                const color = isGreen ? chartColors.priceUp : chartColors.priceDown;

                return (
                  <g key={`${candle.x}-${idx}`}>
                    <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1" opacity="0.8" />
                    <rect
                      x={x - halfWidth}
                      y={bodyTop}
                      width={halfWidth * 2}
                      height={bodyHeight}
                      fill={color}
                      opacity="0.82"
                      rx="1"
                    />
                    <title>
                      {`${formatLabel(candle.x)} | O ${candle.open.toFixed(2)} H ${candle.high.toFixed(2)} L ${candle.low.toFixed(2)} C ${candle.close.toFixed(2)}`}
                    </title>
                  </g>
                );
              })}

              {isShortView && [...proxyClusters]
                .sort((left, right) => right.totalNotional - left.totalNotional)
                .map((cluster) => {
                  const halo = proxyClusterHalo(cluster, proxyNotionalReference);
                  const clusterStyle = proxyToneStyle[cluster.tone];
                  return (
                    <g
                      key={cluster.id}
                      data-testid="proxy-cluster"
                      data-cluster-events={cluster.events.length}
                      data-cluster-notional={cluster.totalNotional}
                      data-cluster-tone={cluster.tone}
                      data-active={activeProxyClusterId === cluster.id ? "true" : undefined}
                      role="presentation"
                      onPointerEnter={() => setActiveProxyClusterId(cluster.id)}
                      onPointerLeave={(event) => {
                        if (event.pointerType === "mouse") {
                          setActiveProxyClusterId(null);
                        }
                      }}
                      onPointerDown={() => {
                        setActiveProxyClusterId(cluster.id);
                        keepProxyTooltipVisible(cluster);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <title>{formatProxyClusterTitle(cluster)}</title>
                      {halo && (
                        <ellipse
                          data-testid="proxy-cluster-halo"
                          cx={halo.cx}
                          cy={halo.cy}
                          rx={halo.rx}
                          ry={halo.ry}
                          fill={clusterStyle.color}
                          fillOpacity="0.07"
                          stroke={clusterStyle.color}
                          strokeOpacity="0.72"
                          strokeWidth={activeProxyClusterId === cluster.id ? "1.8" : "1.2"}
                          strokeDasharray={clusterStyle.dash}
                          clipPath={`url(#${chartIdBase}-proxy-plot-clip)`}
                        />
                      )}
                      {cluster.events.map((event, eventIndex) => {
                        const radius = proxyEventRadius(
                          event.weight,
                          proxyNotionalReference,
                        );
                        const eventStyle = proxyToneStyle[event.side];
                        return (
                          <g
                            key={`${cluster.id}-${event.date}-${eventIndex}`}
                            data-testid="proxy-event-bubble"
                            data-event-side={event.side}
                            data-event-date={event.date}
                            data-event-price={event.price}
                            data-event-notional={event.weight}
                          >
                            <circle
                              cx={event.x}
                              cy={event.y}
                              r={radius + 1.4}
                              fill="none"
                              stroke={eventStyle.color}
                              strokeWidth="1"
                              strokeDasharray={eventStyle.dash}
                              strokeOpacity="0.72"
                            />
                            <circle
                              cx={event.x}
                              cy={event.y}
                              r={radius}
                              fill={eventStyle.color}
                              fillOpacity="0.72"
                              stroke="#f8fafc"
                              strokeOpacity="0.82"
                              strokeWidth="0.7"
                            />
                            <circle
                              cx={event.x}
                              cy={event.y}
                              r={Math.max(10, radius + 3)}
                              fill="transparent"
                              pointerEvents="all"
                            />
                          </g>
                        );
                      })}
                    </g>
                  );
                })}

              {isShortView && ema50Series.some((value) => value !== null) && (
                <text x={chartWidth - pricePaddingBox.right + 6} y={scalePrice(ema50Series.filter((value): value is number => value !== null).slice(-1)[0]) + 4} fill="#f59e0b" fontSize="12">
                  EMA50
                </text>
              )}
              {isShortView && ema200Series.some((value) => value !== null) && (
                <text x={chartWidth - pricePaddingBox.right + 6} y={scalePrice(ema200Series.filter((value): value is number => value !== null).slice(-1)[0]) - 4} fill="#a78bfa" fontSize="12">
                  EMA200
                </text>
              )}

              {(() => {
                const tickCount = Math.min(historyWindow === "252d" ? 10 : 8, unifiedChartData.length);
                const indices = new Set<number>();
                for (let i = 0; i < tickCount; i += 1) {
                  const idx = Math.round((i * Math.max(unifiedChartData.length - 1, 0)) / Math.max(tickCount - 1, 1));
                  indices.add(idx);
                }
                return Array.from(indices).map((idx) => {
                  const x = scalePriceX(idx);
                  const label = formatTick(unifiedChartData[idx].x);
                  return (
                    <text key={`tick-${idx}`} x={x} y={priceChartHeight - 14} fill={chartColors.tick} fontSize="12" textAnchor="middle">
                      {label}
                    </text>
                  );
                });
              })()}

              <line x1={pricePaddingBox.left} y1={pricePaddingBox.top} x2={pricePaddingBox.left} y2={priceChartHeight - pricePaddingBox.bottom} stroke={chartColors.axis} strokeWidth="2" />
              <line x1={pricePaddingBox.left} y1={priceChartHeight - pricePaddingBox.bottom} x2={chartWidth - pricePaddingBox.right} y2={priceChartHeight - pricePaddingBox.bottom} stroke={chartColors.axis} strokeWidth="2" />

              {activeProxyCluster && activeProxyRank !== null && (
                <g data-testid="proxy-cluster-tooltip" pointerEvents="none">
                  <rect
                    x={proxyTooltipX}
                    y={proxyTooltipY}
                    width={proxyTooltipWidth}
                    height={proxyTooltipHeight}
                    rx="7"
                    fill="#0f172a"
                    fillOpacity="0.97"
                    stroke={proxyToneStyle[activeProxyCluster.tone].color}
                    strokeWidth="1.2"
                  />
                  <text
                    x={proxyTooltipX + 10}
                    y={proxyTooltipY + 18}
                    fill="#f8fafc"
                    fontSize="12"
                    fontWeight="700"
                  >
                    {proxyToneStyle[activeProxyCluster.tone].label} · {proxyClusterDateRange(activeProxyCluster)} · {activeProxyCluster.events.length} {activeProxyCluster.events.length === 1 ? "bar" : "bars"}
                  </text>
                  <text
                    x={proxyTooltipX + 10}
                    y={proxyTooltipY + 37}
                    fill="#cbd5e1"
                    fontSize="12"
                  >
                    ${formatCompact(activeProxyCluster.totalNotional)} flagged · {activeProxyRelativeMultiple.toFixed(1)}× median · rank {activeProxyRank}/{proxyClusters.length}
                  </text>
                  <text
                    x={proxyTooltipX + 10}
                    y={proxyTooltipY + 56}
                    fill="#cbd5e1"
                    fontSize="12"
                  >
                    ${activeProxyCluster.weightedPrice.toFixed(2)} weighted price · {proxyClusterMix(activeProxyCluster)}
                  </text>
                </g>
              )}
            </svg>
          ) : (
            <div className="h-64 flex items-center justify-center text-xs text-stealth-400">
              No price history available for this window.
            </div>
          )}
        </DataScroller>

        {/* Price Info Row */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
          <div className="secondary-card p-2">
            <p className="text-stealth-400 mb-1">{closeLabel}</p>
            <p className="text-sm font-bold text-blue-300">${technicalData.current_price.toFixed(2)}</p>
          </div>
          <div className="secondary-card p-2">
            <p className="text-stealth-400 mb-1">52W High</p>
            <p className="text-sm font-bold text-green-400">${technicalData.high_52w.toFixed(2)}</p>
          </div>
          <div className="secondary-card p-2">
            <p className="text-stealth-400 mb-1">52W Low</p>
            <p className="text-sm font-bold text-red-400">${technicalData.low_52w.toFixed(2)}</p>
          </div>
          <div className="secondary-card p-2">
            <p className="text-stealth-400 mb-1">EMA50</p>
            <p className="text-sm font-bold text-amber-400">${technicalData.sma_50.toFixed(2)}</p>
          </div>
          <div className="secondary-card p-2">
            <p className="text-stealth-400 mb-1">EMA200</p>
            <p className="text-sm font-bold text-purple-400">
              {technicalData.sma_200 !== null ? `$${technicalData.sma_200.toFixed(2)}` : "n/a"}
            </p>
          </div>
          <div className="secondary-card p-2">
            <p className="text-stealth-400 mb-1">Trend</p>
            <p
              className={`text-sm font-bold capitalize ${
                technicalData.trend === "uptrend"
                  ? "text-green-400"
                  : technicalData.trend === "downtrend"
                    ? "text-red-400"
                    : "text-stealth-400"
              }`}
            >
              {technicalData.trend}
            </p>
          </div>
        </div>

      {/* MACD — moved above Volume/RSI */}
      <div className="secondary-card p-4 mt-4">
        <p className="text-xs text-stealth-400 mb-3 font-semibold">MACD</p>

        <DataScroller
          label="MACD chart"
          className="rounded-lg border border-stealth-800 bg-stealth-950/85 p-3"
          hint="Scroll horizontally to inspect the MACD, signal, and histogram history."
        >
          <svg
            role="img"
            aria-labelledby={`${chartIdBase}-macd-title ${chartIdBase}-macd-desc`}
            width="100%"
            height="100%"
            viewBox={`0 0 ${chartWidth} 200`}
            preserveAspectRatio="xMidYMid meet"
            style={{ minWidth: "800px" }}
          >
            <title id={`${chartIdBase}-macd-title`}>MACD history</title>
            <desc id={`${chartIdBase}-macd-desc`}>
              MACD, signal, and histogram history. Current MACD is {macd.current.toFixed(2)},
              signal is {macd.signal.toFixed(2)}, and status is {macd.status}.
            </desc>
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
                          fontSize="12"
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
        </DataScroller>

      </div>

      {/* Volume + RSI overlay (dual-axis) */}
      <div className="secondary-card p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-stealth-400 font-semibold">Volume &amp; RSI (14)</p>
          <div className="flex items-center gap-3 text-xs text-stealth-500">
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/60" /> Vol</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: "#a855f7" }} /> RSI</span>
            <span style={{ color: rsi.current > 70 ? "#f87171" : rsi.current < 30 ? "#4ade80" : "#eab308", fontWeight: 600 }}>
              RSI {rsi.current.toFixed(1)} · {rsi.status}
            </span>
          </div>
        </div>
        <DataScroller
          label="Volume and RSI chart"
          className="rounded-lg border border-stealth-800 bg-stealth-950/85 p-3"
          hint="Scroll horizontally to inspect volume and RSI history."
        >
          <svg
            role="img"
            aria-labelledby={`${chartIdBase}-volume-title ${chartIdBase}-volume-desc`}
            width="100%"
            height="100%"
            viewBox={`0 0 ${chartWidth} ${volumeChartHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ minWidth: "800px" }}
          >
            <title id={`${chartIdBase}-volume-title`}>Volume and RSI history</title>
            <desc id={`${chartIdBase}-volume-desc`}>
              Trading volume with 14-period relative strength. Current RSI is
              {" "}{rsi.current.toFixed(1)} and status is {rsi.status}.
            </desc>
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
                    fontSize="12"
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
                          fontSize="12"
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
        </DataScroller>
      </div>

      </div>

      {!hideOptionsContext && optionalityMetrics && (
        <OptionalityMispricingWidget metrics={optionalityMetrics} />
      )}
      {!hideOptionsContext && optionsFlowCard}
    </div>
  );
}

export const TechnicalIndicators = memo(TechnicalIndicatorsComponent);
