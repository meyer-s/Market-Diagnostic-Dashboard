#!/bin/bash
# AAS Indicator - Data Ingestion & Calculation Script

cd "$(dirname "$0")"
source ../.venv/bin/activate

echo "=== Alternative Asset Stability (AAS) Indicator ==="
echo ""
echo "Step 1: Fetching real crypto data from CoinGecko..."
python3 -c "
from app.services.ingestion.aas_data_ingestion import CryptoDataIngestion
from app.core.db import SessionLocal

db = SessionLocal()
try:
    crypto = CryptoDataIngestion(db)
    result = crypto.fetch_current_prices()
    if result:
        print(f'✓ Crypto data: BTC=\${result.btc_usd:,.0f}, ETH=\${result.eth_usd:,.0f}')
    else:
        print('✗ Failed to fetch crypto data')
finally:
    db.close()
"

echo ""
echo "Step 2: Calculating AAS indicator..."
python3 -c "
from datetime import datetime
from app.services.aas_calculator import AASCalculator
from app.core.db import SessionLocal

db = SessionLocal()
try:
    calc = AASCalculator(db)
    result = calc.calculate_for_date(datetime.utcnow())
    
    if result:
        print(f'✓ AAS Score: {result.stability_score:.1f}/100')
        print(f'  Regime: {result.regime.replace(\"_\", \" \").upper()}')
        print(f'  Driver: {result.primary_driver}')
        print(f'  Data: {result.data_completeness:.0%} complete')
    else:
        print('✗ Calculation failed')
finally:
    db.close()
"

echo ""
echo "Done! Use '/aas/current' API endpoint to access data."
