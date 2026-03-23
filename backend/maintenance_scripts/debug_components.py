"""Debug script to check AAS component availability"""
from datetime import datetime, timedelta
from app.services.aas_calculator import AASCalculator
from app.core.db import SessionLocal

def main():
    calc = None
    db = SessionLocal()
    try:
        calc = AASCalculator(db)
        date = datetime.utcnow() - timedelta(days=1)
        
        # Manually gather components to bypass the threshold check
        components = {}
        
        # Metals subsystem - from _calculate_components method
        print("Fetching metals components...")
        try:
            components['gold_usd_zscore'] = calc._calc_gold_usd_zscore(date)
        except Exception as e:
            print(f"  ✗ gold_usd_zscore failed: {e}")
            
        try:
            components['silver_usd_zscore'] = calc._calc_silver_usd_zscore(date)
        except Exception as e:
            print(f"  ✗ silver_usd_zscore failed: {e}")
            
        try:
            components['gold_silver_ratio_signal'] = calc._calc_gsr_signal(date)
        except Exception as e:
            print(f"  ✗ gold_silver_ratio_signal failed: {e}")
            
        try:
            components['platinum_gold_ratio_signal'] = calc._calc_pt_au_signal(date)
        except Exception as e:
            print(f"  ✗ platinum_gold_ratio_signal failed: {e}")
            
        try:
            components['palladium_gold_ratio_signal'] = calc._calc_pd_au_signal(date)
        except Exception as e:
            print(f"  ✗ palladium_gold_ratio_signal failed: {e}")
            
        try:
            components['comex_stress_ratio'] = calc._calc_comex_stress(date)
        except Exception as e:
            print(f"  ✗ comex_stress_ratio failed: {e}")
            
        try:
            components['cb_gold_momentum'] = calc._calc_cb_gold_momentum(date)
        except Exception as e:
            print(f"  ✗ cb_gold_momentum failed: {type(e).__name__}: {e}")
        
        # Crypto subsystem
        print("\nFetching crypto components...")
        try:
            components['btc_usd_zscore'] = calc._calc_btc_usd_zscore(date)
        except Exception as e:
            print(f"  ✗ btc_usd_zscore failed: {type(e).__name__}: {e}")
            
        try:
            components['btc_gold_zscore'] = calc._calc_btc_gold_zscore(date)
        except Exception as e:
            print(f"  ✗ btc_gold_zscore failed: {type(e).__name__}: {e}")
            
        try:
            components['crypto_m2_ratio'] = calc._calc_crypto_m2_ratio(date)
        except Exception as e:
            print(f"  ✗ crypto_m2_ratio failed: {type(e).__name__}: {e}")
            
        try:
            components['crypto_vs_fed_bs'] = calc._calc_crypto_vs_fed(date)
        except Exception as e:
            print(f"  ✗ crypto_vs_fed_bs failed: {type(e).__name__}: {e}")
        
        # Filter out None
        components = {k: v for k, v in components.items() if v is not None}
        
        if not components:
            print("\n❌ No components could be gathered!\n")
            return
        
        print('\n=== AAS Component Availability ===\n')
        print('METALS SUBSYSTEM (9 components):')
        metals_keys = [
            'gold_usd_zscore', 'silver_usd_zscore', 'platinum_usd_zscore', 
            'palladium_usd_zscore', 'gold_silver_ratio_signal', 
            'platinum_gold_ratio_signal', 'palladium_gold_ratio_signal',
            'comex_stress_ratio', 'cb_gold_momentum'
        ]
        
        for i, key in enumerate(metals_keys, 1):
            val = components.get(key)
            status = '✓ OK' if val is not None else '✗ MISSING'
            val_str = f'{val:.4f}' if val is not None else 'N/A'
            print(f'  {i}. {key:35s} {status:10s} value={val_str}')

        print('\nCRYPTO SUBSYSTEM (9 components):')
        crypto_keys = [
            'btc_usd_zscore', 'eth_usd_zscore', 'btc_gold_zscore', 
            'crypto_m2_ratio', 'crypto_vs_fed_bs', 'stablecoin_supply_velocity', 
            'btc_dominance', 'defi_tvl_change', 'exchange_reserves_trend'
        ]
        
        for i, key in enumerate(crypto_keys, 10):
            val = components.get(key)
            status = '✓ OK' if val is not None else '✗ MISSING'
            val_str = f'{val:.4f}' if val is not None else 'N/A'
            print(f'  {i}. {key:35s} {status:10s} value={val_str}')

        available = sum(1 for v in components.values() if v is not None)
        print(f'\n📊 Total available: {available}/18 components')
        print(f'   Threshold: 9/18 (50%) required')
        print(f'   Status: {"✓ PASS" if available >= 9 else "✗ FAIL"}')
        
    finally:
        db.close()

if __name__ == '__main__':
    main()
