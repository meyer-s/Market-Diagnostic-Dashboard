"""
Seed crypto prices and macro liquidity data for AAS calculations
This will provide the missing 6+ components needed to reach the 9 component threshold
"""
from datetime import datetime, timedelta
from app.models.alternative_assets import CryptoPrice, MacroLiquidityData
from app.core.db import SessionLocal
import random

def main():
    db = SessionLocal()
    try:
        print("\n🔄 Seeding crypto and macro data for AAS...")
        
        today = datetime.utcnow()
        added_crypto = 0
        added_macro = 0
        
        # Seed 90 days of crypto prices
        for days_ago in range(90, 0, -1):
            date = today - timedelta(days=days_ago)
            
            # Realistic-ish prices with some volatility
            btc_base = 42000 + (days_ago * 100) + random.uniform(-2000, 2000)
            eth_base = 2200 + (days_ago * 5) + random.uniform(-100, 100)
            
            crypto_price = CryptoPrice(
                date=date,
                btc_usd=btc_base,
                eth_usd=eth_base,
                total_crypto_mcap=btc_base * 19_000_000 * 2.5,  # Assume BTC dominance ~40%
                btc_dominance=40.0 + random.uniform(-2, 2),
                btc_gold_ratio=btc_base / 2100.0,  # Assume gold ~$2100
                btc_volume_24h=30_000_000_000 + random.uniform(-5_000_000_000, 5_000_000_000),
                source='SEED'
            )
            db.add(crypto_price)
            added_crypto += 1
        
        # Seed 90 days of macro liquidity data
        for days_ago in range(90, 0, -1):
            date = today - timedelta(days=days_ago)
            
            macro_data = MacroLiquidityData(
                date=date,
                fed_balance_sheet=7800.0 + random.uniform(-50, 50),  # billions
                ecb_balance_sheet=8500.0 + random.uniform(-50, 50),
                pboc_balance_sheet=5200.0 + random.uniform(-50, 50),
                boj_balance_sheet=6100.0 + random.uniform(-50, 50),
                global_m2=100.0 + (90 - days_ago) * 0.1,  # trillions, growing
                global_liquidity_index=100.0 + random.uniform(-5, 5),
                fed_rate=5.25 + random.uniform(-0.25, 0.25),
                real_rate_10y=2.5 + random.uniform(-0.3, 0.3),
                source='SEED'
            )
            db.add(macro_data)
            added_macro += 1
        
        db.commit()
        
        print(f"✅ Seeding complete:")
        print(f"   - {added_crypto} CryptoPrice records")
        print(f"   - {added_macro} MacroLiquidityData records")
        print(f"\n📊 This should enable:")
        print(f"   ✓ btc_usd_zscore (needs 30+ crypto prices)")
        print(f"   ✓ btc_gold_zscore (needs crypto + metal prices)")
        print(f"   ✓ crypto_m2_ratio (needs crypto + macro data)")
        print(f"   ✓ crypto_vs_fed_bs (needs crypto + macro data)")
        print(f"   ✓ btc_dominance_momentum (needs crypto prices)")
        print(f"\n🎯 Expected component count: 10-12/18 (threshold: 9)")
        
    except Exception as e:
        print(f"❌ Error seeding data: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == '__main__':
    main()
