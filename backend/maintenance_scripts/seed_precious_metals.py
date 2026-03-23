"""
Seed precious metals data for AAS calculations.
"""
from datetime import datetime, timedelta
from app.models.precious_metals import *
from app.core.db import SessionLocal

print('Seeding precious metals data...')

db = SessionLocal()
try:
    # Seed metal prices (last 90 days for better AAS calculations)
    today = datetime.utcnow()
    metals = [
        ('AU', 2100.0),
        ('AG', 24.5),
        ('PT', 950.0),
        ('PD', 1050.0)
    ]
    
    for days_ago in range(90, 0, -1):
        date = today - timedelta(days=days_ago)
        for metal, base_price in metals:
            # Add some realistic variation
            variation = (days_ago % 7) * 0.01
            price = base_price * (1 + variation - 0.03)
            metal_price = MetalPrice(
                metal=metal,
                date=date,
                price_usd_per_oz=price,
                source='SEED'
            )
            db.add(metal_price)
    
    # Seed metal ratios (last 90 days)
    for days_ago in range(90, 0, -1):
        date = today - timedelta(days=days_ago)
        
        # Au/Ag ratio
        ratio = MetalRatio(
            date=date,
            metal1='AU',
            metal2='AG',
            ratio_value=85.7 + (days_ago % 5) - 2,
            zscore_2y=0.5
        )
        db.add(ratio)
        
        # Pt/Au ratio
        ratio = MetalRatio(
            date=date,
            metal1='PT',
            metal2='AU',
            ratio_value=0.45,
            zscore_2y=-0.8
        )
        db.add(ratio)
        
        # Pd/Au ratio
        ratio = MetalRatio(
            date=date,
            metal1='PD',
            metal2='AU',
            ratio_value=0.50,
            zscore_2y=0.2
        )
        db.add(ratio)
    
    # Seed CB holdings
    countries = [
        ('United States', 8133.0, 68.2),
        ('Germany', 3355.0, 67.5),
        ('Italy', 2452.0, 64.3),
        ('France', 2437.0, 60.8),
        ('China', 2068.0, 3.5),
        ('Russia', 2332.0, 22.4)
    ]
    
    for country, tonnes, pct in countries:
        cb_holding = CBHolding(
            country=country,
            date=today - timedelta(days=30),
            gold_tonnes=tonnes,
            pct_of_reserves=pct,
            source='SEED'
        )
        db.add(cb_holding)
    
    # Seed supply data
    supply_metals = [
        ('AU', 3200.0, -1.5, 1050.0, 30.0),
        ('AG', 26000.0, 0.5, 18.0, 25.0),
        ('PT', 190.0, -2.3, 950.0, 35.0),
        ('PD', 210.0, -3.5, 1800.0, 40.0)
    ]
    
    for metal, prod, yoy, aisc, recycling in supply_metals:
        supply = SupplyData(
            metal=metal,
            period='2025-Q4',
            production_tonnes=prod,
            production_yoy_pct=yoy,
            aisc_per_oz=aisc,
            recycling_pct=recycling,
            source='SEED'
        )
        db.add(supply)
    
    # Seed COMEX inventory (last 90 days)
    for days_ago in range(90, 0, -1):
        date = today - timedelta(days=days_ago)
        comex = COMEXInventory(
            date=date,
            metal='AU',
            registered_oz=8500000.0 + (days_ago * 10000),
            eligible_oz=5200000.0,
            total_oz=13700000.0 + (days_ago * 10000),
            open_interest=450000.0,
            oi_to_registered_ratio=0.95,
            source='SEED'
        )
        db.add(comex)
    
    db.commit()
    print('✓ Seed data added successfully')
    print(f'  - {len(metals) * 90} metal prices')
    print(f'  - {90 * 3} metal ratios')
    print(f'  - {len(countries)} CB holdings')
    print(f'  - {len(supply_metals)} supply records')
    print(f'  - 90 COMEX inventory records')
finally:
    db.close()
