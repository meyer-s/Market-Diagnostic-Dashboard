"""
Seed Indicators Script
----------------------
Creates all 12 indicator metadata entries in the database.
This script is automatically run on container startup via startup.sh.

Indicators:
- VIX: Volatility stress indicator (high = stress)
- SPY: S&P 500 ETF momentum (stores EMA gap %, below EMA = stress)
- BREADTH_HEALTH: Breadth proxy from equal-weight vs cap-weight (RSP/SPY ratio)
- DFF: Federal Funds Rate (stores absolute rate, scores based on rate-of-change)
- T10Y2Y: Treasury yield curve (inverted = stress)
- UNRATE: Unemployment rate (high = stress)
- CONSUMER_HEALTH: Derived from PCE, CPI, and PI (low = stress)
- BOND_MARKET_STABILITY: Derived from 10Y and 30Y volatility (high = stress)
- LIQUIDITY_PROXY: EFFR volatility (high = stress)
- ANALYST_ANXIETY: Composite sentiment indicator from VIX, MOVE, HY OAS, ERP (high = stress)
- SENTIMENT_COMPOSITE: Consumer & corporate confidence from Michigan, NFIB, ISM, CapEx
- AAP: Alternative Asset Pressure from crypto and precious metals (low = pressure/distrust)

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
        "weight": 1.5,
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
        "weight": 1.4,
    },
    {
        "code": "BREADTH_HEALTH",
        "name": "Breadth Health",
        "source": "DERIVED",
        "source_symbol": "RSP_SPY_RATIO",
        "category": "equity",
        "direction": -1,  # higher participation = healthier = higher stability score
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.0,
    },
    {
        "code": "DFF",
        "name": "Federal Funds Effective Rate",
        "source": "fred",
        "source_symbol": "DFF",
        "category": "rates",
        # Backend stores rate-of-change: rising rates = tightening = stress
        # Direction=1 inverts positive ROC (stress) to low stability score
        "direction": 1,
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 1.3,
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
        "weight": 1.6,
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
        "weight": 1.8,
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
        "weight": 1.6,
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
        "weight": 1.7,
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
        "weight": 1.6,
    },
    {
        "code": "AAP",
        "name": "Alternative Asset Pressure",
        "source": "DERIVED",
        "source_symbol": "AAP_COMPOSITE",
        "category": "alternative_assets",
        "direction": -1,  # Backend outputs stability score (high = stable, low = pressure)
        "lookback_days_for_z": 252,
        "threshold_green_max": 40,  # Stability score thresholds: RED <40, YELLOW 40-69, GREEN >=70
        "threshold_yellow_max": 70,
        "weight": 2.0,  # Higher weight - structural signal
    },
]

# Check which indicators already exist
new_indicators = []
for ind_data in INDICATORS:
    existing = db.query(Indicator).filter(Indicator.code == ind_data["code"]).first()
    if not existing:
        new_indicators.append(ind_data)

if not new_indicators:
    print("✅ All 12 indicators already exist")
    db.close()
    exit(0)

for ind_data in new_indicators:
    indicator = Indicator(**ind_data)
    db.add(indicator)
    print(f"✅ Adding {ind_data['name']}")

db.commit()
db.close()

print(f"\n✅ Created {len(new_indicators)} new indicator(s)")
print("\n📊 To backfill 365 days of historical data, run:")
print("   curl -X POST http://localhost:8000/admin/backfill")
print("\nOr the ETL scheduler will fetch latest data automatically.")
