"""
Minimal seed script - creates only indicator metadata (no fake data)
Real data will be fetched automatically by the ETL scheduler
"""

from app.core.db import SessionLocal, Base, engine
from app.models.indicator import Indicator

# Create tables
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Check if indicators already exist
existing_bond = db.query(Indicator).filter(Indicator.code == "BOND_MARKET_STABILITY").first()
existing_liquidity = db.query(Indicator).filter(Indicator.code == "LIQUIDITY_PROXY").first()

# Add new indicators that don't exist
new_indicators = []

if not existing_bond:
    new_indicators.append({
        "code": "BOND_MARKET_STABILITY",
        "name": "Bond Market Stability Composite",
        "source": "DERIVED",
        "source_symbol": "BOND_COMPOSITE",  # Aggregates 5 bond market signals
        "category": "bonds",
        "direction": -1,  # high score = healthy bond market, low = stress
        "lookback_days_for_z": 252,
        "threshold_green_max": 35,  # 0-35 = GREEN (stable)
        "threshold_yellow_max": 65,  # 35-65 = YELLOW (caution)
        "weight": 1.8,  # High weight due to bond market's predictive power
    })

if not existing_liquidity:
    new_indicators.append({
        "code": "LIQUIDITY_PROXY",
        "name": "Liquidity Proxy Indicator",
        "source": "DERIVED",
        "source_symbol": "LIQUIDITY_COMPOSITE",  # M2 + Fed Balance + Reverse Repo
        "category": "liquidity",
        "direction": -1,  # high liquidity = stability, low liquidity = stress
        "lookback_days_for_z": 252,
        "threshold_green_max": 30,  # 0-30 = GREEN (abundant liquidity)
        "threshold_yellow_max": 60,  # 30-60 = YELLOW (neutral)
        "weight": 1.6,  # High weight - liquidity drives markets
    })

if not new_indicators:
    print("✅ All composite indicators already exist")
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
