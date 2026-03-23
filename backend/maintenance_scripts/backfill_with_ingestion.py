"""
Backfill crypto and macro data using the existing ingestion services
This runs the ingestion for multiple historical days to build up data
"""
from datetime import datetime, timedelta
import time
from app.core.db import SessionLocal
from app.services.ingestion.aas_data_ingestion import CryptoDataIngestion, MacroDataIngestion
from app.models.alternative_assets import CryptoPrice, MacroLiquidityData

def backfill_with_ingestion(days=7):
    """
    Use the existing ingestion services to fetch real data.
    Note: Free APIs have rate limits, so we fetch conservatively
    """
    db = SessionLocal()
    
    try:
        print(f"\n🔄 Backfilling last {days} days using ingestion services...")
        
        # Delete seed data first
        deleted_crypto = db.query(CryptoPrice).filter(CryptoPrice.source == 'SEED').delete()
        deleted_macro = db.query(MacroLiquidityData).filter(MacroLiquidityData.source == 'SEED').delete()
        db.commit()
        print(f"  Deleted {deleted_crypto} seed crypto records")
        print(f"  Deleted {deleted_macro} seed macro records")
        
        crypto_ingestion = CryptoDataIngestion(db)
        macro_ingestion = MacroDataIngestion(db)
        
        print("\n  Fetching current crypto data...")
        crypto_result = crypto_ingestion.fetch_current_prices()
        if crypto_result:
            print(f"    ✓ Crypto data for {crypto_result.date.date()}")
            print(f"      BTC: ${crypto_result.btc_usd:,.2f}")
            print(f"      ETH: ${crypto_result.eth_usd:,.2f}")
        else:
            print(f"    ✗ Failed to fetch crypto data")
        
        time.sleep(2)  # Rate limit
        
        print("\n  Fetching current macro data...")
        macro_result = macro_ingestion.fetch_current_macro_data()
        if macro_result:
            print(f"    ✓ Macro data for {macro_result.date.date()}")
            if macro_result.fed_balance_sheet:
                print(f"      Fed BS: ${macro_result.fed_balance_sheet:,.1f}B")
        else:
            print(f"    ✗ Failed to fetch macro data")
        
        # Count real data
        crypto_count = db.query(CryptoPrice).filter(CryptoPrice.source != 'SEED').count()
        macro_count = db.query(MacroLiquidityData).filter(MacroLiquidityData.source != 'SEED').count()
        
        print(f"\n✅ Real data now available:")
        print(f"   Crypto: {crypto_count} records")
        print(f"   Macro: {macro_count} records")
        print(f"\n💡 Note: For historical data, the scheduler will fetch daily updates")
        print(f"   Or use FRED API to backfill macro data (fetch_real_macro.py)")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    backfill_with_ingestion()
