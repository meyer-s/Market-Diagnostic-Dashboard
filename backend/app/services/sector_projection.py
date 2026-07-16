"""
Sector Projection Service (Option B)

This service implements a transparent, rules-based scoring system for evaluating sector ETF
performance across multiple time horizons. Unlike black-box machine learning approaches,
every score component is calculable and interpretable by analysts.

Key Features:
- Multi-horizon analysis: 3-month, 6-month, and 12-month projections
- Four weighted scoring components: Trend (45%), Relative Strength (30%), Risk (20%), Regime (5%)
- Regime-aware adjustments: Favors defensive sectors in RED markets, cyclical in GREEN
- Transparent percentile ranking: All scores normalized to 0-100 scale
- Classification system: Winner (top 3), Neutral (middle 5), Loser (bottom 3)

Designed for extensibility - Option A machine learning overlay can be added in future.
"""
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from app.services.ingestion.yahoo_client import YahooClient
from app.models.sector_projection import SectorProjectionRun, SectorProjectionValue
import logging

# =============================================================================
# CONFIGURATION CONSTANTS
# =============================================================================

# 11 SPDR Sector Select ETFs covering all GICS sectors
SECTOR_ETFS = [
    {"symbol": "XLE", "name": "Energy"},
    {"symbol": "XLF", "name": "Financials"},
    {"symbol": "XLK", "name": "Technology"},
    {"symbol": "XLY", "name": "Consumer Discretionary"},
    {"symbol": "XLP", "name": "Consumer Staples"},
    {"symbol": "XLV", "name": "Health Care"},
    {"symbol": "XLI", "name": "Industrials"},
    {"symbol": "XLU", "name": "Utilities"},
    {"symbol": "XLB", "name": "Materials"},
    {"symbol": "XLRE", "name": "Real Estate"},
    {"symbol": "XLC", "name": "Communication Services"},
]
# Benchmark for relative strength calculations
BENCHMARK = {"symbol": "SPY", "name": "S&P 500"}

# Time horizons mapped to trading days (assuming ~252 trading days per year)
HORIZONS = {
    "T": 0,    # Today (uses T_WINDOW_DAYS for calculation)
    "3m": 63,
    "6m": 126,
    "12m": 252,
}
T_WINDOW_DAYS = 21

# Model versioning for tracking projection methodology changes
MODEL_VERSION = "option_b_v1"

# Score component weights - sum to 1.0 for final scoring
# These weights reflect relative importance of each factor in sector evaluation
WEIGHTS = {
    "trend": 0.45,
    "rel_strength": 0.30,
    "risk": 0.20,
    "regime": 0.05,
}

EXPECTED_SECTOR_SYMBOLS = {etf["symbol"] for etf in SECTOR_ETFS}
BLOCKING_DATA_WARNING_TYPES = {
    "empty_sector_projection_run",
    "missing_sector_projections",
    "partial_sector_metrics",
}
QUALITY_STATUS_BLOCKED = "blocked"
QUALITY_STATUS_WARNING = "warning"
QUALITY_STATUS_VALID = "valid"

# =============================================================================
# CORE PROJECTION COMPUTATION
# =============================================================================

logger = logging.getLogger(__name__)


def _warning_type(warning: Dict[str, Any]) -> Optional[str]:
    return warning.get("type") if isinstance(warning, dict) else None


def is_blocking_sector_projection_warning(warning: Dict[str, Any]) -> bool:
    return _warning_type(warning) in BLOCKING_DATA_WARNING_TYPES


def sector_projection_quality_status(warnings: List[Dict[str, Any]]) -> str:
    if any(is_blocking_sector_projection_warning(warning) for warning in warnings):
        return QUALITY_STATUS_BLOCKED
    if warnings:
        return QUALITY_STATUS_WARNING
    return QUALITY_STATUS_VALID


def is_sector_run_excluded_from_latest(run: SectorProjectionRun) -> bool:
    config = run.config_json or {}
    if config.get("excluded_from_latest") is True:
        return True
    warnings = config.get("data_warnings", [])
    return sector_projection_quality_status(warnings) == QUALITY_STATUS_BLOCKED


def get_latest_sector_projection_run(
    db,
    *,
    include_excluded: bool = False,
    search_limit: Optional[int] = None,
) -> Optional[SectorProjectionRun]:
    """Return the latest projection run, optionally skipping quality-blocked runs."""
    query = (
        db.query(SectorProjectionRun)
        .order_by(
            SectorProjectionRun.as_of_date.desc(),
            SectorProjectionRun.created_at.desc(),
            SectorProjectionRun.id.desc(),
        )
    )
    if search_limit is not None:
        query = query.limit(search_limit)
    runs = query.all()
    if include_excluded:
        return runs[0] if runs else None
    for run in runs:
        if not is_sector_run_excluded_from_latest(run):
            values = db.query(SectorProjectionValue).filter_by(run_id=run.id).all()
            read_warnings = validate_sector_projection_quality(_projection_dicts_from_values(values))
            if sector_projection_quality_status(read_warnings) == QUALITY_STATUS_BLOCKED:
                continue
            return run
    return None


def validate_sector_projection_quality(
    projections: List[Dict[str, Any]],
    *,
    zero_metric_threshold_ratio: float = 0.40,
    zero_metric_threshold_count: int = 3,
) -> List[Dict[str, Any]]:
    """Detect incomplete sector projection runs before they become chart inputs."""
    warnings: List[Dict[str, Any]] = []
    if not projections:
        return [{
            "type": "empty_sector_projection_run",
            "details": [{"message": "No sector projection rows were produced."}],
        }]

    by_horizon: Dict[str, List[Dict[str, Any]]] = {horizon: [] for horizon in HORIZONS}
    for projection in projections:
        horizon = projection.get("horizon")
        if horizon in by_horizon:
            by_horizon[horizon].append(projection)

    missing_details = []
    partial_details = []
    for horizon in HORIZONS:
        rows = by_horizon[horizon]
        present_symbols = {row.get("sector_symbol") for row in rows if row.get("sector_symbol")}
        missing_symbols = sorted(EXPECTED_SECTOR_SYMBOLS - present_symbols)
        if missing_symbols:
            missing_details.append({
                "horizon": horizon,
                "present_count": len(present_symbols),
                "expected_count": len(EXPECTED_SECTOR_SYMBOLS),
                "missing_symbols": missing_symbols,
            })

        affected_symbols = []
        for row in rows:
            metrics = row.get("metrics") or {}
            core_values = [metrics.get("return"), metrics.get("sma_dist"), metrics.get("rel_ret")]
            missing_or_nonfinite = [
                value is None
                or not isinstance(value, (int, float, np.floating))
                or not np.isfinite(value)
                for value in core_values
            ]
            all_zero = all(
                isinstance(value, (int, float, np.floating))
                and np.isfinite(value)
                and abs(float(value)) <= 1e-12
                for value in core_values
            )
            if any(missing_or_nonfinite) or all_zero:
                affected_symbols.append(row.get("sector_symbol"))

        threshold = max(zero_metric_threshold_count, int(len(EXPECTED_SECTOR_SYMBOLS) * zero_metric_threshold_ratio))
        if len(affected_symbols) > threshold:
            partial_details.append({
                "horizon": horizon,
                "affected_count": len(affected_symbols),
                "expected_count": len(EXPECTED_SECTOR_SYMBOLS),
                "symbols": sorted(symbol for symbol in affected_symbols if symbol),
                "reason": "return, sma_dist, and rel_ret are all zero-filled or missing",
            })

    if missing_details:
        warnings.append({"type": "missing_sector_projections", "details": missing_details})
    if partial_details:
        warnings.append({"type": "partial_sector_metrics", "details": partial_details})
    return warnings


def merge_sector_projection_warnings(*warning_groups: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen = set()
    for warnings in warning_groups:
        for warning in warnings or []:
            marker = (warning.get("type"), repr(warning.get("details")))
            if marker in seen:
                continue
            seen.add(marker)
            merged.append(warning)
    return merged


def _previous_run_cache(db, prev_run: Optional[SectorProjectionRun]) -> Optional[Dict[str, Any]]:
    if not prev_run:
        return None
    prev_values = (
        db.query(SectorProjectionValue)
        .filter_by(run_id=prev_run.id)
        .all()
    )
    return {
        "run_id": prev_run.id,
        "as_of_date": str(prev_run.as_of_date),
        "created_at": prev_run.created_at.isoformat(),
        "system_state": prev_run.system_state,
        "model_version": prev_run.model_version,
        "values": [
            {
                "horizon": v.horizon,
                "sector_symbol": v.sector_symbol,
                "sector_name": v.sector_name,
                "score_total": v.score_total,
                "rank": v.rank,
            }
            for v in prev_values
        ],
    }


def _projection_dicts_from_values(values: List[SectorProjectionValue]) -> List[Dict[str, Any]]:
    return [
        {
            "horizon": value.horizon,
            "sector_symbol": value.sector_symbol,
            "sector_name": value.sector_name,
            "score_total": value.score_total,
            "score_trend": value.score_trend,
            "score_rel": value.score_rel,
            "score_risk": value.score_risk,
            "score_regime": value.score_regime,
            "rank": value.rank,
            "metrics": value.metrics_json or {},
        }
        for value in values
    ]


def save_sector_projection_run(
    db,
    projections: List[Dict[str, Any]],
    *,
    system_state: str,
    source_warnings: Optional[List[Dict[str, Any]]] = None,
    as_of_date=None,
    created_at: Optional[datetime] = None,
) -> Tuple[SectorProjectionRun, List[Dict[str, Any]]]:
    """Persist a projection run with quality metadata used by latest/history readers."""
    created_at = created_at or datetime.utcnow()
    as_of_date = as_of_date or created_at.date()
    quality_warnings = validate_sector_projection_quality(projections)
    warnings = merge_sector_projection_warnings(source_warnings or [], quality_warnings)
    quality_status = sector_projection_quality_status(warnings)
    excluded_from_latest = quality_status == QUALITY_STATUS_BLOCKED
    prev_run = get_latest_sector_projection_run(db, include_excluded=False)
    prev_cache = _previous_run_cache(db, prev_run)

    run = SectorProjectionRun(
        as_of_date=as_of_date,
        created_at=created_at,
        system_state=system_state,
        model_version=MODEL_VERSION,
        config_json={
            "weights": WEIGHTS,
            "data_warnings": warnings,
            "quality_status": quality_status,
            "excluded_from_latest": excluded_from_latest,
            "previous_run_cache": prev_cache,
        },
    )
    db.add(run)
    db.flush()
    for p in projections:
        db.add(SectorProjectionValue(
            run_id=run.id,
            horizon=p["horizon"],
            sector_symbol=p["sector_symbol"],
            sector_name=p["sector_name"],
            score_total=p["score_total"],
            score_trend=p["score_trend"],
            score_rel=p["score_rel"],
            score_risk=p["score_risk"],
            score_regime=p["score_regime"],
            metrics_json=p["metrics"],
            rank=p["rank"],
        ))
    db.commit()
    return run, warnings


def _history_precedence_key(entry: Dict[str, Any]) -> Tuple[datetime, int]:
    created_at = entry.get("created_at")
    parsed_created_at = datetime.min
    if created_at:
        try:
            parsed_created_at = datetime.fromisoformat(str(created_at))
        except ValueError:
            parsed_created_at = datetime.min
    run_id = entry.get("run_id") or -1
    try:
        run_id = int(run_id)
    except (TypeError, ValueError):
        run_id = -1
    return parsed_created_at, run_id


def build_sector_projection_history(
    db,
    cutoff,
    *,
    include_flagged: bool = False,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Build de-duplicated, chronologically sorted sector projection history."""
    runs = (
        db.query(SectorProjectionRun)
        .filter(SectorProjectionRun.as_of_date >= cutoff)
        .order_by(
            SectorProjectionRun.as_of_date.asc(),
            SectorProjectionRun.created_at.asc(),
            SectorProjectionRun.id.asc(),
        )
        .all()
    )
    # History is consumed by both the raw-history endpoint and the stabilized
    # analytics endpoint. Load all values in one query instead of issuing one
    # query per run; this keeps a year of history cheap enough for page loads.
    values_by_run: Dict[int, List[SectorProjectionValue]] = {}
    if runs:
        all_values = (
            db.query(SectorProjectionValue)
            .filter(SectorProjectionValue.run_id.in_([run.id for run in runs]))
            .all()
        )
        for value in all_values:
            values_by_run.setdefault(value.run_id, []).append(value)
    candidates: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    def add_entry(
        *,
        sector_symbol: str,
        horizon: str,
        as_of_date: str,
        created_at: Optional[str],
        run_id: Optional[int],
        score_total: float,
        rank: int,
        data_warnings: Optional[List[Dict[str, Any]]] = None,
        quality_status: Optional[str] = None,
    ) -> None:
        key = (sector_symbol, horizon, as_of_date)
        entry = {
            "as_of_date": as_of_date,
            "created_at": created_at,
            "run_id": run_id,
            "score_total": score_total,
            "rank": rank,
        }
        if data_warnings:
            entry["data_warnings"] = data_warnings
        if quality_status:
            entry["quality_status"] = quality_status
        existing = candidates.get(key)
        if existing is None or _history_precedence_key(entry) >= _history_precedence_key(existing):
            candidates[key] = entry

    for run in runs:
        config = run.config_json or {}
        warnings = config.get("data_warnings", [])
        values = values_by_run.get(run.id, [])
        read_warnings = validate_sector_projection_quality(_projection_dicts_from_values(values))
        warnings = merge_sector_projection_warnings(warnings, read_warnings)
        quality_status = config.get("quality_status") or sector_projection_quality_status(warnings)
        if not include_flagged and (
            is_sector_run_excluded_from_latest(run)
            or sector_projection_quality_status(warnings) == QUALITY_STATUS_BLOCKED
        ):
            continue
        for v in values:
            add_entry(
                sector_symbol=v.sector_symbol,
                horizon=v.horizon,
                as_of_date=str(run.as_of_date),
                created_at=run.created_at.isoformat(),
                run_id=run.id,
                score_total=v.score_total,
                rank=v.rank,
                data_warnings=warnings,
                quality_status=quality_status,
            )

    if runs:
        latest_run = runs[-1]
        if include_flagged or not is_sector_run_excluded_from_latest(latest_run):
            prev_cache = (latest_run.config_json or {}).get("previous_run_cache")
            if prev_cache and prev_cache.get("as_of_date"):
                try:
                    prev_date = datetime.fromisoformat(prev_cache["as_of_date"]).date()
                except ValueError:
                    prev_date = None
                if prev_date and prev_date >= cutoff:
                    for value in prev_cache.get("values", []):
                        add_entry(
                            sector_symbol=value["sector_symbol"],
                            horizon=value["horizon"],
                            as_of_date=prev_cache["as_of_date"],
                            created_at=prev_cache.get("created_at"),
                            run_id=prev_cache.get("run_id"),
                            score_total=value["score_total"],
                            rank=value["rank"],
                        )

    history: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for sector_symbol, horizon, _date_key in sorted(candidates):
        history.setdefault(sector_symbol, {}).setdefault(horizon, []).append(candidates[(sector_symbol, horizon, _date_key)])

    for horizons in history.values():
        for entries in horizons.values():
            entries.sort(key=lambda entry: (
                entry["as_of_date"],
                _history_precedence_key(entry)[0],
                _history_precedence_key(entry)[1],
            ))
    return history

def detect_duplicate_series(
    price_data: Dict[str, pd.DataFrame],
    tail_points: int = 30,
) -> List[Dict[str, Any]]:
    """Return duplicate series signatures for data integrity checks."""
    signatures: Dict[tuple, str] = {}
    duplicates: List[Dict[str, Any]] = []
    for symbol, df in price_data.items():
        if df.empty or "value" not in df.columns:
            continue
        tail = df["value"].tail(tail_points).tolist()
        sig = (len(df), tuple(round(v, 8) for v in tail))
        if sig in signatures:
            duplicates.append({
                "symbol_a": signatures[sig],
                "symbol_b": symbol,
                "points": len(df),
            })
        else:
            signatures[sig] = symbol
    return duplicates

def detect_stale_series(
    price_data: Dict[str, pd.DataFrame],
    max_age_days: int = 2,
) -> List[Dict[str, Any]]:
    """Return series that lag behind the most recent date."""
    latest_dates = {}
    for symbol, df in price_data.items():
        if df.empty or "date" not in df.columns:
            continue
        try:
            latest_dates[symbol] = pd.to_datetime(df["date"]).max()
        except Exception:
            continue

    if not latest_dates:
        return []

    overall_latest = max(latest_dates.values())
    stale = []
    for symbol, date_val in latest_dates.items():
        lag_days = (overall_latest - date_val).days
        if lag_days > max_age_days:
            stale.append({
                "symbol": symbol,
                "latest_date": date_val.date().isoformat(),
                "lag_days": lag_days,
            })
    return stale

def compute_sector_projections(price_data: Dict[str, pd.DataFrame], system_state: str = "YELLOW") -> List[Dict[str, Any]]:
    """
    Compute sector projections for each ETF and horizon.
    
    This is the heart of the transparent scoring system. For each sector and time horizon,
    we calculate four independent scores (Trend, Relative Strength, Risk, Regime), then
    combine them using weighted average to produce a final 0-100 score.
    
    Args:
        price_data: dict of {symbol: pd.DataFrame with 'date' and 'value' columns}
        system_state: Current market regime - RED/YELLOW/GREEN (affects regime score)
    
    Returns:
        list of dicts containing all scores, metrics, and classifications for each sector/horizon
    
    Process Flow:
        1. For each horizon (3m, 6m, 12m):
        2.   Extract price data for lookback period
        3.   Calculate raw metrics (returns, volatility, drawdown, relative strength)
        4.   Normalize metrics to 0-100 scores using percentile ranks
        5.   Apply regime adjustments based on market state
        6.   Compute weighted final score
        7.   Rank sectors and assign Winner/Neutral/Loser classifications
    """
    projections = []
    today = datetime.utcnow().date()
    
    # Process each time horizon independently
    for horizon, lookback in HORIZONS.items():
        effective_lookback = T_WINDOW_DAYS if lookback == 0 else lookback
        # ------------------------------------------------------------------
        # STEP 1: Collect raw metrics for all sectors at this horizon
        # ------------------------------------------------------------------
        metrics = {}  # Will store {symbol: {metric_name: value}}
        
        for etf in SECTOR_ETFS:
            sym = etf["symbol"]
            df = price_data.get(sym)
            spy = price_data.get(BENCHMARK["symbol"])
            
            # Data validation
            if df is None or len(df) < effective_lookback + 10 or spy is None:
                continue
                
            df = df.sort_values("date").reset_index(drop=True)
            spy = spy.sort_values("date").reset_index(drop=True)
            
            # Align dates between sector and benchmark
            common_dates = set(df["date"]).intersection(set(spy["date"]))
            df = df[df["date"].isin(common_dates)]
            spy = spy[spy["date"].isin(common_dates)]
            
            if len(df) < effective_lookback:
                continue
                
            # Use most recent lookback+1 days (need +1 to calculate returns)
            df = df.iloc[-(effective_lookback + 1):]
            spy = spy.iloc[-(effective_lookback + 1):]
            # ------------------------------------------------------------------
            # STEP 2: Calculate raw financial metrics
            # ------------------------------------------------------------------
            
            # Total return over period
            ret = (df["value"].iloc[-1] / df["value"].iloc[0]) - 1
            spy_ret = (spy["value"].iloc[-1] / spy["value"].iloc[0]) - 1
            
            # Distance from 200-day SMA (momentum indicator)
            # For T horizon with limited data (21 days), use a shorter SMA window
            if horizon == "T":
                sma_window = min(10, len(df) - 1)  # 10-day SMA, or shorter if less data
            else:
                sma_window = min(200, len(df) - 1)  # 200-day SMA
            sma = df["value"].rolling(sma_window).mean().iloc[-1]
            sma_dist = (df["value"].iloc[-1] / sma) - 1 if sma else 0
            
            # Realized volatility (annualized 20-day)
            vol = df["value"].pct_change().rolling(20).std().iloc[-1] * np.sqrt(252)
            
            # Maximum drawdown over full period
            roll_max = df["value"].cummax()
            drawdown = (df["value"] / roll_max - 1).min()
            
            # Relative return vs benchmark (alpha)
            rel_ret = ret - spy_ret
            metrics[sym] = {
                "sector_name": etf["name"],
                "return": ret,
                "sma_dist": sma_dist,
                "vol": vol,
                "drawdown": drawdown,
                "rel_ret": rel_ret,
            }
        
        # ------------------------------------------------------------------
        # STEP 3: Convert raw metrics to 0-100 scores via percentile ranking
        # ------------------------------------------------------------------
        
        # Convert metrics dict to DataFrame for vectorized operations
        mdf = pd.DataFrame.from_dict(metrics, orient="index")
        if mdf.empty:
            continue
        
        # Data cleaning: Replace inf/-inf with NaN, then fill with 0
        mdf.replace([np.inf, -np.inf], np.nan, inplace=True)
        mdf.fillna(0, inplace=True)
        
        # Percentile ranking function - converts any metric to 0-100 score
        def to_score(series, invert=False):
            """Convert metric to 0-100 score using percentile ranks.
            Higher percentile = higher score (unless inverted for "bad" metrics like volatility)"""
            ranks = series.rank(pct=True, na_option='bottom')
            if invert:
                scores = 100 * (1 - ranks)  # Invert for risk metrics
            else:
                scores = 100 * ranks  # Higher is better
            return scores.clip(0, 100).fillna(50)  # Default to 50 if still NaN
        
        # Trend Score (45%): Combination of return and momentum
        mdf["score_trend"] = to_score(mdf["return"] + 0.5 * mdf["sma_dist"])
        
        # Relative Strength Score (30%): Outperformance vs SPY
        mdf["score_rel"] = to_score(mdf["rel_ret"])
        
        # Risk Score (20%): Lower risk = higher score (inverted)
        mdf["score_risk"] = to_score(mdf["vol"] + 0.5 * np.abs(mdf["drawdown"]), invert=True)
        # ------------------------------------------------------------------
        # STEP 4: Apply regime-based adjustments (5% weight)
        # ------------------------------------------------------------------
        # Regime Score: Context-aware bonus/penalty based on sector characteristics
        regime_adj = np.zeros(len(mdf))
        if system_state == "RED":
            # RED market: Reward defensive sectors, penalize high-vol cyclicals
            for i, sym in enumerate(mdf.index):
                if mdf.loc[sym, "sector_name"] in ["Utilities", "Consumer Staples", "Health Care"]:
                    regime_adj[i] = 5  # Defensive bonus
                elif mdf.loc[sym, "vol"] > mdf["vol"].median():
                    regime_adj[i] = -5  # High volatility penalty
        mdf["score_regime"] = 50 + regime_adj
        # ------------------------------------------------------------------
        # STEP 5: Calculate final weighted score and classify sectors
        # ------------------------------------------------------------------
        
        # Weighted average of all components
        mdf["score_total"] = (
            WEIGHTS["trend"] * mdf["score_trend"] +
            WEIGHTS["rel_strength"] * mdf["score_rel"] +
            WEIGHTS["risk"] * mdf["score_risk"] +
            WEIGHTS["regime"] * mdf["score_regime"]
        ).fillna(50)
        
        # Rank sectors 1-11 (1 = best)
        mdf["rank"] = mdf["score_total"].rank(ascending=False, method="min", na_option='bottom')
        mdf["rank"] = mdf["rank"].fillna(len(mdf) // 2).astype(int)
        
        # Classification: Winner (1-3), Neutral (4-8), Loser (9-11)
        mdf["classification"] = "Neutral"
        mdf.loc[mdf["rank"] <= 3, "classification"] = "Winner"
        mdf.loc[mdf["rank"] > (len(mdf) - 3), "classification"] = "Loser"
        # Output
        for sym, row in mdf.iterrows():
            projections.append({
                "sector_symbol": sym,
                "sector_name": row["sector_name"],
                "horizon": horizon,
                "score_total": float(row["score_total"]),
                "score_trend": float(row["score_trend"]),
                "score_rel": float(row["score_rel"]),
                "score_risk": float(row["score_risk"]),
                "score_regime": float(row["score_regime"]),
                "rank": int(row["rank"]),
                "classification": row["classification"],
                "metrics": {
                    "return": float(row["return"]),
                    "sma_dist": float(row["sma_dist"]),
                    "vol": float(row["vol"]),
                    "drawdown": float(row["drawdown"]),
                    "rel_ret": float(row["rel_ret"]),
                },
                "as_of_date": str(today),
                "model_version": MODEL_VERSION,
            })
    return projections

# --- Data Fetch Helper ---
def fetch_sector_price_history(days: int = 8000) -> Dict[str, pd.DataFrame]:
    """
    Fetch price history for all sector ETFs and SPY. Returns dict of DataFrames.
    """
    client = YahooClient()
    end = datetime.utcnow().date()
    start = end - timedelta(days=days)
    result = {}
    for etf in SECTOR_ETFS + [BENCHMARK]:
        data = client.fetch_series(etf["symbol"], start_date=str(start), end_date=str(end))
        if data:
            df = pd.DataFrame(data)
            result[etf["symbol"]] = df

    duplicates = detect_duplicate_series(result)
    for dup in duplicates:
        logger.warning(
            "Duplicate sector price series detected: %s and %s",
            dup["symbol_a"],
            dup["symbol_b"],
        )

    return result
