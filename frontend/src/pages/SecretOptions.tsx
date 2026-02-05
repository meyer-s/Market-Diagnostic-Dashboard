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
  current_greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    price: number;
  } | null;
  model_info: {
    model?: string;
    risk_free_rate?: number;
    volatility?: number;
    volatility_source?: string;
    spot_price?: number;
    dte?: number;
    units?: {
      delta: string;
      gamma: string;
      theta: string;
      vega: string;
    };
    error?: string;
  };
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

const buildGreeksSummary = (
  greeks: PositionMetrics["greeks"] | GreeksPayload["current_greeks"] | null
) => {
  if (!greeks) return null;
  const delta = greeks.delta ?? 0;
  const gamma = greeks.gamma ?? 0;
  const theta = greeks.theta ?? 0;
  const vega = greeks.vega ?? 0;

  const deltaDirection =
    Math.abs(delta) < 0.1 ? "neutral" : delta > 0 ? "bullish" : "bearish";
  const thetaDirection = theta < 0 ? "decay" : "carry";
  const absDelta = Math.abs(delta);
  const absGamma = Math.abs(gamma);
  const absTheta = Math.abs(theta);
  const absVega = Math.abs(vega);

  const directionalLabel =
    absDelta >= 0.4 ? "highly directional" : absDelta >= 0.15 ? "directional" : "low directional";
  const convexityLabel =
    absGamma >= 0.05 ? "high convexity" : absGamma >= 0.02 ? "moderate convexity" : "low convexity";
  const vegaLabel =
    absVega >= 10 ? "high vol sensitivity" : absVega >= 5 ? "moderate vol sensitivity" : "low vol sensitivity";
  const thetaLabel =
    absTheta >= 10 ? "strong time impact" : absTheta >= 4 ? "moderate time impact" : "light time impact";

  return [
    `Overall: ${directionalLabel}, ${convexityLabel}, ${vegaLabel}, with ${thetaLabel} and net ${thetaDirection}.`,
    `Directional exposure is ${deltaDirection} (delta ${formatSigned(delta, 3)}). ~${formatSigned(
      delta,
      3
    )} per $1 move per share (${formatSigned(delta * 100, 1)} per contract).`,
    `Gamma ${formatSigned(gamma, 4)} means delta changes by ~${formatSigned(
      gamma,
      4
    )} for each $1 move.`,
    `Theta ${formatSigned(theta, 4)} implies about $${Math.abs(theta).toFixed(
      2
    )} per day per contract of time ${thetaDirection}.`,
    `Vega ${formatSigned(vega, 4)} means about $${Math.abs(vega).toFixed(
      2
    )} per 1 vol point (1%) per contract.`,
  ];
};

const initialFormState = {
  trade_date: "",
  account: "",
  action: "Buy to Open",
  contracts: "",
  symbol: "",
  expiration: "",
  strike: "",
  option_type: "call",
  fill_price: "",
  total_cost: "",
  underlying_at_entry: "",
  estimated_delta: "",
  shares_equivalent: "",
  dte_at_entry: "",
  underlying_reference: "",
};

export default function SecretOptions() {
  const [positions, setPositions] = useState<PositionPayload[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [greeksData, setGreeksData] = useState<GreeksPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingGreeks, setLoadingGreeks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingPositionId, setClosingPositionId] = useState<number | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closedPositions, setClosedPositions] = useState<any[]>([]);
  const [showClosedLog, setShowClosedLog] = useState(false);

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

  const resetForm = () => {
    setFormData(initialFormState);
  };

  const handleFieldChange =
    (field: keyof typeof initialFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFormData((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleCreatePosition = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!formData.trade_date || !formData.symbol || !formData.expiration) {
      setFormError("Trade date, symbol, and expiration are required.");
      return;
    }
    const contracts = Number(formData.contracts);
    const strike = Number(formData.strike);
    const fillPrice = Number(formData.fill_price);
    const totalCost = Number(formData.total_cost);
    if (!contracts || !strike || !fillPrice || !totalCost) {
      setFormError("Contracts, strike, fill price, and total cost are required.");
      return;
    }

    const optionalNumber = (value: string) => {
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    setSubmitting(true);
    try {
      await apiFetch("/secret/options/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade_date: formData.trade_date,
          account: formData.account || null,
          action: formData.action || null,
          contracts,
          symbol: formData.symbol.toUpperCase(),
          expiration: formData.expiration,
          strike,
          option_type: formData.option_type,
          fill_price: fillPrice,
          total_cost: totalCost,
          underlying_at_entry: optionalNumber(formData.underlying_at_entry),
          estimated_delta: optionalNumber(formData.estimated_delta),
          shares_equivalent: optionalNumber(formData.shares_equivalent),
          dte_at_entry: optionalNumber(formData.dte_at_entry),
          underlying_reference: optionalNumber(formData.underlying_reference),
        }),
      });
      resetForm();
      setShowAddModal(false);
      await loadPositions();
    } catch (err: any) {
      setFormError(err.message || "Failed to add position.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadClosedPositions = async () => {
    try {
      const data = await apiFetch<any>("/secret/options/closed-positions");
      setClosedPositions(data.closed_positions);
    } catch (err: any) {
      console.error("Failed to load closed positions:", err);
    }
  };

  const handleClosePosition = async () => {
    if (!closingPositionId || !exitPrice) {
      alert("Please enter an exit price");
      return;
    }

    try {
      await apiFetch(`/secret/options/positions/${closingPositionId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exit_price: Number(exitPrice),
          close_date: new Date().toISOString().split("T")[0],
          notes: closeNotes || null,
        }),
      });
      
      setShowCloseModal(false);
      setExitPrice("");
      setCloseNotes("");
      setClosingPositionId(null);
      await loadPositions();
      await loadClosedPositions();
    } catch (err: any) {
      alert(`Failed to close position: ${err.message}`);
    }
  };

  const openCloseModal = (positionId: number) => {
    setClosingPositionId(positionId);
    setShowCloseModal(true);
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

  const greekSummary = useMemo(() => {
    const greeks = greeksData?.current_greeks ?? selected?.metrics.greeks ?? null;
    return buildGreeksSummary(greeks);
  }, [greeksData, selected]);

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
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5"
            >
              <span className="text-lg leading-none">+</span> Add Trade
            </button>
            <button
              onClick={() => {
                loadClosedPositions();
                setShowClosedLog(true);
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              P/L History
            </button>
          </div>
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
                  <th className="px-3 py-2 text-center">Action</th>
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
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openCloseModal(position.id);
                          }}
                          className="bg-rose-700 hover:bg-rose-600 text-white px-2 py-1 rounded text-xs font-medium"
                        >
                          −
                        </button>
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

        {greeksData?.model_info && (
          <div className="mb-4 p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
            <div className="text-xs text-gray-400 grid grid-cols-2 md:grid-cols-4 gap-2">
              {greeksData.model_info.model && (
                <div>
                  <span className="text-gray-500">Model:</span>{" "}
                  <span className="text-gray-300">{greeksData.model_info.model}</span>
                </div>
              )}
              {greeksData.model_info.risk_free_rate !== undefined && (
                <div>
                  <span className="text-gray-500">Risk-free rate:</span>{" "}
                  <span className="text-gray-300">{formatPercent(greeksData.model_info.risk_free_rate * 100, 2)}</span>
                </div>
              )}
              {greeksData.model_info.volatility !== undefined && (
                <div>
                  <span className="text-gray-500">Vol (σ):</span>{" "}
                  <span className="text-gray-300">{formatPercent(greeksData.model_info.volatility * 100, 1)}</span>
                </div>
              )}
              {greeksData.model_info.volatility_source && (
                <div>
                  <span className="text-gray-500">Vol source:</span>{" "}
                  <span className="text-gray-300">{greeksData.model_info.volatility_source}</span>
                </div>
              )}
              {greeksData.model_info.spot_price && (
                <div>
                  <span className="text-gray-500">Spot:</span>{" "}
                  <span className="text-gray-300">{formatCurrency(greeksData.model_info.spot_price)}</span>
                </div>
              )}
              {greeksData.model_info.dte !== undefined && (
                <div>
                  <span className="text-gray-500">DTE:</span>{" "}
                  <span className="text-gray-300">{greeksData.model_info.dte} days</span>
                </div>
              )}
            </div>
          </div>
        )}

        {greekSummary && (
          <div className="mb-4 p-3 bg-gray-900/60 rounded-lg border border-gray-700">
            <div className="text-[10px] uppercase text-gray-500 tracking-wide mb-2">
              Deterministic Summary
            </div>
            <ul className="text-sm text-gray-200 space-y-1">
              {greekSummary.map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ul>
          </div>
        )}

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

      {/* Add Trade Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Add New Trade</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                  setFormError(null);
                }}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            
            {formError && (
              <div className="bg-red-900/20 border border-red-700 text-red-300 text-xs rounded-lg p-2 mb-4">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreatePosition} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-xs text-gray-400">
                  Trade Date *
                  <input
                    type="date"
                    value={formData.trade_date}
                    onChange={handleFieldChange("trade_date")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>
                
                <label className="text-xs text-gray-400">
                  Symbol *
                  <input
                    type="text"
                    value={formData.symbol}
                    onChange={handleFieldChange("symbol")}
                    placeholder="AAPL"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 uppercase"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Expiration *
                  <input
                    type="date"
                    value={formData.expiration}
                    onChange={handleFieldChange("expiration")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Strike *
                  <input
                    type="number"
                    step="0.01"
                    value={formData.strike}
                    onChange={handleFieldChange("strike")}
                    placeholder="100.00"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Type *
                  <select
                    value={formData.option_type}
                    onChange={handleFieldChange("option_type")}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                </label>

                <label className="text-xs text-gray-400">
                  Contracts *
                  <input
                    type="number"
                    value={formData.contracts}
                    onChange={handleFieldChange("contracts")}
                    placeholder="1"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Fill Price *
                  <input
                    type="number"
                    step="0.01"
                    value={formData.fill_price}
                    onChange={handleFieldChange("fill_price")}
                    placeholder="5.00"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Total Cost *
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total_cost}
                    onChange={handleFieldChange("total_cost")}
                    placeholder="503.37"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                    required
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Underlying at Entry
                  <input
                    type="number"
                    step="0.01"
                    value={formData.underlying_at_entry}
                    onChange={handleFieldChange("underlying_at_entry")}
                    placeholder="95.50"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  />
                </label>

                <label className="text-xs text-gray-400">
                  Account
                  <input
                    type="text"
                    value={formData.account}
                    onChange={handleFieldChange("account")}
                    placeholder="Active Trading"
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    resetForm();
                    setFormError(null);
                  }}
                  className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  {submitting ? "Adding..." : "Add Trade"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Position Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Close Position</h2>
              <button
                onClick={() => {
                  setShowCloseModal(false);
                  setExitPrice("");
                  setCloseNotes("");
                  setClosingPositionId(null);
                }}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <label className="block text-sm text-gray-400">
                Exit Price (per contract) *
                <input
                  type="number"
                  step="0.01"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  placeholder="5.50"
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                  required
                />
              </label>

              <label className="block text-sm text-gray-400">
                Notes (optional)
                <textarea
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Reason for closing..."
                  rows={3}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowCloseModal(false);
                    setExitPrice("");
                    setCloseNotes("");
                    setClosingPositionId(null);
                  }}
                  className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClosePosition}
                  className="bg-rose-700 hover:bg-rose-600 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  Close Position
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* P/L History Modal */}
      {showClosedLog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Closed Positions History</h2>
              <button
                onClick={() => setShowClosedLog(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            {closedPositions.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No closed positions yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-gray-300">
                  <thead className="text-xs uppercase text-gray-500 border-b border-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Strike</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Entry</th>
                      <th className="px-3 py-2 text-left">Exit</th>
                      <th className="px-3 py-2 text-left">Close Date</th>
                      <th className="px-3 py-2 text-left">P&amp;L $</th>
                      <th className="px-3 py-2 text-left">P&amp;L %</th>
                      <th className="px-3 py-2 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {closedPositions.map((pos) => (
                      <tr key={pos.id} className="hover:bg-gray-900/40">
                        <td className="px-3 py-2 font-semibold">{pos.symbol}</td>
                        <td className="px-3 py-2">${formatNumber(pos.strike, 2)}</td>
                        <td className="px-3 py-2 uppercase">{pos.option_type}</td>
                        <td className="px-3 py-2">${formatNumber(pos.fill_price, 2)}</td>
                        <td className="px-3 py-2">${formatNumber(pos.exit_price, 2)}</td>
                        <td className="px-3 py-2">{formatDate(pos.close_date)}</td>
                        <td
                          className={`px-3 py-2 font-semibold ${
                            pos.dollar_pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {formatCurrency(pos.dollar_pnl, 0)}
                        </td>
                        <td
                          className={`px-3 py-2 ${
                            pos.percent_pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {formatSigned(pos.percent_pnl, 1)}%
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-400">{pos.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
