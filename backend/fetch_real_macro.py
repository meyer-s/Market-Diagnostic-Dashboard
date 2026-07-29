"""
Backfill real macro liquidity data from FRED API
"""
from datetime import datetime, timedelta
import requests
import time
from app.core.config import settings
from app.core.db import SessionLocal
from app.models.alternative_assets import MacroLiquidityData

FRED_API_KEY = settings.FRED_API_KEY
FRED_API = "https://api.stlouisfed.org/fred/series/observations"

def fetch_fred_series(series_id, start_date):
    """Fetch a FRED series"""
    if not FRED_API_KEY:
        raise RuntimeError("FRED_API_KEY is required to fetch macro history")
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": start_date.strftime("%Y-%m-%d"),
        "sort_order": "asc"
    }
    response = requests.get(FRED_API, params=params)
    data = response.json()
    return {obs['date']: float(obs['value']) if obs['value'] != '.' else None 
            for obs in data.get('observations', [])}

def fetch_macro_history(days=365):
    """Fetch historical macro data from FRED"""
    db = SessionLocal()
    
    try:
        print(f"\n🔄 Fetching {days} days of macro data from FRED...")
        
        # Delete seed data first
        deleted = db.query(MacroLiquidityData).filter(MacroLiquidityData.source == 'SEED').delete()
        db.commit()
        print(f"  Deleted {deleted} seed records")
        
        start_date = datetime.utcnow() - timedelta(days=days+10)
        
        # Fetch key series
        print("\n  Fetching Fed Balance Sheet (WALCL)...")
        fed_bs = fetch_fred_series("WALCL", start_date)
        time.sleep(1)
        
        print("  Fetching ECB Balance Sheet (ECBASSETSW)...")
        ecb_bs = fetch_fred_series("ECBASSETSW", start_date)
        time.sleep(1)
        
        print("  Fetching Global M2 proxy (M2SL for US)...")
        us_m2 = fetch_fred_series("M2SL", start_date)
        time.sleep(1)
        
        print("  Fetching Fed Funds Rate (DFF)...")
        fed_rate = fetch_fred_series("DFF", start_date)
        time.sleep(1)
        
        print("  Fetching 10Y Treasury Rate (DGS10)...")
        treasury_10y = fetch_fred_series("DGS10", start_date)
        time.sleep(1)
        
        print("  Fetching 10Y TIPS Rate (DFII10)...")
        tips_10y = fetch_fred_series("DFII10", start_date)
        
        # Combine into daily records
        all_dates = sorted(set(list(fed_bs.keys()) + list(us_m2.keys()) + list(fed_rate.keys())))
        
        added = 0
        for date_str in all_dates:
            try:
                date = datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                continue
            
            # Calculate real rate
            treasury = treasury_10y.get(date_str)
            tips = tips_10y.get(date_str)
            real_rate = (treasury - tips) if (treasury and tips) else None
            
            macro_data = MacroLiquidityData(
                date=date,
                fed_balance_sheet=fed_bs.get(date_str),
                ecb_balance_sheet=ecb_bs.get(date_str),
                pboc_balance_sheet=None,  # Not available from FRED
                boj_balance_sheet=None,  # Not available from FRED
                global_m2=us_m2.get(date_str) * 4.5 if us_m2.get(date_str) else None,  # Rough global estimate
                global_liquidity_index=None,  # Would need to calculate
                fed_rate=fed_rate.get(date_str),
                real_rate_10y=real_rate,
                source='FRED'
            )
            db.add(macro_data)
            added += 1
            
            if added % 10 == 0:
                print(f"    {added} days processed...")
        
        db.commit()
        print(f"\n✅ Added {added} real macro data records from FRED")
        
    except Exception as e:
        print(f"❌ Error fetching macro data: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    fetch_macro_history(365)
