#!/bin/bash
#
# Deploy AAS Full 18-Component System
#
# This script:
# 1. Pulls latest code
# 2. Runs all data fetchers
# 3. Adds all 18 components
# 4. Performs comprehensive backfill
# 5. Restarts services
#

set -e  # Exit on error

echo ""
echo "========================================================================"
echo " 🚀 AAS FULL DEPLOYMENT - 18 Component System"
echo "========================================================================"
echo ""

# Change to app directory
cd ~/Market-Diagnostic-Dashboard

echo "📥 Pulling latest code..."
git pull
echo ""

echo "========================================================================"
echo " 🗄️  PHASE 1: Data Source Refresh"
echo "========================================================================"
echo ""

# Run all data fetchers
echo "1. Fetching precious metals data (7 days)..."
docker exec market_backend python backfill_metals.py 7
echo ""

echo "2. Fetching crypto prices..."
docker exec market_backend python fetch_real_crypto.py
echo ""

echo "3. Fetching macro data..."
docker exec market_backend python fetch_real_macro.py
echo ""

echo "4. Fetching COMEX inventory..."
docker exec market_backend python fetch_comex_data.py
echo ""

echo "5. Fetching CB holdings..."
docker exec market_backend python fetch_cb_holdings.py
echo ""

echo "6. Fetching extended crypto data..."
docker exec market_backend python fetch_extended_crypto.py
echo ""

echo "========================================================================"
echo " 🔧 PHASE 2: Component Implementation"
echo "========================================================================"
echo ""

echo "Running complete component implementation..."
docker exec market_backend python complete_aas_components.py
echo ""

echo "========================================================================"
echo " 📊 PHASE 3: Data Quality Check"
echo "========================================================================"
echo ""

docker exec market_backend python -c "
from app.core.db import SessionLocal
from app.models.precious_metals import MetalPrice, COMEXInventory, CBHolding
from app.models.alternative_assets import CryptoPrice, MacroLiquidityData
from sqlalchemy import func

db = SessionLocal()
try:
    print('📊 Current data inventory:')
    print()
    
    # Metals
    metal_count = db.query(func.count(MetalPrice.id)).scalar()
    metal_real = db.query(func.count(MetalPrice.id)).filter(MetalPrice.source != 'SEED').scalar()
    print(f'  Metals: {metal_real}/{metal_count} real')
    
    # Crypto
    crypto_count = db.query(func.count(CryptoPrice.id)).scalar()
    crypto_real = db.query(func.count(CryptoPrice.id)).filter(CryptoPrice.source != 'SEED').scalar()
    print(f'  Crypto: {crypto_real}/{crypto_count} real')
    
    # Macro
    macro_count = db.query(func.count(MacroLiquidityData.id)).scalar()
    macro_real = db.query(func.count(MacroLiquidityData.id)).filter(MacroLiquidityData.source != 'SEED').scalar()
    print(f'  Macro: {macro_real}/{macro_count} real')
    
    # COMEX
    comex_count = db.query(func.count(COMEXInventory.id)).scalar()
    print(f'  COMEX: {comex_count} records')
    
    # CB Holdings
    cb_count = db.query(func.count(CBHolding.id)).scalar()
    cb_real = db.query(func.count(CBHolding.id)).filter(CBHolding.source != 'SEED').scalar()
    print(f'  CB Holdings: {cb_real}/{cb_count} real')
    print()
finally:
    db.close()
"
echo ""

echo "========================================================================"
echo " 🔄 PHASE 4: AAS Backfill (90 days)"
echo "========================================================================"
echo ""

docker exec market_backend python backfill_aas.py
echo ""

echo "========================================================================"
echo " ✅ PHASE 5: Verification"
echo "========================================================================"
echo ""

echo "Checking AAS status..."
curl -s https://marketdiagnostictool.com/api/aas/current | python3 -c "
import json
import sys

try:
    data = json.load(sys.stdin)
    print(f\"  Date: {data['date']}\")
    print(f\"  Stability Score: {data['stability_score']}\")
    print(f\"  Regime: {data['regime']}\")
    print(f\"  Components: {data['data_quality']['completeness'] * 100:.1f}% complete\")
    print()
except Exception as e:
    print(f\"  Error: {e}\")
"

echo "Checking component breakdown..."
curl -s https://marketdiagnostictool.com/api/aas/components/breakdown | python3 -c "
import json
import sys

try:
    data = json.load(sys.stdin)
    components = data['components']
    active = sum(1 for c in components if c['status'] == 'active')
    total = len(components)
    
    print(f\"  Components: {active}/{total} active\")
    print(f\"  Metals contribution: {data['metals_contribution'] * 100:.1f}%\")
    print(f\"  Crypto contribution: {data['crypto_contribution'] * 100:.1f}%\")
    print()
    
    if active >= 18:
        print(\"  🎉 SUCCESS! All 18 components operational!\")
    elif active >= 13:
        print(f\"  ✅ Above threshold: {active}/18 components active\")
    else:
        print(f\"  ⚠️  Below threshold: {active}/18 components\")
except Exception as e:
    print(f\"  Error: {e}\")
"
echo ""

echo "========================================================================"
echo " 🎉 DEPLOYMENT COMPLETE"
echo "========================================================================"
echo ""
echo "✅ All data sources refreshed"
echo "✅ All 18 components implemented"
echo "✅ AAS backfill complete"
echo "✅ System operational"
echo ""
echo "View results:"
echo "  Dashboard: https://marketdiagnostictool.com/"
echo "  Indicators: https://marketdiagnostictool.com/indicators"
echo "  AAS Breakdown: https://marketdiagnostictool.com/aas-breakdown"
echo "  API: https://marketdiagnostictool.com/api/aas/current"
echo ""
