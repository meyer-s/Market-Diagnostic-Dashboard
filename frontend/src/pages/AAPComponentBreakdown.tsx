import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MarketLoading from '../components/ui/MarketLoading';
import { apiFetch } from "../utils/apiUtils";

// Simple icon components using SVG
const ArrowLeft = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const TrendingUp = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
);

const TrendingDown = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
  </svg>
);

const AlertCircle = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const Info = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

interface AAPComponent {
  name: string;
  category: string;
  value: number;
  weight: number;
  contribution: number;
  status: 'active' | 'missing';
  description: string;
}

interface AAPData {
  date: string;
  stability_score: number;
  pressure_index: number;  // Internal metric (inverted)
  regime: string;
  primary_driver: string;
  metals_contribution: number;  // Contribution to instability
  crypto_contribution: number;  // Contribution to instability
  components: AAPComponent[];
  data_completeness: number;
}

const AAPComponentBreakdown: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<AAPData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAAPData();
  }, []);

  const fetchAAPData = async () => {
    try {
      setLoading(true);
      const result = await apiFetch<AAPData>("/aap/current");
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const getRegimeColor = (regime: string) => {
    const colors: Record<string, string> = {
      'normal_confidence': 'text-green-600',
      'mild_caution': 'text-yellow-600',
      'monetary_stress': 'text-orange-600',
      'liquidity_crisis': 'text-red-600',
      'systemic_breakdown': 'text-red-800'
    };
    return colors[regime] || 'text-gray-600';
  };

  const getRegimeLabel = (regime: string) => {
    return regime.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const componentDescriptions: Record<string, string> = {
    // Metals subsystem
    'gold_usd_zscore': 'Gold price momentum vs USD (20-day z-score)',
    'gold_real_rate_divergence': 'Gold vs real interest rates divergence',
    'cb_gold_momentum': 'Central bank gold accumulation rate',
    'silver_usd_zscore': 'Silver price momentum vs USD',
    'gold_silver_ratio_signal': 'Au/Ag ratio relative to historical norms',
    'platinum_gold_ratio': 'Pt/Au ratio stress signal',
    'palladium_gold_ratio': 'Pd/Au ratio stress signal',
    'comex_stress_ratio': 'Physical vs paper gold stress (OI/Registered)',
    'backwardation_signal': 'Futures backwardation indicating supply stress',
    'etf_flow_divergence': 'Gold ETF flows vs price action',
    
    // Crypto subsystem
    'btc_usd_zscore': 'Bitcoin price momentum vs USD',
    'btc_gold_zscore': 'Bitcoin price relative to gold',
    'btc_real_rate_break': 'Bitcoin vs real rates correlation break',
    'crypto_m2_ratio': 'Crypto market cap vs M2 money supply',
    'btc_dominance_momentum': 'Bitcoin market dominance trend',
    'altcoin_btc_signal': 'Altcoin performance vs Bitcoin',
    'crypto_vs_fed_bs': 'Crypto market cap vs Fed balance sheet',
    'crypto_qt_resilience': 'Crypto resilience during QT periods'
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <MarketLoading size={110} variant="pulse" label="Loading AAP component data..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
          <div className="flex justify-center mb-4">
            <AlertCircle className="h-12 w-12 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-center mb-2">Error Loading Data</h2>
          <p className="text-gray-600 text-center mb-4">{error || 'No data available'}</p>
          <button
            onClick={() => navigate('/indicators')}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Back to Indicators
          </button>
        </div>
      </div>
    );
  }

  const metalsComponents = data.components.filter(c => c.category === 'metals');
  const cryptoComponents = data.components.filter(c => c.category === 'crypto');
  const activeCount = data.components.filter(c => c.status === 'active').length;
  const totalCount = data.components.length;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/indicators')}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <span className="mr-2"><ArrowLeft /></span>
            Back to Indicators
          </button>
          
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Alternative Asset Stability (AAS)
            </h1>
            <p className="text-gray-600 mb-6">
              Comprehensive 18-component indicator measuring systemic stability through precious metals and cryptocurrency signals
            </p>

            {/* Current Status */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-600 mb-1">Stability Score</div>
                <div className="text-3xl font-bold text-gray-900">
                  {data.stability_score.toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">0=min stability, 100=max stability</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-600 mb-1">Regime</div>
                <div className={`text-xl font-semibold ${getRegimeColor(data.regime)}`}>
                  {getRegimeLabel(data.regime)}
                </div>
                <div className="text-xs text-gray-500">Current state</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-600 mb-1">Primary Driver</div>
                <div className="text-xl font-semibold text-gray-900 capitalize">
                  {data.primary_driver}
                </div>
                <div className="text-xs text-gray-500">Signal source</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-600 mb-1">Data Completeness</div>
                <div className="text-3xl font-bold text-gray-900">
                  {(data.data_completeness * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-gray-500">{activeCount}/{totalCount} components</div>
              </div>
            </div>
          </div>
        </div>

        {/* Subsystem Contributions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <span className="w-4 h-4 bg-yellow-500 rounded-full mr-2"></span>
              Metals Subsystem
            </h2>
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Contribution to Instability</span>
                <span className="font-semibold">{(data.metals_contribution * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-yellow-500 h-3 rounded-full transition-all"
                  style={{ width: `${data.metals_contribution * 100}%` }}
                ></div>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              <strong>{metalsComponents.filter(c => c.status === 'active').length}/10</strong> components active
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <span className="w-4 h-4 bg-blue-500 rounded-full mr-2"></span>
              Crypto Subsystem
            </h2>
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Contribution to Instability</span>
                <span className="font-semibold">{(data.crypto_contribution * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all"
                  style={{ width: `${data.crypto_contribution * 100}%` }}
                ></div>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              <strong>{cryptoComponents.filter(c => c.status === 'active').length}/8</strong> components active
            </div>
          </div>
        </div>

        {/* Metals Components Detail */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-6 flex items-center">
            <span className="w-6 h-6 bg-yellow-500 rounded-full mr-3"></span>
            Precious Metals Components (50% weight)
          </h2>
          
          <div className="space-y-4">
            {metalsComponents.map((component, idx) => (
              <div key={idx} className={`border rounded-lg p-4 ${component.status === 'active' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="font-semibold text-gray-900 mr-2">
                        {component.name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </h3>
                      {component.status === 'active' ? (
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">Active</span>
                      ) : (
                        <span className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded-full">Missing</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {componentDescriptions[component.name] || component.description}
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <div className="text-sm text-gray-600">Weight</div>
                    <div className="text-lg font-semibold">{(component.weight * 100).toFixed(1)}%</div>
                  </div>
                </div>
                
                {component.status === 'active' && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Current Value:</span>
                        <span className="ml-2 font-semibold">{component.value.toFixed(3)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Contribution:</span>
                        <span className="ml-2 font-semibold">{(component.contribution * 100).toFixed(2)}%</span>
                      </div>
                      <div className="text-right">
                        {component.value > 0.5 ? (
                          <span className="inline-flex items-center text-red-600">
                            <TrendingUp className="h-4 w-4 mr-1" />
                            Elevated Pressure
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-green-600">
                            <TrendingDown className="h-4 w-4 mr-1" />
                            Normal
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Crypto Components Detail */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-6 flex items-center">
            <span className="w-6 h-6 bg-blue-500 rounded-full mr-3"></span>
            Cryptocurrency Components (50% weight)
          </h2>
          
          <div className="space-y-4">
            {cryptoComponents.map((component, idx) => (
              <div key={idx} className={`border rounded-lg p-4 ${component.status === 'active' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="font-semibold text-gray-900 mr-2">
                        {component.name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </h3>
                      {component.status === 'active' ? (
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">Active</span>
                      ) : (
                        <span className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded-full">Missing</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {componentDescriptions[component.name] || component.description}
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <div className="text-sm text-gray-600">Weight</div>
                    <div className="text-lg font-semibold">{(component.weight * 100).toFixed(1)}%</div>
                  </div>
                </div>
                
                {component.status === 'active' && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Current Value:</span>
                        <span className="ml-2 font-semibold">{component.value.toFixed(3)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Contribution:</span>
                        <span className="ml-2 font-semibold">{(component.contribution * 100).toFixed(2)}%</span>
                      </div>
                      <div className="text-right">
                        {component.value > 0.5 ? (
                          <span className="inline-flex items-center text-red-600">
                            <TrendingUp className="h-4 w-4 mr-1" />
                            Elevated Pressure
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-green-600">
                            <TrendingDown className="h-4 w-4 mr-1" />
                            Normal
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Info Panel */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start">
            <div className="mr-3 flex-shrink-0 mt-1">
              <Info className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-blue-900 mb-2">About AAS Indicator</h3>
              <p className="text-blue-800 text-sm mb-3">
                The Alternative Asset Stability (AAS) indicator measures systemic stability through 18 weighted components
                split equally between precious metals and cryptocurrency markets. Lower stability scores
                indicate growing distrust in fiat currencies and increased demand for alternative stores of value.
              </p>
              <div className="text-sm text-blue-800">
                <strong>Data Sources:</strong> FRED API (macro/crypto), YAHOO Finance (metals), CME (COMEX), 
                World Gold Council (CB holdings), DeFiLlama (DeFi TVL)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AAPComponentBreakdown;
