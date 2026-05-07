"""
Seed Indicators Script
----------------------
Creates/updates all 12 indicator metadata entries in the database.
This script is automatically run on container startup via startup.sh.

Indicators:
- VIX: Volatility stress indicator (high = stress)
- SPY: S&P 500 ETF momentum (stores EMA gap %, below EMA = stress)
- BREADTH_HEALTH: 3-component breadth (RSP/SPY ratio + sector participation + return breadth)
- T10Y2Y: Treasury yield curve (inverted = stress)
- UNRATE: Unemployment rate (high = stress)
- CONSUMER_HEALTH: Derived from PCE, CPI, and PI (low = stress)
- BOND_MARKET_STABILITY: Derived from credit spreads, yield curve, momentum, vol
- LIQUIDITY_PROXY: M2 growth, Fed balance sheet, RRP (low liquidity = stress)
- ANALYST_ANXIETY: Composite from VIX, MOVE, HY OAS, ERP (high = stress)
- SENTIMENT_COMPOSITE: Consumer & corporate confidence from Michigan, NFIB, ISM, CapEx
- AAS: Alternative Asset Stability from crypto and precious metals (low = pressure/distrust)
- SECTOR_REGIME_ALIGNMENT: Sector divergence alignment versus current system regime

DFF (Federal Funds Rate) was removed — its signal is redundant given T10Y2Y,
LIQUIDITY_PROXY, and BOND_MARKET_STABILITY, and it provides no incremental information
during stable-rate environments.

Real data will be fetched automatically by the ETL scheduler every 4 hours.
"""

from app.core.db import SessionLocal, Base, engine
from app.models.indicator import Indicator

# Create tables
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Define all indicators
INDICATORS = [
    {
        "code": "VIX",
        "name": "CBOE Volatility Index (VIX)",
        "source": "yahoo",
        "source_symbol": "^VIX",
        "category": "volatility",
        "direction": 1,  # high VIX = stress → inverted to stability score by backend
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.0,
    },
    {
        "code": "SPY",
        "name": "S&P 500 ETF (SPY)",
        "source": "yahoo",
        "source_symbol": "SPY",
        "category": "equity",
        "direction": -1,  # price below EMA = stress → inverted to stability score by backend
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.3,
    },
    {
        "code": "BREADTH_HEALTH",
        "name": "Market Breadth Health",
        "source": "DERIVED",
        "source_symbol": "BREADTH_COMPOSITE",
        "category": "equity",
        "direction": -1,  # higher participation = healthier = higher stability score
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.8,  # Elevated: primary equity participation confirmation signal
    },
    {
        "code": "T10Y2Y",
        "name": "10-Year minus 2-Year Treasury Spread",
        "source": "fred",
        "source_symbol": "T10Y2Y",
        "category": "rates",
        "direction": -1,  # inverted curve = stress → inverted to stability score by backend
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.0,  # Reduced to limit overlap with BOND_MARKET_STABILITY curve component
    },
    {
        "code": "UNRATE",
        "name": "U.S. Unemployment Rate",
        "source": "fred",
        "source_symbol": "UNRATE",
        "category": "employment",
        "direction": 1,  # high unemployment = stress → inverted to stability score by backend
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.2,
    },
    {
        "code": "CONSUMER_HEALTH",
        "name": "Consumer Health Index",
        "source": "DERIVED",
        "source_symbol": "CONSUMER_COMPOSITE",
        "category": "consumer",
        "direction": -1,  # negative spread = stress → inverted to stability score by backend
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.4,
    },
    {
        "code": "BOND_MARKET_STABILITY",
        "name": "Bond Market Stability Composite",
        "source": "DERIVED",
        "source_symbol": "BOND_COMPOSITE",
        "category": "bonds",
        "direction": 1,  # Backend outputs stress score (high = stress, low = healthy) → invert to stability
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 2.0,  # Primary fixed-income stress anchor
    },
    {
        "code": "LIQUIDITY_PROXY",
        "name": "Liquidity Proxy Indicator",
        "source": "DERIVED",
        "source_symbol": "LIQUIDITY_COMPOSITE",
        "category": "liquidity",
        "direction": -1,  # Backend outputs liquidity z-score (high = more liquid = stable)
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.8,  # Elevated: system-level liquidity regime signal
    },
    {
        "code": "ANALYST_ANXIETY",
        "name": "Analyst Confidence",
        "source": "DERIVED",
        "source_symbol": "ANALYST_ANXIETY_COMPOSITE",
        "category": "sentiment",
        "direction": -1,  # Backend outputs stability score (high = calm/stable, low = anxious)
        "lookback_days_for_z": 520,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.9,  # Elevated: institutional risk sentiment composite
    },
    {
        "code": "SENTIMENT_COMPOSITE",
        "name": "Consumer & Corporate Sentiment",
        "source": "DERIVED",
        "source_symbol": "SENTIMENT_COMPOSITE",
        "category": "sentiment",
        "direction": -1,  # Backend outputs stability score (high sentiment = high score)
        "lookback_days_for_z": 520,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.8,  # Elevated: demand-confidence composite
    },
    {
        "code": "SECTOR_REGIME_ALIGNMENT",
        "name": "Sector Divergence Alignment",
        "source": "DERIVED",
        "source_symbol": "SECTOR_REGIME_ALIGNMENT",
        "category": "equity",
        "direction": -1,  # Backend outputs a stability-alignment score directly (higher = better)
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 0.8,  # Deliberately light: additive signal for leadership/regime confirmation
    },
    {
        "code": "AAS",
        "name": "Alternative Asset Stability",
        "source": "DERIVED",
        "source_symbol": "AAS_COMPOSITE",
        "category": "alternative_assets",
        "direction": -1,  # Backend outputs stability score (high = stable, low = pressure)
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 2.0,  # Higher weight - structural signal
    },
]

# --- Remove deprecated indicators ---
DEPRECATED_CODES = ["DFF"]
from app.models.indicator_value import IndicatorValue

for dep_code in DEPRECATED_CODES:
    dep = db.query(Indicator).filter(Indicator.code == dep_code).first()
    if dep:
        deleted = db.query(IndicatorValue).filter(IndicatorValue.indicator_id == dep.id).delete()
        db.delete(dep)
        print(f"🗑️  Removed deprecated indicator {dep_code} ({deleted} values deleted)")

db.commit()

# --- Create new indicators / update existing weights and metadata ---
created = 0
updated = 0
for ind_data in INDICATORS:
    existing = db.query(Indicator).filter(Indicator.code == ind_data["code"]).first()
    if not existing:
        indicator = Indicator(**ind_data)
        db.add(indicator)
        print(f"✅ Adding {ind_data['name']}")
        created += 1
    else:
        # Update mutable fields so weight/name changes take effect on restart
        changed = False
        for field in ("weight", "name", "source_symbol", "direction", "lookback_days_for_z"):
            if field in ind_data and getattr(existing, field) != ind_data[field]:
                setattr(existing, field, ind_data[field])
                changed = True
        if changed:
            print(f"🔄 Updated {existing.code}")
            updated += 1

db.commit()
db.close()

print(f"\n✅ Seed complete: {created} created, {updated} updated, {len(DEPRECATED_CODES)} deprecated removed")
print("\n📊 To backfill 365 days of historical data, run:")
print("   curl -X POST http://localhost:8000/admin/backfill")
print("\nOr the ETL scheduler will fetch latest data automatically.")
