from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timedelta
from typing import List, Optional, Tuple
from sqlalchemy import func, desc
import statistics
import yfinance as yf

from app.models.alternative_assets import MacroLiquidityData
from app.models.precious_metals import (
    MetalPrice, MetalRatio, CBHolding, CBPurchase, COMEXInventory, 
    ETFHolding, SupplyData, DemandData, MetalCorrelation, 
    MetalRegimeClassification, BackwardationData, LBMAPremium, MetalVolatility,
    RegimeType, GoldBiasType, SilverBiasType, PGMBiasType, RiskLevel
)
from app.utils.db_helpers import get_db_session
from app.services.metal_price_dispersion import (
    DEFAULT_REFERENCE_IDS,
    METAL_DEFINITIONS,
    build_global_price_dispersion,
)

router = APIRouter(prefix="/precious-metals", tags=["precious-metals"])

TONNES_TO_OZ = 32150.7466
COMEX_PLACEHOLDER_SOURCES = ["SEED", "ESTIMATED_FROM_PRICES"]
MONTH_CODE_TO_NUMBER = {
    "F": 1,
    "G": 2,
    "H": 3,
    "J": 4,
    "K": 5,
    "M": 6,
    "N": 7,
    "Q": 8,
    "U": 9,
    "V": 10,
    "X": 11,
    "Z": 12,
}
PRECIOUS_METALS_FUTURES = {
    "AU": {
        "label": "Gold",
        "root": "GC",
        "exchange": "CMX",
        "months": ["G", "J", "M", "Q", "V", "Z"],
    },
    "AG": {
        "label": "Silver",
        "root": "SI",
        "exchange": "CMX",
        "months": ["H", "K", "N", "U", "Z"],
    },
    "PT": {
        "label": "Platinum",
        "root": "PL",
        "exchange": "NYM",
        "months": ["F", "J", "N", "V"],
    },
    "PD": {
        "label": "Palladium",
        "root": "PA",
        "exchange": "NYM",
        "months": ["H", "M", "U", "Z"],
    },
}


# ==================== HELPER FUNCTIONS ====================

def _compute_zscore(values: List[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    mean = statistics.mean(values)
    stdev = statistics.pstdev(values)
    if stdev == 0:
        return 0.0
    return (values[0] - mean) / stdev


def _get_latest_cb_dates(db) -> Tuple[Optional[datetime], Optional[datetime]]:
    latest_date = db.query(func.max(CBHolding.date)).scalar()
    if not latest_date:
        return None, None
    prior_date = db.query(func.max(CBHolding.date)).filter(
        CBHolding.date <= latest_date - timedelta(days=330)
    ).scalar()
    return latest_date, prior_date


def _sum_gold_tonnes(db, date: datetime, countries: Optional[List[str]] = None) -> Optional[float]:
    if not date:
        return None
    query = db.query(func.sum(CBHolding.gold_tonnes)).filter(CBHolding.date == date)
    if countries:
        query = query.filter(CBHolding.country.in_(countries))
    total = query.scalar()
    return total if total is not None else None


def _calc_global_cb_gold_pct_reserves(db, date: Optional[datetime]) -> Optional[float]:
    if not date:
        return None
    holdings = db.query(CBHolding).filter(
        CBHolding.date == date,
        CBHolding.gold_tonnes.isnot(None),
        CBHolding.pct_of_reserves.isnot(None)
    ).all()
    if not holdings:
        return None
    total_gold = 0.0
    total_reserves = 0.0
    for holding in holdings:
        if not holding.pct_of_reserves:
            continue
        total_gold += holding.gold_tonnes
        total_reserves += holding.gold_tonnes / (holding.pct_of_reserves / 100)
    if total_reserves <= 0:
        return None
    return (total_gold / total_reserves) * 100


def _calc_yoy_change(latest_total: Optional[float], prior_total: Optional[float]) -> Optional[float]:
    if latest_total is None or prior_total is None or prior_total <= 0:
        return None
    return ((latest_total - prior_total) / prior_total) * 100


def _calc_etf_holdings_zscore(
    db, ticker: str = "GLD", window_days: int = 730
) -> Optional[float]:
    records = db.query(ETFHolding).filter(
        ETFHolding.ticker == ticker,
        ETFHolding.holdings.isnot(None),
        ETFHolding.date >= datetime.utcnow() - timedelta(days=window_days)
    ).order_by(ETFHolding.date).all()
    values = [r.holdings for r in records if r.holdings is not None]
    if len(values) < 20:
        return None
    mean = statistics.mean(values)
    stdev = statistics.pstdev(values)
    if stdev == 0:
        return 0.0
    return (values[-1] - mean) / stdev


def _calc_etf_holdings_yoy(db, ticker: str = "GLD") -> Optional[float]:
    latest = db.query(ETFHolding).filter(
        ETFHolding.ticker == ticker,
        ETFHolding.holdings.isnot(None)
    ).order_by(desc(ETFHolding.date)).first()
    if not latest or latest.holdings is None:
        return None
    prior = db.query(ETFHolding).filter(
        ETFHolding.ticker == ticker,
        ETFHolding.holdings.isnot(None),
        ETFHolding.date <= latest.date - timedelta(days=330)
    ).order_by(desc(ETFHolding.date)).first()
    if not prior or prior.holdings is None:
        return None
    return ((latest.holdings - prior.holdings) / prior.holdings) * 100


def _calc_cb_net_purchases_yoy(db) -> Optional[float]:
    recent_purchases = db.query(CBPurchase).filter(
        CBPurchase.tonnes_net_yoy_pct.isnot(None)
    ).order_by(desc(CBPurchase.period)).limit(4).all()
    if not recent_purchases:
        return None
    return sum(p.tonnes_net_yoy_pct for p in recent_purchases) / len(recent_purchases)


def _calc_em_accumulation_momentum(db) -> Optional[float]:
    em_countries = ["China", "India", "Russia", "Saudi Arabia", "UAE"]
    em_dates = db.query(CBHolding.date).filter(
        CBHolding.country.in_(em_countries),
        CBHolding.gold_tonnes.isnot(None)
    ).distinct().order_by(desc(CBHolding.date)).limit(2).all()
    if len(em_dates) < 2:
        return None
    latest_date = em_dates[0][0]
    prior_date = em_dates[1][0]
    latest_total = _sum_gold_tonnes(db, latest_date, em_countries)
    prior_total = _sum_gold_tonnes(db, prior_date, em_countries)
    return _calc_yoy_change(latest_total, prior_total)


def _latest_cb_gold_oz(db) -> Optional[float]:
    latest_date = db.query(func.max(CBHolding.date)).scalar()
    if not latest_date:
        return None
    subq = db.query(
        CBHolding.country,
        func.max(CBHolding.id).label("max_id")
    ).filter(
        CBHolding.date == latest_date,
        CBHolding.gold_tonnes.isnot(None)
    ).group_by(CBHolding.country).subquery()
    total_tonnes = db.query(func.sum(CBHolding.gold_tonnes)).join(
        subq,
        CBHolding.id == subq.c.max_id
    ).scalar()
    if total_tonnes is None:
        return None
    return total_tonnes * TONNES_TO_OZ


def _cb_gold_oz_series(db) -> dict:
    subq = db.query(
        CBHolding.date.label("date"),
        CBHolding.country.label("country"),
        func.max(CBHolding.id).label("max_id")
    ).filter(
        CBHolding.gold_tonnes.isnot(None)
    ).group_by(CBHolding.date, CBHolding.country).subquery()

    rows = db.query(
        subq.c.date,
        func.sum(CBHolding.gold_tonnes)
    ).join(
        CBHolding,
        CBHolding.id == subq.c.max_id
    ).group_by(subq.c.date).order_by(subq.c.date).all()
    return {row[0].date(): row[1] * TONNES_TO_OZ for row in rows if row[1] is not None}


def _compute_real_rate_signal(db) -> Optional[float]:
    values = [
        row[0] for row in db.query(MacroLiquidityData.real_rate_10y)
        .filter(MacroLiquidityData.real_rate_10y.isnot(None))
        .order_by(desc(MacroLiquidityData.date))
        .limit(365)
        .all()
        if row[0] is not None
    ]
    zscore = _compute_zscore(values)
    if zscore is None:
        return None
    return -zscore


def _compute_m2_growth_signal(db) -> Optional[float]:
    latest = db.query(MacroLiquidityData).filter(
        MacroLiquidityData.global_m2.isnot(None)
    ).order_by(desc(MacroLiquidityData.date)).first()
    if not latest or latest.global_m2 is None:
        return None
    prior = db.query(MacroLiquidityData).filter(
        MacroLiquidityData.global_m2.isnot(None),
        MacroLiquidityData.date <= latest.date - timedelta(days=330)
    ).order_by(desc(MacroLiquidityData.date)).first()
    if not prior or prior.global_m2 is None or prior.global_m2 == 0:
        return None
    yoy_pct = ((latest.global_m2 - prior.global_m2) / prior.global_m2) * 100
    return yoy_pct / 10.0

def calculate_structural_monetary_bid(db) -> Optional[float]:
    """
    SMB = 0.5 × (Net Purchase Momentum) 
        + 0.3 × (CB Gold % Reserves Change)
        + 0.2 × (EM Accumulation Trend)
    """
    net_purchase_momentum = _calc_cb_net_purchases_yoy(db)
    latest_date, prior_date = _get_latest_cb_dates(db)
    if net_purchase_momentum is None:
        net_purchase_momentum = _calc_yoy_change(
            _sum_gold_tonnes(db, latest_date),
            _sum_gold_tonnes(db, prior_date)
        )
    
    # CB Gold % Reserve Change
    recent_holdings = db.query(CBHolding).filter(
        CBHolding.pct_of_reserves.isnot(None)
    ).order_by(desc(CBHolding.date)).limit(2).all()
    
    cb_reserve_change = 0.0
    if len(recent_holdings) >= 2:
        pct_change = (recent_holdings[0].pct_of_reserves - recent_holdings[1].pct_of_reserves) / recent_holdings[1].pct_of_reserves * 100
        cb_reserve_change = pct_change
    
    # EM Accumulation Trend (proxy: recent purchases from top EM countries)
    em_countries = ["China", "India", "Russia", "Saudi Arabia", "UAE"]
    em_purchases = db.query(CBPurchase).filter(
        CBPurchase.country.in_(em_countries),
        CBPurchase.period >= str(datetime.utcnow().year - 1)
    ).all()
    em_accumulation_trend = (
        sum([p.tonnes_net_yoy_pct for p in em_purchases]) / len(em_purchases)
        if em_purchases else None
    )
    if em_accumulation_trend is None and latest_date and prior_date:
        em_accumulation_trend = _calc_yoy_change(
            _sum_gold_tonnes(db, latest_date, em_countries),
            _sum_gold_tonnes(db, prior_date, em_countries)
        )

    components = []
    if net_purchase_momentum is not None:
        components.append((net_purchase_momentum, 0.5))
    if cb_reserve_change is not None:
        components.append((cb_reserve_change, 0.3))
    if em_accumulation_trend is not None:
        components.append((em_accumulation_trend, 0.2))
    if not components:
        return None

    weighted_sum = sum(value * weight for value, weight in components)
    weight_total = sum(weight for _, weight in components)
    smb = weighted_sum / weight_total
    return max(-100, min(100, smb))  # Clamp to [-100, 100]


def _build_nearby_contract_candidates(config: dict, contracts: int, as_of: datetime) -> List[dict]:
    candidates: List[dict] = []
    current_year = as_of.year
    current_month = as_of.month
    month_codes = sorted(config["months"], key=lambda code: MONTH_CODE_TO_NUMBER[code])

    for year_offset in range(0, 4):
        year = current_year + year_offset
        for month_code in month_codes:
            month_number = MONTH_CODE_TO_NUMBER[month_code]
            if year == current_year and month_number < current_month:
                continue
            symbol = f'{config["root"]}{month_code}{year % 100:02d}.{config["exchange"]}'
            candidates.append({
                "symbol": symbol,
                "month_code": month_code,
                "month_number": month_number,
                "year": year,
                "contract_label": datetime(year, month_number, 1).strftime("%b %Y"),
            })
            if len(candidates) >= contracts + 3:
                return candidates

    return candidates


def _fetch_futures_contract_snapshot(symbol: str) -> Optional[dict]:
    try:
        history = yf.Ticker(symbol).history(period="5d")
    except Exception:
        return None

    if history is None or history.empty or "Close" not in history:
        return None

    closes = history["Close"].dropna()
    if closes.empty:
        return None

    latest_price = float(closes.iloc[-1])
    previous_close = float(closes.iloc[-2]) if len(closes) > 1 else latest_price
    latest_row = history.iloc[-1]
    volume = None
    if "Volume" in history and latest_row.get("Volume") is not None:
        try:
            volume = int(latest_row["Volume"])
        except (TypeError, ValueError):
            volume = None

    as_of = history.index[-1]
    as_of_value = as_of.to_pydatetime().isoformat() if hasattr(as_of, "to_pydatetime") else str(as_of)

    return {
        "price": latest_price,
        "previous_close": previous_close,
        "change_pct": ((latest_price / previous_close) - 1) * 100 if previous_close else 0.0,
        "volume": volume,
        "as_of": as_of_value,
    }


def get_precious_metals_futures_curve(contracts: int = 4) -> dict:
    as_of = datetime.utcnow()
    metals = []
    quote_timestamps = []

    for metal in PRECIOUS_METALS_FUTURES:
        curve = _get_metal_futures_curve(metal, contracts=contracts, as_of=as_of)
        if not curve:
            continue
        metals.append(curve)
        quote_timestamps.extend(row["as_of"] for row in curve["contracts"])

    return {
        "as_of": max(quote_timestamps) if quote_timestamps else None,
        "generated_at": as_of.isoformat(),
        "source": "Yahoo Finance month-specific futures history",
        "contracts_requested": contracts,
        "metals": metals,
    }


def _get_metal_futures_curve(metal: str, contracts: int, as_of: Optional[datetime] = None) -> Optional[dict]:
    """Fetch one venue-specific nearby curve without querying unrelated metals."""
    config = PRECIOUS_METALS_FUTURES.get(metal)
    if not config:
        return None
    as_of = as_of or datetime.utcnow()
    contract_rows = []
    for candidate in _build_nearby_contract_candidates(config, contracts, as_of):
        snapshot = _fetch_futures_contract_snapshot(candidate["symbol"])
        if not snapshot:
            continue
        contract_rows.append({**candidate, **snapshot})
        if len(contract_rows) >= contracts:
            break
    if not contract_rows:
        return None

    front_price = contract_rows[0]["price"]
    deferred_price = contract_rows[-1]["price"] if len(contract_rows) > 1 else front_price
    curve_bps = None
    curve_state = "FLAT"
    if front_price and deferred_price:
        curve_bps = ((front_price / deferred_price) - 1) * 10000
        if curve_bps > 0:
            curve_state = "BACKWARDATION"
        elif curve_bps < 0:
            curve_state = "CONTANGO"
    return {
        "metal": metal,
        "label": config["label"],
        "curve_state": curve_state,
        "curve_bps": curve_bps,
        "contracts": contract_rows,
    }


def calculate_monetary_hedge_strength(
    db,
    real_rate_signal: Optional[float] = None,
    m2_growth_signal: Optional[float] = None
) -> Optional[float]:
    """
    MHS = (Au/DXY_Z + Real_Rate_Signal + 0.5 × M2_Growth_Signal) / 2.5
    Normalized to 0-100
    """
    # Get latest Au/DXY ratio z-score
    latest_au_dxy = db.query(MetalRatio).filter(
        MetalRatio.metal1 == "AU",
        MetalRatio.metal2 == "DXY"
    ).order_by(desc(MetalRatio.date)).first()
    
    au_dxy_zscore = latest_au_dxy.zscore_2y if latest_au_dxy else None

    if real_rate_signal is None:
        real_rate_signal = _compute_real_rate_signal(db)
    if m2_growth_signal is None:
        m2_growth_signal = _compute_m2_growth_signal(db)

    components = []
    if au_dxy_zscore is not None:
        components.append((au_dxy_zscore, 1.0))
    if real_rate_signal is not None:
        components.append((real_rate_signal, 1.0))
    if m2_growth_signal is not None:
        components.append((m2_growth_signal * 0.5, 0.5))
    if not components:
        return None

    weighted_sum = sum(value * weight for value, weight in components)
    weight_total = sum(weight for _, weight in components)
    mhs_raw = weighted_sum / weight_total
    mhs_score = 50 + (mhs_raw * 50)  # Normalize to 0-100
    return max(0, min(100, mhs_score))


def calculate_paper_credibility_index(db) -> Optional[float]:
    """
    PCI derived from ETF holdings (primary) or COMEX ratio (fallback).
    Adjusted for backwardation & spreads.
    """
    gld_zscore = _calc_etf_holdings_zscore(db, "GLD")
    if gld_zscore is not None:
        pci = max(0, min(100, ((gld_zscore + 2) / 4) * 100))
    else:
        # COMEX fallback
        latest_comex = db.query(COMEXInventory).filter(
            COMEXInventory.metal == "AU",
            COMEXInventory.oi_to_registered_ratio.isnot(None),
            COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
        ).order_by(desc(COMEXInventory.date)).first()

        if not latest_comex or not latest_comex.oi_to_registered_ratio:
            return None

        all_ratios = db.query(COMEXInventory.oi_to_registered_ratio).filter(
            COMEXInventory.metal == "AU",
            COMEXInventory.oi_to_registered_ratio.isnot(None),
            COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
        ).all()

        if not all_ratios:
            return None

        ratios_list = [r[0] for r in all_ratios]
        p90 = statistics.quantiles(ratios_list, n=10)[8] if len(ratios_list) > 10 else max(ratios_list)
        stress_factor = (latest_comex.oi_to_registered_ratio / p90) if p90 > 0 else 1.0
        pci = 100 - (stress_factor * 100)

    # Adjust for backwardation
    latest_backwardation = db.query(BackwardationData).order_by(desc(BackwardationData.date)).first()
    if latest_backwardation and latest_backwardation.backwardation_bps > 500:
        pci -= 15  # Penalize deep backwardation
    
    return max(0, min(100, pci))


def classify_regime(db) -> tuple:
    """
    Classify metals regime based on indicator combination
    Returns: (regime, gold_bias, silver_bias, pgm_bias, paper_physical_risk)
    """
    smb = calculate_structural_monetary_bid(db)
    mhs = calculate_monetary_hedge_strength(db)
    pci = calculate_paper_credibility_index(db)
    
    # Get latest ratios
    au_ag_latest = db.query(MetalRatio).filter(
        MetalRatio.metal1 == "AU",
        MetalRatio.metal2 == "AG"
    ).order_by(desc(MetalRatio.date)).first()
    
    pt_au_latest = db.query(MetalRatio).filter(
        MetalRatio.metal1 == "PT",
        MetalRatio.metal2 == "AU"
    ).order_by(desc(MetalRatio.date)).first()
    
    # Get industrial demand proxy (silver price momentum + PGM ratios)
    recent_silver_prices = db.query(MetalPrice).filter(
        MetalPrice.metal == "AG"
    ).order_by(desc(MetalPrice.date)).limit(60).all()
    
    silver_momentum = None
    if len(recent_silver_prices) >= 2:
        silver_momentum = (
            (recent_silver_prices[0].price_usd_per_oz - recent_silver_prices[-1].price_usd_per_oz)
            / recent_silver_prices[-1].price_usd_per_oz
            * 100
        )
    
    # Regime logic
    has_signal = any(
        value is not None
        for value in [mhs, smb, pci, silver_momentum]
    ) or pt_au_latest is not None

    if not has_signal:
        regime = None
    elif mhs is not None and smb is not None and mhs > 60 and smb > 30:
        regime = RegimeType.MONETARY_STRESS
    elif mhs is not None and silver_momentum is not None and mhs > 40 and silver_momentum > 10:
        regime = RegimeType.INFLATION_HEDGE
    elif pt_au_latest and pt_au_latest.ratio_value > 0.8:
        regime = RegimeType.GROWTH_REFLATION
    elif pci is not None and pci < 50:
        regime = RegimeType.LIQUIDITY_CRISIS
    else:
        regime = RegimeType.INDUSTRIAL_COMMODITY
    
    # Gold bias
    if mhs is None:
        gold_bias = None
    elif mhs > 60:
        gold_bias = GoldBiasType.MONETARY_HEDGE
    elif mhs > 40:
        gold_bias = GoldBiasType.NEUTRAL
    else:
        gold_bias = GoldBiasType.FINANCIAL_ASSET
    
    # Silver bias
    if not au_ag_latest:
        silver_bias = None
    elif au_ag_latest.ratio_value > 70:
        silver_bias = SilverBiasType.INDUSTRIAL_MONETARY  # Ag underperforming due to industrial weakness
    elif au_ag_latest and au_ag_latest.ratio_value < 50:
        silver_bias = SilverBiasType.INDUSTRIAL  # Ag outperforming on industrial demand
    else:
        silver_bias = SilverBiasType.INDUSTRIAL_MONETARY
    
    # PGM bias
    if not pt_au_latest:
        pgm_bias = None
    elif pt_au_latest.ratio_value < 0.6:
        pgm_bias = PGMBiasType.RECESSION
    elif pt_au_latest and pt_au_latest.ratio_value > 0.85:
        pgm_bias = PGMBiasType.GROWTH
    else:
        pgm_bias = PGMBiasType.NEUTRAL
    
    # Paper/Physical risk
    if pci is None:
        paper_physical_risk = None
    elif pci > 75:
        paper_physical_risk = RiskLevel.LOW
    elif pci > 50:
        paper_physical_risk = RiskLevel.MODERATE
    else:
        paper_physical_risk = RiskLevel.HIGH
    
    return regime, gold_bias, silver_bias, pgm_bias, paper_physical_risk


# ==================== API ENDPOINTS ====================

@router.get("/regime")
def get_regime_classification():
    """
    Get current precious metals regime classification
    """
    with get_db_session() as db:
        try:
            regime, gold_bias, silver_bias, pgm_bias, paper_physical_risk = classify_regime(db)
            smb = calculate_structural_monetary_bid(db)
            real_rate_signal = _compute_real_rate_signal(db)
            m2_growth_signal = _compute_m2_growth_signal(db)
            mhs = calculate_monetary_hedge_strength(db, real_rate_signal, m2_growth_signal)
            pci = calculate_paper_credibility_index(db)
            
            # Get latest ratios
            au_ag = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "AU", MetalRatio.metal2 == "AG"
            ).order_by(desc(MetalRatio.date)).first()
            
            pt_au = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "PT", MetalRatio.metal2 == "AU"
            ).order_by(desc(MetalRatio.date)).first()
            
            pd_au = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "PD", MetalRatio.metal2 == "AU"
            ).order_by(desc(MetalRatio.date)).first()
            
            au_dxy = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "AU", MetalRatio.metal2 == "DXY"
            ).order_by(desc(MetalRatio.date)).first()
            
            ag_dxy = db.query(MetalRatio).filter(
                MetalRatio.metal1 == "AG", MetalRatio.metal2 == "DXY"
            ).order_by(desc(MetalRatio.date)).first()
            
            # COMEX data (optional)
            comex = db.query(COMEXInventory).filter(
                COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
            ).order_by(desc(COMEXInventory.date)).first()
            comex_change = None
            if comex:
                prior_comex = db.query(COMEXInventory).filter(
                    COMEXInventory.date < comex.date,
                    COMEXInventory.source.notin_(COMEX_PLACEHOLDER_SOURCES)
                ).order_by(desc(COMEXInventory.date)).first()
                if prior_comex and prior_comex.registered_oz:
                    comex_change = (comex.registered_oz - prior_comex.registered_oz) / prior_comex.registered_oz * 100
            
            # Get backwardation data
            backwardation = db.query(BackwardationData).filter(
                BackwardationData.metal == "AU"
            ).order_by(desc(BackwardationData.date)).first()
            back_severity = backwardation.backwardation_bps if backwardation else None
            
            # Get ETF flow data
            latest_etf = db.query(ETFHolding).filter(
                ETFHolding.ticker == "GLD"
            ).order_by(desc(ETFHolding.date)).first()
            etf_divergence = None
            if latest_etf:
                prior_etf = db.query(ETFHolding).filter(
                    ETFHolding.ticker == "GLD",
                    ETFHolding.date < latest_etf.date
                ).order_by(desc(ETFHolding.date)).first()
                if prior_etf and latest_etf.holdings and prior_etf.holdings:
                    etf_divergence = ((latest_etf.holdings - prior_etf.holdings) / prior_etf.holdings) * 100
            
            gld_holdings_zscore = _calc_etf_holdings_zscore(db, "GLD")
            gld_holdings_yoy = _calc_etf_holdings_yoy(db, "GLD")

            latest_cb_date, prior_cb_date = _get_latest_cb_dates(db)
            global_cb_gold_pct_reserves = _calc_global_cb_gold_pct_reserves(db, latest_cb_date)
            net_purchases_yoy = _calc_cb_net_purchases_yoy(db)
            if net_purchases_yoy is None:
                net_purchases_yoy = _calc_yoy_change(
                    _sum_gold_tonnes(db, latest_cb_date),
                    _sum_gold_tonnes(db, prior_cb_date)
                )
            em_accumulation_momentum = _calc_em_accumulation_momentum(db)

            return {
                "regime": {
                    "overall_regime": regime.value if regime else None,
                    "gold_bias": gold_bias.value if gold_bias else None,
                    "silver_bias": silver_bias.value if silver_bias else None,
                    "pgm_bias": pgm_bias.value if pgm_bias else None,
                    "paper_physical_risk": paper_physical_risk.value if paper_physical_risk else None
                },
                "cb_context": {
                    "global_cb_gold_pct_reserves": global_cb_gold_pct_reserves,
                    "net_purchases_yoy": net_purchases_yoy,
                    "structural_monetary_bid": smb,
                    "em_accumulation_momentum": em_accumulation_momentum
                },
                "price_anchors": {
                    "au_dxy_ratio_zscore": au_dxy.zscore_2y if au_dxy else None,
                    "ag_dxy_ratio_zscore": ag_dxy.zscore_2y if ag_dxy else None,
                    "real_rate_signal": real_rate_signal,
                    "monetary_hedge_strength": mhs
                },
                "relative_value": {
                    "au_ag_ratio": au_ag.ratio_value if au_ag else None,
                    "au_ag_ratio_zscore": au_ag.zscore_2y if au_ag else None,
                    "pt_au_ratio": pt_au.ratio_value if pt_au else None,
                    "pt_au_ratio_zscore": pt_au.zscore_2y if pt_au else None,
                    "pd_au_ratio": pd_au.ratio_value if pd_au else None,
                    "pd_au_ratio_zscore": pd_au.zscore_2y if pd_au else None
                },
                "physical_paper": {
                    "paper_credibility_index": pci,
                    "oi_registered_ratio": comex.oi_to_registered_ratio if comex else None,
                    "comex_registered_inventory_change_yoy": comex_change if comex else None,
                    "etf_holdings_zscore": gld_holdings_zscore,
                    "etf_holdings_change_yoy": gld_holdings_yoy,
                    "backwardation_severity": back_severity if backwardation else None,
                    "etf_flow_divergence": etf_divergence if latest_etf else None
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/cb-holdings")
def get_cb_holdings():
    """
    Get central bank holdings by country (most recent)
    """
    with get_db_session() as db:
        try:
            latest_date = db.query(func.max(CBHolding.date)).scalar()
            if not latest_date:
                return []
            
            subq = db.query(
                CBHolding.country,
                func.max(CBHolding.id).label("max_id")
            ).filter(
                CBHolding.date == latest_date
            ).group_by(CBHolding.country).subquery()

            holdings = db.query(CBHolding).join(
                subq,
                CBHolding.id == subq.c.max_id
            ).order_by(desc(CBHolding.gold_tonnes)).limit(20).all()
            
            # Get YoY change
            result = []
            for holding in holdings:
                prior_year = db.query(CBHolding).filter(
                    CBHolding.country == holding.country,
                    CBHolding.date <= holding.date - timedelta(days=330)
                ).order_by(desc(CBHolding.date)).first()
                
                yoy_pct = None
                if prior_year and prior_year.gold_tonnes:
                    yoy_pct = (holding.gold_tonnes - prior_year.gold_tonnes) / prior_year.gold_tonnes * 100

                prior_snapshot = db.query(CBHolding).filter(
                    CBHolding.country == holding.country,
                    CBHolding.date < holding.date
                ).order_by(desc(CBHolding.date)).first()
                net_purchase_qty = None
                if prior_snapshot and prior_snapshot.gold_tonnes is not None:
                    net_purchase_qty = holding.gold_tonnes - prior_snapshot.gold_tonnes
                
                result.append({
                    "country": holding.country,
                    "gold_tonnes": holding.gold_tonnes,
                    "pct_of_reserves": holding.pct_of_reserves,
                    "net_purchase_qty": net_purchase_qty,
                    "net_purchase_yoy_pct": yoy_pct
                })
            
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/futures-curve")
def get_futures_curve(contracts: int = Query(4, ge=3, le=6)):
    """Get COMEX/NYMEX nearby month-specific precious-metals futures curves."""
    try:
        return get_precious_metals_futures_curve(contracts=contracts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/global-price-dispersion")
def get_global_price_dispersion(
    metal: str = Query("AG", min_length=2, max_length=2),
    comparison_time: str = Query("latest_available"),
    reference: str = Query("auto"),
    basis: str = Query("raw_converted"),
):
    """Return registry coverage plus only those venue quotes that can be verified."""
    metal = metal.upper()
    if metal not in METAL_DEFINITIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported metal: {metal}")

    observations = []
    reference_id = DEFAULT_REFERENCE_IDS[metal]
    if metal in PRECIOUS_METALS_FUTURES:
        curve = _get_metal_futures_curve(metal, contracts=1)
        if curve and curve["contracts"]:
            front = curve["contracts"][0]
            observations.append({
                "registry_id": reference_id,
                "symbol": front["symbol"],
                "contract_month": front["contract_label"],
                "local_price": front["price"],
                "currency": "USD",
                "native_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
                "fx_rate_local_per_usd": 1.0,
                "fx_timestamp": front["as_of"],
                "price_type": "provider daily bar close",
                "quote_timestamp": front["as_of"],
                "session_status": "unverified",
                "data_delay": "Daily provider observation; real-time status is not asserted",
                "volume": front.get("volume"),
                "open_interest": None,
            })
    else:
        with get_db_session() as db:
            latest = db.query(MetalPrice).filter(MetalPrice.metal == metal).order_by(desc(MetalPrice.date)).first()
            if latest and latest.price_usd_per_oz is not None:
                observations.append({
                    "registry_id": reference_id,
                    "contract_month": None,
                    "local_price": latest.price_usd_per_oz,
                    "currency": "USD",
                    "native_unit": METAL_DEFINITIONS[metal]["canonical_unit"],
                    "fx_rate_local_per_usd": 1.0,
                    "fx_timestamp": latest.date.isoformat(),
                    "price_type": "stored daily close",
                    "quote_timestamp": latest.date.isoformat(),
                    "session_status": "unverified",
                    "data_delay": "Stored daily provider series; listed contract month is unavailable",
                    "volume": None,
                    "open_interest": None,
                })

    try:
        return build_global_price_dispersion(
            metal,
            observations,
            reference=reference,
            comparison_time=comparison_time,
            basis=basis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/supply")
def get_supply_data():
    """
    Get latest supply data (production, AISC, recycling)
    """
    with get_db_session() as db:
        try:
            latest_period = db.query(func.max(SupplyData.period)).scalar()
            if not latest_period:
                return []
            
            supply = db.query(SupplyData).filter(
                SupplyData.period == latest_period
            ).all()
            
            # Fetch latest spot prices for each metal
            spot_prices = {}
            for metal in ['AU', 'AG', 'PT', 'PD']:
                latest_price = db.query(MetalPrice).filter(
                    MetalPrice.metal == metal
                ).order_by(desc(MetalPrice.date)).first()
                if latest_price:
                    spot_prices[metal] = latest_price.price_usd_per_oz
            
            result = []
            for s in supply:
                current_spot = spot_prices.get(s.metal)
                aisc = s.aisc_per_oz
                margin_pct = (
                    ((current_spot - aisc) / aisc * 100)
                    if current_spot is not None and aisc
                    else None
                )
                
                result.append({
                    "metal": s.metal,
                    "production_tonnes_yoy_pct": s.production_yoy_pct,
                    "aisc_per_oz": aisc,
                    "current_spot_price": current_spot,
                    "margin_pct": margin_pct,
                    "recycling_pct_of_supply": s.recycling_pct
                })
            
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/demand")
def get_demand_data():
    """
    Get latest demand decomposition by category
    """
    with get_db_session() as db:
        try:
            latest_period = db.query(func.max(DemandData.period)).scalar()
            if not latest_period:
                return []
            
            demand = db.query(DemandData).filter(
                DemandData.period == latest_period
            ).all()
            
            result = []
            for d in demand:
                result.append({
                    "metal": d.metal,
                    "period": d.period,
                    "investment_tonnes": d.investment_tonnes,
                    "industrial_tonnes": d.industrial_tonnes,
                    "jewelry_tonnes": d.jewelry_tonnes,
                    "jewelry_asia_tonnes": d.jewelry_asia_tonnes,
                    "other_tonnes": d.other_tonnes,
                    "total_tonnes": d.total_tonnes
                })
            
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-caps")
def get_market_caps():
    """
    Return current spot prices with tracked holdings from ETF + CB data.
    """
    with get_db_session() as db:
        try:
            # Get latest prices
            prices = {}
            for metal in ['AU', 'AG', 'PT', 'PD']:
                latest = db.query(MetalPrice).filter(
                    MetalPrice.metal == metal
                ).order_by(desc(MetalPrice.date)).first()
                if latest:
                    prices[metal] = latest.price_usd_per_oz
            
            etf_by_metal = {
                "AU": "GLD",
                "AG": "SLV",
                "PT": "PPLT",
                "PD": "PALL",
            }

            # Calculate market caps from tracked holdings (ETF + CB gold)
            market_caps = {}
            total_value = 0.0
            cb_gold_oz = _latest_cb_gold_oz(db)
            for metal in ['AU', 'AG', 'PT', 'PD']:
                if metal not in prices:
                    continue
                stock_oz = None
                etf_ticker = etf_by_metal.get(metal)
                if etf_ticker:
                    latest_etf = db.query(ETFHolding).filter(
                        ETFHolding.ticker == etf_ticker
                    ).order_by(desc(ETFHolding.date)).first()
                    if latest_etf and latest_etf.holdings:
                        stock_oz = latest_etf.holdings
                if metal == "AU" and cb_gold_oz:
                    stock_oz = (stock_oz or 0) + cb_gold_oz

                value = (stock_oz * prices[metal]) if stock_oz is not None else None
                market_caps[metal] = {
                    "metal": metal,
                    "price_usd_per_oz": prices[metal],
                    "stock_oz": stock_oz,
                    "market_cap_usd": value
                }
                if value is not None:
                    total_value += value
            
            macro = db.query(MacroLiquidityData).filter(
                MacroLiquidityData.global_m2.isnot(None)
            ).order_by(desc(MacroLiquidityData.date)).first()
            global_m2_usd = (macro.global_m2 * 1e12) if macro and macro.global_m2 is not None else None
            metals_to_m2_ratio = (
                (total_value / global_m2_usd) * 100
                if global_m2_usd and total_value
                else None
            )
            
            return {
                "metals": market_caps,
                "total_market_cap_usd": total_value if total_value else None,
                "global_m2_usd": global_m2_usd,
                "metals_to_m2_pct": metals_to_m2_ratio,
                "notes": {
                    "tracked_stock": "Computed from latest ETF holdings; gold includes latest CB holdings.",
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/correlations")
def get_correlations():
    """
    Get latest rolling correlations
    """
    with get_db_session() as db:
        try:
            latest = db.query(MetalCorrelation).order_by(desc(MetalCorrelation.date)).first()
            
            if not latest:
                return {
                    "timestamp": datetime.utcnow().isoformat(),
                    "au_ag": None,
                    "au_pt": None,
                    "au_pd": None,
                    "ag_pt": None,
                    "ag_pd": None,
                    "pt_pd": None,
                    "au_spy": None,
                    "au_tlt": None,
                    "au_dxy": None,
                    "au_vix": None
                }
            
            au_pt = getattr(latest, "au_pt_60d", None)
            au_pd = getattr(latest, "au_pd_60d", None)
            ag_pt = getattr(latest, "ag_pt_60d", None)
            ag_pd = getattr(latest, "ag_pd_60d", None)
            pt_pd = getattr(latest, "pt_pd_60d", None)
            au_spy = getattr(latest, "au_spy_60d", None)
            au_tlt = getattr(latest, "au_tlt_60d", None)
            au_dxy = getattr(latest, "au_dxy_60d", None)
            au_vix = getattr(latest, "au_vix_60d", None)

            return {
                "timestamp": latest.date.isoformat(),
                "au_ag": latest.au_ag_60d if latest.au_ag_60d is not None else None,
                "au_pt": au_pt if au_pt is not None else None,
                "au_pd": au_pd if au_pd is not None else None,
                "ag_pt": ag_pt if ag_pt is not None else None,
                "ag_pd": ag_pd if ag_pd is not None else None,
                "pt_pd": pt_pd if pt_pd is not None else None,
                "au_spy": au_spy if au_spy is not None else None,
                "au_tlt": au_tlt if au_tlt is not None else None,
                "au_dxy": au_dxy if au_dxy is not None else None,
                "au_vix": au_vix if au_vix is not None else None
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/history/{metal}")
def get_metal_price_history(metal: str, days: int = Query(365, ge=1, le=1095)):
    """
    Get historical price data for a metal
    """
    with get_db_session() as db:
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            prices = db.query(MetalPrice).filter(
                MetalPrice.metal == metal.upper(),
                MetalPrice.date >= cutoff_date
            ).order_by(MetalPrice.date).all()
            
            return [
                {
                    "date": p.date.isoformat(),
                    "price": p.price_usd_per_oz
                }
                for p in prices
            ]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-caps/history")
async def get_market_caps_history(years: int = 25):
    """
    Calculate Metals/M2 ratio history using ingested prices and macro data.
    """
    with get_db_session() as db:
        start_date = datetime.utcnow().date() - timedelta(days=years * 365)
        gold_prices = db.query(MetalPrice).filter(
            MetalPrice.metal == 'AU',
            MetalPrice.price_usd_per_oz.isnot(None),
            MetalPrice.date >= start_date
        ).order_by(MetalPrice.date).all()
        macro = db.query(MacroLiquidityData).filter(
            MacroLiquidityData.global_m2.isnot(None),
            MacroLiquidityData.date >= start_date
        ).order_by(MacroLiquidityData.date).all()

        price_map = {p.date.date(): p.price_usd_per_oz for p in gold_prices}
        m2_map = {m.date.date(): m.global_m2 for m in macro}
        cb_gold_map = _cb_gold_oz_series(db)
        gld_holdings = db.query(ETFHolding).filter(
            ETFHolding.ticker == "GLD",
            ETFHolding.holdings.isnot(None)
        ).order_by(ETFHolding.date).all()
        holdings_map = {h.date.date(): h.holdings for h in gld_holdings}
        cb_gold_oz = _latest_cb_gold_oz(db) or 0.0
        overlap_dates = sorted(set(price_map.keys()) & set(m2_map.keys()))

        history = []
        cb_dates = sorted(cb_gold_map.keys())
        cb_index = 0
        last_cb_oz = None
        last_holdings = None
        for date in overlap_dates:
            if date in holdings_map:
                last_holdings = holdings_map[date]
            while cb_index < len(cb_dates) and cb_dates[cb_index] <= date:
                last_cb_oz = cb_gold_map[cb_dates[cb_index]]
                cb_index += 1
            tracked_cb_oz = last_cb_oz if last_cb_oz is not None else cb_gold_oz
            tracked_gold_oz = None
            if last_holdings is not None or tracked_cb_oz is not None:
                tracked_gold_oz = (last_holdings or 0.0) + (tracked_cb_oz or 0.0)
            tracked_value = (tracked_gold_oz * price_map[date]) if tracked_gold_oz is not None else None
            metals_to_m2 = (
                (tracked_value / (m2_map[date] * 1e12)) * 100
                if tracked_value is not None and m2_map[date] is not None
                else None
            )
            history.append({
                'date': date.isoformat(),
                'gold_price': price_map[date],
                'global_m2_trillions': m2_map[date],
                'metals_to_m2_pct': metals_to_m2
            })

        return {
            'history': history,
            'notes': {
                'metals_to_m2_pct': 'Tracked using GLD holdings and CB gold holdings (carried forward).'
            }
        }
