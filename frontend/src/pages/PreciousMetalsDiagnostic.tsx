import { useState, useEffect, type ReactNode } from "react";
import { useApi } from "../hooks/useApi";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts";
import MarketLoading from "../components/ui/MarketLoading";
import { CHART_NEUTRAL } from "../utils/chartUtils";
import { getFamilyColor, getMetricColor } from "../theme/metricColors";
import { apiFetch } from "../utils/apiUtils";

interface RegimeStatus {
  gold_bias: "MONETARY_HEDGE" | "NEUTRAL" | "FINANCIAL_ASSET" | null;
  silver_bias: "INDUSTRIAL_MONETARY" | "INDUSTRIAL" | "MONETARY" | null;
  pgm_bias: "GROWTH" | "NEUTRAL" | "RECESSION" | null;
  paper_physical_risk: "LOW" | "MODERATE" | "HIGH" | null;
  overall_regime: "MONETARY_STRESS" | "INFLATION_HEDGE" | "GROWTH_REFLATION" | "LIQUIDITY_CRISIS" | "INDUSTRIAL_COMMODITY" | null;
}

interface MetalProjection {
  metal: string;
  metal_name: string;
  etf_symbol: string;
  current_price: number;
  score_total: number;
  score_trend: number;
  score_momentum: number;
  classification: string;
  relative_classification: "Winner" | "Neutral" | "Loser";
  rank: number;
  technicals: {
    sma_20: number | null;
    sma_50: number | null;
    sma_200: number | null;
    rsi: number | null;
    momentum_5d: number | null;
    momentum_20d: number | null;
    momentum_60d: number | null;
    volatility_30d: number | null;
  };
  levels: {
    support: number[];
    resistance: number[];
    take_profit: number;
    stop_loss: number;
  };
  relative_confirmation?: {
    metal_ratio_momentum_5d?: number | null;
    metal_ratio_momentum_20d?: number | null;
    ratio_momentum_confirmed?: boolean;
    leadership_divergence_confirmed?: boolean;
    rotation_confirmed: boolean;
  };
  as_of: string;
}

interface MetalIndicators {
  regime: RegimeStatus;
  cb_context: {
    global_cb_gold_pct_reserves: number | null;
    net_purchases_yoy: number | null;
    structural_monetary_bid: number | null;
    em_accumulation_momentum: number | null;
  };
  price_anchors: {
    au_dxy_ratio_zscore: number | null;
    ag_dxy_ratio_zscore: number | null;
    real_rate_signal: number | null;
    monetary_hedge_strength: number | null;
  };
  relative_value: {
    au_ag_ratio: number | null;
    au_ag_ratio_zscore: number | null;
    pt_au_ratio: number | null;
    pt_au_ratio_zscore: number | null;
    pd_au_ratio: number | null;
    pd_au_ratio_zscore: number | null;
  };
  physical_paper: {
    paper_credibility_index: number | null;
    etf_holdings_zscore: number | null;
    etf_holdings_change_yoy: number | null;
    oi_registered_ratio: number | null;
    comex_registered_inventory_change_yoy: number | null;
    backwardation_severity: number | null;
    etf_flow_divergence: number | null;
  };
}

interface CorrelationMatrix {
  timestamp: string;
  au_ag: number | null;
  au_pt: number | null;
  au_pd: number | null;
  ag_pt: number | null;
  ag_pd: number | null;
  pt_pd: number | null;
  au_spy: number | null;
  au_tlt: number | null;
  au_dxy: number | null;
  au_vix: number | null;
}

interface CBHolding {
  country: string;
  gold_tonnes: number;
  pct_of_reserves: number;
  net_purchase_qty: number | null;
  net_purchase_yoy_pct: number | null;
}

interface SupplyData {
  metal: string;
  production_tonnes_yoy_pct: number | null;
  aisc_per_oz: number | null;
  current_spot_price: number | null;
  margin_pct: number | null;
  recycling_pct_of_supply: number | null;
}

interface DemandData {
  metal: string;
  period: string;
  investment_tonnes: number | null;
  industrial_tonnes: number | null;
  jewelry_tonnes: number | null;
  jewelry_asia_tonnes: number | null;
  other_tonnes: number | null;
  total_tonnes: number | null;
}

interface PriceHistory {
  date: string;
  price: number;
}

interface MetalMarketCap {
  market_cap_usd: number | null;
  price_usd_per_oz: number | null;
  stock_oz: number | null;
}

interface MarketCapsResponse {
  metals: Record<string, MetalMarketCap>;
  total_market_cap_usd: number | null;
  metals_to_m2_pct: number | null;
}

interface MarketCapsHistoryPoint {
  date: string;
  metals_to_m2_pct: number | null;
  gold_price?: number | null;
  global_m2_trillions?: number | null;
}

interface MarketCapsHistoryResponse {
  history: MarketCapsHistoryPoint[];
}

interface FuturesCurveContract {
  symbol: string;
  contract_label: string;
  month_code: string;
  month_number: number;
  year: number;
  price: number;
  previous_close: number;
  change_pct: number;
  volume: number | null;
  as_of: string;
}

interface FuturesCurveMetal {
  metal: string;
  label: string;
  curve_state: "BACKWARDATION" | "CONTANGO" | "FLAT";
  curve_bps: number | null;
  contracts: FuturesCurveContract[];
}

interface FuturesCurveResponse {
  as_of: string;
  source: string;
  contracts_requested: number;
  metals: FuturesCurveMetal[];
}

interface PriceHistoryDataPoint {
  date: string;
  AU?: number;
  AG?: number;
  PT?: number;
  PD?: number;
  CU?: number;
  AL?: number;
}

const METAL_LABELS: Record<string, string> = {
  AU: "Gold",
  AG: "Silver",
  PT: "Platinum",
  PD: "Palladium",
  CU: "Copper",
  AL: "Aluminum",
};

const METAL_CATEGORIES: Record<string, "precious" | "industrial"> = {
  AU: "precious",
  AG: "precious",
  PT: "precious",
  PD: "industrial",
  CU: "industrial",
  AL: "industrial",
};

const getMetalColor = (metal: string, variant: "base" | "muted" | "faint" = "base") =>
  getMetricColor(metal, variant);

const getMetalName = (metal: string): string => {
  return METAL_LABELS[metal] || metal;
};

const DERIVED_TITLE = "Derived from ingested data";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const formatValue = (value: number | null | undefined, digits = 1) =>
  isNumber(value) ? value.toFixed(digits) : "n/a";

const formatSignedValue = (value: number | null | undefined, digits = 1) =>
  isNumber(value) ? `${value > 0 ? "+" : ""}${value.toFixed(digits)}` : "n/a";

const DerivedLabel = ({ label }: { label: ReactNode }) => (
  <span className="inline-flex items-center gap-1" title={DERIVED_TITLE}>
    {label}
    <span className="text-stealth-500">*</span>
  </span>
);

const getRegimeBadgeClass = (regime: string | null): string => {
  switch (regime) {
    case "MONETARY_STRESS":
      return "bg-red-900/30 border-red-600 text-red-200";
    case "INFLATION_HEDGE":
      return "bg-yellow-900/30 border-yellow-600 text-yellow-200";
    case "GROWTH_REFLATION":
      return "bg-green-900/30 border-green-600 text-green-200";
    case "LIQUIDITY_CRISIS":
      return "bg-red-900/40 border-red-500 text-red-100";
    case "INDUSTRIAL_COMMODITY":
      return "bg-blue-900/30 border-blue-600 text-blue-200";
    default:
      return "bg-stealth-700 border-stealth-600 text-gray-300";
  }
};

const getRiskBadgeClass = (risk: string | null): string => {
  if (!risk) return "bg-stealth-700 border-stealth-600 text-gray-300";
  if (risk === "HIGH") return "bg-red-900/30 border-red-600 text-red-200";
  if (risk === "MODERATE") return "bg-yellow-900/30 border-yellow-600 text-yellow-200";
  return "bg-green-900/30 border-green-600 text-green-200";
};

const getBiasText = (bias: string | null): string => {
  if (!bias) return "Unknown";
  if (bias.includes("MONETARY")) return "Monetary Hedge";
  if (bias.includes("INDUSTRIAL")) return "Industrial + Monetary";
  if (bias.includes("FINANCIAL")) return "Financial Asset";
  if (bias === "GROWTH") return "Growth Premium";
  if (bias === "RECESSION") return "Recession Hedge";
  return "Neutral";
};

const getProjectionRead = (proj: MetalProjection): string => {
  const momentum5d = proj.technicals.momentum_5d ?? 0;
  const momentum20d = proj.technicals.momentum_20d ?? 0;

  if (proj.relative_confirmation?.rotation_confirmed) {
    return `${proj.metal_name} is taking leadership inside the precious-metal sleeve, with relative strength improving against gold or against a weaker peer set.`;
  }

  if (METAL_CATEGORIES[proj.metal] === "industrial") {
    if (momentum5d > 0 && momentum20d > 0) {
      return `${proj.metal_name} is behaving like a clean cyclical leader, with both short and intermediate momentum moving in the same direction.`;
    }
    if (momentum5d > 0 && momentum20d <= 0) {
      return `${proj.metal_name} is bouncing near term, but the intermediate trend still needs to repair before it reads as a durable industrial breakout.`;
    }
    return `${proj.metal_name} is still trading like a lagging industrial input, which keeps the cyclical demand read cautious.`;
  }

  if (momentum5d > 0 && momentum20d > 0) {
    return `${proj.metal_name} has both short-term follow-through and intermediate support, which is the cleanest technical profile in the group.`;
  }

  if (momentum5d > 0 && momentum20d <= 0) {
    return `${proj.metal_name} is firming in the short run, but the 20-day tape still says this is more rebound than full trend reset.`;
  }

  if (momentum5d <= 0 && momentum20d <= 0) {
    return `${proj.metal_name} remains under pressure across both short and intermediate windows, so leadership is still fading rather than broadening.`;
  }

  return `${proj.metal_name} is mixed here, with neither a clean breakout nor a full breakdown.`;
};

export default function PreciousMetalsDiagnostic({ embedded = false }: { embedded?: boolean }) {
  const { data: indicators, loading, error } = useApi<MetalIndicators>("/precious-metals/regime");
  const { data: correlations } = useApi<CorrelationMatrix>("/precious-metals/correlations");
  const { data: cb_holdings } = useApi<CBHolding[]>("/precious-metals/cb-holdings");
  const { data: supply_data } = useApi<SupplyData[]>("/precious-metals/supply");
  const { data: demand_data } = useApi<DemandData[]>("/precious-metals/demand");
  const { data: market_caps } = useApi<MarketCapsResponse>("/precious-metals/market-caps");
  const { data: market_caps_history } = useApi<MarketCapsHistoryResponse>("/precious-metals/market-caps/history?years=50");
  const { data: projectionsData } = useApi<{ projections: MetalProjection[] }>("/precious-metals/projections/latest");
  const { data: futuresCurve } = useApi<FuturesCurveResponse>("/precious-metals/futures-curve?contracts=4");

  const [selectedTab, setSelectedTab] = useState<"overview" | "deep-dive">("overview");

  if (loading) {
    return (
      <div className={embedded ? "py-8" : "p-6"}>
        {!embedded && <h1 className="text-3xl font-bold mb-6 text-gray-200">Metals Diagnostic</h1>}
        <div className="flex justify-center py-6">
          <MarketLoading size={110} variant="pulse" label="Loading metals analysis..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={embedded ? "py-8" : "p-6"}>
        {!embedded && <h1 className="text-3xl font-bold mb-6 text-gray-200">Metals Diagnostic</h1>}
        <div className="bg-red-900/20 border border-red-700 text-red-200 p-4 rounded">
          Error loading data: {error}
        </div>
      </div>
    );
  }

  if (!indicators) {
    return (
      <div className={embedded ? "py-8" : "p-6"}>
        {!embedded && <h1 className="text-3xl font-bold mb-6 text-gray-200">Metals Diagnostic</h1>}
        <div className="text-stealth-400">No data available.</div>
      </div>
    );
  }

  const projections = projectionsData?.projections || [];

  return (
    <div className={embedded ? "text-gray-200" : "p-3 md:p-6 text-gray-200"}>
      {!embedded && (
        <>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Metals Diagnostic</h1>
          <p className="text-stealth-400 mb-6 text-sm md:text-base">
            Macro-structural analysis of monetary metals and industrial metals, combining regime context with technical leadership across the broader complex.
          </p>
        </>
      )}

      {/* SECTION 1: REGIME CLASSIFICATION PANEL (PINNED TOP) */}
      <div className="mb-6 primary-card p-4 md:p-6">
        <h2 className="text-lg md:text-xl font-bold mb-4 text-white">Regime Classification</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          {/* Gold Bias Card */}
          <div className={`border rounded-lg p-3 md:p-4 ${getRegimeBadgeClass(indicators.regime.gold_bias)}`}>
            <div className="text-xs md:text-sm font-semibold text-stealth-300 mb-1">GOLD BIAS</div>
            <div className="text-sm md:text-base font-bold">{getBiasText(indicators.regime.gold_bias)}</div>
          </div>

          {/* Silver Bias Card */}
          <div className={`border rounded-lg p-3 md:p-4 ${getRegimeBadgeClass(indicators.regime.silver_bias)}`}>
            <div className="text-xs md:text-sm font-semibold text-stealth-300 mb-1">SILVER BIAS</div>
            <div className="text-sm md:text-base font-bold">{getBiasText(indicators.regime.silver_bias)}</div>
          </div>

          {/* PGM Bias Card */}
          <div className={`border rounded-lg p-3 md:p-4 ${getRegimeBadgeClass(indicators.regime.pgm_bias)}`}>
            <div className="text-xs md:text-sm font-semibold text-stealth-300 mb-1">PGM BIAS</div>
            <div className="text-sm md:text-base font-bold">{getBiasText(indicators.regime.pgm_bias)}</div>
          </div>

          {/* Paper/Physical Risk Card */}
          <div className={`border rounded-lg p-3 md:p-4 ${getRiskBadgeClass(indicators.regime.paper_physical_risk)}`}>
            <div className="text-xs md:text-sm font-semibold text-stealth-300 mb-1">P/P RISK</div>
            <div className="text-sm md:text-base font-bold">{indicators.regime.paper_physical_risk || "Unknown"}</div>
          </div>

          {/* Overall Regime Card */}
          <div className={`border rounded-lg p-3 md:p-4 ${getRegimeBadgeClass(indicators.regime.overall_regime)}`}>
            <div className="text-xs md:text-sm font-semibold text-stealth-300 mb-1">REGIME</div>
            <div className="text-sm md:text-base font-bold">
              {indicators.regime.overall_regime
                ? indicators.regime.overall_regime.replace(/_/g, " ")
                : "Unknown"}
            </div>
          </div>
        </div>

        <div className="text-xs md:text-sm text-stealth-400 mt-4">
          Last Updated: {new Date().toISOString().split('T')[0]} - Data freshness: Real-time spot | CB data (quarterly lag)
        </div>
      </div>

      {/* TAB NAVIGATION */}
      <div className="mb-6 border-b border-stealth-700 flex gap-4">
        <button
          onClick={() => setSelectedTab("overview")}
          className={`pb-3 px-2 font-semibold border-b-2 transition ${
            selectedTab === "overview"
              ? "border-blue-500 text-blue-300"
              : "border-transparent text-stealth-400 hover:text-gray-300"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setSelectedTab("deep-dive")}
          className={`pb-3 px-2 font-semibold border-b-2 transition ${
            selectedTab === "deep-dive"
              ? "border-blue-500 text-blue-300"
              : "border-transparent text-stealth-400 hover:text-gray-300"
          }`}
        >
          Deep Dive
        </button>
      </div>

      {selectedTab === "overview" && (
        <>
          {/* PRICE HISTORY CHART */}
          <div className="mb-6">
            <PriceHistoryChart />
          </div>

          {/* PROJECTIONS & TECHNICAL ANALYSIS */}
          {projections.length > 0 && (
            <div className="mb-6">
              <ProjectionsPanel projections={projections} />
            </div>
          )}
        </>
      )}

      {selectedTab === "deep-dive" && (
        <>
          {/* SECTION 2 & 3: CB CONTEXT & PRICE ANCHORS (2-COLUMN) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Section 2: Monetary & CB Context */}
            <CBContextPanel cb_holdings={cb_holdings} indicators={indicators} />

            {/* Section 3: Price vs Monetary Anchors */}
              <PriceAnchorsPanel indicators={indicators} correlations={correlations} />
          </div>

          {/* SECTION 4 & 5: RELATIVE VALUE & PHYSICAL/PAPER (2-COLUMN) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Section 4: Relative Value */}
            <RelativeValuePanel indicators={indicators} />

            {/* Section 5: Physical vs Paper */}
            <PhysicalPaperPanel indicators={indicators} />
          </div>

          <div className="mb-6">
            <FuturesCurvePanel futuresCurve={futuresCurve} />
          </div>

          {/* SECTION 6 & 7: SUPPLY-DEMAND (2-COLUMN) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Section 6: Supply */}
            <SupplyPanel supply_data={supply_data} />

            {/* Section 7: Demand (Placeholder for future data) */}
            <DemandPanel demand_data={demand_data} />
          </div>

          {/* SECTION 8 & 9: MARKET CAP & CORRELATIONS */}
          <div className="grid grid-cols-1 gap-6 mb-6">
            <MarketCapPanel market_caps={market_caps} market_caps_history={market_caps_history} />
            <CorrelationPanel correlations={correlations} />
          </div>

          {/* METHODOLOGY SECTION */}
          <MethodologyPanel />
        </>
      )}
    </div>
  );
}

// ==================== SECTION COMPONENTS ====================

function MethodologyPanel() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const renderDisclosureIcon = (isExpanded: boolean) => (
    <span className={`collapsible-icon ${isExpanded ? "collapsible-icon-open" : ""}`} aria-hidden="true">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </span>
  );

  const Section = ({ id, title, children }: { id: string, title: string, children: React.ReactNode }) => {
    const isExpanded = expandedSections.has(id);
    return (
      <div className="border-b border-stealth-700 last:border-b-0">
        <button
          onClick={() => toggleSection(id)}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-stealth-700/50"
          aria-expanded={isExpanded}
        >
          <span className="font-semibold text-stealth-200">{title}</span>
          {renderDisclosureIcon(isExpanded)}
        </button>
        <div className={`collapsible-panel ${isExpanded ? "collapsible-panel-open" : ""}`}>
          <div className="collapsible-panel-inner">
            <div className="px-4 pb-4 text-sm text-stealth-300 space-y-3">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="primary-card">
      <div className="p-4 border-b border-stealth-700">
        <h3 className="text-lg font-bold text-white">Technical Methodology & Calculations</h3>
        <p className="text-xs text-stealth-400 mt-1">Detailed explanations of scoring, regime classification, and derived indicators</p>
      </div>

      <div className="divide-y divide-stealth-700">
        <Section id="scoring" title="Technical Scoring Algorithm">
          <div>
            <p className="font-semibold text-white mb-2">Composite Score (0-100):</p>
            <p>Each metal receives a technical score combining trend strength, momentum, and exhaustion risk. Higher scores indicate more bullish potential.</p>
            
            <div className="mt-3">
              <p className="font-semibold text-blue-300">Trend Score (0-100):</p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li><strong>SMA Crossovers:</strong> Price above all SMAs (20/50/200) = maximum trend points</li>
                <li><strong>Distance Penalties:</strong> Excessive distance reduces score to signal exhaustion
                  <ul className="list-circle list-inside ml-4 text-xs">
                    <li>&gt;10% above SMA20: 10pts instead of 25pts (60% penalty)</li>
                    <li>&gt;15% above SMA50: Penalized proportionally</li>
                    <li>&gt;25% above SMA200: Extreme exhaustion penalty</li>
                  </ul>
                </li>
                <li><strong>Below SMAs:</strong> Distance below moving averages also penalized (potential downtrend)</li>
              </ul>
            </div>

            <div className="mt-3">
              <p className="font-semibold text-blue-300">Momentum Score (0-100):</p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li><strong>RSI 45-55:</strong> 100pts (neutral zone, maximum room to run)</li>
                <li><strong>RSI 40-45 or 55-60:</strong> 75pts (mild directional bias)</li>
                <li><strong>RSI 30-40 or 60-70:</strong> 50pts (moderate momentum)</li>
                <li><strong>RSI &gt;70:</strong> 25pts (overbought exhaustion risk)</li>
                <li><strong>RSI &lt;30:</strong> 25pts (oversold, potential reversal)</li>
              </ul>
            </div>

            <p className="mt-3 text-xs text-stealth-400">
              <strong>Philosophy:</strong> The algorithm rewards positive trends while penalizing over-extension. 
              A metal trading 15% above its SMA50 may have strong momentum but faces exhaustion risk, 
              resulting in a lower score than a metal trending steadily at +5% above its moving averages.
            </p>
          </div>
        </Section>

        <Section id="support-resistance" title="Support & Resistance Detection">
          <div>
            <p className="mb-2">Identifies key price levels using local extrema analysis over the last 365 days.</p>
            
            <div className="mt-3">
              <p className="font-semibold text-blue-300">Algorithm:</p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li><strong>Rolling Window:</strong> 5-period lookback to identify local minima (support) and maxima (resistance)</li>
                <li><strong>Support:</strong> Price level where metal historically finds buying pressure (local minimum in window)</li>
                <li><strong>Resistance:</strong> Price level where metal historically faces selling pressure (local maximum in window)</li>
                <li><strong>Nearest Levels:</strong> System reports closest support below current price and closest resistance above</li>
              </ul>
            </div>

            <p className="mt-3 text-xs text-stealth-400">
              <strong>Usage:</strong> Support/resistance levels help identify potential entry/exit zones. 
              Breakouts above resistance or breakdowns below support often signal significant trend changes.
            </p>
          </div>
        </Section>

        <Section id="regime" title="Regime Classification Framework">
          <div>
            <p className="mb-2">Classifies current precious metals market environment into 5 distinct regimes based on metal performance dynamics.</p>
            
            <div className="mt-3">
              <p className="font-semibold text-blue-300">Regime Types:</p>
              <div className="space-y-2 ml-2">
                <div>
                  <p className="font-semibold text-green-400">MONETARY_STRESS</p>
                  <p className="text-xs">Gold outperforming (gold bias &gt; 0.15), low industrial activity. Flight to monetary safety.</p>
                </div>
                <div>
                  <p className="font-semibold text-yellow-400">INFLATION_HEDGE</p>
                  <p className="text-xs">Balanced gold/silver with moderate industrial (MHS 0.8-1.2). Broad inflation concerns.</p>
                </div>
                <div>
                  <p className="font-semibold text-blue-400">GROWTH_REFLATION</p>
                  <p className="text-xs">Silver/PGMs outperforming (gold bias &lt; -0.1), industrial metals strong. Economic expansion.</p>
                </div>
                <div>
                  <p className="font-semibold text-red-400">LIQUIDITY_CRISIS</p>
                  <p className="text-xs">All metals declining, paper risk elevated (&gt; 0.6). Deleveraging environment.</p>
                </div>
                <div>
                  <p className="font-semibold text-purple-400">INDUSTRIAL_COMMODITY</p>
                  <p className="text-xs">PGMs surging (strong PGM momentum), diverging from monetary metals. Supply/demand fundamentals.</p>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <p className="font-semibold text-blue-300">Key Metrics:</p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li><strong>Gold Bias:</strong> (AU score - AG score) / 100. Positive = gold outperformance, negative = silver outperformance.</li>
                <li><strong>PGM Momentum:</strong> Average of platinum and palladium 30-day momentum scores.</li>
                <li><strong>Paper Risk:</strong> Ratio of ETF holdings to physical supply. Higher = more paper leverage risk.</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="derived-indicators" title="Derived Indicators & Formulas">
          <div>
            <p className="mb-2">Composite indicators synthesizing multiple data points to assess market structure.</p>
            
            <div className="space-y-3">
              <div>
                <p className="font-semibold text-blue-300">Silver-Monetary Bias (SMB):</p>
                <p className="text-xs">SMB = (Silver Score - Gold Score) / 100</p>
                <p className="text-xs mt-1">Measures silver's relative strength vs gold. Positive SMB suggests industrial/growth themes dominating, negative suggests monetary stress.</p>
              </div>

              <div>
                <p className="font-semibold text-blue-300">Monetary-Hedge Score (MHS):</p>
                <p className="text-xs">MHS = (Gold Score + Silver Score) / 2 / 100</p>
                <p className="text-xs mt-1">Average performance of monetary metals (AU + AG). High MHS = strong inflation hedge environment.</p>
              </div>

              <div>
                <p className="font-semibold text-blue-300">PGM-Commodity Index (PCI):</p>
                <p className="text-xs">PCI = (Platinum Score + Palladium Score) / 2 / 100</p>
                <p className="text-xs mt-1">Industrial metals gauge. High PCI = strong auto/manufacturing demand, supply concerns, or industrial reflation.</p>
              </div>

              <div>
                <p className="font-semibold text-blue-300">Industrial Divergence Pressure (IDP):</p>
                <p className="text-xs">IDP = PCI - MHS</p>
                <p className="text-xs mt-1">Spread between industrial PGMs and monetary metals. Positive IDP = industrial outperformance, negative = monetary flight.</p>
              </div>

              <div>
                <p className="font-semibold text-blue-300">Supply-Inflation Signal (SIS):</p>
                <p className="text-xs">SIS = (0.4 x MHS) + (0.3 x PCI) + (0.3 x CB Holdings YoY%)</p>
                <p className="text-xs mt-1">Composite of monetary strength, industrial demand, and central bank accumulation. High SIS = broad precious metals bullish structure.</p>
              </div>
            </div>
          </div>
        </Section>

        <Section id="data-sources" title="Data Sources & Update Frequencies">
          <div>
            <div className="space-y-3">
              <div>
                <p className="font-semibold text-blue-300">Price Data:</p>
                <ul className="list-disc list-inside ml-2 text-xs space-y-1">
                  <li><strong>Source:</strong> Yahoo Finance futures contracts (GC=F, SI=F, PL=F, PA=F)</li>
                  <li><strong>Update:</strong> Daily spot prices ingested at market close</li>
                  <li><strong>Historical:</strong> 365-day lookback for technical analysis and moving averages</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-blue-300">ETF Holdings:</p>
                <ul className="list-disc list-inside ml-2 text-xs space-y-1">
                  <li><strong>Source:</strong> GLD, SLV, PPLT, PALL fund websites</li>
                  <li><strong>Update:</strong> Daily holdings data (tonnes/ounces)</li>
                  <li><strong>Metrics:</strong> Paper/physical ratio, holdings momentum, institutional flows</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-blue-300">Supply & Demand:</p>
                <ul className="list-disc list-inside ml-2 text-xs space-y-1">
                  <li><strong>Source:</strong> World Gold Council, Silver Institute, Platinum Guild, industry reports</li>
                  <li><strong>Update:</strong> Weekly aggregation of production, consumption, inventory data</li>
                  <li><strong>Categories:</strong> Mine production, recycling, jewelry, industrial, investment demand</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-blue-300">Central Bank Holdings:</p>
                <ul className="list-disc list-inside ml-2 text-xs space-y-1">
                  <li><strong>Source:</strong> IMF COFER database, World Gold Council quarterly reports</li>
                  <li><strong>Update:</strong> Monthly updates from major central banks (Fed, ECB, PBoC, RBI, etc.)</li>
                  <li><strong>Metrics:</strong> Gold as % of total reserves, net purchases YoY, top 10 holders</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-blue-300">Technical Indicators:</p>
                <ul className="list-disc list-inside ml-2 text-xs space-y-1">
                  <li><strong>RSI:</strong> 14-period relative strength index</li>
                  <li><strong>Moving Averages:</strong> Simple moving averages at 20, 50, 200 periods (daily)</li>
                  <li><strong>Volume:</strong> Daily trading volume from futures contracts</li>
                  <li><strong>Recalculation:</strong> All technical indicators recomputed on each price update</li>
                </ul>
              </div>
            </div>

            <p className="mt-4 text-xs text-stealth-400">
              <strong>Note:</strong> All data undergoes validation checks before ingestion. Missing or anomalous values trigger alerts for manual review.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}

function CBContextPanel({ cb_holdings, indicators }: { cb_holdings: CBHolding[] | null; indicators: MetalIndicators }) {
  const cbContext = indicators.cb_context;
  const goldPct = cbContext.global_cb_gold_pct_reserves;
  const netPurchases = cbContext.net_purchases_yoy;
  const smb = cbContext.structural_monetary_bid;
  const netPurchasesColor = isNumber(netPurchases)
    ? (netPurchases > 200 ? "text-green-400" : "text-yellow-400")
    : "text-stealth-400";
  const netPurchasesText = isNumber(netPurchases)
    ? `${netPurchases > 0 ? "+" : ""}${netPurchases.toFixed(0)}%`
    : "n/a";
  const netPurchasesSummary = isNumber(netPurchases)
    ? (netPurchases > 200
      ? "Yes - buying accelerated sharply vs last year"
      : "Steady accumulation, not urgent")
    : "Data unavailable";
  const smbColor = isNumber(smb) ? (smb > 0 ? "text-green-400" : "text-red-400") : "text-stealth-400";
  const smbBarColor = isNumber(smb) ? (smb > 0 ? "bg-green-500" : "bg-red-500") : "bg-stealth-600";
  const smbText = isNumber(smb) ? `${smb > 0 ? "+" : ""}${smb.toFixed(0)}` : "n/a";
  const goldPctWidth = isNumber(goldPct)
    ? Math.min((goldPct / 15) * 100, 100)
    : 0;
  const smbWidth = isNumber(smb)
    ? Math.min(Math.abs((smb / 100) * 100), 100)
    : 0;
  return (
    <div className="primary-card p-4 md:p-6">
      <h3 className="text-lg font-bold mb-4 text-white">Government Gold Buying Pressure</h3>
      <p className="text-xs text-stealth-400 mb-4">Shows whether central banks are aggressively accumulating gold, consistent with inflation concerns or de-dollarization themes</p>

      <div className="space-y-6">
        {/* CB Gold % of Reserves */}
        <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="How much central banks trust gold vs fiat" />
              </span>
              <span className="text-lg font-bold text-blue-300">
                {isNumber(goldPct) ? `${goldPct.toFixed(1)}%` : "n/a"}
              </span>
            </div>
            <div className="w-full bg-stealth-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full"
                style={{ width: `${goldPctWidth}%` }}
              />
            </div>
          <p className="text-xs text-stealth-400 mt-1">Above 11% = governments hedging currency risk</p>
        </div>

        {/* Net CB Purchases YoY */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="Are governments panic-buying?" />
              </span>
              <span className={`text-lg font-bold ${netPurchasesColor}`}>
                {netPurchasesText}
              </span>
            </div>
            <p className="text-xs text-stealth-400">{netPurchasesSummary}</p>
          </div>

        {/* Structural Monetary Bid */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="Official sector support (floor under price)" />
              </span>
              <span className={`text-lg font-bold ${smbColor}`}>
                {smbText}
              </span>
            </div>
            <div className="w-full bg-stealth-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${smbBarColor}`}
                style={{ width: `${smbWidth}%` }}
              />
            </div>
            <p className="text-xs text-stealth-400 mt-1">Range: -100 to +100. Positive = structural demand</p>
          </div>

        {/* EM Accumulation */}
          {cb_holdings && cb_holdings.length > 0 && (
            <div>
              <span className="text-sm font-semibold text-stealth-300 block mb-2">
                <DerivedLabel label="Top Accumulators (Recent Quarter)" />
              </span>
              <div className="space-y-1">
                {cb_holdings.slice(0, 5).map((holding, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-stealth-300">
                    <span>{idx + 1}. {holding.country}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-stealth-500 mt-3">* Derived from ingested data</p>
        </div>
      </div>
    );
  }

function PriceAnchorsPanel({ indicators, correlations }: { indicators: MetalIndicators; correlations: CorrelationMatrix | null }) {
  const anchors = indicators.price_anchors;
  const mhs = anchors.monetary_hedge_strength;
  const auDxy = anchors.au_dxy_ratio_zscore;
  const realRate = anchors.real_rate_signal;
  const mhsColor = isNumber(mhs) ? (mhs > 0 ? "text-green-400" : "text-red-400") : "text-stealth-400";
  const mhsBarColor = isNumber(mhs) ? (mhs > 0 ? "bg-green-500" : "bg-red-500") : "bg-stealth-600";
  const mhsWidth = isNumber(mhs) ? Math.min(Math.abs((mhs / 100) * 100), 100) : 0;
  const auDxyClass = isNumber(auDxy)
    ? (Math.abs(auDxy) > 1.5 ? "text-red-400" : "text-yellow-400")
    : "text-stealth-400";
  const auDxyText = isNumber(auDxy)
    ? `${auDxy > 0 ? "+" : ""}${auDxy.toFixed(2)} sigma`
    : "n/a";
  const auDxySummary = isNumber(auDxy)
    ? (Math.abs(auDxy) > 2
      ? "Warning: Extreme deviation from 2Y norm"
      : Math.abs(auDxy) > 1.5
        ? "High valuation"
        : "Normal range")
    : "Data unavailable";
  const realRateColor = isNumber(realRate) ? (realRate < 0 ? "text-green-400" : "text-red-400") : "text-stealth-400";
  const corrAuSpy = correlations?.au_spy;
  const corrAuTlt = correlations?.au_tlt;
  const corrAuDxy = correlations?.au_dxy;
  const corrAuVix = correlations?.au_vix;
  return (
    <div className="primary-card p-4 md:p-6">
      <h3 className="text-lg font-bold mb-4 text-white">Where Prices Tend to Bounce or Break</h3>
      <p className="text-xs text-stealth-400 mb-4">Shows if metals are expensive/cheap vs currencies, interest rates, and inflation</p>

      <div className="space-y-4">
        {/* MHS Score */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="Monetary Hedge Strength" />
              </span>
              <span className={`text-lg font-bold ${mhsColor}`}>
                {formatValue(mhs, 0)}
              </span>
            </div>
            <div className="w-full bg-stealth-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${mhsBarColor}`}
                style={{ width: `${mhsWidth}%` }}
              />
            </div>
            <p className="text-xs text-stealth-400 mt-1">-100 to +100: Is gold priced as currency or commodity?</p>
          </div>

        {/* Au/DXY Z-Score */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="Au/DXY Ratio (Z-Score)" />
              </span>
              <span className={`text-lg font-bold ${auDxyClass}`}>
                {auDxyText}
              </span>
            </div>
            <p className="text-xs text-stealth-400">{auDxySummary}</p>
          </div>

        {/* Real Rate Signal */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="Real Rate Signal" />
              </span>
              <span className={`text-lg font-bold ${realRateColor}`}>
                {formatValue(realRate, 2)}
              </span>
            </div>
            <p className="text-xs text-stealth-400">Negative = lower real rates favor gold</p>
          </div>

        {/* Correlation Summary */}
          <div className="border-t border-stealth-600 pt-3 mt-3">
            <span className="text-xs font-semibold text-stealth-300 block mb-2">
              <DerivedLabel label="Key Correlations (60-day)" />
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-stealth-400">Au {"<->"} SPY:</span>
                <span className="text-stealth-300">{formatSignedValue(corrAuSpy, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stealth-400">Au {"<->"} TLT:</span>
                <span className="text-stealth-300">{formatSignedValue(corrAuTlt, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stealth-400">Au {"<->"} DXY:</span>
                <span className="text-stealth-300">{formatSignedValue(corrAuDxy, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stealth-400">Au {"<->"} VIX:</span>
                <span className="text-stealth-300">{formatSignedValue(corrAuVix, 2)}</span>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

function RelativeValuePanel({ indicators }: { indicators: MetalIndicators }) {
  const rv = indicators.relative_value;
  const auAg = rv.au_ag_ratio;
  const auAgZ = rv.au_ag_ratio_zscore;
  const ptAu = rv.pt_au_ratio;
  const ptAuZ = rv.pt_au_ratio_zscore;
  const pdAu = rv.pd_au_ratio;
  const pdAuZ = rv.pd_au_ratio_zscore;
  return (
    <div className="primary-card p-4 md:p-6">
      <h3 className="text-lg font-bold mb-4 text-white">Which Metal Is Cheap vs Others</h3>
      <p className="text-xs text-stealth-400 mb-4">When ratios stretch beyond normal ranges, one metal is likely oversold or overbought</p>

      <div className="space-y-4">
        {/* Au/Ag Ratio */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label={
                  <span>
                    <span style={{ color: getMetalColor('AU') }}>Au</span>/
                    <span style={{ color: getMetalColor('AG') }}>Ag</span> Ratio
                  </span>
                } />
              </span>
              <span className="text-lg font-bold text-blue-300">
                {isNumber(auAg) ? auAg.toFixed(1) : "n/a"}
              </span>
            </div>
            <div className="flex justify-between text-xs text-stealth-400 mb-2">
              <span>Z-Score: {isNumber(auAgZ) ? `${auAgZ.toFixed(2)} sigma` : "n/a"}</span>
              <span className={
                isNumber(auAg)
                  ? (auAg > 70 ? "text-red-400" : auAg < 50 ? "text-green-400" : "text-yellow-400")
                  : "text-stealth-400"
              }>
                {isNumber(auAg)
                  ? (auAg > 70 ? "Monetary stress bias" : auAg < 50 ? "Industrial demand" : "Balanced")
                  : "Unknown"}
              </span>
            </div>
          <div className="bg-stealth-700 rounded p-2">
            <div className="flex justify-between text-xs text-stealth-400">
              <span>50 (Industrial)</span>
              <span>65 (Balanced)</span>
              <span>75 (Stress)</span>
            </div>
          </div>
        </div>

        {/* Pt/Au Ratio */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label={
                  <span>
                    <span style={{ color: getMetalColor('PT') }}>Pt</span>/
                    <span style={{ color: getMetalColor('AU') }}>Au</span> Ratio
                  </span>
                } />
              </span>
              <span className="text-lg font-bold text-blue-300">
                {isNumber(ptAu) ? ptAu.toFixed(3) : "n/a"}
              </span>
            </div>
            <div className="flex justify-between text-xs text-stealth-400">
              <span>Z-Score: {isNumber(ptAuZ) ? `${ptAuZ.toFixed(2)} sigma` : "n/a"}</span>
              <span className={isNumber(ptAuZ) ? (ptAuZ < -1 ? "text-red-400" : "text-green-400") : "text-stealth-400"}>
                {isNumber(ptAuZ) ? (ptAuZ < -1 ? "Industrial stress marker" : "Growth neutral") : "Unknown"}
              </span>
            </div>
          </div>

        {/* Pd/Au Ratio */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label={
                  <span>
                    <span style={{ color: getMetalColor('PD') }}>Pd</span>/
                    <span style={{ color: getMetalColor('AU') }}>Au</span> Ratio
                  </span>
                } />
              </span>
              <span className="text-lg font-bold text-blue-300">
                {isNumber(pdAu) ? pdAu.toFixed(3) : "n/a"}
              </span>
            </div>
            <p className="text-xs text-stealth-400">
              Z-Score: {isNumber(pdAuZ) ? `${pdAuZ.toFixed(2)} sigma` : "n/a"} - Indicator of auto cycle demand
            </p>
          </div>
      </div>
    </div>
  );
}

function PhysicalPaperPanel({ indicators }: { indicators: MetalIndicators }) {
  const pp = indicators.physical_paper;
  const pci = pp.paper_credibility_index;
  const holdingsZ = pp.etf_holdings_zscore;
  const holdingsYoY = pp.etf_holdings_change_yoy;
  const oiRatio = pp.oi_registered_ratio;
  const comexChange = pp.comex_registered_inventory_change_yoy;
  const backwardation = pp.backwardation_severity;
  const useEtfZ = isNumber(holdingsZ);
  const useEtfYoY = isNumber(holdingsYoY);
  const pciColor = isNumber(pci)
    ? (pci > 75 ? "text-green-400" : pci > 50 ? "text-yellow-400" : "text-red-400")
    : "text-stealth-400";
  const pciBarColor = isNumber(pci)
    ? (pci > 75 ? "bg-green-500" : pci > 50 ? "bg-yellow-500" : "bg-red-500")
    : "bg-stealth-600";
  const yoyColor = isNumber(holdingsYoY)
    ? (holdingsYoY < -2 ? "text-red-400" : "text-green-400")
    : isNumber(comexChange)
      ? (comexChange < -5 ? "text-red-400" : "text-yellow-400")
      : "text-stealth-400";
  const backwardationText = isNumber(backwardation)
    ? `${backwardation.toFixed(0)}`
    : "n/a";
  return (
    <div className="primary-card p-4 md:p-6">
      <h3 className="text-lg font-bold mb-4 text-white">Is There a Physical Squeeze Brewing?</h3>
      <p className="text-xs text-stealth-400 mb-4">Shows if paper contracts are overwhelming physical supply (precursor to price spikes)</p>

      <div className="space-y-4">
        {/* PCI Score */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="Paper Credibility Index (PCI)" />
              </span>
              <span className={`text-lg font-bold ${pciColor}`}>
                {formatValue(pci, 0)}
              </span>
            </div>
            <div className="w-full bg-stealth-700 rounded-full h-3">
              <div
                className={`h-3 rounded-full ${pciBarColor}`}
                style={{ width: `${isNumber(pci) ? pci : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-stealth-400 mt-1">
              <span>0 (Stress)</span>
              <span>50 (Caution)</span>
              <span>75+ (Healthy)</span>
            </div>
          </div>

        {/* OI / Registered Ratio */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label={useEtfZ ? "GLD Holdings (Z-Score)" : "Futures OI / Registered Inventory"} />
              </span>
              <span className="text-lg font-bold text-blue-300">
                {useEtfZ
                  ? `${formatSignedValue(holdingsZ, 2)} sigma`
                  : isNumber(oiRatio)
                    ? `${oiRatio.toFixed(2)}x`
                    : "n/a"}
              </span>
            </div>
            <p className="text-xs text-stealth-400">
              {useEtfZ
                ? "ETF holdings vs 2Y norm (yfinance)."
                : isNumber(oiRatio)
                  ? `Normal: 0.9-1.0x. ${oiRatio > 1.3 ? "Warning: Elevated stress" : "Healthy"}`
                  : "Data unavailable"}
            </p>
          </div>

        {/* Inventory Change */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label={useEtfYoY ? "GLD Holdings (YoY %)" : "Registered Inventory (YoY %)"} />
              </span>
              <span className={`text-lg font-bold ${yoyColor}`}>
                {useEtfYoY
                  ? `${formatSignedValue(holdingsYoY, 1)}%`
                  : isNumber(comexChange)
                    ? `${comexChange.toFixed(0)}%`
                    : "n/a"}
              </span>
            </div>
            <p className="text-xs text-stealth-400">
              {useEtfYoY
                ? "Change in ETF holdings over 12 months."
                : isNumber(comexChange)
                  ? (comexChange < -10
                    ? "Warning: Significant decline-monitor tightness"
                    : "Normal range")
                  : "Data unavailable"}
            </p>
          </div>

        {/* Backwardation */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-stealth-300">
                <DerivedLabel label="Backwardation Severity (bps)" />
              </span>
              <span className="text-lg font-bold text-blue-300">{backwardationText}</span>
            </div>
            <p className="text-xs text-stealth-400">
              {isNumber(backwardation)
                ? (backwardation > 500 ? "Warning: Deep backwardation = stress" : "Normal contango structure")
                : "Data unavailable"}
            </p>
          </div>
      </div>
    </div>
  );
}

function FuturesCurvePanel({ futuresCurve }: { futuresCurve: FuturesCurveResponse | null }) {
  const [selectedMetal, setSelectedMetal] = useState("AU");
  const [curveView, setCurveView] = useState<"spread" | "log">("spread");
  const metals = futuresCurve?.metals ?? [];
  const activeCurve = metals.find((item) => item.metal === selectedMetal) ?? metals[0] ?? null;
  const activeColor = activeCurve ? getMetalColor(activeCurve.metal) : getFamilyColor("metals");
  const curveBps = activeCurve?.curve_bps ?? null;
  const curveLabel = activeCurve?.curve_state === "BACKWARDATION"
    ? "Backwardation"
    : activeCurve?.curve_state === "CONTANGO"
      ? "Contango"
      : "Flat";
  const curveSummary = activeCurve && isNumber(curveBps)
    ? activeCurve.curve_state === "BACKWARDATION"
      ? `Front-month ${activeCurve.label.toLowerCase()} is pricing ${Math.abs(curveBps).toFixed(0)} bps above the furthest nearby contract.`
      : activeCurve.curve_state === "CONTANGO"
        ? `Deferred ${activeCurve.label.toLowerCase()} is pricing ${Math.abs(curveBps).toFixed(0)} bps above the front month.`
        : `${activeCurve.label} is trading on a mostly flat nearby curve.`
    : "Nearby contract quotes are unavailable.";
  const frontPrice = activeCurve?.contracts[0]?.price ?? null;
  const chartData = activeCurve?.contracts.map((contract) => ({
    contract: contract.contract_label,
    price: contract.price,
    logPrice: contract.price > 0 ? contract.price : null,
    spreadPct: isNumber(frontPrice) && frontPrice > 0
      ? ((contract.price / frontPrice) - 1) * 100
      : null,
    change_pct: contract.change_pct,
    volume: contract.volume,
  })) ?? [];
  const positivePrices = chartData
    .map((point) => point.price)
    .filter((value): value is number => isNumber(value) && value > 0);
  const minPrice = positivePrices.length > 0 ? Math.min(...positivePrices) : undefined;
  const maxPrice = positivePrices.length > 0 ? Math.max(...positivePrices) : undefined;
  const chartMetric = curveView === "log" ? "logPrice" : "spreadPct";
  const chartTitle = curveView === "log" ? "Log price curve" : "Curve spread vs front month";
  const chartSubtitle = curveView === "log"
    ? "Log scale keeps higher-priced contracts readable while preserving the curve slope."
    : "Front contract rebased to 0% so contango and backwardation stand out immediately.";

  return (
    <div className="primary-card p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white">Nearby Futures Curve</h3>
          <p className="text-xs text-stealth-400 mt-1">Uses the next few listed contracts to show whether the metals complex is paying up for nearby delivery or for time.</p>
        </div>
        <div className="text-xs text-stealth-500">
          {futuresCurve?.as_of ? `As of ${futuresCurve.as_of.slice(0, 16).replace("T", " ")}` : "Live quote timing unavailable"}
        </div>
      </div>

      {metals.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {metals.map((metal) => {
              const isActive = metal.metal === activeCurve?.metal;
              return (
                <button
                  key={metal.metal}
                  type="button"
                  onClick={() => setSelectedMetal(metal.metal)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${isActive ? "border-stealth-400 bg-stealth-700 text-white" : "border-stealth-700 bg-stealth-900/70 text-stealth-300 hover:border-stealth-500 hover:text-white"}`}
                >
                  {metal.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-sm font-semibold text-white">{chartTitle}</div>
              <div className="text-xs text-stealth-400 mt-1">{chartSubtitle}</div>
            </div>
            <div className="inline-flex rounded-full border border-stealth-700 bg-stealth-950/80 p-1">
              <button
                type="button"
                onClick={() => setCurveView("spread")}
                className={`rounded-full px-3 py-1 text-xs transition ${curveView === "spread" ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-white"}`}
              >
                Spread %
              </button>
              <button
                type="button"
                onClick={() => setCurveView("log")}
                className={`rounded-full px-3 py-1 text-xs transition ${curveView === "log" ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-white"}`}
              >
                Log Price
              </button>
            </div>
          </div>

          {activeCurve && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.9fr)] gap-4">
              <div className="bg-stealth-900/55 rounded-xl border border-stealth-800 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: activeColor }}>{activeCurve.label}</div>
                    <div className="text-xs text-stealth-400 mt-1">{curveSummary}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-[0.18em] text-stealth-500">Curve Shape</div>
                    <div className="text-base font-bold" style={{ color: activeColor }}>
                      {curveLabel}{isNumber(curveBps) ? ` ${curveBps > 0 ? "+" : ""}${curveBps.toFixed(0)} bps` : ""}
                    </div>
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="contract"
                      stroke={CHART_NEUTRAL.axis}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 11 }}
                    />
                    <YAxis
                      stroke={CHART_NEUTRAL.axis}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 11 }}
                      scale={curveView === "log" ? "log" : "auto"}
                      domain={curveView === "log" && minPrice && maxPrice ? [minPrice * 0.998, maxPrice * 1.002] : ["auto", "auto"]}
                      tickFormatter={(value) => curveView === "log" ? `$${Number(value).toFixed(0)}` : `${Number(value).toFixed(2)}%`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: "4px" }}
                      formatter={(value: number, key: string) => {
                        if (key === "change_pct") return [`${value.toFixed(2)}%`, "1D change"];
                        if (key === "volume") return [value?.toLocaleString?.() ?? "n/a", "Volume"];
                        if (key === "spreadPct") return [`${value.toFixed(2)}%`, "Vs front month"];
                        return [`$${value.toFixed(2)}`, "Price"];
                      }}
                    />
                    {curveView === "spread" && <ReferenceLine y={0} stroke={CHART_NEUTRAL.axis} strokeDasharray="4 4" />}
                    <Line
                      type="monotone"
                      dataKey={chartMetric}
                      stroke={activeColor}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: activeColor, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: activeColor }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                {activeCurve.contracts.map((contract) => (
                  <div key={contract.symbol} className="bg-stealth-900/55 rounded-xl border border-stealth-800 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{contract.contract_label}</div>
                        <div className="text-xs text-stealth-500 mt-1">{contract.symbol}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold" style={{ color: activeColor }}>${contract.price.toFixed(2)}</div>
                        <div className={`text-xs ${contract.change_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {contract.change_pct >= 0 ? "+" : ""}{contract.change_pct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-stealth-400">
                      <span>Prev close ${contract.previous_close.toFixed(2)}</span>
                      <span>{contract.volume != null ? `${contract.volume.toLocaleString()} vol` : "Volume n/a"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-stealth-400">Nearby futures contracts are unavailable right now.</div>
      )}
    </div>
  );
}

function SupplyPanel({ supply_data }: { supply_data: SupplyData[] | null }) {
  return (
    <div className="primary-card p-4 md:p-6">
      <h3 className="text-lg font-bold mb-4 text-white">Are Miners Profitable or Squeezed?</h3>
      <p className="text-xs text-stealth-400 mb-4">Low margins = production cuts ahead = tighter supply = bullish</p>

        {supply_data && supply_data.length > 0 ? (
          <div className="space-y-4">
            {supply_data.map((metal, idx) => (
              <div key={idx} className="border-b border-stealth-600 pb-3 last:border-b-0">
                {(() => {
                  const prod = metal.production_tonnes_yoy_pct;
                  const prodColor = isNumber(prod)
                    ? (prod < 0 ? "text-red-400" : "text-green-400")
                    : "text-stealth-400";
                  const prodText = isNumber(prod)
                    ? `${prod > 0 ? "+" : ""}${prod.toFixed(0)}% YoY`
                    : "n/a";
                  const marginColor = isNumber(metal.margin_pct)
                    ? (metal.margin_pct > 50 ? "text-green-400" : "text-yellow-400")
                    : "text-stealth-400";
                  return (
                    <>
                      <div className="flex justify-between items-start mb-2">
                        <span 
                          className="text-sm font-semibold" 
                          style={{ color: getMetalColor(metal.metal) }}
                        >
                          {getMetalName(metal.metal)} ({metal.metal})
                        </span>
                        <span className={`text-xs font-bold ${prodColor}`}>
                          {prodText}
                        </span>
                      </div>
                      <div className="text-xs text-stealth-400 space-y-1">
                        <div className="flex justify-between">
                          <span>AISC: {isNumber(metal.aisc_per_oz) ? `$${metal.aisc_per_oz.toFixed(0)}/oz` : "n/a"}</span>
                          <span>Spot: {isNumber(metal.current_spot_price) ? `$${metal.current_spot_price.toFixed(0)}/oz` : "n/a"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Margin:</span>
                          <span className={marginColor}>
                            {isNumber(metal.margin_pct) ? `${metal.margin_pct.toFixed(0)}%` : "n/a"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Recycling:</span>
                          <span>
                            {isNumber(metal.recycling_pct_of_supply)
                              ? `${metal.recycling_pct_of_supply.toFixed(0)}% of supply`
                              : "n/a"}
                          </span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
      ) : (
        <p className="text-sm text-stealth-400">Supply data loading...</p>
      )}
    </div>
  );
}

function DemandPanel({ demand_data }: { demand_data: DemandData[] | null }) {
  const categoryColors = {
    investment: getFamilyColor("market"),
    industrial: getFamilyColor("industrials"),
    jewelry: getFamilyColor("consumer"),
    other: getFamilyColor("benchmark"),
  };

  return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-lg font-bold mb-4 text-white">Who's Buying and Why</h3>
        <p className="text-xs text-stealth-400 mb-4">Industrial demand = economy strong, Investment demand = fear rising, Jewelry = wealth in Asia</p>

        {demand_data && demand_data.length > 0 ? (
          <div className="space-y-4">
            {demand_data.map((metal, idx) => {
              const parts = [
                metal.investment_tonnes,
                metal.industrial_tonnes,
                metal.jewelry_tonnes,
                metal.other_tonnes
              ].filter(isNumber);
              const fallbackTotal = parts.reduce((sum: number, value: number) => sum + value, 0);
              const total = isNumber(metal.total_tonnes) ? metal.total_tonnes : fallbackTotal;
              const hasTotal = isNumber(total) && total > 0;
              const categories = [
                { label: "Investment", value: metal.investment_tonnes, pct: hasTotal && isNumber(metal.investment_tonnes) ? (metal.investment_tonnes / total) * 100 : null, color: categoryColors.investment },
                { label: "Industrial", value: metal.industrial_tonnes, pct: hasTotal && isNumber(metal.industrial_tonnes) ? (metal.industrial_tonnes / total) * 100 : null, color: categoryColors.industrial },
                { label: "Jewelry", value: metal.jewelry_tonnes, pct: hasTotal && isNumber(metal.jewelry_tonnes) ? (metal.jewelry_tonnes / total) * 100 : null, color: categoryColors.jewelry },
                { label: "Other", value: metal.other_tonnes, pct: hasTotal && isNumber(metal.other_tonnes) ? (metal.other_tonnes / total) * 100 : null, color: categoryColors.other }
              ].filter((cat): cat is typeof cat & { value: number } => isNumber(cat.value) && cat.value > 0);

            return (
              <div key={idx} className="border-b border-stealth-600 pb-3 last:border-b-0">
                  <div className="flex justify-between items-start mb-2">
                    <span 
                      className="text-sm font-semibold" 
                      style={{ color: getMetalColor(metal.metal) }}
                    >
                      {getMetalName(metal.metal)} ({metal.metal})
                    </span>
                    <span className="text-xs text-stealth-400">{metal.period}</span>
                  </div>
                  
                  {categories.length > 0 ? (
                    <>
                      {/* Stacked bar showing demand composition */}
                      <div className="w-full h-6 bg-stealth-700 rounded overflow-hidden flex mb-2">
                        {categories.map((cat, i) => (
                          <div
                            key={i}
                            style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                            className="flex items-center justify-center text-[10px] font-bold text-white"
                            title={`${cat.label}: ${cat.value.toFixed(0)}t (${cat.pct?.toFixed(1)}%)`}
                          >
                            {isNumber(cat.pct) && cat.pct > 8 ? `${cat.pct.toFixed(0)}%` : ""}
                          </div>
                        ))}
                      </div>
        
                      {/* Legend and values */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {categories.map((cat, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 rounded" style={{ backgroundColor: cat.color }} />
                              <span className="text-stealth-400">{cat.label}:</span>
                            </div>
                            <span className="text-stealth-200 font-semibold">{cat.value.toFixed(0)}t</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-stealth-500">Demand breakdown unavailable.</div>
                  )}
                </div>
              );
            })}
        </div>
      ) : (
        <p className="text-sm text-stealth-400">Demand data loading...</p>
      )}
    </div>
  );
}

function MarketCapPanel({ market_caps, market_caps_history }: { market_caps: MarketCapsResponse | null; market_caps_history: MarketCapsHistoryResponse | null }) {
  if (!market_caps || !market_caps_history) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-lg font-bold mb-4 text-white">How Big Is This Asset Class?</h3>
        <p className="text-sm text-stealth-400">Loading market cap data...</p>
      </div>
    );
  }

  const formatMarketCap = (value: number | null | undefined) => {
    if (!isNumber(value)) return "n/a";
    if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(0)}B`;
    return `$${(value / 1e6).toFixed(0)}M`;
  };

  const gold_cap = market_caps.metals?.AU?.market_cap_usd ?? null;
  const total_cap = market_caps.total_market_cap_usd ?? null;
  const m2_ratio = market_caps.metals_to_m2_pct ?? null;
  const m2_ratio_bps = isNumber(m2_ratio) ? m2_ratio * 100 : null;
  
  const gold_pct = isNumber(total_cap) && isNumber(gold_cap) && total_cap > 0
    ? (gold_cap / total_cap * 100)
    : null;
  const others_cap = isNumber(total_cap) && isNumber(gold_cap)
    ? total_cap - gold_cap
    : null;

  // Calculate scenario prices (derived from ingested pricing when available)
  const gold_price = market_caps.metals?.AU?.price_usd_per_oz ?? null;
  const scenario_3k_total = isNumber(gold_price) && isNumber(total_cap)
    ? (3000 / gold_price) * total_cap
    : null;
  const scenario_5k_total = isNumber(gold_price) && isNumber(total_cap)
    ? (5000 / gold_price) * total_cap
    : null;
  const history = market_caps_history?.history || [];
  const ratioHistory = history
    .filter((entry) => isNumber(entry?.metals_to_m2_pct))
    .map((entry) => ({
      ...entry,
      year: Number(String(entry.date).slice(0, 4)),
      metals_to_m2_bps: (entry.metals_to_m2_pct as number) * 100,
    }));
  const yearlyRatioHistory = Object.values(
    ratioHistory.reduce((acc: Record<number, { year: number; sum: number; count: number }>, entry) => {
      if (!isNumber(entry.year) || !isNumber(entry.metals_to_m2_bps)) {
        return acc;
      }
      if (!acc[entry.year]) {
        acc[entry.year] = { year: entry.year, sum: 0, count: 0 };
      }
      acc[entry.year].sum += entry.metals_to_m2_bps;
      acc[entry.year].count += 1;
      return acc;
    }, {})
  )
    .map((entry) => ({
      year: entry.year,
      metals_to_m2_bps: entry.count ? entry.sum / entry.count : 0,
    }))
    .filter((entry) => entry.metals_to_m2_bps > 0)
    .sort((a, b) => a.year - b.year);
  const minPositiveBps = yearlyRatioHistory.reduce((min, entry) => {
    if (!isNumber(entry.metals_to_m2_bps) || entry.metals_to_m2_bps <= 0) {
      return min;
    }
    return Math.min(min, entry.metals_to_m2_bps);
  }, Number.POSITIVE_INFINITY);
  const hasLogHistory = Number.isFinite(minPositiveBps);
  const latestHistory = history.length ? history[history.length - 1] : null;
  const formatBps = (value: number) => {
    if (!isNumber(value)) return "n/a";
    if (Math.abs(value) < 0.01) return "<0.01";
    return value.toFixed(2);
  };

  return (
    <div className="primary-card p-4 md:p-6">
        <h3 className="text-lg font-bold mb-4 text-white">How Big Is This Asset Class?</h3>
        <p className="text-xs text-stealth-400 mb-1">Tiny markets = easier to move = more volatility = bigger % gains possible</p>
        <p className="text-xs text-stealth-500 mb-4">Tracked holdings use ETF assets plus central bank gold.</p>
      <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-stealth-700 rounded p-3">
              <div className="text-stealth-400 text-xs mb-1">
                Gold ({isNumber(gold_pct) ? `${gold_pct.toFixed(1)}%` : "n/a"})
              </div>
              <div className="text-lg font-bold text-blue-300">{formatMarketCap(gold_cap)}</div>
              <div className="text-xs text-stealth-500">
                {isNumber(market_caps.metals?.AU?.stock_oz) && isNumber(gold_price)
                  ? `${(market_caps.metals.AU.stock_oz / 1e9).toFixed(1)}B oz tracked @ $${gold_price.toFixed(0)}/oz`
                  : "n/a"}
              </div>
            </div>
            <div className="bg-stealth-700 rounded p-3">
              <div className="text-stealth-400 text-xs mb-1">Other 3 Metals</div>
              <div className="text-lg font-bold text-blue-300">{formatMarketCap(others_cap)}</div>
              <div className="text-xs text-stealth-500">Silver, Platinum, Palladium</div>
            </div>
          </div>
            <div className="bg-stealth-700 rounded p-3">
              <div className="text-stealth-400 text-xs mb-2">
                <DerivedLabel label="Tracked Ratio to Global M2" />
              </div>
              <div className="flex justify-between items-center">
                <span>Tracked Metals / M2:</span>
                <span className="text-lg font-bold text-blue-300">
                  {isNumber(m2_ratio_bps) ? `${m2_ratio_bps.toFixed(2)} bps` : "n/a"}
                </span>
              </div>
            </div>
        
        {/* Annual Average History Chart */}
            <div className="border-t border-stealth-600 pt-4 mt-4">
              <div className="text-stealth-400 text-xs mb-3 font-semibold">
                Tracked Metals/M2 Annual Average (log scale)
              </div>
            {yearlyRatioHistory.length > 0 && hasLogHistory ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={yearlyRatioHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
                    <XAxis
                      dataKey="year"
                      stroke={CHART_NEUTRAL.axis}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      tickFormatter={(value) => String(value)}
                    />
                    <YAxis
                      stroke={CHART_NEUTRAL.axis}
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      scale="log"
                      domain={[minPositiveBps * 0.8, 'auto']}
                      tickFormatter={(value) => formatBps(Number(value))}
                      label={{ value: 'Metals/M2 (bps, log)', angle: -90, position: 'insideLeft', style: { fill: CHART_NEUTRAL.label, fontSize: 10 } }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: CHART_NEUTRAL.tooltipBg, border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`, borderRadius: '4px' }}
                      formatter={(value: number) => [`${formatBps(Number(value))} bps`, 'Metals/M2']}
                      labelFormatter={(year) => `Year: ${year}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="metals_to_m2_bps"
                      stroke={getFamilyColor("metals")}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: getFamilyColor("metals") }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                  <p className="text-xs text-stealth-500 mt-2">
                    Latest daily: {isNumber(m2_ratio_bps) ? `${m2_ratio_bps.toFixed(2)} bps` : "n/a"}.
                  </p>
                </>
              ) : (
                <div className="text-xs text-stealth-500">
                  Tracked metals/M2 ratio uses ETF assets and CB gold holdings. Latest gold price and global M2 shown below.
                  {latestHistory && (
                    <div className="mt-2 text-stealth-400">
                    Gold: {isNumber(latestHistory.gold_price) ? `$${latestHistory.gold_price.toFixed(2)}` : "n/a"} ·
                    Global M2: {isNumber(latestHistory.global_m2_trillions) ? `${latestHistory.global_m2_trillions.toFixed(2)}T` : "n/a"}
                  </div>
                )}
              </div>
            )}
          </div>
          
          <p className="text-xs text-stealth-400 border-t border-stealth-600 pt-3 mt-3">
            Non-predictive scenarios: If Au {"->"} $3,000/oz, metals {"->"} {formatMarketCap(scenario_3k_total)}. 
            If Au {"->"} $5,000/oz, {"->"} {formatMarketCap(scenario_5k_total)}.
          </p>
      </div>
    </div>
  );
}

function CorrelationPanel({ correlations }: { correlations: CorrelationMatrix | null }) {
  if (!correlations) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-lg font-bold mb-4 text-white">Volatility & Correlation</h3>
        <p className="text-sm text-stealth-400">Correlation data loading...</p>
      </div>
    );
  }
  const formatCorr = (value: number | null | undefined) =>
    isNumber(value) ? value.toFixed(2) : "n/a";

  return (
    <div className="primary-card p-4 md:p-6">
      <h3 className="text-lg font-bold mb-4 text-white">Does Gold Zig When Stocks Zag?</h3>
      <p className="text-xs text-stealth-400 mb-4">Negative correlation to stocks/dollar = working as a hedge. Positive = riding the same wave.</p>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-stealth-400 border-b border-stealth-600">
            <tr>
              <th className="text-left py-2">Pair</th>
              <th className="text-right py-2">Correlation</th>
              <th className="text-right py-2">Interpretation</th>
            </tr>
          </thead>
          <tbody className="text-xs text-stealth-300">
            <tr className="border-b border-stealth-700">
              <td className="py-2">
                <span style={{ color: getMetalColor('AU') }}>Au</span> {"<->"} <span style={{ color: getMetalColor('AG') }}>Ag</span>
              </td>
                <td className="text-right font-semibold">{formatCorr(correlations.au_ag)}</td>
              <td className="text-right">High correlation (both monetary)</td>
            </tr>
            <tr className="border-b border-stealth-700">
              <td className="py-2">
                <span style={{ color: getMetalColor('AU') }}>Au</span> {"<->"} SPY
              </td>
                <td className="text-right font-semibold">{formatCorr(correlations.au_spy)}</td>
              <td className="text-right">Diversification benefit</td>
            </tr>
            <tr className="border-b border-stealth-700">
              <td className="py-2">
                <span style={{ color: getMetalColor('AU') }}>Au</span> {"<->"} TLT
              </td>
                <td className="text-right font-semibold">{formatCorr(correlations.au_tlt)}</td>
              <td className="text-right">Bond substitute marker</td>
            </tr>
            <tr className="border-b border-stealth-700">
              <td className="py-2">
                <span style={{ color: getMetalColor('AU') }}>Au</span> {"<->"} DXY
              </td>
                <td className="text-right font-semibold">{formatCorr(correlations.au_dxy)}</td>
              <td className="text-right">Currency hedge effect</td>
            </tr>
            <tr>
              <td className="py-2">
                <span style={{ color: getMetalColor('AU') }}>Au</span> {"<->"} VIX
              </td>
                <td className="text-right font-semibold">{formatCorr(correlations.au_vix)}</td>
              <td className="text-right">Stress indicator</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-3 bg-stealth-700 rounded text-xs text-stealth-400 border-l-2 border-blue-500">
        <strong>Note:</strong> Correlations change with market regime. Breakdowns {'>'} +/-2sigma can indicate regime shifts. Use as
        regime confirmation, not a mean-reversion cue.
      </div>
    </div>
  );
}

// ==================== PROJECTIONS PANEL ====================
function ProjectionsPanel({ projections }: { projections: MetalProjection[] }) {
  const rankedProjections = [...projections].sort((left, right) => left.rank - right.rank);
  const preciousProjections = rankedProjections.filter((proj) => METAL_CATEGORIES[proj.metal] === "precious");
  const industrialProjections = rankedProjections.filter((proj) => METAL_CATEGORIES[proj.metal] === "industrial");
  const leader = rankedProjections[0];
  const laggard = rankedProjections[rankedProjections.length - 1];
  const confirmedLeaders = preciousProjections.filter((proj) => proj.relative_confirmation?.rotation_confirmed);
  const shortTermAdvancers = rankedProjections.filter((proj) => (proj.technicals.momentum_5d ?? -Infinity) > 0).length;
  const intermediateAdvancers = rankedProjections.filter((proj) => (proj.technicals.momentum_20d ?? -Infinity) > 0).length;

  const getClassificationColor = (classification: string) => {
    switch (classification) {
      case "Strong": return "text-emerald-400";
      case "Bullish": return "text-green-400";
      case "Neutral": return "text-yellow-400";
      case "Bearish": return "text-orange-400";
      case "Weak": return "text-red-400";
      default: return "text-gray-400";
    }
  };

  const getRelativeClassColor = (relClass: "Winner" | "Neutral" | "Loser") => {
    switch (relClass) {
      case "Winner": return "bg-emerald-500/20 text-emerald-400 border-emerald-500";
      case "Loser": return "bg-red-500/20 text-red-400 border-red-500";
      default: return "bg-blue-500/20 text-blue-400 border-blue-500";
    }
  };

  const overviewHeadline = leader
    ? `${leader.metal_name} is leading the complex right now, while ${laggard?.metal_name ?? "the laggard"} remains the weakest link in the tape.`
    : "Metals leadership is unavailable.";

  const breadthRead = shortTermAdvancers > intermediateAdvancers
    ? "Short-term momentum is improving faster than the 20-day trend, which reads more like a rebound first and a full trend reset second."
    : "Short and intermediate momentum are aligned, which points to broader participation rather than a narrow bounce.";

  const confirmationRead = confirmedLeaders.length > 0
    ? `${confirmedLeaders.map((proj) => proj.metal_name).join(", ")} ${confirmedLeaders.length === 1 ? "has" : "have"} active rotation confirmation inside the precious-metal group.`
    : "No precious metal has fully confirmed rotation yet, so leadership is still tentative rather than broad-based.";

  const industrialRead = industrialProjections.length > 0
    ? `${industrialProjections[0].metal_name} is the strongest industrial read, which helps separate growth-sensitive metal strength from purely monetary hedging.`
    : "Industrial metals are not populated yet, so this read is still concentrated in the precious-metal sleeve.";

  const conclusion = leader
    ? `${leader.metal_name} remains the metal to respect, but ${breadthRead.toLowerCase()} Keep treating gold as the monetary anchor, and use palladium, copper, and aluminum as the cleaner cyclical cross-checks.`
    : "Wait for fresh metals data before drawing a tactical conclusion.";

  return (
    <div className="bg-stealth-800 p-4 md:p-6 rounded-lg border border-stealth-600">
      <h2 className="text-xl font-bold mb-4">
        Winners & Losers Right Now
      </h2>
      <p className="text-xs text-stealth-400 mb-4">Competitive ranking based on trend strength, momentum, and exhaustion risk</p>

      <div className="mb-6 rounded-lg border border-stealth-600 bg-stealth-700/60 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-stealth-400">Current Market Read</div>
        <p className="mt-2 text-sm text-stealth-100 leading-relaxed">{overviewHeadline}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
          <div className="rounded border border-stealth-600 bg-stealth-800/70 p-3 text-stealth-300">{breadthRead}</div>
          <div className="rounded border border-stealth-600 bg-stealth-800/70 p-3 text-stealth-300">{confirmationRead}</div>
          <div className="rounded border border-stealth-600 bg-stealth-800/70 p-3 text-stealth-300">{industrialRead}</div>
        </div>
        <div className="mt-4 rounded border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Conclusion</div>
          <p className="mt-1 text-sm text-stealth-100 leading-relaxed">{conclusion}</p>
        </div>
      </div>

      {/* Winners and Losers Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {rankedProjections.map((proj) => (
          <div
            key={proj.metal}
            className={`p-3 rounded border ${getRelativeClassColor(proj.relative_classification)}`}
          >
            <div className="text-xs font-semibold mb-1">
              #{proj.rank} <span style={{ color: getMetalColor(proj.metal) }}>{proj.metal_name}</span>
            </div>
            <div className="text-lg font-bold">${proj.current_price.toFixed(2)}</div>
            <div className="text-xs mt-1">Score: {proj.score_total}/100</div>
            <div className={`text-xs mt-1 font-semibold ${getClassificationColor(proj.classification)}`}>
              {proj.classification}
            </div>
          </div>
        ))}
      </div>

      {/* Detailed Projections - Precious Metals */}
      <div className="mb-8">
        <h3 className="text-lg font-bold mb-3 text-yellow-400">Precious Metals</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {preciousProjections.map((proj) => (
            <div key={proj.metal} className="bg-stealth-700 p-4 rounded border border-stealth-600">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-lg">
                    <span style={{ color: getMetalColor(proj.metal) }}>{proj.metal_name}</span> ({proj.etf_symbol})
                  </h3>
                  <div className="text-sm text-stealth-400" style={{ color: getMetalColor(proj.metal) }}>
                    {proj.metal}
                  </div>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-semibold ${getRelativeClassColor(proj.relative_classification)}`}>
                  {proj.relative_classification}
                </div>
              </div>

              {/* Technical Indicators */}
              <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                <div>
                  <span className="text-stealth-400">Current:</span>
                  <span className="ml-2 font-semibold">${proj.current_price.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-stealth-400">RSI:</span>
                  <span className="ml-2 font-semibold">{proj.technicals.rsi?.toFixed(1) || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-stealth-400">SMA 20:</span>
                  <span className="ml-2 font-semibold">${proj.technicals.sma_20?.toFixed(2) || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-stealth-400">SMA 50:</span>
                  <span className="ml-2 font-semibold">${proj.technicals.sma_50?.toFixed(2) || 'N/A'}</span>
                </div>
              </div>

              {/* Momentum */}
              <div className="mb-3">
                <div className="text-xs text-stealth-400 mb-1">Momentum</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-stealth-400">5d:</span>
                    <span className={`ml-1 font-semibold ${(proj.technicals.momentum_5d || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {proj.technicals.momentum_5d?.toFixed(1) || 'N/A'}%
                    </span>
                  </div>
                  <div>
                    <span className="text-stealth-400">20d:</span>
                    <span className={`ml-1 font-semibold ${(proj.technicals.momentum_20d || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {proj.technicals.momentum_20d?.toFixed(1) || 'N/A'}%
                    </span>
                  </div>
                  <div>
                    <span className="text-stealth-400">60d:</span>
                    <span className={`ml-1 font-semibold ${(proj.technicals.momentum_60d || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {proj.technicals.momentum_60d?.toFixed(1) || 'N/A'}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Support and Resistance */}
              <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                <div>
                  <div className="text-stealth-400 mb-1">Support Levels</div>
                  {proj.levels.support.length > 0 ? (
                    proj.levels.support.map((level, idx) => (
                      <div key={idx} className="text-green-400 font-semibold">
                        ${level.toFixed(2)}
                      </div>
                    ))
                  ) : (
                    <div className="text-stealth-500">None detected</div>
                  )}
                </div>
                <div>
                  <div className="text-stealth-400 mb-1">Resistance Levels</div>
                  {proj.levels.resistance.length > 0 ? (
                    proj.levels.resistance.map((level, idx) => (
                      <div key={idx} className="text-red-400 font-semibold">
                        ${level.toFixed(2)}
                      </div>
                    ))
                  ) : (
                    <div className="text-stealth-500">None detected</div>
                  )}
                </div>
              </div>

              {/* Reference Levels */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-stealth-600">
                <div>
                  <span className="text-stealth-400">Upper:</span>
                  <span className="ml-2 text-green-400 font-semibold">${proj.levels.take_profit.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-stealth-400">Lower:</span>
                  <span className="ml-2 text-red-400 font-semibold">${proj.levels.stop_loss.toFixed(2)}</span>
                </div>
              </div>

              {/* Score Breakdown */}
              <div className="mt-3 pt-3 border-t border-stealth-600">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stealth-400">Trend Score:</span>
                  <span className="font-semibold">{proj.score_trend}/100</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-stealth-400">Momentum Score:</span>
                  <span className="font-semibold">{proj.score_momentum}/100</span>
                </div>
              </div>

              {proj.relative_confirmation && (
                <div className="mt-3 pt-3 border-t border-stealth-600">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-stealth-400">{proj.metal_name} Relative Confirmation</span>
                    <span
                      className={`px-2 py-0.5 rounded font-semibold ${
                        proj.relative_confirmation.rotation_confirmed
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-stealth-700 text-stealth-300 border border-stealth-600"
                      }`}
                    >
                      {proj.relative_confirmation.rotation_confirmed ? "Rotation Confirmed" : "Awaiting Confirmation"}
                    </span>
                  </div>
                  {proj.relative_confirmation.metal_ratio_momentum_5d !== undefined && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-stealth-400">{proj.metal}/{proj.metal === "AU" ? "Pt,Ag,Pd" : "Au"} 5d:</span>
                        <span className={`ml-1 font-semibold ${(proj.relative_confirmation.metal_ratio_momentum_5d ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {proj.relative_confirmation.metal_ratio_momentum_5d !== null
                            ? `${proj.relative_confirmation.metal_ratio_momentum_5d > 0 ? "+" : ""}${proj.relative_confirmation.metal_ratio_momentum_5d.toFixed(2)}%`
                            : "n/a"}
                        </span>
                      </div>
                      <div>
                        <span className="text-stealth-400">{proj.metal}/{proj.metal === "AU" ? "Pt,Ag,Pd" : "Au"} 20d:</span>
                        <span className={`ml-1 font-semibold ${(proj.relative_confirmation.metal_ratio_momentum_20d ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {proj.relative_confirmation.metal_ratio_momentum_20d != null
                            ? `${proj.relative_confirmation.metal_ratio_momentum_20d > 0 ? "+" : ""}${proj.relative_confirmation.metal_ratio_momentum_20d.toFixed(2)}%`
                            : "n/a"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-stealth-600 text-xs text-stealth-300 leading-relaxed">
                <span className="text-stealth-400 font-semibold">Read:</span> {getProjectionRead(proj)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Projections - Industrial Metals */}
      <div className="mb-8">
        <h3 className="text-lg font-bold mb-3 text-blue-400">Industrial Metals</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {industrialProjections.map((proj) => (
            <div key={proj.metal} className="bg-stealth-700 p-4 rounded border border-stealth-600">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-lg">
                    <span style={{ color: getMetalColor(proj.metal) }}>{proj.metal_name}</span> ({proj.etf_symbol})
                  </h3>
                  <div className="text-sm text-stealth-400" style={{ color: getMetalColor(proj.metal) }}>
                    {proj.metal}
                  </div>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-semibold ${getRelativeClassColor(proj.relative_classification)}`}>
                  {proj.relative_classification}
                </div>
              </div>

              {/* Technical Indicators */}
              <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                <div>
                  <span className="text-stealth-400">Current:</span>
                  <span className="ml-2 font-semibold">${proj.current_price.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-stealth-400">RSI:</span>
                  <span className="ml-2 font-semibold">{proj.technicals.rsi?.toFixed(1) || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-stealth-400">SMA 20:</span>
                  <span className="ml-2 font-semibold">${proj.technicals.sma_20?.toFixed(2) || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-stealth-400">SMA 50:</span>
                  <span className="ml-2 font-semibold">${proj.technicals.sma_50?.toFixed(2) || 'N/A'}</span>
                </div>
              </div>

              {/* Momentum */}
              <div className="mb-3">
                <div className="text-xs text-stealth-400 mb-1">Momentum</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-stealth-400">5d:</span>
                    <span className={`ml-1 font-semibold ${(proj.technicals.momentum_5d || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {proj.technicals.momentum_5d?.toFixed(1) || 'N/A'}%
                    </span>
                  </div>
                  <div>
                    <span className="text-stealth-400">20d:</span>
                    <span className={`ml-1 font-semibold ${(proj.technicals.momentum_20d || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {proj.technicals.momentum_20d?.toFixed(1) || 'N/A'}%
                    </span>
                  </div>
                  <div>
                    <span className="text-stealth-400">60d:</span>
                    <span className={`ml-1 font-semibold ${(proj.technicals.momentum_60d || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {proj.technicals.momentum_60d?.toFixed(1) || 'N/A'}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Support and Resistance */}
              <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                <div>
                  <div className="text-stealth-400 mb-1">Support Levels</div>
                  {proj.levels.support.length > 0 ? (
                    proj.levels.support.map((level, idx) => (
                      <div key={idx} className="text-green-400 font-semibold">
                        ${level.toFixed(2)}
                      </div>
                    ))
                  ) : (
                    <div className="text-stealth-500">None detected</div>
                  )}
                </div>
                <div>
                  <div className="text-stealth-400 mb-1">Resistance Levels</div>
                  {proj.levels.resistance.length > 0 ? (
                    proj.levels.resistance.map((level, idx) => (
                      <div key={idx} className="text-red-400 font-semibold">
                        ${level.toFixed(2)}
                      </div>
                    ))
                  ) : (
                    <div className="text-stealth-500">None detected</div>
                  )}
                </div>
              </div>

              {/* Reference Levels */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-stealth-600">
                <div>
                  <span className="text-stealth-400">Upper:</span>
                  <span className="ml-2 text-green-400 font-semibold">${proj.levels.take_profit.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-stealth-400">Lower:</span>
                  <span className="ml-2 text-red-400 font-semibold">${proj.levels.stop_loss.toFixed(2)}</span>
                </div>
              </div>

              {/* Score Breakdown */}
              <div className="mt-3 pt-3 border-t border-stealth-600">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stealth-400">Trend Score:</span>
                  <span className="font-semibold">{proj.score_trend}/100</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-stealth-400">Momentum Score:</span>
                  <span className="font-semibold">{proj.score_momentum}/100</span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-stealth-600 text-xs text-stealth-300 leading-relaxed">
                <span className="text-stealth-400 font-semibold">Read:</span> {getProjectionRead(proj)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 p-3 bg-stealth-700 rounded text-xs text-stealth-400 border-l-2 border-blue-500">
        <strong>How to read this:</strong> Scores blend trend structure, momentum, and nearby support/resistance. A high score means leadership is broadening; a low score means the metal is lagging even if the spot price still looks elevated. Strong = {'>'} 75 total score.
      </div>
    </div>
  );
}

function PriceHistoryChart() {
  const [historyData, setHistoryData] = useState<PriceHistoryDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const metals = ['AU', 'AG', 'PT', 'PD'];
        const responses = await Promise.all(
          metals.map(metal => 
            apiFetch<PriceHistory[]>(`/precious-metals/history/${metal}?days=365`)
          )
        );

        // Combine all metal histories into a single dataset
        const auData = responses[0] || [];
        const agData = responses[1] || [];
        const ptData = responses[2] || [];
        const pdData = responses[3] || [];

        // Create a map of dates to prices
        const dateMap = new Map();

        auData.forEach((item: PriceHistory) => {
          const date = item.date.split('T')[0];
          if (!dateMap.has(date)) {
            dateMap.set(date, { date });
          }
          dateMap.get(date).AU = item.price;
        });

        agData.forEach((item: PriceHistory) => {
          const date = item.date.split('T')[0];
          if (!dateMap.has(date)) {
            dateMap.set(date, { date });
          }
          dateMap.get(date).AG = item.price;
        });

        ptData.forEach((item: PriceHistory) => {
          const date = item.date.split('T')[0];
          if (!dateMap.has(date)) {
            dateMap.set(date, { date });
          }
          dateMap.get(date).PT = item.price;
        });

        pdData.forEach((item: PriceHistory) => {
          const date = item.date.split('T')[0];
          if (!dateMap.has(date)) {
            dateMap.set(date, { date });
          }
          dateMap.get(date).PD = item.price;
        });

        const combined = Array.from(dateMap.values()).sort((a, b) => 
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        setHistoryData(combined);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching price history:', error);
        setLoading(false);
      }
    };

    fetchHistory();
  }, []);

  if (loading) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-lg font-bold mb-4 text-white">Price History (1 Year)</h3>
        <div className="text-stealth-400">Loading price history...</div>
      </div>
    );
  }

  return (
    <div className="primary-card p-4 md:p-6">
      <h3 className="text-lg font-bold mb-4 text-white">Price History (1 Year)</h3>
      
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={historyData}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL.grid} />
          <XAxis 
            dataKey="date" 
            stroke={CHART_NEUTRAL.axis}
            tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
            tickFormatter={(date) => {
              const d = new Date(date);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
          <YAxis 
            yAxisId="left"
            stroke={CHART_NEUTRAL.axis}
            tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
            label={{ value: 'Gold/Platinum/Palladium ($/oz)', angle: -90, position: 'insideLeft', fill: CHART_NEUTRAL.label }}
          />
          <YAxis 
            yAxisId="right"
            orientation="right"
            stroke={CHART_NEUTRAL.axis}
            tick={{ fill: CHART_NEUTRAL.tick, fontSize: 12 }}
            label={{ value: 'Silver ($/oz)', angle: 90, position: 'insideRight', fill: CHART_NEUTRAL.label }}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: CHART_NEUTRAL.tooltipBg, 
              border: `1px solid ${CHART_NEUTRAL.tooltipBorder}`,
              borderRadius: '0.5rem',
              color: CHART_NEUTRAL.text
            }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
            labelFormatter={(label) => new Date(label).toLocaleDateString()}
          />
          <Legend 
            wrapperStyle={{ color: CHART_NEUTRAL.tick }}
            iconType="line"
          />
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="AU" 
            stroke={getMetalColor("AU")} 
            strokeWidth={2}
            dot={false}
              name="Gold"
          />
          <Line 
              yAxisId="right"
              type="monotone" 
              dataKey="AG" 
              stroke={getMetalColor("AG")} 
              strokeWidth={2}
              dot={false}
              name="Silver"
            />
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="PT" 
              stroke={getMetalColor("PT")} 
              strokeWidth={2}
              dot={false}
              name="Platinum"
            />
            <Line 
            yAxisId="left"
              type="monotone" 
            dataKey="PD" 
            stroke={getMetalColor("PD")} 
            strokeWidth={2}
            dot={false}
            name="Palladium"
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-4 text-xs text-stealth-400">
          <p>Precious-metals history is shown in raw USD per troy ounce. Copper and aluminum are tracked in the ranking cards below because their contract units differ from the precious-metal sleeve.</p>
      </div>
    </div>
  );
}
