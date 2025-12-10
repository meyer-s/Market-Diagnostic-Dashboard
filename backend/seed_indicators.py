"""
Minimal seed script - creates only indicator metadata (no fake data)
Real data will be fetched automatically by the ETL scheduler
"""

from app.core.db import SessionLocal, Base, engine
from app.models.indicator import Indicator

# Create tables
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Clear existing indicators
db.query(Indicator).delete()
db.commit()

indicators = [
    {
        "code": "VIX",
        "name": "Volatility Index (VIX)",
        "source": "YAHOO",
        "source_symbol": "^VIX",
        "category": "volatility",
        "direction": 1,  # high = stress
        "lookback_days_for_z": 252,
        "threshold_green_max": 30,
        "threshold_yellow_max": 60,
        "weight": 1.5,
    },
    {
        "code": "DFF",
        "name": "Federal Funds Rate",
        "source": "FRED",
        "source_symbol": "DFF",
        "category": "rates",
        "direction": 1,  # high = stress
        "lookback_days_for_z": 252,
        "threshold_green_max": 30,
        "threshold_yellow_max": 60,
        "weight": 1.2,
    },
    {
        "code": "T10Y2Y",
        "name": "Yield Curve (10Y-2Y)",
        "source": "FRED",
        "source_symbol": "T10Y2Y",
        "category": "rates",
        "direction": 1,  # high = positive curve = stability, low/negative = inverted = stress
        "lookback_days_for_z": 252,
        "threshold_green_max": 30,
        "threshold_yellow_max": 60,
        "weight": 1.8,
    },
    {
        "code": "UNRATE",
        "name": "Unemployment Rate",
        "source": "FRED",
        "source_symbol": "UNRATE",
        "category": "employment",
        "direction": 1,  # high = stress
        "lookback_days_for_z": 252,
        "threshold_green_max": 30,
        "threshold_yellow_max": 60,
        "weight": 1.0,
    },
    {
        "code": "SPY",
        "name": "S&P 500 ETF",
        "source": "YAHOO",
        "source_symbol": "SPY",
        "category": "equity",
        "direction": 1,  # high = bull market = stability, low = bear market = stress
        "lookback_days_for_z": 252,
        "threshold_green_max": 30,
        "threshold_yellow_max": 60,
        "weight": 1.3,
    },
]

for ind_data in indicators:
    indicator = Indicator(**ind_data)
    db.add(indicator)

db.commit()
db.close()

print(f"✅ Created {len(indicators)} indicators (metadata only)")
print("\n📊 To backfill 365 days of historical data, run:")
print("   curl -X POST http://localhost:8000/admin/backfill")
print("\nOr the ETL scheduler will fetch latest data automatically.")
