import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useApi } from "../../hooks/useApi";

interface CryptoAsset {
  symbol: string;
  current_price: number | null;
  change_24h: number | null;
  change_30d: number | null;
  market_cap: number | null;
}

interface CryptoMarketOverviewResponse {
  summary: {
    btc_dominance: number | null;
    total_market_cap: number | null;
    advancing_assets_24h: number;
    monitored_assets: number;
  };
  assets: CryptoAsset[];
}

const formatCurrency = (value: number | null, compact = false) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : value >= 1000 ? 0 : 2,
  }).format(value);
};

const formatPercent = (value: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
};

export default function CryptoMarketWidget() {
  const { data, loading } = useApi<CryptoMarketOverviewResponse>("/crypto/market-overview?days=90");

  const leaders = useMemo(() => {
    if (!data?.assets?.length) return [];
    return [...data.assets]
      .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
      .slice(0, 4);
  }, [data]);

  if (loading) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-base sm:text-lg font-bold mb-3">Crypto</h3>
        <div className="text-sm text-stealth-400">Loading crypto market data…</div>
      </div>
    );
  }

  return (
    <Link
      to="/crypto-indicators"
      className="primary-card primary-card-hover p-4 md:p-6 cursor-pointer block"
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-base sm:text-lg font-bold">Crypto</h3>
        <span className="text-xs text-stealth-400">90d view</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-4">
        <div className="secondary-card p-2">
          <div className="text-stealth-400 mb-1">Total MCap</div>
          <div className="font-semibold text-stealth-100">
            {formatCurrency(data?.summary?.total_market_cap ?? null, true)}
          </div>
        </div>
        <div className="secondary-card p-2">
          <div className="text-stealth-400 mb-1">BTC Dominance</div>
          <div className="font-semibold text-stealth-100">
            {data?.summary?.btc_dominance !== null && data?.summary?.btc_dominance !== undefined
              ? `${data.summary.btc_dominance.toFixed(1)}%`
              : "n/a"}
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {leaders.map((asset) => (
          <div key={asset.symbol} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-stealth-100">{asset.symbol}</span>
              <span className="text-stealth-400 text-xs">{formatCurrency(asset.current_price)}</span>
            </div>
            <div className="text-right">
              <div className={`text-xs font-semibold ${(asset.change_24h ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {formatPercent(asset.change_24h)}
              </div>
              <div className={`text-xs ${(asset.change_30d ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                {formatPercent(asset.change_30d)} 30d
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-stealth-700 text-xs text-stealth-400">
        {data?.summary
          ? `${data.summary.advancing_assets_24h}/${data.summary.monitored_assets} assets green over 24h`
          : "Crypto market breadth unavailable"}
      </div>
    </Link>
  );
}
