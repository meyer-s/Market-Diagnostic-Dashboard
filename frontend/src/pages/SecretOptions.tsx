import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
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

interface ClosedPositionRow {
  id: number;
  symbol: string;
  option_type: string;
  strike: number;
  expiration: string;
  contracts: number;
  trade_date: string;
  close_date: string;
  fill_price: number;
  exit_price: number;
  total_cost: number;
  total_proceeds: number;
  dollar_pnl: number;
  percent_pnl: number;
  underlying_at_entry: number | null;
  underlying_at_exit: number | null;
  account: string | null;
  notes: string | null;
}

interface RawPositionPayload {
  position: OptionPosition;
  metrics?: Partial<PositionMetrics> | null;
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

type SortDirection = "asc" | "desc";
type PositionSortKey =
  | "symbol"
  | "strike"
  | "expiration"
  | "option_type"
  | "contracts"
  | "fill_price"
  | "option_price"
  | "underlying"
  | "dte"
  | "pnl"
  | "delta"
  | "theta";
type ClosedSortKey =
  | "symbol"
  | "strike"
  | "option_type"
  | "fill_price"
  | "exit_price"
  | "close_date"
  | "dollar_pnl"
  | "percent_pnl";

interface ZoneInputs {
  profitTake: string;
  lossCut: string;
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
    absDelta >= 0.4 ? "moves a lot with the stock" : absDelta >= 0.15 ? "moves some with the stock" : "moves only a little with the stock";
  const convexityLabel =
    absGamma >= 0.05 ? "reacts quickly when the stock moves" : absGamma >= 0.02 ? "reacts more as the stock moves" : "reacts slowly to stock moves";
  const vegaLabel =
    absVega >= 10 ? "very sensitive to volatility" : absVega >= 5 ? "somewhat sensitive to volatility" : "not very sensitive to volatility";
  const thetaLabel =
    absTheta >= 10 ? "time matters a lot" : absTheta >= 4 ? "time matters" : "time matters less";

  return {
    tone: deltaDirection,
    thetaDirection,
    overall: `Overall: this option ${directionalLabel}, ${convexityLabel}, is ${vegaLabel}, and ${thetaLabel} (net ${thetaDirection}).`,
    details: [
      `Direction: ${deltaDirection} (delta ${formatSigned(delta, 3)}). ~${formatSigned(
        delta,
        3
      )} per $1 move per share (${formatSigned(delta * 100, 1)} per contract).`,
      `Speed of change (gamma) ${formatSigned(gamma, 4)} means delta shifts by ~${formatSigned(
        gamma,
        4
      )} for each $1 move.`,
      `Time decay (theta) ${formatSigned(theta, 4)} implies about $${Math.abs(theta).toFixed(
        2
      )} per day per contract of time ${thetaDirection}.`,
      `Volatility sensitivity (vega) ${formatSigned(vega, 4)} means about $${Math.abs(vega).toFixed(
        2
      )} per 1 vol point (1%) per contract.`,
    ],
  };
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

const asNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizePositionMetrics = (
  metrics: RawPositionPayload["metrics"]
): PositionMetrics => {
  const safeGreeks =
    metrics?.greeks &&
    metrics.greeks.delta !== undefined &&
    metrics.greeks.gamma !== undefined &&
    metrics.greeks.theta !== undefined &&
    metrics.greeks.vega !== undefined
      ? {
          delta: metrics.greeks.delta,
          gamma: metrics.greeks.gamma,
          theta: metrics.greeks.theta,
          vega: metrics.greeks.vega,
        }
      : null;

  return {
    market: {
      current_price: metrics?.market?.current_price ?? null,
      previous_close: metrics?.market?.previous_close ?? null,
      change: metrics?.market?.change ?? null,
      change_percent: metrics?.market?.change_percent ?? null,
      implied_volatility: metrics?.market?.implied_volatility ?? null,
      last_updated: metrics?.market?.last_updated ?? "",
    },
    option_price: metrics?.option_price ?? null,
    option_price_source: metrics?.option_price_source ?? null,
    volatility: metrics?.volatility ?? null,
    volatility_source: metrics?.volatility_source ?? null,
    dte: metrics?.dte ?? null,
    greeks: safeGreeks,
    pnl: {
      dollar: metrics?.pnl?.dollar ?? null,
      percent: metrics?.pnl?.percent ?? null,
      source: metrics?.pnl?.source ?? null,
    },
  };
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
  const [editingPositionId, setEditingPositionId] = useState<number | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingPositionId, setClosingPositionId] = useState<number | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closedPositions, setClosedPositions] = useState<ClosedPositionRow[]>([]);
  const [showClosedLog, setShowClosedLog] = useState(false);
  const [scenarioOptionPrices, setScenarioOptionPrices] = useState<Record<number, string>>({});
  const [positionSort, setPositionSort] = useState<{ key: PositionSortKey; direction: SortDirection }>({
    key: "symbol",
    direction: "asc",
  });
  const [closedSort, setClosedSort] = useState<{ key: ClosedSortKey; direction: SortDirection }>({
    key: "close_date",
    direction: "desc",
  });
  const [closedExitOverrides, setClosedExitOverrides] = useState<Record<number, string>>({});
  const [zoneInputsByPosition, setZoneInputsByPosition] = useState<Record<number, ZoneInputs>>({});

  const loadPositions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ positions: RawPositionPayload[] }>("/secret/options/positions");
      const normalizedPositions: PositionPayload[] = (data.positions || []).map((item) => ({
        position: item.position,
        metrics: normalizePositionMetrics(item.metrics),
      }));
      setPositions(normalizedPositions);
      if (normalizedPositions.length > 0 && selectedId === null) {
        setSelectedId(normalizedPositions[0].position.id);
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

  const closeTradeModal = () => {
    setShowAddModal(false);
    setEditingPositionId(null);
    resetForm();
    setFormError(null);
  };

  const optionalNumber = (value: string) => {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const buildPositionPayloadFromForm = () => {
    if (!formData.trade_date || !formData.symbol || !formData.expiration) {
      setFormError("Trade date, symbol, and expiration are required.");
      return null;
    }

    const contracts = Number(formData.contracts);
    const strike = Number(formData.strike);
    const fillPrice = Number(formData.fill_price);
    const totalCost = Number(formData.total_cost);

    if (!contracts || !strike || !fillPrice || !totalCost) {
      setFormError("Contracts, strike, fill price, and total cost are required.");
      return null;
    }

    return {
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
    };
  };

  const openEditModal = (position: OptionPosition) => {
    setEditingPositionId(position.id);
    setFormError(null);
    setFormData({
      trade_date: position.trade_date || "",
      account: position.account || "",
      action: position.action || "Buy to Open",
      contracts: String(position.contracts ?? ""),
      symbol: position.symbol || "",
      expiration: position.expiration || "",
      strike: position.strike !== null && position.strike !== undefined ? String(position.strike) : "",
      option_type: position.option_type || "call",
      fill_price: position.fill_price !== null && position.fill_price !== undefined ? String(position.fill_price) : "",
      total_cost: position.total_cost !== null && position.total_cost !== undefined ? String(position.total_cost) : "",
      underlying_at_entry:
        position.underlying_at_entry !== null && position.underlying_at_entry !== undefined
          ? String(position.underlying_at_entry)
          : "",
      estimated_delta:
        position.estimated_delta !== null && position.estimated_delta !== undefined
          ? String(position.estimated_delta)
          : "",
      shares_equivalent:
        position.shares_equivalent !== null && position.shares_equivalent !== undefined
          ? String(position.shares_equivalent)
          : "",
      dte_at_entry:
        position.dte_at_entry !== null && position.dte_at_entry !== undefined
          ? String(position.dte_at_entry)
          : "",
      underlying_reference:
        position.underlying_reference !== null && position.underlying_reference !== undefined
          ? String(position.underlying_reference)
          : "",
    });
    setShowAddModal(true);
  };

  const handleFieldChange =
    (field: keyof typeof initialFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFormData((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleCreatePosition = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const payload = buildPositionPayloadFromForm();
    if (!payload) return;

    setSubmitting(true);
    try {
      await apiFetch("/secret/options/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeTradeModal();
      await loadPositions();
    } catch (err: any) {
      setFormError(err.message || "Failed to add position.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePosition = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingPositionId) {
      setFormError("No position selected for edit.");
      return;
    }

    setFormError(null);
    const payload = buildPositionPayloadFromForm();
    if (!payload) return;

    setSubmitting(true);
    try {
      await apiFetch(`/secret/options/positions/${editingPositionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeTradeModal();
      await loadPositions();
    } catch (err: any) {
      setFormError(err.message || "Failed to update position.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadClosedPositions = async () => {
    try {
      const data = await apiFetch<{ closed_positions: ClosedPositionRow[] }>(
        "/secret/options/closed-positions"
      );
      setClosedPositions(data.closed_positions || []);
      setClosedExitOverrides({});
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

  useEffect(() => {
    if (!selected) {
      return;
    }
    const id = selected.position.id;
    setZoneInputsByPosition((prev) => {
      if (prev[id]) {
        return prev;
      }
      const strike = selected.position.strike;
      const fill = selected.position.fill_price || 0;
      const spot = selected.metrics.market.current_price ?? strike;
      const defaultProfitTake = strike + fill;
      const defaultLossCut = Math.max(0, Math.min(strike, spot - fill));
      return {
        ...prev,
        [id]: {
          profitTake: defaultProfitTake.toFixed(2),
          lossCut: defaultLossCut.toFixed(2),
        },
      };
    });
  }, [selected]);

  const getEffectiveOptionPrice = (item: PositionPayload): number | null => {
    const override = asNumber(scenarioOptionPrices[item.position.id]);
    if (override !== null) {
      return override;
    }
    return item.metrics.option_price;
  };

  const getEffectivePnl = (item: PositionPayload): number | null => {
    const optionPrice = getEffectiveOptionPrice(item);
    if (optionPrice !== null) {
      return (optionPrice - item.position.fill_price) * item.position.contracts * 100;
    }
    return item.metrics?.pnl?.dollar ?? null;
  };

  const sortedPositions = useMemo(() => {
    const sorted = [...positions];
    sorted.sort((left, right) => {
      const direction = positionSort.direction === "asc" ? 1 : -1;
      const lv = (() => {
        switch (positionSort.key) {
          case "symbol":
            return left.position.symbol;
          case "strike":
            return left.position.strike;
          case "expiration":
            return left.position.expiration;
          case "option_type":
            return left.position.option_type;
          case "contracts":
            return left.position.contracts;
          case "fill_price":
            return left.position.fill_price;
          case "option_price":
            return getEffectiveOptionPrice(left);
          case "underlying":
            return left.metrics.market.current_price;
          case "dte":
            return left.metrics.dte;
          case "pnl":
            return getEffectivePnl(left);
          case "delta":
            return left.metrics.greeks?.delta ?? null;
          case "theta":
            return left.metrics.greeks?.theta ?? null;
          default:
            return null;
        }
      })();
      const rv = (() => {
        switch (positionSort.key) {
          case "symbol":
            return right.position.symbol;
          case "strike":
            return right.position.strike;
          case "expiration":
            return right.position.expiration;
          case "option_type":
            return right.position.option_type;
          case "contracts":
            return right.position.contracts;
          case "fill_price":
            return right.position.fill_price;
          case "option_price":
            return getEffectiveOptionPrice(right);
          case "underlying":
            return right.metrics.market.current_price;
          case "dte":
            return right.metrics.dte;
          case "pnl":
            return getEffectivePnl(right);
          case "delta":
            return right.metrics.greeks?.delta ?? null;
          case "theta":
            return right.metrics.greeks?.theta ?? null;
          default:
            return null;
        }
      })();

      if (lv === null || lv === undefined) return 1;
      if (rv === null || rv === undefined) return -1;
      if (typeof lv === "string" && typeof rv === "string") {
        return lv.localeCompare(rv) * direction;
      }
      return ((Number(lv) || 0) - (Number(rv) || 0)) * direction;
    });
    return sorted;
  }, [positions, positionSort, scenarioOptionPrices]);

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalPnl = 0;
    let count = 0;
    positions.forEach((item) => {
      totalCost += item.position.total_cost;
      const pnlDollar = getEffectivePnl(item);
      if (pnlDollar !== null && pnlDollar !== undefined) {
        totalPnl += pnlDollar;
      }
      count += 1;
    });
    const percent = totalCost ? (totalPnl / totalCost) * 100 : null;
    return { totalCost, totalPnl, percent, count };
  }, [positions, scenarioOptionPrices]);

  const selectedZoneInputs = selected ? zoneInputsByPosition[selected.position.id] : null;
  const selectedSpotPrice =
    greeksData?.model_info?.spot_price ?? selected?.metrics.market.current_price ?? null;
  const selectedStrike = selected?.position.strike ?? null;
  const selectedProfitTake = asNumber(selectedZoneInputs?.profitTake);
  const selectedLossCut = asNumber(selectedZoneInputs?.lossCut);

  const chartPriceDomain = useMemo(() => {
    if (!greeksData?.price_curve?.length) {
      return null;
    }
    const prices = greeksData.price_curve.map((point) => point.price);
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
    };
  }, [greeksData]);

  const closedRows = useMemo(() => {
    return closedPositions.map((pos) => {
      const overrideExit = asNumber(closedExitOverrides[pos.id]);
      const effectiveExit = overrideExit ?? pos.exit_price;
      const effectiveDollarPnl = (effectiveExit - pos.fill_price) * pos.contracts * 100;
      const effectivePercentPnl = pos.total_cost ? (effectiveDollarPnl / pos.total_cost) * 100 : 0;
      return {
        ...pos,
        effective_exit: effectiveExit,
        effective_dollar_pnl: effectiveDollarPnl,
        effective_percent_pnl: effectivePercentPnl,
      };
    });
  }, [closedPositions, closedExitOverrides]);

  const sortedClosedRows = useMemo(() => {
    const sorted = [...closedRows];
    sorted.sort((left, right) => {
      const direction = closedSort.direction === "asc" ? 1 : -1;
      const lv = (() => {
        switch (closedSort.key) {
          case "symbol":
            return left.symbol;
          case "strike":
            return left.strike;
          case "option_type":
            return left.option_type;
          case "fill_price":
            return left.fill_price;
          case "exit_price":
            return left.effective_exit;
          case "close_date":
            return left.close_date;
          case "dollar_pnl":
            return left.effective_dollar_pnl;
          case "percent_pnl":
            return left.effective_percent_pnl;
          default:
            return null;
        }
      })();
      const rv = (() => {
        switch (closedSort.key) {
          case "symbol":
            return right.symbol;
          case "strike":
            return right.strike;
          case "option_type":
            return right.option_type;
          case "fill_price":
            return right.fill_price;
          case "exit_price":
            return right.effective_exit;
          case "close_date":
            return right.close_date;
          case "dollar_pnl":
            return right.effective_dollar_pnl;
          case "percent_pnl":
            return right.effective_percent_pnl;
          default:
            return null;
        }
      })();
      if (lv === null || lv === undefined) return 1;
      if (rv === null || rv === undefined) return -1;
      if (typeof lv === "string" && typeof rv === "string") {
        return lv.localeCompare(rv) * direction;
      }
      return ((Number(lv) || 0) - (Number(rv) || 0)) * direction;
    });
    return sorted;
  }, [closedRows, closedSort]);

  const closedTotals = useMemo(() => {
    const totalPnl = sortedClosedRows.reduce((sum, row) => sum + row.effective_dollar_pnl, 0);
    const totalCost = sortedClosedRows.reduce((sum, row) => sum + row.total_cost, 0);
    const winners = sortedClosedRows.filter((row) => row.effective_dollar_pnl > 0).length;
    const totalTrades = sortedClosedRows.length;
    return {
      totalPnl,
      totalCost,
      totalTrades,
      winners,
      winRate: totalTrades ? (winners / totalTrades) * 100 : 0,
    };
  }, [sortedClosedRows]);

  const sortArrow = (active: boolean, direction: SortDirection) => {
    if (!active) return "↕";
    return direction === "asc" ? "↑" : "↓";
  };

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
            <p className="text-xs text-gray-500">
              Click a row to inspect Greeks. Click column headers to sort. Use What-if Option cells for quick P/L scenarios.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setScenarioOptionPrices({})}
              className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              Reset Scenarios
            </button>
            <button
              onClick={() => {
                setEditingPositionId(null);
                resetForm();
                setFormError(null);
                setShowAddModal(true);
              }}
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
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "symbol",
                          direction: prev.key === "symbol" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Symbol {sortArrow(positionSort.key === "symbol", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "strike",
                          direction: prev.key === "strike" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Strike {sortArrow(positionSort.key === "strike", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "expiration",
                          direction: prev.key === "expiration" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Expiration {sortArrow(positionSort.key === "expiration", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "option_type",
                          direction: prev.key === "option_type" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Type {sortArrow(positionSort.key === "option_type", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "contracts",
                          direction: prev.key === "contracts" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Contracts {sortArrow(positionSort.key === "contracts", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "fill_price",
                          direction: prev.key === "fill_price" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Fill {sortArrow(positionSort.key === "fill_price", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "option_price",
                          direction: prev.key === "option_price" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Option / What-if {sortArrow(positionSort.key === "option_price", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "underlying",
                          direction: prev.key === "underlying" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Underlying {sortArrow(positionSort.key === "underlying", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "dte",
                          direction: prev.key === "dte" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      DTE {sortArrow(positionSort.key === "dte", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "pnl",
                          direction: prev.key === "pnl" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      P&amp;L {sortArrow(positionSort.key === "pnl", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "delta",
                          direction: prev.key === "delta" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Delta {sortArrow(positionSort.key === "delta", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() =>
                        setPositionSort((prev) => ({
                          key: "theta",
                          direction: prev.key === "theta" && prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                    >
                      Theta {sortArrow(positionSort.key === "theta", positionSort.direction)}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {sortedPositions.map((item) => {
                  const { position, metrics } = item;
                  const effectiveOptionPrice = getEffectiveOptionPrice(item);
                  const pnl = getEffectivePnl(item);
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
                        <div className="space-y-1">
                          <div>
                            {metrics.option_price !== null
                              ? formatCurrency(metrics.option_price, 2)
                              : "—"}
                          </div>
                          <input
                            type="number"
                            step="0.01"
                            value={scenarioOptionPrices[position.id] ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(event) =>
                              setScenarioOptionPrices((prev) => ({
                                ...prev,
                                [position.id]: event.target.value,
                              }))
                            }
                            placeholder="What-if"
                            className="w-24 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-200"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {metrics.market.current_price !== null
                          ? formatCurrency(metrics.market.current_price, 2)
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{metrics.dte ?? "—"}</td>
                      <td
                        className={`px-3 py-2 font-semibold ${
                          (pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {pnl !== null && pnl !== undefined
                          ? formatCurrency(pnl, 0)
                          : "—"}
                        {effectiveOptionPrice !== metrics.option_price && (
                          <div className="text-[10px] text-amber-300">scenario</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {metrics.greeks ? metrics.greeks.delta.toFixed(3) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {metrics.greeks ? metrics.greeks.theta.toFixed(3) : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(position);
                            }}
                            className="bg-sky-700 hover:bg-sky-600 text-white px-2 py-1 rounded text-xs font-medium"
                          >
                            Edit
                          </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openCloseModal(position.id);
                          }}
                          className="bg-rose-700 hover:bg-rose-600 text-white px-2 py-1 rounded text-xs font-medium"
                        >
                          −
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-gray-700 text-xs">
                <tr>
                  <td className="px-3 py-2 font-semibold text-gray-400" colSpan={9}>
                    Table Total P&amp;L (with scenarios)
                  </td>
                  <td
                    className={`px-3 py-2 font-semibold ${
                      totals.totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {formatCurrency(totals.totalPnl, 0)}
                  </td>
                  <td className="px-3 py-2 text-gray-500" colSpan={3}>
                    {totals.percent !== null ? `${formatSigned(totals.percent, 1)}%` : "—"}
                  </td>
                </tr>
              </tfoot>
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
            <div
              className={`text-sm font-semibold ${
                greekSummary.tone === "bullish"
                  ? "text-emerald-300"
                  : greekSummary.tone === "bearish"
                    ? "text-rose-300"
                    : "text-gray-200"
              }`}
            >
              {greekSummary.overall}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span
                className={`px-2 py-0.5 rounded-full border ${
                  greekSummary.tone === "bullish"
                    ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-200"
                    : greekSummary.tone === "bearish"
                      ? "border-rose-700/60 bg-rose-900/30 text-rose-200"
                      : "border-gray-700 bg-gray-800 text-gray-300"
                }`}
              >
                Direction: {greekSummary.tone}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full border ${
                  greekSummary.thetaDirection === "decay"
                    ? "border-amber-700/60 bg-amber-900/30 text-amber-200"
                    : "border-emerald-700/60 bg-emerald-900/30 text-emerald-200"
                }`}
              >
                Time: {greekSummary.thetaDirection}
              </span>
            </div>
            <ul className="mt-2 text-sm text-gray-200 space-y-1">
              {greekSummary.details.map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {selected && (
          <div className="mb-4 p-3 bg-gray-900/40 rounded-lg border border-gray-700/60">
            <div className="text-xs text-gray-400 mb-2">
              Price zones: ITM starts at strike, profit-taking defaults to strike + premium, and loss-cut is editable.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-gray-400">
                Strike (ITM line)
                <input
                  type="number"
                  value={selected.position.strike}
                  readOnly
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300"
                />
              </label>
              <label className="text-xs text-gray-400">
                Profit-take price
                <input
                  type="number"
                  step="0.01"
                  value={selectedZoneInputs?.profitTake ?? ""}
                  onChange={(event) =>
                    setZoneInputsByPosition((prev) => ({
                      ...prev,
                      [selected.position.id]: {
                        profitTake: event.target.value,
                        lossCut: prev[selected.position.id]?.lossCut ?? "",
                      },
                    }))
                  }
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                />
              </label>
              <label className="text-xs text-gray-400">
                Loss-cut price
                <input
                  type="number"
                  step="0.01"
                  value={selectedZoneInputs?.lossCut ?? ""}
                  onChange={(event) =>
                    setZoneInputsByPosition((prev) => ({
                      ...prev,
                      [selected.position.id]: {
                        profitTake: prev[selected.position.id]?.profitTake ?? "",
                        lossCut: event.target.value,
                      },
                    }))
                  }
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                />
              </label>
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              Legend: <span className="text-sky-300">dotted</span> = spot,{" "}
              <span className="text-amber-300">amber</span> = strike/ITM threshold,{" "}
              <span className="text-emerald-300">green zone</span> = profit-taking,{" "}
              <span className="text-rose-300">red zone</span> = loss-cut.
            </div>
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
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
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
                    {chartPriceDomain && selectedLossCut !== null && (
                      <ReferenceArea
                        x1={chartPriceDomain.min}
                        x2={selectedLossCut}
                        fill="#ef4444"
                        fillOpacity={0.1}
                      />
                    )}
                    {chartPriceDomain && selectedStrike !== null && (
                      <ReferenceArea
                        x1={selectedStrike}
                        x2={chartPriceDomain.max}
                        fill="#f59e0b"
                        fillOpacity={0.08}
                      />
                    )}
                    {chartPriceDomain && selectedProfitTake !== null && (
                      <ReferenceArea
                        x1={selectedProfitTake}
                        x2={chartPriceDomain.max}
                        fill="#22c55e"
                        fillOpacity={0.12}
                      />
                    )}
                    {selectedSpotPrice !== null && (
                      <ReferenceLine x={selectedSpotPrice} stroke="#7dd3fc" strokeDasharray="4 4" />
                    )}
                    {selectedStrike !== null && (
                      <ReferenceLine x={selectedStrike} stroke="#f59e0b" strokeDasharray="3 3" />
                    )}
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
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
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
                    {chartPriceDomain && selectedLossCut !== null && (
                      <ReferenceArea
                        x1={chartPriceDomain.min}
                        x2={selectedLossCut}
                        fill="#ef4444"
                        fillOpacity={0.1}
                      />
                    )}
                    {chartPriceDomain && selectedStrike !== null && (
                      <ReferenceArea
                        x1={selectedStrike}
                        x2={chartPriceDomain.max}
                        fill="#f59e0b"
                        fillOpacity={0.08}
                      />
                    )}
                    {chartPriceDomain && selectedProfitTake !== null && (
                      <ReferenceArea
                        x1={selectedProfitTake}
                        x2={chartPriceDomain.max}
                        fill="#22c55e"
                        fillOpacity={0.12}
                      />
                    )}
                    {selectedSpotPrice !== null && (
                      <ReferenceLine x={selectedSpotPrice} stroke="#7dd3fc" strokeDasharray="4 4" />
                    )}
                    {selectedStrike !== null && (
                      <ReferenceLine x={selectedStrike} stroke="#f59e0b" strokeDasharray="3 3" />
                    )}
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

      {/* Trade Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">
                {editingPositionId ? "Edit Trade" : "Add New Trade"}
              </h2>
              <button
                onClick={closeTradeModal}
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

            <form
              onSubmit={editingPositionId ? handleUpdatePosition : handleCreatePosition}
              className="space-y-4"
            >
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
                  onClick={closeTradeModal}
                  className="px-4 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  {submitting
                    ? editingPositionId
                      ? "Saving..."
                      : "Adding..."
                    : editingPositionId
                      ? "Save Changes"
                      : "Add Trade"}
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setClosedExitOverrides({})}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-xs"
                >
                  Reset What-if
                </button>
                <button
                  onClick={() => setShowClosedLog(false)}
                  className="text-gray-400 hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Tracked Closed Trades</div>
                <div className="text-base font-semibold text-gray-100">{closedTotals.totalTrades}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Win Rate</div>
                <div className="text-base font-semibold text-gray-100">{formatPercent(closedTotals.winRate, 1)}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Total Cost</div>
                <div className="text-base font-semibold text-gray-100">{formatCurrency(closedTotals.totalCost, 0)}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Total P&amp;L (with what-if)</div>
                <div
                  className={`text-base font-semibold ${
                    closedTotals.totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {formatCurrency(closedTotals.totalPnl, 0)}
                </div>
              </div>
            </div>

            {sortedClosedRows.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No closed positions yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-gray-300">
                  <thead className="text-xs uppercase text-gray-500 border-b border-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "symbol",
                              direction: prev.key === "symbol" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Symbol {sortArrow(closedSort.key === "symbol", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "strike",
                              direction: prev.key === "strike" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Strike {sortArrow(closedSort.key === "strike", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "option_type",
                              direction: prev.key === "option_type" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Type {sortArrow(closedSort.key === "option_type", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "fill_price",
                              direction: prev.key === "fill_price" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Entry {sortArrow(closedSort.key === "fill_price", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "exit_price",
                              direction: prev.key === "exit_price" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Exit / What-if {sortArrow(closedSort.key === "exit_price", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "close_date",
                              direction: prev.key === "close_date" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          Close Date {sortArrow(closedSort.key === "close_date", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "dollar_pnl",
                              direction: prev.key === "dollar_pnl" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          P&amp;L $ {sortArrow(closedSort.key === "dollar_pnl", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">
                        <button
                          type="button"
                          onClick={() =>
                            setClosedSort((prev) => ({
                              key: "percent_pnl",
                              direction: prev.key === "percent_pnl" && prev.direction === "asc" ? "desc" : "asc",
                            }))
                          }
                        >
                          P&amp;L % {sortArrow(closedSort.key === "percent_pnl", closedSort.direction)}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {sortedClosedRows.map((pos) => (
                      <tr key={pos.id} className="hover:bg-gray-900/40">
                        <td className="px-3 py-2 font-semibold">{pos.symbol}</td>
                        <td className="px-3 py-2">${formatNumber(pos.strike, 2)}</td>
                        <td className="px-3 py-2 uppercase">{pos.option_type}</td>
                        <td className="px-3 py-2">${formatNumber(pos.fill_price, 2)}</td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <div>${formatNumber(pos.exit_price, 2)}</div>
                            <input
                              type="number"
                              step="0.01"
                              value={closedExitOverrides[pos.id] ?? ""}
                              onChange={(event) =>
                                setClosedExitOverrides((prev) => ({
                                  ...prev,
                                  [pos.id]: event.target.value,
                                }))
                              }
                              placeholder="What-if"
                              className="w-24 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-200"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">{formatDate(pos.close_date)}</td>
                        <td
                          className={`px-3 py-2 font-semibold ${
                            pos.effective_dollar_pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {formatCurrency(pos.effective_dollar_pnl, 0)}
                        </td>
                        <td
                          className={`px-3 py-2 ${
                            pos.effective_percent_pnl >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {formatSigned(pos.effective_percent_pnl, 1)}%
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
