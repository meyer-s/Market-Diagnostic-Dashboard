/**
 * Market Map Component
 * 
 * Displays a comprehensive visualization of S&P 500 stock performance organized by sector.
 * This component provides a "heat map" style view where stocks are represented as bubbles
 * positioned vertically based on their performance, sized by trading volume, and colored
 * by performance magnitude.
 * 
 * Features:
 * - Real-time S&P 500 stock data (450+ stocks across 11 sectors)
 * - Intraday SPY performance chart (5-minute intervals)
 * - Interactive bubble visualization with vertical positioning by % change
 * - Dynamic Y-axis scaling per sector for optimal visibility
 * - Volume-based bubble sizing
 * - Performance-based color gradients
 * - Click to open Yahoo Finance page
 * - NASDAQ-100 tickers shown by default, others on hover
 * 
 * Performance Characteristics:
 * - Initial load: ~15-30 seconds (fetches all stock data)
 * - Cached loads: <1 second
 * - Auto-refresh: Every 5 minutes
 * 
 * Layout:
 * 1. Header with description
 * 2. Intraday SPY chart (5-min intervals, last 5 days)
 * 3. Grid of sector cards with bubble visualizations
 * 
 * @component
 * @example
 * <MarketMap />
 * 
 * @author Market Diagnostic Dashboard
 * @version 2.0.0
 * @since 2025-12-18
 */

import { useEffect, useMemo, useState } from "react";
import MarketLoading from "../components/ui/MarketLoading";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { formatDateTimeWithWeekday } from "../utils/styleUtils";
import { CHART_MARGIN, CHART_NEUTRAL } from "../utils/chartUtils";
import { apiFetch } from "../utils/apiUtils";
import { getFamilyColor, statePalette } from "../theme/metricColors";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Individual stock data point
 */
interface StockData {
  ticker: string;      // Stock symbol (e.g., 'AAPL')
  price: number;       // Current price in USD
  pct_change: number;  // Percentage change from previous close
  volume: number;      // Trading volume
  market_cap: number;  // Rough estimate: volume * price
}

/**
 * Sector grouping with aggregated data
 */
interface SectorData {
  name: string;          // Sector name (e.g., 'Technology', 'Financials')
  pct_change: number;    // Average performance of all stocks in sector
  stocks: StockData[];   // Array of individual stock data
}

/**
 * Daily performance summary for SPY
 */
interface WeekPerformance {
  date: string;        // ISO date string
  day_name: string;    // Day of week (Monday, Tuesday, etc.)
  close: number;       // Closing price
  pct_change: number;  // Daily percentage change
}

/**
 * Intraday 15-minute data point for major indices
 */
interface IntradayData {
  timestamp: string;   // ISO timestamp
  date: string;        // Date portion only
  day_name: string;    // Day of week
  price: number;       // Price at this interval
  pct_change: number;  // % change from day's open
  hour: number;        // Hour of trading day (9-16)
  index: string;       // Index identifier: 'SPY', 'DJI', or 'RTY'
}

/**
 * Combined intraday data point for charting multiple indices together
 */
interface IntradaySeriesPoint {
  timestamp: string;
  SPY?: number;
  DJI?: number;
  RTY?: number;
}

interface SectorProjection {
  sector_symbol: string;
  score_total: number;
}

/**
 * Complete market map data structure
 */
interface MarketMapData {
  week_performance: WeekPerformance[];  // Daily summaries
  sectors: SectorData[];                // All sector data
}

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

/** Auto-refresh interval in milliseconds (5 minutes) */
const REFRESH_INTERVAL = 300000;

/** NASDAQ-100 constituent tickers - these show labels by default to reduce clutter */
const NASDAQ_100_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'COST',
  'NFLX', 'AMD', 'PEP', 'ADBE', 'CSCO', 'TMUS', 'INTC', 'CMCSA', 'TXN', 'QCOM',
  'INTU', 'HON', 'AMAT', 'SBUX', 'ISRG', 'BKNG', 'AMGN', 'ADI', 'PANW', 'VRTX',
  'ADP', 'GILD', 'MDLZ', 'LRCX', 'REGN', 'MU', 'PYPL', 'SNPS', 'KLAC', 'CDNS',
  'MELI', 'CRWD', 'MAR', 'ABNB', 'ORLY', 'CTAS', 'MRVL', 'CSX', 'DASH', 'FTNT',
  'ADSK', 'NXPI', 'ASML', 'ROP', 'WDAY', 'PAYX', 'PCAR', 'AEP', 'ROST', 'ODFL',
  'MNST', 'CHTR', 'CPRT', 'FAST', 'KDP', 'EA', 'BKR', 'TEAM', 'VRSK', 'DXCM',
  'CTSH', 'KHC', 'IDXX', 'LULU', 'GEHC', 'EXC', 'CCEP', 'XEL', 'ZS', 'ON',
  'CSGP', 'TTWO', 'ANSS', 'DDOG', 'CDW', 'BIIB', 'ILMN', 'GFS', 'WBD', 'MDB',
  'MRNA', 'WBA', 'SMCI', 'ARM', 'DLTR', 'FANG', 'ALGN', 'ZM', 'SIRI', 'LCID'
];

const withAlpha = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized.length === 3
    ? normalized.split("").map((ch) => ch + ch).join("")
    : normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const MarketMap = () => {
  // State management
  const [data, setData] = useState<MarketMapData | null>(null);
  const [intradayData, setIntradayData] = useState<IntradayData[]>([]);
  const [sectorProjections, setSectorProjections] = useState<Record<string, SectorProjection[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Map sector names to ETF symbols
  const sectorToEtf: Record<string, string> = {
    'Technology': 'XLK',
    'Financials': 'XLF',
    'Health Care': 'XLV',
    'Consumer Discretionary': 'XLY',
    'Industrials': 'XLI',
    'Energy': 'XLE',
    'Consumer Staples': 'XLP',
    'Utilities': 'XLU',
    'Materials': 'XLB',
    'Real Estate': 'XLRE',
    'Communication Services': 'XLC',
  };

  /**
   * Fetch market map data from backend API
   */
  const fetchData = async () => {
    try {
      const [mapResult, intradayResult] = await Promise.all([
        apiFetch<MarketMapData>("/market-map/data?days=5"),
        apiFetch<{ data: IntradayData[] }>("/market-map/spy-intraday"),
      ]);
      const projectionsResult = await apiFetch<{ projections: Record<string, SectorProjection[]> }>("/sectors/projections/latest").catch(() => null);

      setData(mapResult);
      setIntradayData(intradayResult.data || []);
      setSectorProjections(projectionsResult?.projections || null);
    } catch (error) {
      console.error("Error fetching market map:", error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  /**
   * Data Fetching Effect
   * Fetches market data on mount and sets up auto-refresh interval
   */
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, []);

  const intradaySeries = useMemo<IntradaySeriesPoint[]>(() => {
    if (!intradayData.length) return [];

    const byTimestamp = new Map<string, IntradaySeriesPoint>();
    intradayData.forEach((point) => {
      const existing = byTimestamp.get(point.timestamp) ?? { timestamp: point.timestamp };
      if (point.index === "SPY") {
        existing.SPY = point.pct_change;
      } else if (point.index === "DJI") {
        existing.DJI = point.pct_change;
      } else if (point.index === "RTY") {
        existing.RTY = point.pct_change;
      }
      byTimestamp.set(point.timestamp, existing);
    });

    return Array.from(byTimestamp.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [intradayData]);

  const orderedWeekPerformance = useMemo<WeekPerformance[]>(() => {
    if (!data?.week_performance?.length) return [];

    const sorted = [...data.week_performance].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return sorted.length > 5 ? sorted.slice(-5) : sorted;
  }, [data]);

  const lastCommonTimestampMs = useMemo(() => {
    if (!intradayData.length) return null;

    const latestByIndex: Record<string, number> = {
      SPY: 0,
      DJI: 0,
      RTY: 0
    };

    intradayData.forEach((point) => {
      const time = new Date(point.timestamp).getTime();
      if (point.index in latestByIndex && time > latestByIndex[point.index]) {
        latestByIndex[point.index] = time;
      }
    });

    const latestTimes = Object.values(latestByIndex).filter((time) => time > 0);
    if (latestTimes.length < 3) {
      return null;
    }

    return Math.min(...latestTimes);
  }, [intradayData]);

  const intradaySeriesAligned = useMemo<IntradaySeriesPoint[]>(() => {
    if (!intradaySeries.length) return [];
    if (!lastCommonTimestampMs) return intradaySeries;
    return intradaySeries.filter(
      (point) => new Date(point.timestamp).getTime() <= lastCommonTimestampMs
    );
  }, [intradaySeries, lastCommonTimestampMs]);

  /**
   * Manual refresh handler - forces immediate data reload
   */
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <MarketLoading size={120} variant="scan" label="Loading market map..." />
      </div>
    );
  }

  if (!data || !data.sectors || data.sectors.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-stealth-400">
          {!data ? 'No data available' : 'No sectors found'}
          <div className="text-xs mt-2">
            {data && JSON.stringify(Object.keys(data))}
          </div>
        </div>
      </div>
    );
  }

  // Calculate total volume for scaling
  const totalVolume = data.sectors.reduce((sum, sector) => {
    return sum + sector.stocks.reduce((s, stock) => s + stock.volume, 0);
  }, 0);

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  /**
   * Convert percentage change to Y-axis position
   * 
   * Maps a stock's percentage change to a vertical position within the chart container.
   * Uses dynamic min/max range per sector for optimal visibility of relative performance.
   * 
   * @param pct - Stock's percentage change (-100 to +100)
   * @param containerHeight - Height of the container in percentage (typically 100)
   * @param minPct - Minimum percentage in the sector (e.g., -5.2%)
   * @param maxPct - Maximum percentage in the sector (e.g., +8.3%)
   * @returns Y position as percentage (0 = top, 100 = bottom)
   * 
   * @example
   * // For a sector with range -3% to +7%, a stock at +2%:
   * percentToYPosition(2, 100, -3, 7) // Returns ~50 (middle)
   */
  const percentToYPosition = (pct: number, containerHeight: number, minPct: number, maxPct: number): number => {
    const range = maxPct - minPct;
    // Normalize: 0 at top (maxPct), 1 at bottom (minPct)
    const normalized = (maxPct - pct) / range;
    return normalized * containerHeight;
  };

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <div className="p-3 md:p-6 space-y-3 md:space-y-6">
      {/* =================================================================
          HEADER SECTION
          ================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-stealth-100">Market Map</h1>
          <p className="text-xs sm:text-sm text-stealth-400 mt-1">
            S&P 500 sector performance - bubble size represents trading volume
          </p>
        </div>
        
        {/* Refresh Button */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium text-xs sm:text-sm transition whitespace-nowrap ${
            isRefreshing
              ? 'bg-stealth-700 text-stealth-400 cursor-not-allowed'
              : 'bg-stealth-700 text-stealth-200 hover:bg-stealth-600 hover:text-stealth-100'
          }`}
          title="Refresh market data"
        >
          <svg
            className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span className="hidden xs:inline">{isRefreshing ? 'Refreshing...' : 'Refresh Data'}</span>
          <span className="xs:hidden">{isRefreshing ? 'Loading...' : 'Refresh'}</span>
        </button>
      </div>

      {/* =================================================================
          INTRADAY MAJOR INDICES CHART
          Shows 5-minute interval price action for SPY, DJI, RTY across last 5 trading days
          ================================================================= */}
      <div className="bg-stealth-800 rounded-lg p-3 md:p-6 border border-stealth-700">
        <h2 className="text-base md:text-lg font-semibold text-stealth-200 mb-2">Major Indices Intraday (5 min)</h2>
        <p className="text-stealth-400 text-xs mb-3 md:mb-4">SPY (S&P 500), DJI (Dow Jones), RTY (Russell 2000)</p>
        <div className="h-48 sm:h-64">
          {intradaySeriesAligned.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={intradaySeriesAligned} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                <XAxis
                  dataKey="timestamp"
                  type="category"
                  allowDuplicatedCategory={false}
                  hide={true}
                />
                <YAxis
                  tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
                  stroke={CHART_NEUTRAL.axis}
                  tickFormatter={(value) => `${value.toFixed(1)}%`}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: CHART_NEUTRAL.tooltipBg,
                    borderColor: CHART_NEUTRAL.tooltipBorder,
                    borderRadius: "6px",
                  }}
                  labelStyle={{ color: CHART_NEUTRAL.label, fontSize: 11 }}
                  itemStyle={{ fontSize: 11 }}
                  labelFormatter={(timestamp: string) => formatDateTimeWithWeekday(timestamp)}
                  formatter={(value: number, name: string) => {
                    const indexNames: Record<string, string> = {
                      'SPY': 'S&P 500',
                      'DJI': 'Dow Jones',
                      'RTY': 'Russell 2000'
                    };
                    const displayName = indexNames[name as string] || name;
                    return [`${Number(value).toFixed(2)}%`, displayName];
                  }}
                />
                <ReferenceLine y={0} stroke={CHART_NEUTRAL.axis} strokeDasharray="3 3" strokeWidth={1.5} />
                
                {/* Vertical day dividers - Add reference lines at start of each trading day */}
                {(() => {
                  const dayStartTimestamps: string[] = [];
                  let lastDay = "";
                  intradaySeriesAligned.forEach((point) => {
                    const dayKey = new Date(point.timestamp).toDateString();
                    if (dayKey !== lastDay) {
                      if (lastDay) {
                        dayStartTimestamps.push(point.timestamp);
                      }
                      lastDay = dayKey;
                    }
                  });
                  return dayStartTimestamps.map(timestamp => (
                    <ReferenceLine 
                      key={timestamp}
                      x={timestamp} 
                      stroke={CHART_NEUTRAL.axis} 
                      strokeDasharray="5 5" 
                      strokeWidth={1}
                    />
                  ));
                })()}
                
                {/* SPY Line - Green */}
                <Line
                  type="monotone"
                  dataKey="SPY"
                  name="SPY"
                  stroke={getFamilyColor("equity")}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                
                {/* DJI Line - Blue */}
                <Line
                  type="monotone"
                  dataKey="DJI"
                  name="DJI"
                  stroke={getFamilyColor("industrials")}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                
                {/* RTY Line - Orange */}
                <Line
                  type="monotone"
                  dataKey="RTY"
                  name="RTY"
                  stroke={getFamilyColor("financials")}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-stealth-400">
              Loading chart data...
            </div>
          )}
        </div>
        
        {/* Daily Summary Cards - Aligned with chart sections */}
        <div className="flex gap-0 mt-3 md:mt-4" style={{ paddingLeft: '40px' }}>
          {orderedWeekPerformance.map((day, idx) => (
            <div
              key={day.date}
              className="flex-1 text-center p-1.5 sm:p-2 bg-stealth-900 border-t border-b border-stealth-700"
              style={{ 
                borderLeft: idx === 0 ? `1px solid ${CHART_NEUTRAL.grid}` : 'none',
                borderRight: `1px solid ${CHART_NEUTRAL.grid}`
              }}
            >
              <div className="text-xs font-semibold text-stealth-300 truncate">{day.day_name.substring(0, 3)}</div>
              <div className={`text-xs sm:text-sm font-bold ${day.pct_change >= 0 ? "text-green-400" : "text-red-400"}`}>
                {day.pct_change >= 0 ? "+" : ""}{day.pct_change.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* =================================================================
          SECTOR PERFORMANCE GRID
          Each card shows one sector with vertical bubble chart
          ================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
        {data.sectors
          .sort((a, b) => b.pct_change - a.pct_change)  // Sort by performance (best first)
          .map((sector) => {
            const sectorVolume = sector.stocks.reduce((sum, stock) => sum + stock.volume, 0);
            const volumePercent = (sectorVolume / totalVolume) * 100;
            const maxVolume = Math.max(...sector.stocks.map(s => s.volume));

            // ============================================================
            // DYNAMIC Y-AXIS RANGE CALCULATION
            // Each sector gets its own optimized scale for better visibility
            // ============================================================
            const stockPctChanges = sector.stocks.map(s => s.pct_change);
            const maxPct = Math.max(...stockPctChanges) + 1;  // Add 1% padding at top
            const minPct = Math.min(...stockPctChanges) - 1;  // Add 1% padding at bottom
            
            // Generate grid lines at appropriate intervals based on range
            const range = maxPct - minPct;
            // Adaptive intervals: smaller range = finer grid, larger range = coarser grid
            const interval = range <= 6 ? 1 : range <= 12 ? 2 : range <= 20 ? 5 : 10;
            
            const gridLines: number[] = [];
            let currentLine = Math.ceil(minPct / interval) * interval;
            while (currentLine <= maxPct) {
              gridLines.push(currentLine);
              currentLine += interval;
            }

            return (
              <div
                key={sector.name}
                className="bg-stealth-800 rounded-lg border border-stealth-700 overflow-hidden"
              >
                {/* Sector Header */}
                <div className="flex flex-col gap-1 px-4 py-2.5 bg-stealth-900 border-b border-stealth-700">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-stealth-200 truncate">{sector.name}</h3>
                    {(() => {
                      const etfSymbol = sectorToEtf[sector.name];
                      if (!etfSymbol || !sectorProjections) return null;
                      
                      const projection3m = sectorProjections["3m"]?.find((p: SectorProjection) => p.sector_symbol === etfSymbol);
                      const projection6m = sectorProjections["6m"]?.find((p: SectorProjection) => p.sector_symbol === etfSymbol);
                      const projection12m = sectorProjections["12m"]?.find((p: SectorProjection) => p.sector_symbol === etfSymbol);
                      
                      if (!projection3m) return null;
                      
                      // Get scores for sparkline
                      const scoreNow = sector.pct_change * 10 + 50;  // Current performance scaled to 0-100
                      const score3m = projection3m.score_total;
                      const score6m = projection6m?.score_total || score3m;
                      const score12m = projection12m?.score_total || score3m;
                      
                      // Use fixed 0-100 range for consistent sparkline heights
                      const scores = [scoreNow, score3m, score6m, score12m];
                      const sparkPoints = scores.map((score) => {
                        const normalized = Math.max(0, Math.min(100, score));
                        return 20 - (normalized / 100) * 20;  // 20px height, top=0, bottom=20
                      });
                      
                      // Determine color based on trend
                      const trendUp = score12m > scoreNow;
                      const trendDown = score12m < scoreNow;
                      
                      return (
                        <div className="flex flex-col items-end">
                          <svg width="50" height="20" viewBox="0 0 50 20" className="flex-shrink-0">
                            {/* Smooth bezier curve connecting 4 points */}
                            <path
                              d={`M 0,${sparkPoints[0]} Q 8,${(sparkPoints[0] + sparkPoints[1]) / 2} 17,${sparkPoints[1]} Q 25,${(sparkPoints[1] + sparkPoints[2]) / 2} 33,${sparkPoints[2]} Q 42,${(sparkPoints[2] + sparkPoints[3]) / 2} 50,${sparkPoints[3]}`}
                              fill="none"
                              stroke={trendUp ? statePalette.green : trendDown ? statePalette.red : statePalette.neutral}
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            
                            {/* Data point circles - only show final point colored */}
                            <circle cx="50" cy={sparkPoints[3]} r="1.5" fill={trendUp ? statePalette.green : trendDown ? statePalette.red : statePalette.neutral} />
                          </svg>
                          <div className="text-[9px] text-stealth-500">T + 12M</div>
                        </div>
                      );
                    })()}
                  </div>
                  <span
                    className={`text-xs font-bold px-1.5 py-0.5 rounded self-start ${
                      sector.pct_change >= 0 ? "bg-green-600 text-white" : "bg-red-600 text-white"
                    }`}
                  >
                    {sector.pct_change >= 0 ? "+" : ""}{sector.pct_change.toFixed(1)}%
                  </span>
                </div>

                {/* Vertical Column Chart */}
                <div className="relative" style={{ height: '260px' }}>
                  {/* Y-axis scale */}
                  <div className="absolute left-2 top-0 bottom-0 flex flex-col justify-between py-3 text-xs text-stealth-400">
                    {gridLines.map((pct) => (
                      <div 
                        key={pct} 
                        className="leading-none"
                        style={{
                          position: 'absolute',
                          top: `${((maxPct - pct) / range) * 100}%`,
                          transform: 'translateY(-50%)'
                        }}
                      >
                        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                      </div>
                    ))}
                  </div>

                  {/* Chart area with grid */}
                  <div className="absolute left-12 right-4 top-4 bottom-4">
                    {/* Horizontal grid lines */}
                    <div className="absolute inset-0">
                      {gridLines.map((pct) => (
                        <div
                          key={pct}
                          className="absolute w-full"
                          style={{
                            top: `${((maxPct - pct) / range) * 100}%`,
                            borderTop: `1px ${pct === 0 ? 'solid' : 'dashed'} ${pct === 0 ? CHART_NEUTRAL.axis : CHART_NEUTRAL.grid}`,
                          }}
                        />
                      ))}
                    </div>

                    {/* Stock bubbles */}
                    <div className="absolute inset-0">
                      {sector.stocks.map((stock, stockIdx) => {
                        // NASDAQ-100 stocks (major tech/growth companies)
                        const nasdaq100 = [
                          'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'COST',
                          'NFLX', 'AMD', 'PEP', 'ADBE', 'CSCO', 'TMUS', 'INTC', 'CMCSA', 'TXN', 'QCOM',
                          'INTU', 'HON', 'AMAT', 'SBUX', 'ISRG', 'BKNG', 'AMGN', 'ADI', 'PANW', 'VRTX',
                          'ADP', 'GILD', 'MDLZ', 'LRCX', 'REGN', 'MU', 'PYPL', 'SNPS', 'KLAC', 'CDNS',
                          'MELI', 'CRWD', 'MAR', 'ABNB', 'ORLY', 'CTAS', 'MRVL', 'CSX', 'DASH', 'FTNT',
                          'ADSK', 'NXPI', 'ASML', 'ROP', 'WDAY', 'PAYX', 'PCAR', 'AEP', 'ROST', 'ODFL',
                          'MNST', 'CHTR', 'CPRT', 'FAST', 'KDP', 'EA', 'BKR', 'TEAM', 'VRSK', 'DXCM',
                          'CTSH', 'KHC', 'IDXX', 'LULU', 'GEHC', 'EXC', 'CCEP', 'XEL', 'ZS', 'ON',
                          'CSGP', 'TTWO', 'ANSS', 'DDOG', 'CDW', 'BIIB', 'ILMN', 'GFS', 'WBD', 'MDB',
                          'MRNA', 'WBA', 'SMCI', 'ARM', 'DLTR', 'FANG', 'ALGN', 'ZM', 'SIRI', 'LCID'
                        ];
                        
                        // Check if this stock is in NASDAQ-100 (for label display)
                        const isNasdaq100 = nasdaq100.includes(stock.ticker);
                        
                        // ============================================================
                        // BUBBLE SIZING: Volume-proportional within sector
                        // ============================================================
                        const volumeRatio = stock.volume / maxVolume;
                        const size = Math.max(18, Math.min(70, volumeRatio * 70));  // 18-70px range
                        
                        // ============================================================
                        // Y-AXIS POSITIONING: Based on % change within dynamic range
                        // ============================================================
                        const yPos = percentToYPosition(stock.pct_change, 100, minPct, maxPct);
                        
                        // ============================================================
                        // X-AXIS POSITIONING: Better horizontal distribution
                        // Uses multiple hash-based offsets for natural spread across full width
                        // ============================================================
                        const tickerHash = stock.ticker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                        const hash2 = stock.ticker.length * stock.ticker.charCodeAt(0);
                        const baseX = 5 + (tickerHash % 90);  // Spread across 5-95% width (full utilization)
                        const volumeSpread = (hash2 % 15) - 7.5;  // Add -7.5 to +7.5% variation
                        const xJitter = Math.min(95, Math.max(5, baseX + volumeSpread));  // Clamp to 5-95%
                        
                        // ============================================================
                        // COLOR CODING: Performance-based gradient
                        // Bright green (strong gains) -> Light green (small gains) ->
                        // Light red (small losses) -> Dark red (strong losses)
                        // ============================================================
                        const getColor = (pct: number): string => {
                          const magnitude = Math.min(Math.abs(pct), 10);
                          const alpha = 0.3 + (magnitude / 10) * 0.6;
                          if (pct > 0) {
                            return withAlpha(statePalette.green, alpha);
                          }
                          if (pct < 0) {
                            return withAlpha(statePalette.red, alpha);
                          }
                          return withAlpha(statePalette.neutral, 0.35);
                        };

                        return (
                          <div
                            key={stock.ticker}
                            className="absolute rounded-full flex items-center justify-center cursor-pointer hover:scale-125 hover:z-50 transition-all group"
                            style={{
                              width: `${size}px`,
                              height: `${size}px`,
                              left: `${xJitter}%`,
                              top: `${yPos}%`,
                              transform: 'translate(-50%, -50%)',
                              backgroundColor: getColor(stock.pct_change),
                              opacity: 0.8,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                            }}
                            onClick={() => window.open(`https://finance.yahoo.com/quote/${stock.ticker}`, '_blank')}
                          >
                            {/* Show ticker only for NASDAQ-100 or on hover */}
                            <span className={`text-[10px] font-bold text-white drop-shadow ${isNasdaq100 ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                              {stock.ticker}
                            </span>
                            
                            {/* Tooltip */}
                            <div className="absolute hidden group-hover:block bottom-full mb-2 bg-stealth-900 border border-stealth-600 rounded px-3 py-2 text-xs whitespace-nowrap z-50 shadow-xl pointer-events-none">
                              <div className="text-stealth-100 font-bold">{stock.ticker}</div>
                              <div className={`font-semibold ${stock.pct_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {stock.pct_change >= 0 ? '+' : ''}{stock.pct_change.toFixed(2)}%
                              </div>
                              <div className="text-stealth-400 text-[10px] mt-1">
                                ${stock.price.toFixed(2)}
                              </div>
                              <div className="text-stealth-400 text-[10px]">
                                Vol: {(stock.volume / 1e6).toFixed(1)}M
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Footer stats */}
                <div className="px-4 py-2 bg-stealth-900 border-t border-stealth-700 flex justify-between text-xs text-stealth-400">
                  <span>Volume: {(sectorVolume / 1e9).toFixed(2)}B</span>
                  <span>{volumePercent.toFixed(1)}% of total</span>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default MarketMap;
