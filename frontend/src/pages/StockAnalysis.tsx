/**
 * Stock Analysis Page
 * 
 * Single stock lookup and analysis with multi-horizon outlook.
 * Allows users to search for any stock and view transparent scoring across time horizons.
 * 
 * Features:
 * - Stock ticker search and lookup
 * - Multi-horizon analysis: 3-month, 6-month, and 12-month outlooks
 * - Interactive chart with uncertainty cones
 * - Detailed scoring breakdown with conviction metrics
 * - Price analysis with take profit and stop loss targets
 * - Comparison against SPY benchmark
 */

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { PriceAnalysisChart } from "../components/widgets/PriceAnalysisChart";
import { ConvictionSnapshot } from "../components/widgets/ConvictionSnapshot";
import { TechnicalIndicators } from "../components/widgets/TechnicalIndicators.tsx";
import MarketLoading from "../components/ui/MarketLoading";
import "../index.css";
import { CHART_NEUTRAL } from "../utils/chartUtils";
import { getFamilyColor } from "../theme/metricColors";
import { apiFetch } from "../utils/apiUtils";
import { buildHolisticSummary } from "../utils/holisticSummary";
import type { SummaryInput } from "../types/holisticSummary";

interface StockProjection {
  ticker: string;
  name: string;
  horizon: string;
  score_total: number;
  score_trend: number;
  score_relative_strength: number;
  score_risk: number;
  score_regime: number;
  trailing_return_pct: number;
  volatility: number;
  max_drawdown: number;
  conviction: number;
  current_price: number;
  take_profit: number;
  stop_loss: number;
}

interface NewsArticle {
  id: number;
  symbol: string;
  sector?: string | null;
  title: string;
  link: string;
  source: string;
  published_at: string;
}

interface DataWarning {
  type: string;
  details?: any;
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

interface FundamentalPoint {
  date: string;
  value: number;
}

interface FundamentalSeries {
  series: FundamentalPoint[];
  derived?: boolean;
}

interface FundamentalsPayload {
  eps: FundamentalSeries;
  roe: FundamentalSeries;
  free_cash_flow: FundamentalSeries;
  market_cap: FundamentalSeries;
  pe_ratio: FundamentalSeries;
  revenue_yoy?: FundamentalSeries;
}

export default function StockAnalysis() {
  const [ticker, setTicker] = useState("");
  const [searchTicker, setSearchTicker] = useState("");
  const [projections, setProjections] = useState<Record<string, StockProjection>>({});
  const [technicalData, setTechnicalData] = useState<any>(null);
  const [optionsFlow, setOptionsFlow] = useState<OptionsFlowData | null>(null);
  const [optionalityMetrics, setOptionalityMetrics] = useState<OptionalityMetrics | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsPayload | null>(null);
  const [analystTarget, setAnalystTarget] = useState<number | null>(null);
  const [analystCount, setAnalystCount] = useState<number | null>(null);
  const [historicalScore, setHistoricalScore] = useState<number | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [dataWarnings, setDataWarnings] = useState<DataWarning[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [selectedHorizon, setSelectedHorizon] = useState<"T" | "3m" | "6m" | "12m">("12m");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [showSummaryDebug, setShowSummaryDebug] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return;

    setSearchTicker(ticker.toUpperCase());
    setLoading(true);
    setError(null);

    try {
      const projData = await apiFetch<any>(`/stocks/${ticker.toUpperCase()}/projections`);
      setProjections(projData.projections);
      setHistoricalScore(projData.historical?.score_3m_ago ?? null);
      setTechnicalData(projData.technical || null);
      setOptionsFlow(projData.options_flow || null);
      setOptionalityMetrics(projData.optionality || null);
      setFundamentals(projData.fundamentals || null);
      setAnalystTarget(projData.analyst_target ?? null);
      setAnalystCount(projData.analyst_count ?? null);
      setDataWarnings(projData.data_warnings || []);
      setLastUpdated(new Date().toISOString());
      setDataAsOf(projData.as_of_date || projData.created_at || null);

      // Fetch news filtered by ticker (server-side to avoid missing relevant articles)
      const tickerNews = await apiFetch<any[]>(`/news?hours=720&limit=50&symbol=${ticker.toUpperCase()}`).catch(() => null); // Last 30 days
      if (tickerNews) {
        setNews(tickerNews.slice(0, 10)); // Show top 10 articles
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch stock data");
      setProjections({});
      setHistoricalScore(null);
      setTechnicalData(null);
      setOptionsFlow(null);
      setOptionalityMetrics(null);
      setFundamentals(null);
      setAnalystTarget(null);
      setAnalystCount(null);
      setNews([]);
      setDataWarnings([]);
      setLastUpdated(null);
      setDataAsOf(null);
    } finally {
      setLoading(false);
    }
  };

  // Prepare data for line chart
  const getChartData = () => {
    const tScore = projections["T"]?.score_total;
    const score3m = projections["3m"]?.score_total;
    const score6m = projections["6m"]?.score_total;
    const score12m = projections["12m"]?.score_total;

    if (
      tScore === undefined ||
      score3m === undefined ||
      score6m === undefined ||
      score12m === undefined
    ) {
      return null;
    }

    return {
      ticker: searchTicker,
      name: projections["3m"].name,
      scores: {
        "T": tScore,
        "3m": score3m,
        "6m": score6m,
        "12m": score12m,
      },
    };
  };

  const chartData = getChartData();

  const isSelectedHorizon = (h: "T" | "3m" | "6m" | "12m") => selectedHorizon === h;

  // Format relative time for timestamps
  const getRelativeTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "1d ago";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatCompact = (value: number, digits = 1) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: digits,
    }).format(value);

  const formatDollars = (value: number, digits = 2) =>
    `$${value.toFixed(digits)}`;

  const formatPercent = (value: number, digits = 1) =>
    `${value.toFixed(digits)}%`;

  const formatDateLabel = (date: string) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  const calcSmaSeries = (values: number[], window: number) => {
    if (values.length < window) return Array(values.length).fill(null);
    const result: Array<number | null> = [];
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      sum += values[i];
      if (i >= window) {
        sum -= values[i - window];
      }
      result.push(i >= window - 1 ? sum / window : null);
    }
    return result;
  };

  const calcSlopeFromSeries = (series: Array<number | null>, window = 10) => {
    const values = series.filter((value): value is number => Number.isFinite(value));
    if (values.length <= window) return null;
    return (values[values.length - 1] - values[values.length - 1 - window]) / window;
  };

  const calcAtrSeries = (candles: Array<{ high: number; low: number; close: number }>, window = 14) => {
    if (candles.length < 2) return [];
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const prevClose = candles[i - 1].close;
      const highLow = candles[i].high - candles[i].low;
      const highClose = Math.abs(candles[i].high - prevClose);
      const lowClose = Math.abs(candles[i].low - prevClose);
      trs.push(Math.max(highLow, highClose, lowClose));
    }
    const atrs: Array<number | null> = Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < trs.length; i += 1) {
      sum += trs[i];
      if (i >= window) {
        sum -= trs[i - window];
      }
      if (i >= window - 1) {
        atrs[i + 1] = sum / window;
      }
    }
    return atrs;
  };

  const calcAverage = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  function buildSummaryInput(): SummaryInput | null {
    if (!searchTicker || !technicalData) return null;

    const candles = (technicalData.candles || []).map((c: any) => ({
      close: Number(c.close),
      high: Number(c.high),
      low: Number(c.low),
      volume: Number(c.volume ?? 0),
    }));
    if (!candles.length) return null;

    const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v));
    const ma50Series = calcSmaSeries(closes, 50);
    const ma200Series = calcSmaSeries(closes, 200);
    const ma50Slope = calcSlopeFromSeries(ma50Series);
    const ma200Slope = calcSlopeFromSeries(ma200Series);

    const rsiSeries = technicalData?.rsi?.series || [];
    const rsiSlope = calcSlopeFromSeries(rsiSeries);
    const macdHistSeries = technicalData?.macd?.histogram_series || [];
    const macdHistSlope = calcSlopeFromSeries(macdHistSeries);

    const atrSeries = calcAtrSeries(candles);
    const atrPctSeries = atrSeries.map((atr, idx) =>
      Number.isFinite(atr) && candles[idx] ? (atr as number) / candles[idx].close * 100 : null
    );
    const atrPctSlope = calcSlopeFromSeries(atrPctSeries);
    const atr14Pct = atrPctSeries.filter((value): value is number => Number.isFinite(value)).slice(-1)[0] ?? null;

    const volumes = candles.map((c) => c.volume).filter((v) => Number.isFinite(v) && v > 0);
    const currentVolume = volumes[volumes.length - 1];
    const avg20 = calcAverage(volumes.slice(-20));
    const volVs20 = Number.isFinite(currentVolume) && Number.isFinite(avg20) && avg20
      ? currentVolume / avg20
      : null;

    const recent20 = candles.slice(-20);
    const recent60 = candles.slice(-60);
    const support1 = recent20.length ? Math.min(...recent20.map((c) => c.low)) : null;
    const resistance1 = recent20.length ? Math.max(...recent20.map((c) => c.high)) : null;
    const support2 = recent60.length ? Math.min(...recent60.map((c) => c.low)) : null;
    const resistance2 = recent60.length ? Math.max(...recent60.map((c) => c.high)) : null;

    const mapSeries = (series?: FundamentalPoint[]) => ({
      values: series?.map((point) => point.value) ?? [],
      dates: series?.map((point) => point.date) ?? [],
    });

    const eps = mapSeries(fundamentals?.eps?.series);
    const roe = mapSeries(fundamentals?.roe?.series);
    const fcf = mapSeries(fundamentals?.free_cash_flow?.series);
    const mcap = mapSeries(fundamentals?.market_cap?.series);
    const pe = mapSeries(fundamentals?.pe_ratio?.series);
    const revenue = mapSeries(fundamentals?.revenue_yoy?.series);

    return {
      symbol: searchTicker,
      asOf: dataAsOf || new Date().toISOString(),
      technicals: {
        price: technicalData?.current_price ?? null,
        ma50: technicalData?.sma_50 ?? null,
        ma200: technicalData?.sma_200 ?? null,
        ma50_slope: ma50Slope,
        ma200_slope: ma200Slope,
        rsi14: technicalData?.rsi?.current ?? null,
        rsi14_slope: rsiSlope,
        macd: technicalData?.macd?.current ?? null,
        macd_signal: technicalData?.macd?.signal ?? null,
        macd_hist: technicalData?.macd?.histogram ?? null,
        macd_hist_slope: macdHistSlope,
        atr14_pct: atr14Pct,
        atr14_pct_slope: atrPctSlope,
        vol_vs_20d: volVs20,
        support1,
        support2,
        resistance1,
        resistance2,
      },
      fundamentals: {
        eps_series: eps.values,
        eps_dates: eps.dates,
        roe_series: roe.values,
        roe_dates: roe.dates,
        fcf_series: fcf.values,
        fcf_dates: fcf.dates,
        marketcap_series: mcap.values,
        marketcap_dates: mcap.dates,
        pe_series: pe.values,
        pe_dates: pe.dates,
        revenue_yoy_series: revenue.values,
        revenue_yoy_dates: revenue.dates,
      },
      options: {
        iv30: optionalityMetrics?.iv30 ?? null,
        hv30: optionalityMetrics?.hv30 ?? null,
        iv_percentile: optionalityMetrics?.iv_percentile ?? null,
        avg_edr: optionalityMetrics?.avg_edr ?? null,
      },
    };
  }

  const summaryInput = useMemo(
    () => buildSummaryInput(),
    [searchTicker, technicalData, fundamentals, optionalityMetrics, dataAsOf]
  );
  const holisticSummary = useMemo(
    () => (summaryInput ? buildHolisticSummary(summaryInput) : null),
    [summaryInput]
  );

  const derivedBadge = (
    <span className="ml-1 text-[10px] text-amber-300/90" title="Derived from reported filings">
      *
    </span>
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto text-gray-100">
      <h1 className="text-2xl font-bold mb-2">Stock Analysis</h1>
      <p className="mb-4 text-gray-400">Analyze individual stocks across multiple time horizons with quantified confidence levels</p>
      
      {/* Stock Search */}
      <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6 shadow-lg">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="e.g., AAPL, MSFT, TSLA"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 sm:py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition text-sm sm:text-base"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold transition whitespace-nowrap"
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </form>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6">
          <p className="text-red-300">{error}</p>
          <p className="text-sm text-red-400 mt-2">
            Please check the ticker symbol and try again. The stock must have sufficient historical data available.
          </p>
        </div>
      )}

      {/* Results */}
      {chartData && (
        <>
          {/* Fundamentals Summary */}
          {projections["T"] && (
            <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-4 shadow-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-xl font-bold">{chartData.ticker}</h2>
                    {lastUpdated && (
                      <span className="text-[10px] text-gray-500 bg-gray-900 px-2 py-0.5 rounded">
                        Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400">{chartData.name}</p>
                  {dataAsOf && (
                    <p className="text-xs text-gray-500 mt-1">
                      Market data as of {new Date(dataAsOf).toLocaleString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Current Price</p>
                  <p className="text-2xl font-bold text-blue-400">${projections["T"].current_price.toFixed(2)}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <div className="bg-gray-900 rounded p-3 border border-gray-700">
                  <p className="text-gray-400 mb-1">52W Range</p>
                  <p className="font-semibold">
                    {technicalData?.low_52w !== undefined && technicalData?.high_52w !== undefined
                      ? `$${Number(technicalData.low_52w).toFixed(2)} - $${Number(technicalData.high_52w).toFixed(2)}`
                      : "n/a"}
                  </p>
                </div>
                <div className="bg-gray-900 rounded p-3 border border-gray-700">
                  <p className="text-gray-400 mb-1">Trend</p>
                  <p
                    className={`font-semibold capitalize ${
                      technicalData?.trend === "uptrend"
                        ? "text-green-400"
                        : technicalData?.trend === "downtrend"
                          ? "text-red-400"
                          : "text-gray-300"
                    }`}
                  >
                    {technicalData?.trend ?? "n/a"}
                  </p>
                </div>
                <div className="bg-gray-900 rounded p-3 border border-gray-700">
                  <p className="text-gray-400 mb-1">Conviction</p>
                  <p className="font-semibold text-purple-300">{Math.round(projections["T"].conviction)}%</p>
                </div>
                <div className="bg-gray-900 rounded p-3 border border-gray-700">
                  <p className="text-gray-400 mb-1">Take Profit</p>
                  <p className="font-semibold text-green-400">${projections["T"].take_profit.toFixed(2)}</p>
                </div>
                <div className="bg-gray-900 rounded p-3 border border-gray-700">
                  <p className="text-gray-400 mb-1">Stop Loss</p>
                  <p className="font-semibold text-red-400">
                    ${Math.max(0, projections["T"].stop_loss).toFixed(2)}
                  </p>
                </div>
                <div className="bg-gray-900 rounded p-3 border border-gray-700">
                  <p className="text-gray-400 mb-1">Risk</p>
                  <p className="font-semibold text-gray-200">
                    Vol {projections["T"].volatility.toFixed(1)}% / DD {projections["T"].max_drawdown.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Price Analysis & Conviction Grid */}
          {projections[selectedHorizon] && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <PriceAnalysisChart
                currentPrice={projections[selectedHorizon].current_price}
                takeProfit={projections[selectedHorizon].take_profit}
                stopLoss={projections[selectedHorizon].stop_loss}
                trailingReturn={projections[selectedHorizon].trailing_return_pct}
                horizon={selectedHorizon.toUpperCase()}
                analystTarget={analystTarget}
                analystCount={analystCount}
              />
              <ConvictionSnapshot
                conviction={projections[selectedHorizon].conviction}
                score={projections[selectedHorizon].score_total}
                volatility={projections[selectedHorizon].volatility}
                horizon={selectedHorizon.toUpperCase()}
              />
            </div>
          )}

          {/* Technical Indicators */}
          {projections["T"] && (
            <TechnicalIndicators
              technicalData={technicalData}
              optionsFlow={optionsFlow}
              optionalityMetrics={optionalityMetrics}
            />
          )}

          {/* Fundamental Analysis */}
          {fundamentals && (
            <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base sm:text-lg font-semibold">Fundamental Analysis</h3>
                <span className="text-[10px] sm:text-xs text-gray-500">Up to 3 years (quarterly)</span>
              </div>
              <div className="text-[11px] text-gray-400 mb-4">
                Source: Yahoo Finance filings via yfinance. Cadence: quarterly. Coverage varies by metric.
                {" "}
                {[
                  { label: "EPS", series: fundamentals.eps?.series },
                { label: "ROE", series: fundamentals.roe?.series },
                { label: "FCF", series: fundamentals.free_cash_flow?.series },
                { label: "Rev YoY", series: fundamentals.revenue_yoy?.series },
                { label: "MCap", series: fundamentals.market_cap?.series },
                { label: "P/E", series: fundamentals.pe_ratio?.series },
              ]
                  .map((item) => `${item.label}: ${item.series?.length ?? 0}q`)
                  .join(" · ")}
                .
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    key: "eps",
                    title: "EPS",
                    series: fundamentals.eps?.series || [],
                    derived: fundamentals.eps?.derived,
                    color: getFamilyColor("equity"),
                    format: (value: number) => formatDollars(value, 2),
                    axis: (value: number) => formatDollars(value, 0),
                  },
                  {
                    key: "roe",
                    title: "ROE",
                    series: fundamentals.roe?.series || [],
                    derived: fundamentals.roe?.derived,
                    color: getFamilyColor("growth"),
                    format: (value: number) => formatPercent(value, 1),
                    axis: (value: number) => `${value.toFixed(0)}%`,
                  },
                  {
                    key: "free_cash_flow",
                    title: "Free Cash Flow",
                    series: fundamentals.free_cash_flow?.series || [],
                    derived: fundamentals.free_cash_flow?.derived,
                    color: getFamilyColor("liquidity"),
                    format: (value: number) => `$${formatCompact(value, 2)}`,
                    axis: (value: number) => formatCompact(value, 0),
                  },
                  {
                    key: "revenue_yoy",
                    title: "Revenue Growth (YoY)",
                    series: fundamentals.revenue_yoy?.series || [],
                    derived: fundamentals.revenue_yoy?.derived,
                    color: getFamilyColor("growth"),
                    format: (value: number) => formatPercent(value, 1),
                    axis: (value: number) => `${value.toFixed(0)}%`,
                  },
                  {
                    key: "market_cap",
                    title: "Market Cap",
                    series: fundamentals.market_cap?.series || [],
                    derived: fundamentals.market_cap?.derived,
                    color: getFamilyColor("financials"),
                    format: (value: number) => `$${formatCompact(value, 2)}`,
                    axis: (value: number) => formatCompact(value, 0),
                  },
                  {
                    key: "pe_ratio",
                    title: "PE Ratio",
                    series: fundamentals.pe_ratio?.series || [],
                    derived: fundamentals.pe_ratio?.derived,
                    color: getFamilyColor("sentiment"),
                    format: (value: number) => value.toFixed(1),
                    axis: (value: number) => value.toFixed(0),
                  },
                ].map((card) => (
                  <div key={card.key} className="bg-gray-900 rounded-lg border border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-gray-100">
                        {card.title}
                        {card.derived ? derivedBadge : null}
                      </div>
                      {card.series.length > 0 && (
                        <span className="text-[10px] text-gray-500">
                          {formatDateLabel(card.series[0].date)} → {formatDateLabel(card.series[card.series.length - 1].date)}
                        </span>
                      )}
                    </div>
                    {card.series.length > 1 ? (
                      <div className="h-36" style={{ minWidth: 0, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={card.series}>
                            <XAxis
                              dataKey="date"
                              tickFormatter={(value) => formatDateLabel(String(value))}
                              tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              tickFormatter={card.axis}
                              tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <Tooltip
                              formatter={(value) => card.format(Number(value))}
                              labelFormatter={(label) => `Quarter: ${formatDateLabel(String(label))}`}
                              contentStyle={{
                                background: "#111827",
                                border: "1px solid #374151",
                                borderRadius: "8px",
                                fontSize: "12px",
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke={card.color}
                              strokeWidth={2}
                              dot={{ r: 2 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">
                        {card.series.length === 1
                          ? `Latest: ${card.format(card.series[0].value)}`
                          : card.key === "revenue_yoy"
                            ? "Need at least 5 quarterly points to plot YoY growth."
                            : "No data available for this metric."}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Holistic Summary */}
          {holisticSummary && (
            <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base sm:text-lg font-semibold">Holistic Summary</h3>
                <span className="text-[10px] sm:text-xs text-gray-300 bg-gray-900 border border-gray-700 px-2 py-1 rounded-full">
                  {holisticSummary.regime}
                </span>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed mb-4">
                {holisticSummary.narrative}
              </p>
              <div className="space-y-2 text-sm text-gray-400">
                {holisticSummary.bullets.map((bullet) => (
                  <div key={bullet.axis}>
                    <span className="text-gray-500">{bullet.axis}:</span> {bullet.text}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-sm text-gray-400">
                <span className="text-gray-500">Watch:</span> {holisticSummary.watch}
              </div>
              {holisticSummary.debug && (
                <button
                  type="button"
                  onClick={() => setShowSummaryDebug((prev) => !prev)}
                  className="mt-3 text-xs text-blue-300 hover:text-blue-200 transition"
                >
                  {showSummaryDebug ? "Hide debug" : "Show debug"}
                </button>
              )}
              {showSummaryDebug && holisticSummary.debug && (
                <div className="mt-3 bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-gray-400 space-y-2">
                  {[
                    holisticSummary.debug.technical,
                    holisticSummary.debug.fundamental,
                    holisticSummary.debug.options,
                  ].map((axis) => (
                    <div key={axis.label}>
                      <span className="text-gray-500">{axis.label}:</span>{" "}
                      {axis.bias} · score {axis.score} · confidence {axis.confidence} · rules{" "}
                      {Array.isArray(axis.debug?.rules) ? axis.debug?.rules.join(", ") : "n/a"}
                    </div>
                  ))}
                  <div>
                    <span className="text-gray-500">Regime:</span>{" "}
                    {holisticSummary.debug.regime_matrix.key} ·{" "}
                    {holisticSummary.debug.regime_matrix.rationale.join("; ")}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Interactive Chart */}
          <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6">
            <h3 className="text-base sm:text-lg font-semibold mb-4">Score Trends</h3>
            <div className="bg-gray-900 rounded-lg p-2 sm:p-4 mb-2">
              <div className="w-full" style={{ aspectRatio: '3 / 1', maxHeight: '240px' }}>
                <svg width="100%" height="100%" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet">
                {/* Grid lines */}
                {[0, 25, 50, 75, 100].map((y) => (
                  <g key={y}>
                    <line x1="50" y1={260 - (y * 2.4)} x2="960" y2={260 - (y * 2.4)} stroke={CHART_NEUTRAL.grid} strokeWidth="1" strokeDasharray="4 4" />
                    <text x="40" y={264 - (y * 2.4)} fill={CHART_NEUTRAL.tick} fontSize="10" textAnchor="end">{y}</text>
                  </g>
                ))}
                
                {/* X-axis labels - simplified */}
                <text x="150" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">-3M</text>
                <text x="375" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">T</text>
                <text x="575" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">3M</text>
                <text x="750" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">6M</text>
                <text x="925" y="285" fill={CHART_NEUTRAL.tick} fontSize="11" textAnchor="middle" fontWeight="500">12M</text>
                
                {(() => {
                  const color = getFamilyColor("equity");
                  
                  // Calculate points - -3M is shown only when history exists
                  const hasHistory = historicalScore !== null;
                  const histScore = historicalScore ?? null;
                  
                  const xHist = 150;   // -3M
                  const yHist = hasHistory ? 260 - ((histScore as number) * 2.4) : 0;
                  const x0 = 375;      // Now (T)
                  const y0 = 260 - (chartData.scores["T"] * 2.4);
                  const x1 = 575;      // +3M
                  const y1 = 260 - (chartData.scores["3m"] * 2.4);
                  const x2 = 750;      // +6M
                  const y2 = 260 - (chartData.scores["6m"] * 2.4);
                  const x3 = 925;      // +12M
                  const y3 = 260 - (chartData.scores["12m"] * 2.4);
                  
                  // Calculate uncertainty cone (only for future projections starting from T)
                  const initialSigma = 2;
                  const sigma3m = 3;
                  const sigma6m = Math.abs(chartData.scores["6m"] - chartData.scores["3m"]) * 0.3 + 6;
                  const sigma12m = Math.abs(chartData.scores["12m"] - chartData.scores["6m"]) * 0.4 + 10;
                  
                  const upper0 = y0 - (initialSigma * 2.4);
                  const lower0 = y0 + (initialSigma * 2.4);
                  const upper1 = y1 - (sigma3m * 2.4);
                  const lower1 = y1 + (sigma3m * 2.4);
                  const upper2 = y2 - (sigma6m * 2.4);
                  const lower2 = y2 + (sigma6m * 2.4);
                  const upper3 = y3 - (sigma12m * 2.4);
                  const lower3 = y3 + (sigma12m * 2.4);
                  
                  // Historical path (solid, no cone, -3M to T)
                  const historicalPath = hasHistory
                    ? `
                      M ${xHist} ${yHist}
                      Q ${(xHist + x0) / 2} ${(yHist + y0) / 2}, ${x0} ${y0}
                    `
                    : null;
                  
                  // Future path - full (from T through all horizons)
                  // Path from T to 6M (solid, normal opacity)
                  const pathToSixMonth = `
                    M ${x0} ${y0}
                    L ${x1} ${y1}
                    Q ${(x1 + x2) / 2} ${(y1 + y2) / 2}, ${x2} ${y2}
                  `;
                  
                  // Path from 6M to 12M (fading segment)
                  const pathSixToTwelve = `
                    M ${x2} ${y2}
                    Q ${(x2 + x3) / 2} ${(y2 + y3) / 2}, ${x3} ${y3}
                  `;
                  
                  const conePathUpper = `
                    M ${x0} ${upper0}
                    L ${x1} ${upper1}
                    Q ${(x1 + x2) / 2} ${(upper1 + upper2) / 2}, ${x2} ${upper2}
                    Q ${(x2 + x3) / 2} ${(upper2 + upper3) / 2}, ${x3} ${upper3}
                  `;
                  
                  const conePathLower = `
                    M ${x0} ${lower0}
                    L ${x1} ${lower1}
                    Q ${(x1 + x2) / 2} ${(lower1 + lower2) / 2}, ${x2} ${lower2}
                    Q ${(x2 + x3) / 2} ${(lower2 + lower3) / 2}, ${x3} ${lower3}
                  `;
                  
                  return (
                    <g>
                      <defs>
                        <linearGradient id="stockGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor={color} stopOpacity="0.02" />
                          <stop offset="40%" stopColor={color} stopOpacity="0.08" />
                          <stop offset="100%" stopColor={color} stopOpacity="0.15" />
                        </linearGradient>
                        <linearGradient id="lineFadeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                          <stop offset="100%" stopColor={color} stopOpacity="0.15" />
                        </linearGradient>
                      </defs>
                      
                      {/* Historical line (solid, brighter, -3M to T) */}
                      {historicalPath && (
                        <path 
                          d={historicalPath} 
                          stroke={color} 
                          strokeWidth="3" 
                          fill="none" 
                          opacity={0.9}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                      
                      {/* Uncertainty cone */}
                      <path
                        d={`${conePathUpper} L ${x3} ${lower3} Q ${(x2 + x3) / 2} ${(lower2 + lower3) / 2}, ${x2} ${lower2} Q ${(x1 + x2) / 2} ${(lower1 + lower2) / 2}, ${x1} ${lower1} L ${x0} ${lower0} Z`}
                        fill="url(#stockGradient)"
                        opacity={0.5}
                      />
                      
                      {/* Cone boundaries */}
                      <path 
                        d={conePathUpper}
                        stroke={color}
                        strokeWidth="1"
                        fill="none"
                        opacity={0.3}
                        strokeDasharray="3 3"
                      />
                      <path 
                        d={conePathLower}
                        stroke={color}
                        strokeWidth="1"
                        fill="none"
                        opacity={0.3}
                        strokeDasharray="3 3"
                      />
                      
                      {/* Future projection line T to 6M (normal opacity) */}
                      <path 
                        d={pathToSixMonth} 
                        stroke={color} 
                        strokeWidth="3.5" 
                        fill="none" 
                        opacity={0.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
                      {/* Future projection line 6M to 12M (fading into cone) */}
                      <path 
                        d={pathSixToTwelve} 
                        stroke="url(#lineFadeGradient)" 
                        strokeWidth="3.5" 
                        fill="none" 
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      
                      {/* Vertical "Now" line */}
                      <line 
                        x1={x0} 
                        y1={20} 
                        x2={x0} 
                        y2={280} 
                        stroke={getFamilyColor("benchmark")} 
                        strokeWidth="2" 
                        strokeDasharray="5 5"
                        opacity={0.5}
                      />
                      
                      {/* Points - 5 data points */}
                      {hasHistory && (
                        <circle cx={xHist} cy={yHist} r="4" fill={color} opacity={0.7} />
                      )}
                      <circle cx={x0} cy={y0} r="6" fill={color} opacity={0.9} stroke={getFamilyColor("benchmark")} strokeWidth="2" />
                      <circle cx={x1} cy={y1} r="5" fill={color} opacity={0.8} />
                      <circle cx={x2} cy={y2} r="5" fill={color} opacity={0.6} />
                      <circle cx={x3} cy={y3} r="5" fill={color} opacity={0.3} />
                    </g>
                  );
                })()}
              </svg>
              </div>
            </div>
          </div>

          {/* Score Breakdown Tables - Conditional based on selected horizon */}
          <div className="space-y-6">
            {selectedHorizon === "T" && projections["3m"] && (
              <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Current Position</h3>
                  
                  {/* Horizon Selector */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedHorizon("T")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("T")
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      Now
                    </button>
                    <button
                      onClick={() => setSelectedHorizon("3m")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("3m")
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      T+3M
                    </button>
                    <button
                      onClick={() => setSelectedHorizon("6m")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("6m")
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      T+6M
                    </button>
                    <button
                      onClick={() => setSelectedHorizon("12m")}
                      className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                        isSelectedHorizon("12m")
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      T+12M
                    </button>
                  </div>
                </div>
                <div className="text-gray-400 text-xs sm:text-sm">
                  Current score reflects real-time positioning. Select a future horizon to view the outlook.
                </div>
              </div>
            )}
            
            {selectedHorizon !== "T" && (() => {
              const projection = projections[selectedHorizon];
              if (!projection) return null;

              return (
                <div key={selectedHorizon} className="bg-gray-800 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">{selectedHorizon.toUpperCase()} Outlook</h3>
                    
                    {/* Horizon Selector */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedHorizon("T")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("T")
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        Now
                      </button>
                      <button
                        onClick={() => setSelectedHorizon("3m")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("3m")
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        T+3M
                      </button>
                      <button
                        onClick={() => setSelectedHorizon("6m")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("6m")
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        T+6M
                      </button>
                      <button
                        onClick={() => setSelectedHorizon("12m")}
                        className={`px-4 py-2 rounded text-xs sm:text-sm font-medium transition min-h-10 ${
                          isSelectedHorizon("12m")
                            ? "bg-blue-600 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        T+12M
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
                    <div className="bg-gray-900 rounded p-4">
                      <div className="text-xs sm:text-sm text-gray-400 mb-1">Total Score</div>
                      <div className="text-2xl sm:text-3xl font-bold text-blue-400">{Math.round(projection.score_total)}</div>
                    </div>
                    <div className="bg-gray-900 rounded p-4">
                      <div className="text-xs sm:text-sm text-gray-400 mb-1">Score Change</div>
                      <div className={`text-2xl sm:text-3xl font-bold ${
                        projection.score_total >= projections["3m"].score_total ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {projection.score_total >= projections["3m"].score_total ? '+' : ''}
                        {(projection.score_total - projections["3m"].score_total).toFixed(1)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-gray-400 w-24 sm:w-32 truncate">Trend (45%)</span>
                      <div className="flex-1 bg-gray-700 rounded h-3">
                        <div 
                          className="bg-yellow-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_trend}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_trend)}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-gray-400 w-24 sm:w-32 truncate">Rel. Strength (30%)</span>
                      <div className="flex-1 bg-gray-700 rounded h-3">
                        <div 
                          className="bg-lime-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_relative_strength}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_relative_strength)}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-gray-400 w-24 sm:w-32 truncate">Risk (20%)</span>
                      <div className="flex-1 bg-gray-700 rounded h-3">
                        <div 
                          className="bg-red-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_risk}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_risk)}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <span className="text-gray-400 w-24 sm:w-32 truncate">Regime (5%)</span>
                      <div className="flex-1 bg-gray-700 rounded h-3">
                        <div 
                          className="bg-indigo-500 h-3 rounded transition-all"
                          style={{ width: `${projection.score_regime}%` }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm font-semibold w-10 sm:w-12 text-right">{Math.round(projection.score_regime)}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm">
                    <div>
                      <span className="text-gray-400">Volatility:</span>
                      <span className="ml-2 font-semibold">{projection.volatility.toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Max Drawdown:</span>
                      <span className="ml-2 font-semibold text-red-400">{projection.max_drawdown.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Recent News */}
          {news.length > 0 && (
            <div className="mt-6 bg-gray-800 rounded-lg shadow p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base sm:text-lg font-semibold">Recent News for {searchTicker}</h2>
                {lastUpdated && (
                  <span className="text-[10px] text-gray-500">
                    Updated {getRelativeTime(lastUpdated)}
                  </span>
                )}
              </div>
              <div className="space-y-2 sm:space-y-3">
                {news.map((article) => (
                  <a
                    key={article.id}
                    href={article.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-gray-900 rounded-lg p-3 sm:p-4 min-h-20 sm:min-h-24 hover:bg-gray-850 transition-colors border border-gray-700 hover:border-blue-500/50"
                  >
                    <h3 className="text-xs sm:text-sm font-semibold text-blue-400 mb-2 line-clamp-2">
                      {article.title}
                    </h3>
                    <div className="flex items-center justify-between text-xs text-gray-400 gap-2">
                      <span className="font-medium truncate">{article.source}</span>
                      <span className="whitespace-nowrap">
                        {getRelativeTime(article.published_at)}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Understanding the Analysis */}
          <div className="mt-6 bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 sm:p-4">
            <h3 className="text-xs sm:text-sm font-semibold text-blue-200 mb-2">Understanding the Analysis</h3>
            <div className="text-xs text-blue-200/80 space-y-1 sm:space-y-2 leading-relaxed">
              <p><strong>Score (0-100):</strong> Higher scores indicate stronger technical outlook.</p>
              <p><strong>Score Change:</strong> Shows whether the outlook is improving (+) or deteriorating (-) over time.</p>
              <p><strong>Uncertainty Cone:</strong> Tighter cones = higher confidence. Wider cones = greater uncertainty.</p>
              <p><strong>Conviction:</strong> Confidence level in the analysis (0-100). Based on signal alignment, volatility, and score strength.</p>
              <p><strong>Price Targets:</strong> Take Profit and Stop Loss levels calculated from volatility-adjusted returns and risk metrics.</p>
            </div>
          </div>

        {dataWarnings.length > 0 && (
          <div className="mt-6 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-yellow-200/90 leading-relaxed">
              <strong>Data Warning:</strong> Recent analysis snapshots contain data quality flags that may reduce accuracy.
            </p>
            {dataWarnings.length > 0 && (
              <p className="mt-1 text-xs text-yellow-200/80">
                {dataWarnings.map(w => w.type.replace(/_/g, " ")).join(", ")}
              </p>
            )}
          </div>
        )}

          {/* Methodology */}
          <div className="mt-6 bg-gray-800 rounded-lg shadow">
            <button
              onClick={() => setMethodologyOpen(!methodologyOpen)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-750 transition-colors rounded-lg"
            >
              <h2 className="text-lg font-semibold">Methodology & Scoring Details</h2>
              <div className="text-lg font-bold text-gray-500">
                {methodologyOpen ? '-' : '+'}
              </div>
            </button>
            {methodologyOpen && (
              <div className="px-6 pb-6 text-sm text-gray-300 space-y-4">
                <p>
                  Stock analysis uses the same transparent scoring methodology as sector analysis, 
                  evaluating performance across 3-month, 6-month, and 12-month lookback periods.
                </p>
                <div className="bg-gray-900 rounded p-4">
                  <h4 className="font-semibold mb-2">Scoring Components</h4>
                  <ul className="space-y-2 text-xs">
                    <li><strong>Trend (45%):</strong> Price momentum and technical positioning relative to moving averages</li>
                    <li><strong>Relative Strength (30%):</strong> Outperformance vs SPY benchmark</li>
                    <li><strong>Risk (20%):</strong> Volatility and drawdown analysis (inverted scoring)</li>
                    <li><strong>Regime (5%):</strong> Context-aware adjustments based on market environment</li>
                  </ul>
                </div>
                <div className="bg-gray-900 rounded p-4">
                  <h4 className="font-semibold mb-2">Conviction Metric</h4>
                  <p className="text-xs mb-2">
                    Measures confidence in the analysis (0-100) based on three factors:
                  </p>
                  <ul className="space-y-1 text-xs">
                    <li>- <strong>Component Alignment (40%):</strong> How well the scoring components agree with each other</li>
                    <li>- <strong>Volatility Factor (35%):</strong> Lower volatility = higher conviction in the analysis</li>
                    <li>- <strong>Signal Strength (25%):</strong> How far the score deviates from neutral (50 = stronger signal)</li>
                  </ul>
                </div>
                <div className="bg-gray-900 rounded p-4">
                  <h4 className="font-semibold mb-2">Price Targets</h4>
                  <ul className="space-y-2 text-xs">
                    <li><strong>Take Profit:</strong> Calculated from projected return with volatility and horizon adjustments. Represents upside potential.</li>
                    <li><strong>Stop Loss:</strong> Based on volatility (ATR), risk score, and time horizon. Defines acceptable downside risk.</li>
                    <li><strong>Risk/Reward Ratio:</strong> Take Profit upside divided by Stop Loss downside. Higher is better.</li>
                  </ul>
                </div>
                <div className="bg-gray-900 rounded p-4">
                  <h4 className="font-semibold mb-2">Uncertainty Cones</h4>
                  <p className="text-xs">
                    The expanding cone represents confidence intervals. Width increases with forecast horizon, 
                    reflecting growing uncertainty. Narrower cones indicate more predictable price behavior.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Disclaimer */}
          <div className="mt-6 bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
            <p className="text-xs text-yellow-200/90 leading-relaxed">
              <strong>Disclaimer:</strong> These analysis signals are theoretical models for educational and informational purposes only. 
              They are not financial advice, investment recommendations, or guarantees of future performance. 
              Past performance does not indicate future results. Always conduct your own research and consult with a qualified 
              financial advisor before making investment decisions.
            </p>
          </div>
        </>
      )}

      {loading && (
        <div className="bg-gray-800 rounded-lg p-12 flex justify-center">
          <MarketLoading size={110} variant="scan" label="Analyzing stock..." />
        </div>
      )}

      {/* Empty State */}
      {!chartData && !loading && !error && (
        <div className="bg-gray-800 rounded-lg p-12 text-center">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-lg font-semibold mb-2">Search for a stock to get started</p>
            <p className="text-sm">Enter any stock ticker to analyze its multi-horizon outlook</p>
          </div>
        </div>
      )}
    </div>
  );
}
