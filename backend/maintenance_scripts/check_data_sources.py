from app.core.db import SessionLocal
from app.models.precious_metals import MetalPrice, MetalRatio, COMEXInventory, CBHolding
from app.models.alternative_assets import CryptoPrice, MacroLiquidityData

db = SessionLocal()
try:
    metal_prices = db.query(MetalPrice).count()
    metal_prices_real = db.query(MetalPrice).filter(MetalPrice.source != 'SEED').count()
    
    ratios = db.query(MetalRatio).count()
    
    comex = db.query(COMEXInventory).count()
    comex_real = db.query(COMEXInventory).filter(
        COMEXInventory.source.notin_(['SEED', 'ESTIMATED_FROM_PRICES'])
    ).count()
    
    cb = db.query(CBHolding).count()
    cb_real = db.query(CBHolding).filter(CBHolding.source != 'SEED').count()
    
    crypto = db.query(CryptoPrice).count()
    crypto_real = db.query(CryptoPrice).filter(CryptoPrice.source != 'SEED').count()
    
    macro = db.query(MacroLiquidityData).count()
    macro_real = db.query(MacroLiquidityData).filter(MacroLiquidityData.source != 'SEED').count()
    
    print('\n📊 Data Source Analysis:')
    print(f'\n  Metal Prices: {metal_prices} total ({metal_prices_real} real, {metal_prices - metal_prices_real} seed)')
    print(f'  Metal Ratios: {ratios} total (calculated from prices)')
    print(f'  COMEX: {comex} total ({comex_real} real, {comex - comex_real} seed)')
    print(f'  CB Holdings: {cb} total ({cb_real} real, {cb - cb_real} seed)')
    print(f'  Crypto: {crypto} total ({crypto_real} real, {crypto - crypto_real} seed)')
    print(f'  Macro: {macro} total ({macro_real} real, {macro - macro_real} seed)')
    
    if metal_prices_real > 0:
        sample = db.query(MetalPrice).filter(MetalPrice.source != 'SEED').order_by(MetalPrice.date.desc()).limit(3).all()
        print(f'\n  Sample real metal prices:')
        for s in sample:
            print(f'    {s.date.date()} {s.metal}: ${s.price_usd_per_oz:.2f} (source: {s.source})')
    
    # Check date range of real data
    if metal_prices_real > 0:
        oldest = db.query(MetalPrice).filter(MetalPrice.source != 'SEED').order_by(MetalPrice.date).first()
        newest = db.query(MetalPrice).filter(MetalPrice.source != 'SEED').order_by(MetalPrice.date.desc()).first()
        print(f'\n  Real metal data range: {oldest.date.date()} to {newest.date.date()}')
finally:
    db.close()
