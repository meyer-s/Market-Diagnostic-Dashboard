import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { apiFetch } from "../utils/apiUtils";
import { CHART_NEUTRAL } from "../utils/chartUtils";
import { formatDate, formatNumber } from "../utils/styleUtils";
import { getFamilyColor } from "../theme/metricColors";

interface OptionPosition {
  id: number;
  trade_date: string;
  account: string | null;
  action: string | null;
  contracts: number;
  symbol: string;
  expiration: string;
  strike: number;
  option_type: string;
  fill_price: number;
  total_cost: number;
  underlying_at_entry: number | null;
  estimated_delta: number | null;
  shares_equivalent: number | null;
  dte_at_entry: number | null;
  underlying_reference: number | null;
}

interface PositionMetrics {
  market: {
    current_price: number | null;
    previous_close: number | null;
    change: number | null;
    change_percent: number | null;
    implied_volatility: number | null;
    last_updated: string;
  };
  option_price: number | null;
  option_price_source: string | null;
  volatility: number | null;
  volatility_source: string | null;
  dte: number | null;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  } | null;
  pnl: {
    dollar: number | null;
    percent: number | null;
    source: string | null;
  };
}

interface PositionPayload {
  position: OptionPosition;
  metrics: PositionMetrics;
}

interface GreeksPayload {
  price_curve: { price: number; delta: number; gamma: number }[];
  theta_curve: { days: number; theta: number }[];
}

const formatCurrency = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `$${value.toFixed(digits)}`;
};

const formatPercent = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
};

const formatSigned = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
};

export default function SecretOptions() {
  const [positions, setPositions] = useState<PositionPayload[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [greeksData, setGreeksData] = useState<GreeksPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGreeks, setLoadingGreeks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPositions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ positions: PositionPayload[] }>("/secret/options/positions");
      setPositions(data.positions);
      if (data.positions.length > 0 && selectedId === null) {
        setSelectedId(data.positions[0].position.id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load positions");
    } finally {
      setLoading(false);
    }
  };

  const loadGreeks = async (positionId: number) => {
    setLoadingGreeks(true);
    try {
      const data = await apiFetch<GreeksPayload>(`/secret/options/greeks/${positionId}`);
      setGreeksData(data);
    } catch {
      setGreeksData(null);
    } finally {
      setLoadingGreeks(false);
    }
  };

  useEffect(() => {
    loadPositions();
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      loadGreeks(selectedId);
    }
  }, [selectedId]);

  const selected = useMemo(
    () => positions.find((item) => item.position.id === selectedId) || null,
    [positions, selectedId]
  );

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalPnl = 0;
    let count = 0;
    positions.forEach((item) => {
      totalCost += item.position.total_cost;
      if (item.metrics.pnl.dollar !== null && item.metrics.pnl.dollar !== undefined) {
        totalPnl += item.metrics.pnl.dollar;
      }
      count += 1;
    });
    const percent = totalCost ? (totalPnl / totalCost) * 100 : null;
    return { totalCost, totalPnl, percent, count };
  }, [positions]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto text-gray-100">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Options Performance (Private)</h1>
        <span className="text-xs text-gray-500">/secret/options</span>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Tracks positions created from bot-driven signals. Metrics update from live option chains and price data.
      </p>

      {error && (
        <div className="bg-red-900/20 border border-red-700 text-red-300 text-sm rounded-lg p-3 mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="text-xs text-gray-500">Total Cost</div>
          <div className="text-lg font-semibold">{formatCurrency(totals.totalCost)}</div>
        </div>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="text-xs text-gray-500">Total P&amp;L</div>
          <div
            className={`text-lg font-semibold ${
              totals.totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {formatCurrency(totals.totalPnl)}
          </div>
          <div className="text-xs text-gray-400">
            {totals.percent !== null ? `${formatSigned(totals.percent, 1)}%` : "—"}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="text-xs text-gray-500">Active Positions</div>
          <div className="text-lg font-semibold">{totals.count}</div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold">Position Summary</h2>
            <p className="text-xs text-gray-500">Click a row to inspect Greeks and curves.</p>
          </div>
          <select
            value={selectedId ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedId(value ? Number(value) : null);
            }}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200"
          >
            <option value="">Select a position</option>
            {positions.map((item) => (
              <option key={item.position.id} value={item.position.id}>
                {item.position.symbol} {item.position.strike} {item.position.option_type.toUpperCase()} (
                {formatDate(item.position.expiration)})
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">Loading positions...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-gray-300">
              <thead className="text-xs uppercase text-gray-500 border-b border-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-left">Strike</th>
                  <th className="px-3 py-2 text-left">Expiration</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Contracts</th>
                  <th className="px-3 py-2 text-left">Fill</th>
                  <th className="px-3 py-2 text-left">Option</th>
                  <th className="px-3 py-2 text-left">Underlying</th>
                  <th className="px-3 py-2 text-left">DTE</th>
                  <th className="px-3 py-2 text-left">P&amp;L</th>
                  <th className="px-3 py-2 text-left">Delta</th>
                  <th className="px-3 py-2 text-left">Theta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {positions.map((item) => {
                  const { position, metrics } = item;
                  const pnl = metrics.pnl.dollar ?? 0;
                  const rowActive = position.id === selectedId;
                  return (
                    <tr
                      key={position.id}
                      className={`cursor-pointer ${rowActive ? "bg-gray-900/60" : "hover:bg-gray-900/40"}`}
                      onClick={() => setSelectedId(position.id)}
                    >
                      <td className="px-3 py-2 font-semibold text-gray-100">{position.symbol}</td>
                      <td className="px-3 py-2">${formatNumber(position.strike, 2)}</td>
                      <td className="px-3 py-2">{formatDate(position.expiration)}</td>
                      <td className="px-3 py-2 uppercase">{position.option_type}</td>
                      <td className="px-3 py-2">{position.contracts}</td>
                      <td className="px-3 py-2">{formatCurrency(position.fill_price, 2)}</td>
                      <td className="px-3 py-2">
                        {metrics.option_price !== null
                          ? formatCurrency(metrics.option_price, 2)
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {metrics.market.current_price !== null
                          ? formatCurrency(metrics.market.current_price, 2)
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{metrics.dte ?? "—"}</td>
                      <td
                        className={`px-3 py-2 font-semibold ${
                          pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {metrics.pnl.dollar !== null ? formatCurrency(metrics.pnl.dollar, 0) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {metrics.greeks ? metrics.greeks.delta.toFixed(3) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {metrics.greeks ? metrics.greeks.theta.toFixed(3) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold">Greeks Curves</h2>
            <p className="text-xs text-gray-500">
              Based on current underlying and implied or historical volatility.
            </p>
          </div>
          {selected && (
            <div className="text-xs text-gray-400 text-right">
              <div>
                Vol source: {selected.metrics.volatility_source || "n/a"}{" "}
                {selected.metrics.volatility ? `(${formatPercent(selected.metrics.volatility * 100, 1)})` : ""}
              </div>
              <div>Option price: {selected.metrics.option_price_source || "n/a"}</div>
            </div>
          )}
        </div>

        {loadingGreeks ? (
          <div className="text-sm text-gray-400">Loading Greeks...</div>
        ) : greeksData && greeksData.price_curve.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-3">
              <h3 className="text-sm font-semibold mb-2">Delta vs Price</h3>
              <div className="h-48" style={{ minWidth: 0, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={greeksData.price_curve}>
                    <XAxis
                      dataKey="price"
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value) => formatNumber(Number(value), 3)}
                      labelFormatter={(label) => `Price: $${label}`}
                      contentStyle={{
                        background: "#111827",
                        border: "1px solid #374151",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="delta"
                      stroke={getFamilyColor("equity")}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-gray-900 rounded-lg border border-gray-700 p-3">
              <h3 className="text-sm font-semibold mb-2">Gamma vs Price</h3>
              <div className="h-48" style={{ minWidth: 0, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={greeksData.price_curve}>
                    <XAxis
                      dataKey="price"
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value) => formatNumber(Number(value), 4)}
                      labelFormatter={(label) => `Price: $${label}`}
                      contentStyle={{
                        background: "#111827",
                        border: "1px solid #374151",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="gamma"
                      stroke={getFamilyColor("growth")}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-gray-900 rounded-lg border border-gray-700 p-3 lg:col-span-2">
              <h3 className="text-sm font-semibold mb-2">Theta vs Time</h3>
              <div className="h-48" style={{ minWidth: 0, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={greeksData.theta_curve}>
                    <XAxis
                      dataKey="days"
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value) => formatNumber(Number(value), 4)}
                      labelFormatter={(label) => `${label} days to expiry`}
                      contentStyle={{
                        background: "#111827",
                        border: "1px solid #374151",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="theta"
                      stroke={getFamilyColor("sentiment")}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">No Greeks data available for the selected position.</div>
        )}
      </div>
    </div>
  );
}
