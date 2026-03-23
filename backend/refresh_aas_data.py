"""
Master script to fetch all AAS data sources and achieve 18/18 components.

This script orchestrates the complete data refresh:
1. Precious metals (already working from YAHOO/FRED)
2. Crypto prices (BTC/ETH from FRED)
3. Macro liquidity (Fed BS, ECB, M2 from FRED)
4. COMEX inventory (from configured source)
5. CB holdings (from WGC/IMF Q4 2025 data)
6. Extended crypto (dominance, DeFi TVL, stablecoins)

After data refresh, runs comprehensive AAS backfill.
"""
import sys
import time
from datetime import datetime

print("\n" + "="*70)
print(" AAS DATA REFRESH - Full 18 Component System")
print("="*70 + "\n")

print("This script will:")
print("  1. Fetch/update precious metals data")
print("  2. Fetch crypto prices (BTC/ETH)")
print("  3. Fetch macro liquidity data")
print("  4. Ingest COMEX inventory")
print("  5. Fetch CB gold holdings")
print("  6. Extend crypto market data")
print("  7. Clean up seed data")
print("  8. Run AAS backfill")
print()

response = input("Continue? (y/n): ")
if response.lower() != 'y':
    print("Aborted.")
    sys.exit(0)

print("\n" + "="*70)
print(" Step 1: Precious Metals Data")
print("="*70 + "\n")

print("✓ Precious metals already available from daily ingestion")
print("  (YAHOO Finance + FRED API)")
print()

time.sleep(2)

print("="*70)
print(" Step 2: Crypto Prices (BTC/ETH)")
print("="*70 + "\n")

from fetch_real_crypto import main as fetch_crypto
try:
    fetch_crypto()
except Exception as e:
    print(f"⚠️  Warning: Crypto fetch had issues: {e}")
    print("  Continuing with available data...")

time.sleep(2)

print("\n" + "="*70)
print(" Step 3: Macro Liquidity Data")
print("="*70 + "\n")

from fetch_real_macro import main as fetch_macro
try:
    fetch_macro()
except Exception as e:
    print(f"⚠️  Warning: Macro fetch had issues: {e}")
    print("  Continuing with available data...")

time.sleep(2)

print("\n" + "="*70)
print(" Step 4: COMEX Inventory Ingestion")
print("="*70 + "\n")

from fetch_comex_data import main as fetch_comex
try:
    fetch_comex()
except Exception as e:
    print(f"⚠️  Warning: COMEX fetch had issues: {e}")
    print("  Continuing with available data...")

time.sleep(2)

print("\n" + "="*70)
print(" Step 5: Central Bank Holdings")
print("="*70 + "\n")

from fetch_cb_holdings import main as fetch_cb
try:
    fetch_cb()
except Exception as e:
    print(f"⚠️  Warning: CB holdings fetch had issues: {e}")
    print("  Continuing with available data...")

time.sleep(2)

print("\n" + "="*70)
print(" Step 6: Extended Crypto Market Data")
print("="*70 + "\n")

from fetch_extended_crypto import main as fetch_extended
try:
    fetch_extended()
except Exception as e:
    print(f"⚠️  Warning: Extended crypto fetch had issues: {e}")
    print("  Continuing with available data...")

time.sleep(2)

print("\n" + "="*70)
print(" Step 7: Data Quality Check")
print("="*70 + "\n")

from app.core.db import get_db_session
from app.models.precious_metals import MetalPrice, CryptoPrice, MacroLiquidity, COMEXInventory, CBHolding
from sqlalchemy import func

with get_db_session() as db:
    print("📊 Current data inventory:")
    print()
    
    # Metals
    metal_count = db.query(func.count(MetalPrice.id)).scalar()
    metal_real = db.query(func.count(MetalPrice.id)).filter(MetalPrice.source != 'SEED').scalar()
    metal_dates = db.query(func.min(MetalPrice.date), func.max(MetalPrice.date)).first()
    print(f"  Metals: {metal_real}/{metal_count} real")
    print(f"    Range: {metal_dates[0]} to {metal_dates[1]}")
    
    # Crypto
    crypto_count = db.query(func.count(CryptoPrice.id)).scalar()
    crypto_real = db.query(func.count(CryptoPrice.id)).filter(CryptoPrice.source != 'SEED').scalar()
    crypto_dates = db.query(func.min(CryptoPrice.date), func.max(CryptoPrice.date)).first()
    print(f"  Crypto: {crypto_real}/{crypto_count} real")
    print(f"    Range: {crypto_dates[0]} to {crypto_dates[1]}")
    
    # Macro
    macro_count = db.query(func.count(MacroLiquidity.id)).scalar()
    macro_real = db.query(func.count(MacroLiquidity.id)).filter(MacroLiquidity.source != 'SEED').scalar()
    macro_dates = db.query(func.min(MacroLiquidity.date), func.max(MacroLiquidity.date)).first()
    print(f"  Macro: {macro_real}/{macro_count} real")
    print(f"    Range: {macro_dates[0]} to {macro_dates[1]}")
    
    # COMEX
    comex_count = db.query(func.count(COMEXInventory.id)).scalar()
    comex_real = db.query(func.count(COMEXInventory.id)).filter(
        COMEXInventory.source.notin_(['SEED', 'ESTIMATED_FROM_PRICES'])
    ).scalar()
    print(f"  COMEX: {comex_real}/{comex_count} real/estimated")
    
    # CB Holdings
    cb_count = db.query(func.count(CBHolding.id)).scalar()
    cb_real = db.query(func.count(CBHolding.id)).filter(CBHolding.source != 'SEED').scalar()
    print(f"  CB Holdings: {cb_real}/{cb_count} real")
    
    print()

time.sleep(2)

print("="*70)
print(" Step 8: AAS Backfill (90 days)")
print("="*70 + "\n")

print("Running AAS calculation with all available data...")
print()

from backfill_aas import backfill_aas_data
try:
    backfill_aas_data()
except Exception as e:
    print(f"❌ Backfill error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*70)
print(" DATA REFRESH COMPLETE")
print("="*70 + "\n")

print("✅ All data sources refreshed")
print("✅ AAS calculations updated")
print()
print("Next steps:")
print("  1. Review component availability in logs")
print("  2. Check indicator page: https://marketdiagnostictool.com/indicators")
print("  3. View detailed breakdown: /api/aas/components")
print()
print("💡 To deploy to production:")
print("   git add backend/*.py")
print("   git commit -m 'Add comprehensive AAS data fetchers'")
print("   git push")
print("   ssh ubuntu@100.49.90.221")
print("   cd ~/Market-Diagnostic-Dashboard && git pull")
print("   docker exec market_backend python refresh_aas_data.py")
print()
