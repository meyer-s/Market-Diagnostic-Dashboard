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
  usePlotArea,
} from "recharts";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import { apiFetch } from "../utils/apiUtils";
import { CHART_NEUTRAL } from "../utils/chartUtils";
import { formatDate, formatNumber } from "../utils/styleUtils";
import { getFamilyColor } from "../theme/metricColors";
import { buildHolisticSummary } from "../utils/holisticSummary";
import { buildSummaryInputFromSnapshot, type TechnicalDataLike, type FundamentalsLike, type OptionalityLike } from "../utils/summaryInput";

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
  source_event_id: number | null;
  source_triggered_at: string | null;
  source_match_method: string | null;
  source_match_confidence: number | null;
  source_match_notes: string | null;
}

interface PositionMetrics {
  market: {
    current_price: number | null;
    previous_close: number | null;
    change: number | null;
    change_percent: number | null;
    implied_volatility: number | null;
    last_updated: string;
    data_source?: string | null;
    quote_source?: string | null;
  };
  option_price: number | null;
  option_price_source: string | null;
  quote: {
    bid: number | null;
    ask: number | null;
    last: number | null;
    mid: number | null;
    spread: number | null;
    spread_pct: number | null;
    volume: number | null;
    open_interest: number | null;
    implied_volatility: number | null;
    last_trade_at: string | null;
    data_source?: string | null;
    quote_source?: string | null;
    quality: string | null;
  };
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
  source_event_id: number | null;
  source_triggered_at: string | null;
  source_match_method: string | null;
  source_match_confidence: number | null;
  source_match_notes: string | null;
}

interface TrainingOutcomeRow {
  event_id: number;
  symbol: string;
  triggered_at: string | null;
  option_type: string;
  hold_days: number;
  entry_date: string;
  exit_date: string | null;
  entry_underlying: number;
  exit_underlying: number | null;
  underlying_directional_return_pct: number | null;
  entry_option_price_est: number | null;
  exit_option_price_est: number | null;
  option_return_pct_est: number | null;
  option_pnl_per_contract_est: number | null;
  status: "matured" | "pending";
}

interface TrainingOutcomeSummary {
  sample_size: number;
  matured: number;
  pending: number;
  win_rate_pct: number | null;
  avg_option_return_pct: number | null;
  total_option_pnl_per_contract: number | null;
}

interface TrainingOutcomeResponse {
  outcomes: TrainingOutcomeRow[];
  summary: TrainingOutcomeSummary;
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

interface SpotWeighting {
  technical: number | null;
  fundamental: number | null;
  composite: number;
  confidence: number;
  signalCount: number;
  direction: "left" | "right" | "neutral";
}

const EMPTY_SPOT_WEIGHTING: SpotWeighting = {
  technical: null,
  fundamental: null,
  composite: 0,
  confidence: 0,
  signalCount: 0,
  direction: "neutral",
};

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

const capitalizeWord = (value: string) => {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

const formatDataSource = (source?: string | null, quoteSource?: string | null) => {
  const normalized = source?.trim().toLowerCase();
  const provider =
    normalized === "ibkr"
      ? "IBKR"
      : normalized === "yahoo" || normalized === "yfinance"
        ? "yfinance"
        : source?.trim() || "Unknown";
  const detail = quoteSource?.trim();
  return detail ? `${provider} (${detail.replace(/_/g, " ")})` : provider;
};

const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));
const countAxisRules = (axis: { debug?: { rules?: unknown[] } } | null | undefined): number => {
  const rules = axis?.debug?.rules;
  return Array.isArray(rules) ? rules.length : 0;
};

const computeSpotWeighting = (payload: Record<string, unknown> | null, symbol: string): SpotWeighting => {
  const summaryInput = buildSummaryInputFromSnapshot({
    symbol,
    technicalData: payload?.technical as TechnicalDataLike,
    fundamentals: payload?.fundamentals as FundamentalsLike | null,
    optionalityMetrics: payload?.optionality as OptionalityLike | null,
    asOf: (payload?.as_of_date || payload?.created_at || null) as string | null,
  });
  if (!summaryInput) {
    return EMPTY_SPOT_WEIGHTING;
  }

  const summary = buildHolisticSummary(summaryInput);
  const technicalAxis = summary.debug?.technical;
  const fundamentalAxis = summary.debug?.fundamental;
  if (!technicalAxis && !fundamentalAxis) {
    return EMPTY_SPOT_WEIGHTING;
  }

  const technical = technicalAxis ? clampUnit(technicalAxis.score / 100) : null;
  const fundamental = fundamentalAxis ? clampUnit(fundamentalAxis.score / 100) : null;
  const technicalUsed = technical ?? 0;
  const fundamentalUsed = fundamental ?? 0;
  const rawComposite = technicalUsed * 0.6 + fundamentalUsed * 0.4;
  const confidence =
    ((technicalAxis?.confidence ?? 0) * 0.6 + (fundamentalAxis?.confidence ?? 0) * 0.4) / 100;
  const normalizedConfidence = Math.max(0, Math.min(1, confidence));
  const composite = clampUnit(rawComposite * normalizedConfidence);
  const signalCount = countAxisRules(technicalAxis) + countAxisRules(fundamentalAxis);
  const direction = composite > 0.08 ? "right" : composite < -0.08 ? "left" : "neutral";

  return {
    technical,
    fundamental,
    composite,
    confidence: normalizedConfidence,
    signalCount,
    direction,
  };
};

const getProjectionColor = (strength: number) => {
  if (strength > 0.08) return "#22c55e";
  if (strength < -0.08) return "#f43f5e";
  return "#64748b";
};

const ProjectionBezierOverlay = ({
  selectedSpotPrice,
  chartPriceDomain,
  technicalStrength,
  fundamentalStrength,
}: {
  selectedSpotPrice: number | null;
  chartPriceDomain: { min: number; max: number } | null;
  technicalStrength: number | null | undefined;
  fundamentalStrength: number | null | undefined;
}) => {
  const plotArea = usePlotArea();
  if (!plotArea || selectedSpotPrice === null || !chartPriceDomain) return null;

  const left = Number(plotArea.x);
  const top = Number(plotArea.y);
  const width = Number(plotArea.width);
  const height = Number(plotArea.height);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const domainMin = Number(chartPriceDomain.min);
  const domainMax = Number(chartPriceDomain.max);
  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax <= domainMin) return null;

  const ratio = (selectedSpotPrice - domainMin) / (domainMax - domainMin);
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const right = left + width;
  const spotX = left + clampedRatio * width;
  const clampedSpotX = Math.max(left + 4, Math.min(right - 4, spotX));

  const makeHalfPath = (strength: number, half: "top" | "bottom") => {
    const s = clampUnit(strength);
    const dir = s >= 0 ? 1 : -1;
    const mag = Math.abs(s);
    const span = width * (0.14 + mag * 0.34);
    const endX = Math.max(left + 4, Math.min(right - 4, clampedSpotX + dir * span));
    const yJoin = top + height * 0.52;
    const yEdge = half === "top" ? top : top + height;
    const c1x = clampedSpotX + dir * (span * 0.14);
    const c2x = clampedSpotX + dir * (span * 0.72);
    const c1y = half === "top" ? yJoin - height * 0.18 : yJoin + height * 0.18;
    const c2y = half === "top" ? yEdge + height * 0.08 : yEdge - height * 0.08;
    const axisNudge = Math.max(4, Math.min(10, span * 0.1));
    const edgeInset = Math.max(8, Math.min(12, height * 0.06));
    return {
      path: `M ${clampedSpotX} ${yJoin}
        C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${yEdge}
        L ${clampedSpotX} ${yEdge}
        Z`,
      labelX: clampedSpotX + dir * axisNudge,
      labelY: half === "top" ? top + edgeInset : top + height - edgeInset,
    };
  };

  const tech = makeHalfPath(technicalStrength ?? 0, "top");
  const fund = makeHalfPath(fundamentalStrength ?? 0, "bottom");
  const techColor = getProjectionColor(technicalStrength ?? 0);
  const fundColor = getProjectionColor(fundamentalStrength ?? 0);

  return (
    <g pointerEvents="none">
      <path d={tech.path} fill={techColor} fillOpacity={0.14} />
      <path d={fund.path} fill={fundColor} fillOpacity={0.12} />
      <text x={tech.labelX} y={tech.labelY} fill={techColor} fontSize={9} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
        T
      </text>
      <text x={fund.labelX} y={fund.labelY} fill={fundColor} fontSize={9} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
        F
      </text>
    </g>
  );
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
    overall: `${capitalizeWord(deltaDirection)} setup with ${
      thetaDirection === "decay" ? "negative time carry" : "positive time carry"
    }.`,
    details: [
      {
        label: "Delta",
        value: formatSigned(delta, 3),
        note: `~${formatSigned(delta * 100, 1)} per $1 move per contract (${capitalizeWord(
          deltaDirection
        )})`,
      },
      {
        label: "Gamma",
        value: formatSigned(gamma, 4),
        note: `Delta changes by ~${formatSigned(gamma, 4)} for each $1 move`,
      },
      {
        label: "Theta",
        value: formatSigned(theta, 4),
        note: `~$${Math.abs(theta).toFixed(2)} per day per contract (${capitalizeWord(
          thetaDirection
        )})`,
      },
      {
        label: "Vega",
        value: formatSigned(vega, 4),
        note: `~$${Math.abs(vega).toFixed(2)} per +1 vol point (1%) per contract`,
      },
      {
        label: "Directional response",
        value: directionalLabel,
        note: convexityLabel,
      },
      {
        label: "Volatility + time",
        value: vegaLabel,
        note: thetaLabel,
      },
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
      data_source: metrics?.market?.data_source ?? null,
      quote_source: metrics?.market?.quote_source ?? null,
    },
    option_price: metrics?.option_price ?? null,
    option_price_source: metrics?.option_price_source ?? null,
    quote: {
      ...{
        bid: null,
        ask: null,
        last: null,
        mid: null,
        spread: null,
        spread_pct: null,
        volume: null,
        open_interest: null,
        implied_volatility: null,
        last_trade_at: null,
        data_source: null,
        quote_source: null,
        quality: null,
      },
      ...(metrics?.quote ?? {}),
    },
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
  const [showTrainingOutcomes, setShowTrainingOutcomes] = useState(false);
  const [trainingOutcomes, setTrainingOutcomes] = useState<TrainingOutcomeRow[]>([]);
  const [trainingSummary, setTrainingSummary] = useState<TrainingOutcomeSummary | null>(null);
  const [loadingTrainingOutcomes, setLoadingTrainingOutcomes] = useState(false);
  const [positionSort, setPositionSort] = useState<{ key: PositionSortKey; direction: SortDirection }>({
    key: "symbol",
    direction: "asc",
  });
  const [closedSort, setClosedSort] = useState<{ key: ClosedSortKey; direction: SortDirection }>({
    key: "close_date",
    direction: "desc",
  });
  const [zoneInputsByPosition, setZoneInputsByPosition] = useState<Record<number, ZoneInputs>>({});
  const [spotWeightBySymbol, setSpotWeightBySymbol] = useState<Record<string, SpotWeighting>>({});

  const anyModalOpen = showAddModal || showCloseModal || showTrainingOutcomes;
  const renderModal = (node: JSX.Element) => {
    if (typeof document === "undefined") {
      return null;
    }
    return createPortal(node, document.body);
  };

  useEffect(() => {
    if (!anyModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [anyModalOpen]);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load positions");
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
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to add position.");
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
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to update position.");
    } finally {
      setSubmitting(false);
    }
  };

  const loadClosedPositions = async () => {
    try {
      const data = await apiFetch<{ closed_positions: ClosedPositionRow[] }>(
        "/secret/options/closed-positions?limit=500"
      );
      setClosedPositions(data.closed_positions || []);
    } catch (err: unknown) {
      console.error("Failed to load closed positions:", err);
    }
  };

  const loadTrainingOutcomes = async () => {
    setLoadingTrainingOutcomes(true);
    try {
      const data = await apiFetch<TrainingOutcomeResponse>(
        "/secret/options/training-outcomes?lookback_days=365&limit=300"
      );
      setTrainingOutcomes(data.outcomes || []);
      setTrainingSummary(data.summary || null);
    } catch (err: unknown) {
      console.error("Failed to load training outcomes:", err);
      setTrainingOutcomes([]);
      setTrainingSummary(null);
    } finally {
      setLoadingTrainingOutcomes(false);
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
    } catch (err: unknown) {
      alert(`Failed to close position: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openCloseModal = (positionId: number) => {
    setClosingPositionId(positionId);
    setShowCloseModal(true);
  };

  useEffect(() => {
    loadPositions();
    loadClosedPositions();
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
  const selectedSymbol = selected?.position.symbol?.trim().toUpperCase() ?? null;
  const selectedStockAnalysisPath = selectedSymbol
    ? `/stock-analysis/${encodeURIComponent(selectedSymbol)}?symbol=${encodeURIComponent(selectedSymbol)}`
    : null;

  const greekSummary = useMemo(() => {
    const greeks = greeksData?.current_greeks ?? selected?.metrics.greeks ?? null;
    return buildGreeksSummary(greeks);
  }, [greeksData, selected]);

  useEffect(() => {
    if (!selectedSymbol || spotWeightBySymbol[selectedSymbol]) {
      return;
    }
    let cancelled = false;
    apiFetch<Record<string, unknown>>(`/stocks/${selectedSymbol}/projections`)
      .then((payload) => {
        if (cancelled) return;
        setSpotWeightBySymbol((prev) => ({
          ...prev,
          [selectedSymbol]: computeSpotWeighting(payload, selectedSymbol),
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setSpotWeightBySymbol((prev) => ({
          ...prev,
          [selectedSymbol]: EMPTY_SPOT_WEIGHTING,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, spotWeightBySymbol]);

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
            return left.metrics.option_price;
          case "underlying":
            return left.metrics.market.current_price;
          case "dte":
            return left.metrics.dte;
          case "pnl":
            return left.metrics?.pnl?.dollar ?? null;
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
            return right.metrics.option_price;
          case "underlying":
            return right.metrics.market.current_price;
          case "dte":
            return right.metrics.dte;
          case "pnl":
            return right.metrics?.pnl?.dollar ?? null;
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
  }, [positions, positionSort]);

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalPnl = 0;
    let count = 0;
    positions.forEach((item) => {
      totalCost += item.position.total_cost;
      const pnlDollar = item.metrics?.pnl?.dollar;
      if (pnlDollar !== null && pnlDollar !== undefined) {
        totalPnl += pnlDollar;
      }
      count += 1;
    });
    const percent = totalCost ? (totalPnl / totalCost) * 100 : null;
    return { totalCost, totalPnl, percent, count };
  }, [positions]);

  const selectedZoneInputs = selected ? zoneInputsByPosition[selected.position.id] : null;
  const selectedSpotPrice =
    selected?.metrics.market.current_price ?? greeksData?.model_info?.spot_price ?? null;
  const selectedStrike = selected?.position.strike ?? null;
  const selectedProfitTake = asNumber(selectedZoneInputs?.profitTake);
  const selectedLossCut = asNumber(selectedZoneInputs?.lossCut);
  const selectedSpotWeight = selectedSymbol ? spotWeightBySymbol[selectedSymbol] ?? null : null;
  const currentSpotLean = useMemo(() => {
    if (!selected) return 0;
    const dayMove = Number(selected.metrics.market.change_percent ?? 0);
    if (!Number.isFinite(dayMove)) return 0;
    return clampUnit(dayMove / 2.5);
  }, [selected]);
  const projectedSpotGap = clampUnit((selectedSpotWeight?.composite ?? 0) - currentSpotLean);
  const technicalGap =
    selectedSpotWeight?.technical !== null && selectedSpotWeight?.technical !== undefined
      ? clampUnit(selectedSpotWeight.technical - currentSpotLean)
      : projectedSpotGap;
  const fundamentalGap =
    selectedSpotWeight?.fundamental !== null && selectedSpotWeight?.fundamental !== undefined
      ? clampUnit(selectedSpotWeight.fundamental - currentSpotLean)
      : projectedSpotGap;

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

  const sortedClosedRows = useMemo(() => {
    const sorted = [...closedPositions];
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
            return left.exit_price;
          case "close_date":
            return left.close_date;
          case "dollar_pnl":
            return left.dollar_pnl;
          case "percent_pnl":
            return left.percent_pnl;
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
            return right.exit_price;
          case "close_date":
            return right.close_date;
          case "dollar_pnl":
            return right.dollar_pnl;
          case "percent_pnl":
            return right.percent_pnl;
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
  }, [closedPositions, closedSort]);

  const closedTotals = useMemo(() => {
    const totalPnl = sortedClosedRows.reduce((sum, row) => sum + row.dollar_pnl, 0);
    const totalCost = sortedClosedRows.reduce((sum, row) => sum + row.total_cost, 0);
    const winners = sortedClosedRows.filter((row) => row.dollar_pnl > 0).length;
    const totalTrades = sortedClosedRows.length;
    return {
      totalPnl,
      totalCost,
      totalTrades,
      winners,
      winRate: totalTrades ? (winners / totalTrades) * 100 : 0,
    };
  }, [sortedClosedRows]);

  const openAttribution = useMemo(() => {
    const linked = positions.filter(
      (item) => item.position.source_event_id !== null && item.position.source_event_id !== undefined
    );
    const avgLinkConfidence = linked.length
      ? linked.reduce((sum, item) => sum + (item.position.source_match_confidence ?? 0), 0) / linked.length
      : null;
    return {
      linked: linked.length,
      total: positions.length,
      coverage: positions.length ? (linked.length / positions.length) * 100 : 0,
      avgLinkConfidence,
    };
  }, [positions]);

  const closedAttribution = useMemo(() => {
    const linked = sortedClosedRows.filter(
      (row) => row.source_event_id !== null && row.source_event_id !== undefined
    );
    const linkedWins = linked.filter((row) => row.dollar_pnl > 0).length;
    const linkedNetPnl = linked.reduce((sum, row) => sum + row.dollar_pnl, 0);
    const linkedAvgPercent = linked.length
      ? linked.reduce((sum, row) => sum + row.percent_pnl, 0) / linked.length
      : null;
    const linkedExpectancyDollar = linked.length ? linkedNetPnl / linked.length : null;
    return {
      linked: linked.length,
      linkedWinRate: linked.length ? (linkedWins / linked.length) * 100 : 0,
      linkedAvgPercent,
      linkedExpectancyDollar,
    };
  }, [sortedClosedRows]);

  const sortArrow = (active: boolean, direction: SortDirection) => {
    if (!active) return "↕";
    return direction === "asc" ? "↑" : "↓";
  };

  const buildAttributionTooltip = (
    sourceEventId: number | null | undefined,
    sourceTriggeredAt: string | null | undefined,
    sourceMatchMethod: string | null | undefined,
    sourceMatchConfidence: number | null | undefined,
    sourceMatchNotes: string | null | undefined
  ): string => {
    if (!sourceEventId) {
      return "No linked sweep signal for this trade.";
    }
    const lines = [
      `Linked sweep event #${sourceEventId}`,
      sourceTriggeredAt ? `Triggered: ${sourceTriggeredAt}` : "Triggered: n/a",
      sourceMatchMethod ? `Method: ${sourceMatchMethod}` : "Method: n/a",
      sourceMatchConfidence !== null && sourceMatchConfidence !== undefined
        ? `Link confidence: ${Math.round(sourceMatchConfidence * 100)}%`
        : "Link confidence: n/a",
    ];
    if (sourceMatchNotes) {
      lines.push(`Notes: ${sourceMatchNotes}`);
    }
    return lines.join("\n");
  };

  const attributionHeat = (
    sourceEventId: number | null | undefined,
    confidence: number | null | undefined
  ): { marker: string; rowTint: string; quality: string } => {
    if (!sourceEventId) {
      return {
        marker: "bg-gray-600",
        rowTint: "",
        quality: "unlinked",
      };
    }
    const c = confidence ?? 0;
    if (c >= 0.9) {
      return { marker: "bg-emerald-400", rowTint: "bg-emerald-950/20", quality: "high" };
    }
    if (c >= 0.75) {
      return { marker: "bg-lime-400", rowTint: "bg-lime-950/15", quality: "good" };
    }
    if (c >= 0.6) {
      return { marker: "bg-amber-400", rowTint: "bg-amber-950/10", quality: "medium" };
    }
    return { marker: "bg-rose-400", rowTint: "bg-rose-950/10", quality: "low" };
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

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
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
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="text-xs text-gray-500">Sweep Linked</div>
          <div className="text-lg font-semibold">
            {openAttribution.linked}/{openAttribution.total}
          </div>
          <div className="text-xs text-gray-400">
            {formatPercent(openAttribution.coverage, 1)} coverage
            {openAttribution.avgLinkConfidence !== null
              ? ` • ${formatPercent(openAttribution.avgLinkConfidence * 100, 0)} avg link conf`
              : ""}
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="text-xs text-gray-500">Signal Quality (Linked)</div>
          <div
            className={`text-lg font-semibold ${
              closedAttribution.linkedAvgPercent !== null && closedAttribution.linkedAvgPercent < 0
                ? "text-rose-300"
                : "text-emerald-300"
            }`}
          >
            {closedAttribution.linked > 0
              ? `${formatPercent(closedAttribution.linkedWinRate, 1)} win`
              : "n/a"}
          </div>
          <div className="text-xs text-gray-400">
            {closedAttribution.linked > 0
              ? `n=${closedAttribution.linked} • ${
                  closedAttribution.linkedAvgPercent !== null
                    ? `${formatSigned(closedAttribution.linkedAvgPercent, 1)}% avg`
                    : "avg n/a"
                }${
                  closedAttribution.linkedExpectancyDollar !== null
                    ? ` • ${formatCurrency(closedAttribution.linkedExpectancyDollar, 0)} expectancy`
                    : ""
                }`
              : "No closed linked trades yet"}
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold">Position Summary</h2>
            <p className="text-xs text-gray-500">
              Click a row to inspect Greeks. Click column headers to sort.
            </p>
          </div>
          <div className="flex gap-2">
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
            <button
              onClick={() => {
                loadTrainingOutcomes();
                setShowTrainingOutcomes(true);
              }}
              className="bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              Scanner Outcomes
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
                      Option {sortArrow(positionSort.key === "option_price", positionSort.direction)}
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
                  const heat = attributionHeat(position.source_event_id, position.source_match_confidence);
                  const tooltip = buildAttributionTooltip(
                    position.source_event_id,
                    position.source_triggered_at,
                    position.source_match_method,
                    position.source_match_confidence,
                    position.source_match_notes
                  );
                  const optionQuoteSource = formatDataSource(metrics.quote?.data_source, metrics.quote?.quote_source);
                  const underlyingQuoteSource = formatDataSource(
                    metrics.market?.data_source,
                    metrics.market?.quote_source
                  );
                  const rowActive = position.id === selectedId;
                  return (
                    <tr
                      key={position.id}
                      className={`cursor-pointer ${
                        rowActive ? "bg-gray-900/60" : `${heat.rowTint} hover:bg-gray-900/40`
                      }`}
                      onClick={() => setSelectedId(position.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            title={`${tooltip}\nLink quality: ${heat.quality}`}
                            className={`inline-block h-5 w-1.5 rounded-full ${heat.marker}`}
                          />
                          <span className="font-semibold text-gray-100">{position.symbol}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">${formatNumber(position.strike, 2)}</td>
                      <td className="px-3 py-2">{formatDate(position.expiration)}</td>
                      <td className="px-3 py-2 uppercase">{position.option_type}</td>
                      <td className="px-3 py-2">{position.contracts}</td>
                      <td className="px-3 py-2">{formatCurrency(position.fill_price, 2)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span>{metrics.option_price !== null ? formatCurrency(metrics.option_price, 2) : "—"}</span>
                          <span className="text-[10px] uppercase text-gray-500">{optionQuoteSource}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {metrics.market.current_price !== null
                              ? formatCurrency(metrics.market.current_price, 2)
                              : "—"}
                          </span>
                          <span className="text-[10px] uppercase text-gray-500">
                            {underlyingQuoteSource}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">{metrics.dte ?? "—"}</td>
                      <td
                        className={`px-3 py-2 font-semibold ${
                          (metrics.pnl?.dollar ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {metrics.pnl?.dollar !== null && metrics.pnl?.dollar !== undefined
                          ? formatCurrency(metrics.pnl.dollar, 0)
                          : "—"}
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
                    Table Total P&amp;L
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
          <div className="flex flex-col items-end gap-2">
            {selectedStockAnalysisPath && selectedSymbol && (
              <Link
                to={selectedStockAnalysisPath}
                className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
              >
                View {selectedSymbol} Analysis
              </Link>
            )}
            {selected && (
              <div className="text-xs text-gray-400 text-right">
                <div>
                  Vol source: {selected.metrics.volatility_source || "n/a"}{" "}
                  {selected.metrics.volatility ? `(${formatPercent(selected.metrics.volatility * 100, 1)})` : ""}
                </div>
                <div>Option price: {selected.metrics.option_price_source || "n/a"}</div>
                <div>
                  Option quote source:{" "}
                  {formatDataSource(selected.metrics.quote?.data_source, selected.metrics.quote?.quote_source)}
                </div>
                <div>
                  Underlying source:{" "}
                  {formatDataSource(selected.metrics.market?.data_source, selected.metrics.market?.quote_source)}
                </div>
                <div>
                  Quote: bid{" "}
                  {selected.metrics.quote?.bid !== null && selected.metrics.quote?.bid !== undefined
                    ? formatCurrency(selected.metrics.quote.bid, 2)
                    : "n/a"}{" "}
                  / ask{" "}
                  {selected.metrics.quote?.ask !== null && selected.metrics.quote?.ask !== undefined
                    ? formatCurrency(selected.metrics.quote.ask, 2)
                    : "n/a"}
                </div>
                <div>
                  Spread:{" "}
                  {selected.metrics.quote?.spread_pct !== null && selected.metrics.quote?.spread_pct !== undefined
                    ? formatPercent(selected.metrics.quote.spread_pct, 1)
                    : "n/a"}{" "}
                  | OI/Vol: {selected.metrics.quote?.open_interest ?? "n/a"} / {selected.metrics.quote?.volume ?? "n/a"}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mb-4">
          {loadingGreeks ? (
            <div className="text-sm text-gray-400">Loading Greeks...</div>
          ) : greeksData && greeksData.price_curve.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-gray-900 rounded-lg border border-gray-700 p-3">
                <h3 className="text-sm font-semibold mb-2">Delta vs Price</h3>
                <div className="h-48" style={{ minWidth: 0, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
                      <ProjectionBezierOverlay
                        selectedSpotPrice={selectedSpotPrice}
                        chartPriceDomain={chartPriceDomain}
                        technicalStrength={technicalGap}
                        fundamentalStrength={fundamentalGap}
                      />
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
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
                      <ProjectionBezierOverlay
                        selectedSpotPrice={selectedSpotPrice}
                        chartPriceDomain={chartPriceDomain}
                        technicalStrength={technicalGap}
                        fundamentalStrength={fundamentalGap}
                      />
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
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
              {selectedSpotPrice !== null && (
                <div>
                  <span className="text-gray-500">Chart spot:</span>{" "}
                  <span className="text-gray-300">{formatCurrency(selectedSpotPrice)}</span>
                </div>
              )}
              {greeksData.model_info.spot_price !== undefined && greeksData.model_info.spot_price !== null && (
                <div>
                  <span className="text-gray-500">Model spot:</span>{" "}
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
              Deterministic Snapshot
            </div>
            <div
              className={`text-sm font-semibold leading-relaxed ${
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
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {greekSummary.details.map((item) => (
                <div
                  key={item.label}
                  className="rounded-md border border-gray-700/70 bg-gray-900/40 px-2.5 py-2"
                >
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">{item.label}</div>
                  <div className="text-sm font-medium text-gray-100">{item.value}</div>
                  <div className="text-[11px] leading-snug text-gray-400 mt-0.5">{item.note}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="mb-4 p-3 bg-gray-900/40 rounded-lg border border-gray-700/60">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-amber-300">
                Strike (ITM line)
                <input
                  type="number"
                  value={selected.position.strike}
                  readOnly
                  className="mt-1 w-full bg-gray-900 border border-amber-700/70 rounded px-2 py-1.5 text-xs text-amber-100"
                />
              </label>
              <label className="text-xs text-emerald-300">
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
                  className="mt-1 w-full bg-gray-900 border border-emerald-700/70 rounded px-2 py-1.5 text-xs text-emerald-100"
                />
              </label>
              <label className="text-xs text-rose-300">
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
                  className="mt-1 w-full bg-gray-900 border border-rose-700/70 rounded px-2 py-1.5 text-xs text-rose-100"
                />
              </label>
            </div>
          </div>
        )}

      </div>

      {/* Trade Modal */}
      {showAddModal && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
          onClick={closeTradeModal}
        >
          <div
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
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
      {showCloseModal && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
          onClick={() => {
            setShowCloseModal(false);
            setExitPrice("");
            setCloseNotes("");
            setClosingPositionId(null);
          }}
        >
          <div
            className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full"
            onClick={(event) => event.stopPropagation()}
          >
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
      {showClosedLog && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 p-4"
        >
          <div className="w-full max-w-5xl rounded-lg border border-gray-700 bg-gray-800 p-6 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Closed Positions History</h2>
              <button
                onClick={() => setShowClosedLog(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
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
                <div className="text-[11px] text-gray-500">Total P&amp;L</div>
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
                          Exit {sortArrow(closedSort.key === "exit_price", closedSort.direction)}
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
                    {sortedClosedRows.map((pos) => {
                      const heat = attributionHeat(pos.source_event_id, pos.source_match_confidence);
                      const tooltip = buildAttributionTooltip(
                        pos.source_event_id,
                        pos.source_triggered_at,
                        pos.source_match_method,
                        pos.source_match_confidence,
                        pos.source_match_notes
                      );
                      return (
                      <tr key={pos.id} className={`${heat.rowTint} hover:bg-gray-900/40`}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              title={`${tooltip}\nLink quality: ${heat.quality}`}
                              className={`inline-block h-5 w-1.5 rounded-full ${heat.marker}`}
                            />
                            <span className="font-semibold">{pos.symbol}</span>
                          </div>
                        </td>
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
                    )})}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scanner Training Outcomes Modal */}
      {showTrainingOutcomes && renderModal(
        <div
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowTrainingOutcomes(false)}
        >
          <div
            className="w-full max-w-6xl rounded-lg border border-gray-700 bg-gray-800 p-6 max-h-[90dvh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">Exceptional Scanner Training Outcomes</h2>
                <p className="text-xs text-gray-400 mt-1">
                  Backtest view of exceptional optionality setups held for their suggested window.
                </p>
              </div>
              <button
                onClick={() => setShowTrainingOutcomes(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Examples</div>
                <div className="text-base font-semibold text-gray-100">{trainingSummary?.sample_size ?? 0}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Matured</div>
                <div className="text-base font-semibold text-gray-100">{trainingSummary?.matured ?? 0}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Pending</div>
                <div className="text-base font-semibold text-gray-100">{trainingSummary?.pending ?? 0}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Win Rate</div>
                <div className="text-base font-semibold text-gray-100">
                  {trainingSummary?.win_rate_pct !== null && trainingSummary?.win_rate_pct !== undefined
                    ? formatPercent(trainingSummary.win_rate_pct, 1)
                    : "—"}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Avg Return</div>
                <div className={`text-base font-semibold ${(trainingSummary?.avg_option_return_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {trainingSummary?.avg_option_return_pct !== null && trainingSummary?.avg_option_return_pct !== undefined
                    ? formatSigned(trainingSummary.avg_option_return_pct, 1) + "%"
                    : "—"}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
                <div className="text-[11px] text-gray-500">Total P/L (1 lot)</div>
                <div className={`text-base font-semibold ${(trainingSummary?.total_option_pnl_per_contract ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {trainingSummary?.total_option_pnl_per_contract !== null && trainingSummary?.total_option_pnl_per_contract !== undefined
                    ? formatCurrency(trainingSummary.total_option_pnl_per_contract, 0)
                    : "—"}
                </div>
              </div>
            </div>

            {loadingTrainingOutcomes ? (
              <div className="text-sm text-gray-400 text-center py-8">Loading scanner outcomes...</div>
            ) : trainingOutcomes.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No exceptional scanner examples found in lookback window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-gray-300">
                  <thead className="text-xs uppercase text-gray-500 border-b border-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Hold</th>
                      <th className="px-3 py-2 text-left">Entry</th>
                      <th className="px-3 py-2 text-left">Exit</th>
                      <th className="px-3 py-2 text-left">Underlying Dir %</th>
                      <th className="px-3 py-2 text-left">Entry Prem</th>
                      <th className="px-3 py-2 text-left">Exit Prem</th>
                      <th className="px-3 py-2 text-left">Option Return %</th>
                      <th className="px-3 py-2 text-left">P/L (1 contract)</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {trainingOutcomes.map((row) => (
                      <tr key={row.event_id} className="hover:bg-gray-900/40">
                        <td className="px-3 py-2 font-semibold text-gray-100">{row.symbol}</td>
                        <td className="px-3 py-2 uppercase">{row.option_type}</td>
                        <td className="px-3 py-2">{row.hold_days}d</td>
                        <td className="px-3 py-2">{formatDate(row.entry_date)}</td>
                        <td className="px-3 py-2">{row.exit_date ? formatDate(row.exit_date) : "—"}</td>
                        <td className={`px-3 py-2 ${(row.underlying_directional_return_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {row.underlying_directional_return_pct !== null && row.underlying_directional_return_pct !== undefined
                            ? `${formatSigned(row.underlying_directional_return_pct, 1)}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">{row.entry_option_price_est !== null && row.entry_option_price_est !== undefined ? formatCurrency(row.entry_option_price_est, 2) : "—"}</td>
                        <td className="px-3 py-2">{row.exit_option_price_est !== null && row.exit_option_price_est !== undefined ? formatCurrency(row.exit_option_price_est, 2) : "—"}</td>
                        <td className={`px-3 py-2 ${(row.option_return_pct_est ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {row.option_return_pct_est !== null && row.option_return_pct_est !== undefined
                            ? `${formatSigned(row.option_return_pct_est, 1)}%`
                            : "—"}
                        </td>
                        <td className={`px-3 py-2 ${(row.option_pnl_per_contract_est ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {row.option_pnl_per_contract_est !== null && row.option_pnl_per_contract_est !== undefined
                            ? formatCurrency(row.option_pnl_per_contract_est, 0)
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded px-2 py-1 text-xs font-semibold ${
                              row.status === "matured"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-600/50"
                                : "bg-amber-500/20 text-amber-300 border border-amber-600/50"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
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
